#!/usr/bin/env python3
"""从 @open-pencil/scene-graph 的 .d.ts 生成 docs/engine-semantics.md 的字段清单章节。

用法：
  python3 scripts/gen-engine-semantics.py                    # 打到 stdout
  python3 scripts/gen-engine-semantics.py --write docs/engine-semantics.md
  python3 scripts/gen-engine-semantics.py --check  docs/engine-semantics.md

字段清单必须从类型定义里机器生成，不许手抄——抄错一个字段名，
od-format 的 schema 就会按错的模型建，而且没人会发现。
docs/engine-semantics.md 里引用的清单与本脚本的输出必须逐字一致，
`--check` 就是这条约束的机器复核。
"""
import re
import sys
from pathlib import Path


BEGIN_MARK = "<!-- BEGIN GENERATED: engine-semantics -->"
END_MARK = "<!-- END GENERATED: engine-semantics -->"

# 默认 dist 路径按脚本自身定位，不依赖 cwd——这样从任何目录都能跑。
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIST = REPO_ROOT / "node_modules/@open-pencil/scene-graph/dist"


# ---- 分类规则 ----
# 判据（docs/engine-semantics.md §5）：
#   D 派生缓存 —— 引擎算出来的缓存，有 setter 也有重算入口，序列化时剔除、加载时重算
#   B 二进制   —— 字段里直接躺着一个 Uint8Array（或结构内嵌 blob）
#   S 语义字段 —— 值是 JSON 原生标量或字面量联合，直接映射
#   O 对象字段 —— 数组 / Record / 接口对象，序列化时要改名映射
DERIVED = {
    "derivedLayout",
    "derivedTextGlyphs",
    "variableBindingScales",
    "variableAssignmentScales",
}
# 直接二进制
BINARY_DIRECT = {"textPicture"}
# 结构内嵌二进制：GeometryPath.commandsBlob 是 Uint8Array（types.ts:2062）
BINARY_EMBEDDED = {"fillGeometry", "strokeGeometry"}

LABELS = {
    "S": "S 类 · 语义字段（JSON 原生标量 / 字面量联合）",
    "O": "O 类 · 对象字段（数组 / Record / 接口对象，需改名映射）",
    "B": "B 类 · 二进制（含 Uint8Array blob）",
    "D": "D 类 · 派生缓存（引擎算出来的；处理见下表备注）",
}

# 序列化处理备注。分类能机器判，备注不能——备注是人写的，写在脚本里，
# 于是文档里的表和脚本的输出一致，改一处两处都变。
NOTES = {
    "derivedLayout": "**D1 必丢**：scene-graph 内无重算入口，重算在 core 的布局趟",
    "derivedTextGlyphs": "**D1 必丢**：文本整形重算（内含 commandsBlob 二进制）",
    "variableBindingScales": "**D2 必留**：只有实例同步/缩放会重算；scale≠1 时丢弃会让绑定解出不同的数",
    "variableAssignmentScales": "**D2 必留**：实例作用域的新声明单位；引擎自己的 round-trip 也保留（core transfer.ts:85-86）",
    "textPicture": "**D1 必丢**：Skia 段落快照缓存，剔除即可，无需 base64",
    "fillGeometry": "结构内嵌 blob，可无损转 SVG path 后入文本",
    "strokeGeometry": "结构内嵌 blob，可无损转 SVG path 后入文本",
}

# SceneGraph 实例级状态：字段名 -> 往返处理。
# 键必须是 dist/types.d.ts 里 SceneGraph 的公开字段名或 private 字段名；
# 脚本会核对，多一个少一个都报错——说明包升级了，这里的表得重写。
GRAPH_STATE = {
    "nodes": "必须往返（id → 节点，od-format 的主表）",
    "images": "**二进制**：外置 assets/ + hash 引用",
    "variables": "必须往返（变量声明）",
    "variableCollections": "必须往返（变量集合 + 模式表）",
    "activeMode": "必须往返（collectionId → modeId）",
    "enabledLibraries": "必须往返（库启用绑定）",
    "rootId": "必须往返（文档根节点 id）",
    "documentColorSpace": "必须往返（srgb / display-p3）",
    "figKiwiVersion": "可丢弃（.fig 导入溯源）",
    "figSchemaDeflated": "可丢弃（二进制，.fig 导入溯源）",
    "instanceIndex": "可丢弃（派生索引，加载时由 registerNode 重建）",
    "positionPreviewVersion": "可丢弃（运行时计数）",
    "emitter": "私有（运行时事件总线）",
    "idGenerator": "私有（ID 生成器，构造期注入）",
    "absPosCache": "私有（绝对位置缓存，加载时清空）",
    "previewMutationDepth": "私有（运行时深度计数）",
    "previewObservers": "私有（运行时观察者）",
    "changeObservers": "私有（运行时观察者）",
    "sourceMetadataPreservationDepth": "私有（运行时深度计数）",
    "importedStateApplicationDepth": "私有（运行时深度计数）",
    "importedIdGenerator": "私有（导入期的 ID 生成器）",
    "layoutMutationDepth": "私有（运行时深度计数）",
    "derivedLayoutDepth": "私有（运行时深度计数）",
}


def cell(text: str) -> str:
    """markdown 表格单元格：类型里的 `|` 会劈开单元格，得转义。"""
    return text.replace("|", "\\|")


def strip_comments(src: str) -> str:
    return re.sub(r"/\*.*?\*/", "", src, flags=re.S)


def interface_body(src: str, name: str) -> str:
    m = re.search(
        r"^(?:declare )?(?:interface|class) " + re.escape(name) + r"\b[^{]*\{",
        src,
        re.M,
    )
    if not m:
        raise SystemExit(f"interface/class {name} not found")
    i = m.end() - 1
    depth = 0
    j = i
    while j < len(src):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return src[m.end():j]


def fields(src: str, name: str) -> dict:
    body = strip_comments(interface_body(src, name))
    out = {}
    for line in body.split("\n"):
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        m = re.match(r"^(?:readonly )?([A-Za-z_$][\w$]*)\??\s*:\s*(.+?);$", line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def type_aliases(src: str) -> dict:
    """`type X = ...` 的别名表，用来判断一个具名类型是不是字面量联合。"""
    out = {}
    for m in re.finditer(r"^(?:declare )?type ([A-Za-z_$][\w$]*)\s*=\s*(.+?);$", src, re.M):
        out[m.group(1)] = m.group(2).strip()
    return out


def is_literal_union(typ: str, aliases: dict) -> bool:
    """类型是不是纯字面量联合（`'A' | 'B'` 或指向这种联合的具名类型）。"""
    typ = typ.strip()
    if typ.endswith("| null") or typ.endswith("| undefined"):
        typ = typ.rsplit("|", 1)[0].strip()
    if "|" in typ:
        parts = [p.strip() for p in typ.split("|")]
        return all(p.startswith("'") and p.endswith("'") for p in parts)
    if typ.startswith("'") and typ.endswith("'"):
        return True
    if typ in aliases:
        return is_literal_union(aliases[typ], aliases)
    return False


def is_scalar(typ: str, aliases: dict) -> bool:
    """类型是不是 JSON 原生标量（含 null / undefined 可选）。"""
    base = typ
    for suffix in (" | null", " | undefined"):
        if base.endswith(suffix):
            base = base[: -len(suffix)].strip()
    if base in ("string", "number", "boolean"):
        return True
    return is_literal_union(base, aliases)


def classify(name: str, typ: str, aliases: dict) -> str:
    if name in DERIVED:
        return "D"
    if name in BINARY_DIRECT or name in BINARY_EMBEDDED:
        return "B"
    if is_scalar(typ, aliases):
        return "S"
    return "O"


def graph_public_fields(src: str) -> list:
    """SceneGraph 的实例字段：公开的 + private 的，按 .d.ts 里的声明顺序。"""
    out = []
    for line in strip_comments(interface_body(src, "SceneGraph")).split("\n"):
        line = line.strip()
        # 字段声明都在 constructor 之前；之后都是方法签名和内联返回类型
        if line.startswith("constructor"):
            break
        if not line or line.startswith("//"):
            continue
        # 私有字段在 .d.ts 里常写成 `private absPosCache;`——没有类型标注，
        # 类型标注被 TS 抹掉了。类型列照实写「未标注」，不手抄源码里的类型。
        m = re.match(
            r"^(?:private |protected |public )?(?:readonly )?([A-Za-z_$][\w$]*)\??\s*(?::\s*(.+?))?\s*;?\s*$",
            line,
        )
        if m:
            typ = m.group(2).strip().rstrip(";") if m.group(2) else "（未在 .d.ts 标注）"
            out.append((m.group(1), typ))
    return out


def summary_line(src: str) -> str:
    aliases = type_aliases(src)
    node = fields(src, "SceneNode")
    graph = graph_public_fields(src)
    counts = {}
    for name, typ in node.items():
        counts[classify(name, typ, aliases)] = counts.get(classify(name, typ, aliases), 0) + 1
    return (
        "SceneNode %d 个字段（S %d / O %d / B %d / D %d）；SceneGraph 实例级状态 %d 个"
        % (
            len(node),
            counts.get("S", 0),
            counts.get("O", 0),
            counts.get("B", 0),
            counts.get("D", 0),
            len(graph),
        )
    )


def render(src: str) -> str:
    aliases = type_aliases(src)
    node = fields(src, "SceneNode")
    graph = graph_public_fields(src)

    unknown = [name for name, _ in graph if name not in GRAPH_STATE]
    if unknown:
        raise SystemExit(f"SceneGraph 字段未登记往返处理：{unknown}")
    missing = [name for name in GRAPH_STATE if name not in {n for n, _ in graph}]
    if missing:
        raise SystemExit(f"GRAPH_STATE 里登记了 SceneGraph 没有的字段：{missing}")

    buckets: dict = {}
    for name, typ in node.items():
        buckets.setdefault(classify(name, typ, aliases), []).append((name, typ))

    lines = []
    lines.append("### 10.1 SceneNode 字段全表（%d 个）\n" % len(node))
    lines.append(
        "来源：`node_modules/@open-pencil/scene-graph/dist/types.d.ts` 的 `interface SceneNode`，"
        "由 `scripts/gen-engine-semantics.py` 机器生成（字段名与类型均从 .d.ts 解析，非手抄）。\n"
    )
    lines.append("| 分类 | 字段数 | 序列化处理 |")
    lines.append("|---|---|---|")
    for key, treatment in (
        ("S", "直接 JSON"),
        ("O", "结构映射（改名 + 字段级编码）"),
        ("B", "外置资产 / base64"),
        ("D", "D1 必丢（重算）/ D2 必留（无重算入口）—— 见下表备注"),
    ):
        lines.append(f"| {LABELS[key]} | {len(buckets.get(key, []))} | {treatment} |")
    lines.append("")

    for key in ["S", "O", "B", "D"]:
        items = buckets.get(key, [])
        lines.append(f"#### {LABELS[key]} —— {len(items)} 个\n")
        lines.append("| 字段 | 类型 | 序列化处理 |")
        lines.append("|---|---|---|")
        for name, typ in items:
            note = NOTES.get(name, {
                "S": "直接 JSON",
                "O": "结构映射（改名 + 字段级编码）",
                "B": "外置资产 / base64",
                "D": "剔除，加载时重算",
            }[key])
            lines.append(f"| `{name}` | `{cell(typ)}` | {note} |")
        lines.append("")

    lines.append("### 10.2 SceneGraph 实例级状态全表（%d 个）\n" % len(graph))
    lines.append(
        "来源：同文件 `declare class SceneGraph` 的字段声明（`constructor` 之前），"
        "由 `scripts/gen-engine-semantics.py` 机器生成。\n"
    )
    lines.append("| 字段 | 类型 | 往返处理 |")
    lines.append("|---|---|---|")
    for name, typ in graph:
        lines.append(f"| `{name}` | `{cell(typ)}` | {GRAPH_STATE[name]} |")
    lines.append("")

    counts = {k: len(v) for k, v in buckets.items()}
    lines.append("### 10.3 计数摘要\n")
    lines.append(
        "SceneNode 共 %d 个字段：S %d / O %d / B %d / D %d；"
        "SceneGraph 实例级状态共 %d 个。"
        % (
            len(node),
            counts.get("S", 0),
            counts.get("O", 0),
            counts.get("B", 0),
            counts.get("D", 0),
            len(graph),
        )
    )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    args = sys.argv[1:]
    dist = DEFAULT_DIST
    mode = "print"
    target = None
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--write" or arg == "--check":
            mode = arg[2:]
            i += 1
            if i >= len(args):
                raise SystemExit(f"{arg} 需要一个文档路径")
            target = Path(args[i])
        elif arg == "--dist":
            i += 1
            if i >= len(args):
                raise SystemExit("--dist 需要一个路径")
            dist = Path(args[i])
        else:
            raise SystemExit(f"未知参数：{arg}")
        i += 1

    src = strip_comments((dist / "types.d.ts").read_text(encoding="utf-8", errors="replace"))
    body = render(src)

    if mode == "print":
        print(body)
        return

    doc = target.read_text(encoding="utf-8")
    if BEGIN_MARK not in doc or END_MARK not in doc:
        raise SystemExit(f"{target} 里没有生成标记（{BEGIN_MARK} / {END_MARK}）")
    start = doc.index(BEGIN_MARK) + len(BEGIN_MARK)
    end = doc.index(END_MARK)
    current = doc[start:end].strip("\n")

    if mode == "check":
        if current != body.strip("\n"):
            print("FAIL: docs 里的清单与脚本输出不一致（手抄过？）", file=sys.stderr)
            print("--- docs ---", file=sys.stderr)
            print(current, file=sys.stderr)
            print("--- script ---", file=sys.stderr)
            print(body, file=sys.stderr)
            raise SystemExit(1)
        print("OK: %s 的字段清单与 .d.ts 一致" % target)
        print("    " + summary_line(src))
        return

    # write
    doc = doc[:start] + "\n" + body.strip("\n") + "\n" + doc[end:]
    target.write_text(doc, encoding="utf-8")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
