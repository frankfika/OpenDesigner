#!/usr/bin/env python3
"""从 docs/od-format-spec.md 抽出实现需要的全部内容，生成一份压缩的施工手册。

规格 2815 行，实现者读不动。这份手册只保留「写代码必需」的部分：
顶层结构 / 字段映射全表 / 引用重映射表 / 绑定路径表 / IdRegistry 契约 /
公开 API / MUST 测试清单 / 三条硬约束 / 章节行号索引（需要细节时再定点读）。

用法：python3 scripts/build-impl-guide.py
产物：docs/od-format-impl-guide.md
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs" / "od-format-spec.md"
OUT = ROOT / "docs" / "od-format-impl-guide.md"

lines = SPEC.read_text(encoding="utf-8").splitlines()


def slice_lines(start: int, end: int) -> str:
    """按 1-based 行号区间取文本（含首尾）。"""
    return "\n".join(lines[start - 1 : end])


def section(title: str) -> tuple[int, int]:
    """返回某个 '### 标题' 章节的 (起始行, 结束行)，结束行=下一个同级标题前一行。"""
    pat = re.compile(r"^#{2,3} " + re.escape(title) + r"\s*$")
    start = None
    for i, ln in enumerate(lines, 1):
        if pat.match(ln):
            start = i
            break
    if start is None:
        raise SystemExit(f"找不到章节：{title}")
    level = len(lines[start - 1]) - len(lines[start - 1].lstrip("#"))
    end = len(lines)
    for i in range(start, len(lines)):
        ln = lines[i]
        if ln.startswith("#") and (len(ln) - len(ln.lstrip("#"))) <= level:
            end = i
            break
    return start, end


def cut(title: str) -> str:
    s, e = section(title)
    return slice_lines(s, e)


# 需要全文收录的章节（实现必需）
FULL = [
    "0.2 三条不可协商的约束",
    "1.1 顶层键总表（规范顺序）",
    "1.2 `meta` — 文档元信息",
    "1.4 `assets` — 外部二进制资源",
    "2.2 odId 语法（正式文法）",
    "2.3 kind 前缀表",
    "2.4 slug 生成算法（规范性）",
    "2.5 唯一性与判别器",
    "2.6 odId ↔ engineId 映射：**文件里不存映射表**",
    "2.7 加载路径：`toEngine(doc)`",
    "2.8 保存路径：`fromEngine(graph, registry?)`",
    "2.11 `IdRegistry` API（实现契约）",
    "3.1 编码总则",
    "3.2 节点字段映射全表（154/154）",
    "3.3 文档层字段映射（SceneGraph 12 字段）",
    "3.4 哪些字段的值是「引用」（需要重映射）",
    "3.5 变量绑定路径的翻译表（规范性）",
    "3.6 自由格式 Map 的编码（`Map` → 对象）",
    "3.7 `instanceOverrides` 的值编码",
    "6.2 键顺序策略",
    "6.3 缩进、换行、编码",
    "6.4 浮点精度",
    "8.1 全局约定",
    "8.2 `od convert`",
    "8.3 `od inspect`",
    "8.4 `od validate`",
    "8.5 `od migrate` 与 `od schema`",
    "8.6 退出码",
    "8.7 错误信息格式",
    "9.1 包结构建议",
    "9.2 公开 API（与 `packages/od-format/src/index.ts` 的现有注释对齐）",
    "9.3 实现顺序建议（每步都可独立验证）",
    "9.4 MUST 写的测试清单",
]

parts: list[str] = []
parts.append(
    """# od-format 实现施工手册（从规格压缩而来）

> **这份是给实现者用的工作稿**，不是新规格——与 `docs/od-format-spec.md` 冲突时**以规格为准**。
> 生成方式：`python3 scripts/build-impl-guide.py`（从规格原文抽取，未改写内容）。
> 规格全文 2815 行，实现者不必通读；本手册已包含写代码所需的全部内容。
> 需要细节时用文末的**章节行号索引**定点读规格原文。
>
> ### ⚠️ 读法策略（上一轮就是死在这）
>
> **不要整份 `read` 本手册或规格。** 手册每节前面有 `<!-- ===== 标题 ===== -->` 标记，
> 用它定位、用 `sed -n '起,止p'` 只读需要的区间；单次 read 不要超过 300 行。
> 先花 5 分钟读懂你要写的那几节，**立刻开始写代码**，不要反复通读全文。
> 上一轮的执行者把整份 2815 行规格一次读完（4.7 万输入 token），30 分钟全部耗在读文档上，
> 一行代码都没写。

## 三条硬约束（违反即错，来自实测调研）

1. **`variableBindingScales` / `variableAssignmentScales` 必须往返保留** ——
   它们没有加载期重算入口（唯一写入口是实例同步/树缩放），且直接参与绑定解算
   `value * scale`。scale ≠ 1 时丢掉会**静默算出不同的数**。引擎自己的全图 round-trip
   也保留它们。
2. **`textPicture` 是派生缓存，剔除** —— 它是 Skia 段落快照，不是资产，不要走 base64 分支。
3. **`instanceOverrides` 必须用引擎自带的三态编解码**
   （`serializeInstanceOverrideState` / `deserializeInstanceOverrideState`，
   `scene-graph/src/instance-overrides.ts`）。直接 `JSON.stringify` 会丢光。
   同理**绝不能 `JSON.stringify(graph)`** —— TS 的 `private` 是编译期的事，
   会把 `emitter`/`absPosCache` 写进文本并把所有 `Map` 变成 `{}`。

## 依赖与版本（已锁定，别自己改）

- zod **4.6.7**：`z.record()` 要两个参数 `z.record(z.string(), z.unknown())`
- vitest **5.1.0**、typescript **5.9.3**（strict + noUncheckedIndexedAccess）
- `packages/od-format` 运行时依赖**只有** `@open-pencil/scene-graph@0.16.0` + `zod`
- `@open-pencil/core@0.16.0` 只在**根** devDependencies，可在测试里用它做渲染比对 /
  跑布局，但**不要**写进 od-format 的 dependencies
- JSON 字节数用 `Buffer.byteLength`（不是 `json.length`，那是 UTF-16 码元数）
- od-format **不跑布局**；规格 §9.2 有 `opts.layout` 注入点，调用方传 core 的布局函数

---
"""
)

for title in FULL:
    body = cut(title).rstrip()
    parts.append(f"\n<!-- ===== {title} ===== -->\n\n{body}\n")

# 章节行号索引
parts.append("\n<!-- ===== 章节行号索引（需要细节时定点读规格原文） ===== -->\n\n")
parts.append("| 行号 | 标题 |\n|---|---|\n")
for i, ln in enumerate(lines, 1):
    if re.match(r"^#{2,3} ", ln):
        parts.append(f"| {i} | {ln.lstrip('#').strip()} |\n")

parts.append(
    """
---

## 规格里**没有**收录、但你需要知道的

- §0.5 / §0.6 上游事实核对表（core 侧已核实事实）—— 想知道某条引擎行为是否已核实，看规格对应行号
- §1.3 `nodes` 集合（扁平数组 + parent 指针 + 前序遍历规则 + 节点键顺序）
- §1.5 变量与集合、§1.6 主题模式、§1.7 外部库绑定 —— 需要时按索引读规格
- §1.8 顶层完整示例 —— 实现完成后拿它当 fixture
- §3.1.1 省略规则（默认即省略）、§3.1.2 几何字段特殊省略（G1/G2）—— **在 §3.1 里**
- §4 三类硬骨头的完整讨论与验收红线（T1–T8）—— §4.5 有验收红线
- §5 版本策略与迁移框架（v0.1 → v1 的完整示例）
- §6.1 JSONC 注释容忍、§6.5 Unicode 转义、§6.6 短数组单行输出、§6.7 完整文本样例
- §7 公开 JSON Schema 的生成方式与防脱节机制
- §10 待核实清单
"""
)

OUT.write_text("".join(parts), encoding="utf-8")
print(f"wrote {OUT} ({len(''.join(parts))} chars, {OUT.read_text(encoding='utf-8').count(chr(10))} lines)")
