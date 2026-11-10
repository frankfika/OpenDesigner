/**
 * od 文本形态：JSONC 解析 + 规范化写出（规格 §6）。
 *
 * - **JSONC 注释容忍**：agent 手写文件时加 `// 注释` 很自然，读的时候要能容忍。
 * - **固定键序**：见 `order.ts`。同一份文档序列化两次必须**逐字节相同**（MUST 测试 #14）。
 * - **2 空格缩进 / LF 换行 / 文件末尾单个 LF / 无 BOM**。
 * - **最短往返数字表示**：用 `JSON.stringify` 的默认行为（禁止四舍五入，规则 F1）。
 */
import {
  ASSET_KEY_ORDER,
  GROUP_CHILD_ORDER,
  LIBRARY_KEY_ORDER,
  META_KEY_ORDER,
  MODE_KEY_ORDER,
  NODE_KEY_ORDER,
  TOP_LEVEL_KEY_ORDER,
  VARIABLE_KEY_ORDER,
  VARIABLE_SET_KEY_ORDER,
} from './order'
import { OdDecodeError } from './errors'
import type { OdDocument } from './schema'

/**
 * 剥离 JSONC 注释（`//` 行注释与 `/* *\/` 块注释）。
 *
 * 字符串字面量里的 `//`、`/*` 不算注释 —— 必须跟踪字符串状态与转义。
 */
export function stripJsonComments(text: string): string {
  let out = ''
  let i = 0
  let inString = false
  let inLineComment = false
  let inBlockComment = false

  while (i < text.length) {
    const ch = text[i]!
    const next = text[i + 1]

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false
        out += ch
      }
      i++
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 2
        continue
      }
      // 保留换行，避免行号错位
      if (ch === '\n') out += ch
      i++
      continue
    }

    if (inString) {
      out += ch
      if (ch === '\\') {
        // 转义：下一个字符原样带出（可能是引号或反斜杠）
        if (i + 1 < text.length) {
          out += text[i + 1]
          i += 2
          continue
        }
      } else if (ch === '"') {
        inString = false
      }
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }

    if (ch === '/' && next === '/') {
      inLineComment = true
      i += 2
      continue
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true
      i += 2
      continue
    }

    out += ch
    i++
  }

  return out
}

/** 解析 JSONC 文本 → 原始值。 */
export function parseJsonc(text: string): unknown {
  // 去掉 BOM
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  try {
    return JSON.parse(stripJsonComments(body)) as unknown
  } catch (error) {
    throw new OdDecodeError(
      'OD1001',
      '',
      `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
}

// ---------------------------------------------------------------------------
// 规范化写出
// ---------------------------------------------------------------------------

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  )
}

/**
 * 判断一个值能否压成一行：只含原始值的数组，或只含原始值 / 原始值对象的对象。
 * 含「对象数组」的子树必须展开（否则一行会长到没法看）。
 */
function canInline(value: unknown): boolean {
  if (isPrimitive(value)) return true
  if (Array.isArray(value)) return value.every(isPrimitive)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).every(
      (v) =>
        isPrimitive(v) ||
        (typeof v === 'object' &&
          v !== null &&
          !Array.isArray(v) &&
          Object.values(v).every(isPrimitive))
    )
  }
  return false
}

/** 按给定顺序重排键；未列出的键按字典序追加（规格 §6.2 的 `orderKeys`）。 */
export function orderKeys<T extends Record<string, unknown>>(obj: T, order: readonly string[]): T {
  const out: Record<string, unknown> = {}
  for (const k of order) {
    if (k in obj && obj[k] !== undefined) out[k] = obj[k]
  }
  for (const k of Object.keys(obj).sort()) {
    if (!(k in out) && obj[k] !== undefined) out[k] = obj[k]
  }
  return out as T
}

interface WriteOptions {
  /** 当前对象显式的键序。 */
  order?: readonly string[]
  /** 当前对象所属的「组路径」（如 `text.font`），键序从 GROUP_CHILD_ORDER 派生。 */
  groupPath?: string
  /** 当前对象是不是一个「节点对象」（键序用 NODE_KEY_ORDER，组键自动下钻）。 */
  node?: boolean
  /** 当前数组的元素是不是「节点对象」。 */
  nodeItems?: boolean
}

function writeValue(value: unknown, indent: number, opts: WriteOptions = {}): string {
  if (value === undefined || value === null) return 'null'

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new OdDecodeError('OD1100', '', `数字不是有限值：${value}`)
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (!opts.nodeItems && canInline(value)) return JSON.stringify(value)
    const pad = '  '.repeat(indent + 1)
    const closePad = '  '.repeat(indent)
    const items = value.map(
      (item) => `${pad}${writeValue(item, indent + 1, { node: opts.nodeItems })}`
    )
    return `[\n${items.join(',\n')}\n${closePad}]`
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined)
    if (keys.length === 0) return '{}'
    if (!opts.node && canInline(obj)) return JSON.stringify(obj)

    const pad = '  '.repeat(indent + 1)
    const closePad = '  '.repeat(indent)

    // 键序：显式 order 优先，其次节点键序、组键序，最后字典序
    let sortedKeys: string[]
    if (opts.order) {
      sortedKeys = opts.order.filter((k) => keys.includes(k))
      for (const k of keys.sort()) if (!sortedKeys.includes(k)) sortedKeys.push(k)
    } else if (opts.node) {
      sortedKeys = NODE_KEY_ORDER.filter((k) => keys.includes(k))
      for (const k of keys.sort()) if (!sortedKeys.includes(k)) sortedKeys.push(k)
    } else if (opts.groupPath) {
      const groupOrder = GROUP_CHILD_ORDER.get(opts.groupPath) ?? []
      sortedKeys = groupOrder.filter((k) => keys.includes(k))
      for (const k of keys.sort()) if (!sortedKeys.includes(k)) sortedKeys.push(k)
    } else {
      sortedKeys = keys.sort()
    }

    const entries = sortedKeys.map((key) => {
      const child = obj[key]
      const childGroupPath =
        opts.groupPath && GROUP_CHILD_ORDER.has(`${opts.groupPath}.${key}`)
          ? `${opts.groupPath}.${key}`
          : undefined
      return `${pad}${JSON.stringify(key)}: ${writeValue(child, indent + 1, {
        groupPath: childGroupPath,
        nodeItems: key === 'nodes',
      })}`
    })
    return `{\n${entries.join(',\n')}\n${closePad}}`
  }

  return JSON.stringify(value) ?? 'null'
}

/**
 * 把 od 文档规范化写出（固定键序、2 空格缩进、LF、末尾单个换行）。
 *
 * 同一份文档写两次必须**逐字节相同**（C2）。
 */
export function stringifyOd(doc: OdDocument): string {
  const top = doc as unknown as Record<string, unknown>
  const ordered: Record<string, unknown> = {}
  for (const key of TOP_LEVEL_KEY_ORDER) {
    if (key in top && top[key] !== undefined) ordered[key] = top[key]
  }
  for (const key of Object.keys(top).sort()) {
    if (!(key in ordered) && top[key] !== undefined) ordered[key] = top[key]
  }

  // meta
  if (ordered.meta && typeof ordered.meta === 'object') {
    ordered.meta = orderKeys(ordered.meta as Record<string, unknown>, META_KEY_ORDER)
  }

  // variables
  if (Array.isArray(ordered.variables)) {
    ordered.variables = (ordered.variables as Record<string, unknown>[]).map((v) =>
      orderKeys(v, VARIABLE_KEY_ORDER)
    )
  }

  // variableSets
  if (Array.isArray(ordered.variableSets)) {
    ordered.variableSets = (ordered.variableSets as Record<string, unknown>[]).map((v) => {
      const set = orderKeys(v, VARIABLE_SET_KEY_ORDER)
      if (Array.isArray(set.modes)) {
        set.modes = (set.modes as Record<string, unknown>[]).map((m) =>
          orderKeys(m, MODE_KEY_ORDER)
        )
      }
      return set
    })
  }

  // libraries
  if (Array.isArray(ordered.libraries)) {
    ordered.libraries = (ordered.libraries as Record<string, unknown>[]).map((l) =>
      orderKeys(l, LIBRARY_KEY_ORDER)
    )
  }

  // assets
  if (ordered.assets && typeof ordered.assets === 'object') {
    const assets = ordered.assets as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(assets).sort()) {
      const value = assets[key]
      out[key] =
        value && typeof value === 'object'
          ? orderKeys(value as Record<string, unknown>, ASSET_KEY_ORDER)
          : value
    }
    ordered.assets = out
  }

  // nodes：交给 writeValue 的 nodeItems 机制处理（节点对象有专门的键序）
  return writeValue(ordered, 0, { order: TOP_LEVEL_KEY_ORDER }) + '\n'
}
