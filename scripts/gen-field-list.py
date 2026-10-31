#!/usr/bin/env python3
"""从 @open-pencil/scene-graph 的 .d.ts 生成 docs/sdk-notes.md 的字段清单章节。

用法：python3 scripts/gen-field-list.py <scene-graph-dist-dir> <输出md>
字段清单必须从类型定义里机器生成，不许手抄——抄错一个字段名，
Phase 1 的 schema 就会按错的模型建。
"""
import re
import sys
from pathlib import Path


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


# ---- 分类规则 ----
DERIVED = {
    "derivedLayout",
    "derivedTextGlyphs",
    "variableBindingScales",
    "variableAssignmentScales",
}
BINARY_DIRECT = {"textPicture"}
# 内部是 Uint8Array，但可无损转成 SVG path / 字节记录
BINARY_ENCODED = {"fillGeometry", "strokeGeometry"}
STRUCTURED = {
    "childIds", "source", "fills", "strokes", "effects", "layoutGrids", "guides",
    "textDecorationFills", "textParagraphs", "styleRuns", "fontVariations",
    "fontFeatures", "vectorNetwork", "booleanOperation", "dashPattern",
    "strokeAlign", "maskType", "gridTemplateColumns", "gridTemplateRows",
    "instanceOverrides", "componentPropertyDefinitions", "componentPropertyReferences",
    "componentPropertyAssignments", "componentPropertyValues", "symbolLinks",
    "variantPropSpecs", "boundVariables", "variableModes", "exportSettings",
    "pluginData", "pluginRelaunchData", "textPathData",
}
PLAIN = re.compile(
    r"^(string|number|boolean|null)$"
    r"|^'[^']*'(\s*\|\s*'[^']*')*$"
    r"|^[\w.]+(\s*\|\s*(null|undefined|'[^']*'|[\w.]+))*$"
)


def classify(name: str, typ: str) -> str:
    if name in DERIVED:
        return "D"
    if name in BINARY_DIRECT:
        return "C"
    if name in BINARY_ENCODED:
        return "B2"
    if name in STRUCTURED:
        return "B"
    if PLAIN.match(typ):
        return "A"
    return "B"


LABELS = {
    "A": "A 类 · JSON 原生（number/string/boolean/字面量联合）",
    "B": "B 类 · 纯对象结构（改名映射即可，不含二进制）",
    "B2": "B2 类 · 结构内嵌二进制 blob（可无损编码成文本）",
    "C": "C 类 · 直接二进制（需 base64 或外置资产）",
    "D": "D 类 · 派生缓存（序列化时丢弃，加载时重算）",
}


def main() -> None:
    dist = Path(sys.argv[1])
    out = Path(sys.argv[2])
    src = strip_comments((dist / "types.d.ts").read_text(encoding="utf-8", errors="replace"))

    node = fields(src, "SceneNode")
    graph_public = []
    for line in strip_comments(interface_body(src, "SceneGraph")).split("\n"):
        line = line.strip()
        # 字段声明都在 constructor 之前；之后都是方法签名和内联返回类型，不要
        if line.startswith("constructor"):
            break
        if line and not line.startswith("//"):
            graph_public.append(line.rstrip(";"))

    buckets: dict[str, list] = {}
    for name, typ in node.items():
        buckets.setdefault(classify(name, typ), []).append((name, typ))

    lines = []
    lines.append("### 3.1 SceneNode 字段全表（%d 个）\n" % len(node))
    lines.append(
        "来源：`node_modules/@open-pencil/scene-graph/dist/types.d.ts`，"
        "`interface SceneNode`（由 `scripts/gen-field-list.py` 机器生成）。\n"
    )
    for key in ["A", "B", "B2", "C", "D"]:
        items = buckets.get(key, [])
        lines.append(f"#### {LABELS[key]} —— {len(items)} 个\n")
        lines.append("| 字段 | 类型 |")
        lines.append("|---|---|")
        for name, typ in items:
            lines.append(f"| `{name}` | `{typ}` |")
        lines.append("")

    lines.append("### 3.2 SceneGraph 文档层字段\n")
    lines.append("| 字段 | 类型 | 序列化处理 |")
    lines.append("|---|---|---|")
    for raw in graph_public:
        m = re.match(r"^(?:readonly )?([A-Za-z_$][\w$]*)\??\s*:\s*(.+)$", raw)
        if not m:
            continue
        name, typ = m.group(1), m.group(2).strip()
        if name in ("emitter",):
            continue
        note = "直接 JSON"
        if name == "nodes":
            note = "对象数组（id → 节点）"
        elif name == "images":
            note = "**二进制**：外置 assets/ + hash 引用"
        elif name == "variables":
            note = "直接 JSON"
        elif name == "variableCollections":
            note = "直接 JSON"
        elif name == "activeMode":
            note = "直接 JSON"
        elif name == "enabledLibraries":
            note = "直接 JSON"
        elif name == "instanceIndex":
            note = "派生索引，丢弃后重算"
        elif name == "figSchemaDeflated":
            note = "**二进制**，.fig 导入溯源，丢弃"
        elif name == "figKiwiVersion":
            note = ".fig 导入溯源，丢弃"
        elif name == "positionPreviewVersion":
            note = "运行时计数，丢弃"
        elif name == "rootId":
            note = "直接 JSON"
        elif name == "documentColorSpace":
            note = "直接 JSON"
        lines.append(f"| `{name}` | `{typ}` | {note} |")
    lines.append("")

    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out} ({len(node)} node fields)")


if __name__ == "__main__":
    main()
