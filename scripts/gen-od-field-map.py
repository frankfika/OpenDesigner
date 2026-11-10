#!/usr/bin/env python3
"""生成 packages/od-format/src/field-map.ts —— od-format 的字段映射单一事实源。

设计原则（见 docs/od-format-spec.md §3.2）：
  * **字段清单**从引擎的 .d.ts 机器解析 —— 绝不手抄，手抄的清单不许通过验证。
  * **od 字段路径**是设计决策（M 表），已由规格复核；本脚本只做搬运 + 双向覆盖断言。

用法：
    python3 scripts/gen-od-field-map.py            # 生成
    python3 scripts/gen-od-field-map.py --check    # 只校验，不写盘（CI 用）

产物：packages/od-format/src/field-map.ts
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DTS = os.path.join(ROOT, 'node_modules/@open-pencil/scene-graph/dist/types.d.ts')
OUT = os.path.join(ROOT, 'packages/od-format/src/field-map.ts')

# ---------------------------------------------------------------------------
# 1. 从引擎 .d.ts 机器解析 SceneNode 的字段名与类型
# ---------------------------------------------------------------------------
src = open(DTS, encoding='utf-8').read()
m = re.search(r'^interface SceneNode \{(.*?)^\}', src, re.S | re.M)
if not m:
    sys.exit('FAIL: 在 types.d.ts 里找不到 interface SceneNode')
body = m.group(1)

fields = []          # [(name, typeText)]
for line in body.split('\n'):
    line = line.strip()
    mm = re.match(r'^(?:readonly )?([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*(.+?)(?:;)?$', line)
    if mm:
        fields.append((mm.group(1), mm.group(2).rstrip(';')))
names = [f[0] for f in fields]
TYPES = dict(fields)


# 类型别名表：`type LayoutMode = 'HORIZONTAL' | 'VERTICAL'` → enum
# 不解析别名的话，枚举字段会被误判成 object，schema 就会要求一个对象而不是字符串。
ALIASES = {}
for _m in re.finditer(r'^type\s+([A-Za-z_]\w*)\s*=\s*(.+?)(?:;|\n)', src, re.M):
    _name, _rhs = _m.group(1), _m.group(2).strip()
    if _rhs.startswith("'"):
        ALIASES[_name] = 'enum'
    elif '|' in _rhs and all(re.fullmatch(r"'[^']*'", p.strip()) for p in _rhs.split('|')):
        ALIASES[_name] = 'enum'
    elif _rhs in ('string', 'number', 'boolean'):
        ALIASES[_name] = _rhs


def value_kind(t: str) -> str:
    """把 .d.ts 的类型文本归一化成 schema 用的粗粒度类别。"""
    t = t.strip()
    if t in ALIASES:
        return ALIASES[t]
    if t.endswith('[]'):
        return 'array'
    if t.startswith('Record<') or t.startswith('{'):
        return 'object'
    if t.startswith('(') and '|' in t and t.endswith(')'):
        inner = t[1:-1]
        parts = [p.strip() for p in inner.split('|')]
        if all(p in ('number', 'string', 'boolean') for p in parts):
            return 'literal-union'
        return 'object'
    if '|' in t:
        parts = [p.strip() for p in t.split('|')]
        non_null = [p for p in parts if p != 'null']
        if not non_null:
            return 'null'
        if len(non_null) == 1:
            return value_kind(non_null[0])
        # 字面量联合（枚举）优先判成 enum
        if all(re.fullmatch(r"'[^']*'", p) for p in non_null):
            return 'enum'
        if all(p in ('number', 'string', 'boolean') for p in non_null):
            return 'literal-union'
        return 'object'
    if t in ('number', 'string', 'boolean'):
        return t
    if t == 'null':
        return 'null'
    if t in ('Uint8Array', 'Uint8Array<ArrayBufferLike>'):
        return 'binary'
    return 'object'


# ---------------------------------------------------------------------------
# 2. 设计映射表：引擎字段 -> (od 路径, 处理方式, 说明)
# ---------------------------------------------------------------------------
M = {
 # --- 结构 ---
 'id': ('id', '改名', '语义改名：值不再是引擎 id，而是 odId（见 §2）'),
 'type': ('type', '原样', '枚举原样保留（SCREAMING_SNAKE）'),
 'name': ('name', '原样', ''),
 'parentId': ('parent', '改名', '引用父节点 odId；根节点省略'),
 'childIds': ('children', '改名', '引用子节点 odId，按绘制顺序；**实例的拷贝子节点照常写入**（§4.1 决策 I-1）'),
 # --- 几何 ---
 'x': ('box.x', '合并', '**一律照存**，不因是布局派生量而省略（§3.1.2 规则 G）'),
 'y': ('box.y', '合并', '同上：一律照存'),
 'width': ('box.width', '合并', '一律照存，不因派生而省略（§3.1.2）'),
 'height': ('box.height', '合并', '同上：一律照存'),
 'rotation': ('box.rotation', '合并', ''),
 'minWidth': ('limits.minWidth', '合并', ''),
 'maxWidth': ('limits.maxWidth', '合并', ''),
 'minHeight': ('limits.minHeight', '合并', ''),
 'maxHeight': ('limits.maxHeight', '合并', ''),
 'targetAspectRatio': ('limits.aspect', '原样', '结构 {x,y} 不变'),
 # --- 来源 ---
 'source': ('source', '拆分', '只保留 format/id/orderKey/editedFields；丢弃 fig 载荷（§3.3）'),
 # --- 派生 ---
 'derivedLayout': ('—', '剔除', 'D1 派生缓存，加载时重算'),
 'derivedTextGlyphs': ('—', '剔除', 'D1 派生缓存，剔除重算'),
 'variableBindingScales': ('bindings.scales', '改名', '**D2 必留**：绑定值的单位乘数，无加载期重算入口'),
 'variableAssignmentScales': ('bindings.assignmentScales', '改名', '**D2 必留**：仅 INSTANCE 写，丢了回不来'),
 # --- 画笔 ---
 'fills': ('fills', '原样', '数组；元素结构见 §3.6'),
 'strokes': ('strokes', '原样', '数组；元素结构见 §3.6'),
 'effects': ('effects', '原样', '数组'),
 'fillGeometry': ('geometry.fill', '改名', 'GeometryPath[]；commandsBlob → SVG path d（§6.4）'),
 'strokeGeometry': ('geometry.stroke', '改名', '同上'),
 'vectorNetwork': ('geometry.network', '改名', 'VectorNetwork | null'),
 'arcData': ('geometry.arc', '改名', ''),
 'booleanOperation': ('geometry.boolean', '改名', '可 undefined → od 省略'),
 'dashPattern': ('stroke.dash', '改名', 'number[]'),
 'strokeAlign': ('stroke.align', '改名', ''),
 'strokeCap': ('stroke.cap', '改名', ''),
 'strokeJoin': ('stroke.join', '改名', ''),
 'strokeMiterLimit': ('stroke.miterLimit', '改名', ''),
 'strokeWeight': ('stroke.weight', '改名', ''),
 'borderTopWeight': ('borders.top', '改名', ''),
 'borderRightWeight': ('borders.right', '改名', ''),
 'borderBottomWeight': ('borders.bottom', '改名', ''),
 'borderLeftWeight': ('borders.left', '改名', ''),
 'independentStrokeWeights': ('borders.independent', '改名', ''),
 # --- 外观 ---
 'opacity': ('appearance.opacity', '改名', ''),
 'visible': ('appearance.visible', '改名', ''),
 'locked': ('appearance.locked', '改名', ''),
 'clipsContent': ('appearance.clipsContent', '改名', ''),
 'blendMode': ('appearance.blendMode', '改名', ''),
 'expanded': ('appearance.expanded', '改名', ''),
 'autoRename': ('appearance.autoRename', '改名', ''),
 'internalOnly': ('appearance.internal', '改名', ''),
 'isMask': ('appearance.mask', '改名', ''),
 'maskType': ('appearance.maskType', '改名', ''),
 'maskIsOutline': ('appearance.maskOutline', '改名', ''),
 'cornerRadius': ('corners.radius', '改名', '与四角的统一入口：值等于四角时写标量，否则展开'),
 'topLeftRadius': ('corners.topLeft', '改名', ''),
 'topRightRadius': ('corners.topRight', '改名', ''),
 'bottomRightRadius': ('corners.bottomRight', '改名', ''),
 'bottomLeftRadius': ('corners.bottomLeft', '改名', ''),
 'independentCorners': ('corners.independent', '改名', ''),
 'cornerSmoothing': ('corners.smoothing', '改名', ''),
 'flipX': ('flip.x', '改名', ''),
 'flipY': ('flip.y', '改名', ''),
 'handleMirroring': ('flip.handleMirroring', '改名', ''),
 # --- 共享样式引用 ---
 'fillStyleId': ('styles.fill', '改名', '外部/派生引用，值保持原样字符串（§3.5）'),
 'strokeStyleId': ('styles.stroke', '改名', '同上'),
 'textStyleId': ('styles.text', '改名', '同上'),
 'effectStyleId': ('styles.effect', '改名', '同上'),
 'gridStyleId': ('styles.grid', '改名', '同上'),
 'sharedStyleType': ('styles.sharedType', '改名', ''),
 # --- 文本 ---
 'text': ('text.content', '改名', '字符串绑定路径改为 text.content（§3.5）'),
 'fontSize': ('text.font.size', '改名', ''),
 'fontFamily': ('text.font.family', '改名', ''),
 'fontWeight': ('text.font.weight', '改名', ''),
 'italic': ('text.font.italic', '改名', ''),
 'fontVariations': ('text.font.variations', '改名', ''),
 'fontFeatures': ('text.font.features', '改名', ''),
 'textAlignHorizontal': ('text.align.horizontal', '改名', ''),
 'textAlignVertical': ('text.align.vertical', '改名', ''),
 'textDirection': ('text.direction', '改名', ''),
 'textLanguage': ('text.language', '改名', ''),
 'textAutoResize': ('text.autosize', '改名', ''),
 'textCase': ('text.case', '改名', ''),
 'textDecoration': ('text.decoration.kind', '改名', 'NONE/UNDERLINE/STRIKETHROUGH'),
 'textDecorationStyle': ('text.decoration.style', '改名', 'SOLID/DOTTED/WAVY'),
 'textDecorationThickness': ('text.decoration.thickness', '改名', ''),
 'textDecorationSkipInk': ('text.decoration.skipInk', '改名', ''),
 'textDecorationFills': ('text.decoration.fills', '改名', ''),
 'textUnderlineOffset': ('text.decoration.underlineOffset', '改名', ''),
 'leadingTrim': ('text.leading.trim', '改名', ''),
 'lineHeight': ('text.leading.lineHeight', '改名', ''),
 'letterSpacing': ('text.leading.letterSpacing', '改名', ''),
 'maxLines': ('text.limits.maxLines', '改名', ''),
 'textTruncation': ('text.limits.truncation', '改名', ''),
 'listSpacing': ('text.list.spacing', '改名', ''),
 'paragraphSpacing': ('text.list.paragraphSpacing', '改名', ''),
 'paragraphIndent': ('text.list.paragraphIndent', '改名', ''),
 'hangingList': ('text.list.hanging', '改名', ''),
 'textParagraphs': ('text.paragraphs', '改名', ''),
 'styleRuns': ('text.runs', '改名', 'StyleRun[]；run.style 内部字段原样'),
 'textPathData': ('text.path', '改名', 'TextPathData | null'),
 'textPathBox': ('text.pathBox', '改名', 'Rect | null'),
 'textPicture': ('—', '剔除', '**D1**：Skia 段落快照**缓存**，不是资产，剔除即可'),
 # --- 自动布局 ---
 'layoutMode': ('layout.mode', '改名', ''),
 'layoutDirection': ('layout.direction', '改名', ''),
 'layoutWrap': ('layout.wrap', '改名', ''),
 'primaryAxisAlign': ('layout.align.primary', '改名', ''),
 'counterAxisAlign': ('layout.align.counter', '改名', ''),
 'counterAxisAlignContent': ('layout.align.content', '改名', ''),
 'primaryAxisSizing': ('layout.sizing.primary', '改名', ''),
 'counterAxisSizing': ('layout.sizing.counter', '改名', ''),
 'itemSpacing': ('layout.gap', '改名', '变量绑定路径同步改写'),
 'counterAxisSpacing': ('layout.crossGap', '改名', ''),
 'paddingTop': ('layout.padding.top', '改名', ''),
 'paddingRight': ('layout.padding.right', '改名', ''),
 'paddingBottom': ('layout.padding.bottom', '改名', ''),
 'paddingLeft': ('layout.padding.left', '改名', ''),
 'layoutPositioning': ('layout.positioning', '改名', ''),
 'layoutGrow': ('layout.grow', '改名', ''),
 'layoutAlignSelf': ('layout.alignSelf', '改名', ''),
 'itemReverseZIndex': ('layout.reverseZ', '改名', ''),
 'strokesIncludedInLayout': ('layout.includeStrokes', '改名', ''),
 'horizontalConstraint': ('constraints.horizontal', '改名', ''),
 'verticalConstraint': ('constraints.vertical', '改名', ''),
 # --- 栅格 ---
 'gridColumnGap': ('grid.columnGap', '改名', ''),
 'gridRowGap': ('grid.rowGap', '改名', ''),
 'gridTemplateColumns': ('grid.template.columns', '改名', 'GridTrack[]'),
 'gridTemplateRows': ('grid.template.rows', '改名', 'GridTrack[]'),
 'gridPosition': ('grid.position', '改名', 'GridPosition | null'),
 'layoutGrids': ('grid.grids', '改名', 'LayoutGrid[]'),
 'guides': ('guides', '原样', 'CanvasGuide[]'),
 # --- 组件 / 实例 ---
 'componentId': ('component.main', '改名', '引用主组件 odId；库组件改用 component.library（§4.1）'),
 'componentKey': ('component.key', '改名', ''),
 'sourceLibraryKey': ('component.libraryKey', '改名', ''),
 'publishId': ('component.publishId', '改名', ''),
 'overrideKey': ('component.overrideKey', '改名', ''),
 'sharedSymbolVersion': ('component.symbolVersion', '改名', ''),
 'publishedVersion': ('component.publishedVersion', '改名', ''),
 'librarySource': ('component.library', '改名', 'LibraryAssetSource | null'),
 'isPublishable': ('component.publishable', '改名', ''),
 'isSymbolPublishable': ('component.symbolPublishable', '改名', ''),
 'isExposedInstance': ('component.exposed', '改名', ''),
 'symbolDescription': ('component.description', '改名', ''),
 'componentScale': ('component.scale', '改名', ''),
 'symbolLinks': ('component.links', '改名', 'SymbolLink[]'),
 'variantPropSpecs': ('component.variants', '改名', 'propDefId → 组件属性 odId'),
 'instanceOverrides': ('component.overrides', '改名', '见 §4.1 的 descendants 键改写'),
 'componentPropertyDefinitions': ('component.properties', '改名', '每条 definition.id → odId'),
 'componentPropertyReferences': ('component.propertyRefs', '改名', 'propertyId → odId'),
 'componentPropertyAssignments': ('component.assignments', '改名', '键为属性 id → odId'),
 'componentPropertyValues': ('component.values', '改名', '键为属性「名称」（非 id），保持不变'),
 # --- 变量 ---
 'boundVariables': ('bindings.fields', '改名', '键为 od 侧绑定路径（§3.5）'),
 'variableModes': ('bindings.modes', '改名', '集合 odId → 模式 odId'),
 # --- 杂项 ---
 'exportSettings': ('export', '改名', 'ExportSetting[]'),
 'pluginData': ('pluginData', '原样', 'PluginDataEntry[]'),
 'pluginRelaunchData': ('pluginRelaunch', '改名', 'PluginRelaunchDataEntry[]'),
 'pointCount': ('shape.points', '改名', ''),
 'starInnerRadius': ('shape.innerRadius', '改名', ''),
}


missing = [n for n in names if n not in M]
extra = [k for k in M if k not in names]
if missing or extra:
    sys.exit('FAIL: 映射表与引擎字段不一致\n  漏项(引擎有映射无): %s\n  幽灵项(映射有引擎无): %s'
             % (missing, extra))

from collections import Counter
_t = Counter(v[1] for v in M.values())
print('engine fields: %d  mapped: %d  treatments: %s' % (len(names), len(M), dict(_t)))

# ---------------------------------------------------------------------------
# 3. 生成 TypeScript
# ---------------------------------------------------------------------------
# 设计表里的中文处理方式 → 代码里的英文枚举
TREATMENT_EN = {
    '\u6539\u540d': 'rename',
    '\u539f\u6837': 'keep',
    '\u5408\u5e76': 'merge',
    '\u5254\u9664': 'drop',
    '\u62c6\u5206': 'split',
}

lines = []
lines.append('// AUTO-GENERATED by scripts/gen-od-field-map.py — DO NOT EDIT BY HAND.')
lines.append('//')
lines.append('// 字段清单来自 @open-pencil/scene-graph@0.16.0 的 types.d.ts（机器解析）。')
lines.append('// 重新生成： python3 scripts/gen-od-field-map.py')
lines.append('// 校验：     python3 scripts/gen-od-field-map.py --check')
lines.append('')
lines.append('/** od 侧对引擎字段的处理方式。 */')
lines.append('export type FieldTreatment =')
lines.append("  | 'rename'   // 改名：字段位置/名字变了，语义不变")
lines.append("  | 'merge'    // 合并：若干引擎字段并到一个 od 字段组")
lines.append("  | 'keep'     // 原样：名字与位置都不变")
lines.append("  | 'drop'     // 剔除：D1 派生缓存，加载后由引擎重算")
lines.append("  | 'split'    // 拆分：引擎一个字段在 od 侧拆成多段")
lines.append('')
lines.append('export interface FieldMapping {')
lines.append('  /** 引擎侧字段名（SceneNode 上的属性名）。 */')
lines.append('  readonly engine: string')
lines.append('  /** od 侧路径，点分（`box.width`）；剔除的字段为 null。 */')
lines.append('  readonly od: string | null')
lines.append('  readonly treatment: FieldTreatment')
lines.append('  readonly note: string')
lines.append('}')
lines.append('')
lines.append('/** 154 个引擎字段的完整映射表（顺序 = types.d.ts 里的声明顺序）。 */')
lines.append('export const FIELD_MAP: readonly FieldMapping[] = [')
for n in names:
    od, tr, note = M[n]
    od_val = 'null' if od == '\u2014' else json.dumps(od, ensure_ascii=False)
    lines.append('  { engine: %s, od: %s, treatment: %s, note: %s },'
                 % (json.dumps(n), od_val, json.dumps(TREATMENT_EN[tr]), json.dumps(note, ensure_ascii=False)))
lines.append(']')
lines.append('')
lines.append('/** 值类别，决定 od 侧 zod schema 的叶子类型。 */')
lines.append('export type ValueKind =')
lines.append("  | 'number' | 'string' | 'boolean' | 'enum' | 'literal-union'")
lines.append("  | 'object' | 'array' | 'null' | 'binary' | 'unknown'")
lines.append('')
lines.append('/** 每个引擎字段的值类别（机器解析）。 */')
lines.append('export const FIELD_VALUE_KINDS: Readonly<Record<string, ValueKind>> = {')
for n in names:
    lines.append('  %s: %s,' % (json.dumps(n), json.dumps(value_kind(TYPES[n]))))
lines.append('}')
lines.append('')
lines.append('/** 引擎字段名全集（154 个）。 */')
lines.append('export const ENGINE_FIELD_NAMES: readonly string[] = [')
for n in names:
    lines.append('  %s,' % json.dumps(n))
lines.append(']')
lines.append('')
lines.append('/** D1 · 必丢：有明确重算入口，加载后由引擎重算。 */')
lines.append('export const D1_NODE_FIELDS: readonly string[] = [')
for n in names:
    if M[n][0] == '\u2014':
        lines.append('  %s,' % json.dumps(n))
lines.append(']')
lines.append('')
lines.append('/** D2 · 必留：没有加载期重算入口，丢了回不来。 */')
lines.append('export const D2_NODE_FIELDS: readonly string[] = [')
for n in names:
    if 'D2' in M[n][2]:
        lines.append('  %s,' % json.dumps(n))
lines.append(']')
lines.append('')

content = '\n'.join(lines)

if '--check' in sys.argv:
    old = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
    if old != content:
        sys.exit('FAIL: %s 与生成器输出不一致，请重新运行 gen-od-field-map.py' % OUT)
    print('OK: %s 与生成器输出一致' % OUT)
else:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(content)
    print('WROTE: %s (%d bytes)' % (OUT, len(content.encode('utf-8'))))
