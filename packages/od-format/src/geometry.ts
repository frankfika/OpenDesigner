/**
 * 几何 blob（`commandsBlob`）↔ SVG path `d` 的**无损**双向转换。
 *
 * 引擎的 blob 布局（已对 `scene-graph/src/geometry.ts:319-327` 与
 * `core/dist/io/formats/svg/paths.js` 逐行核实）：
 *
 *   [1 字节 opcode][float32 小端 x][float32 小端 y] ...
 *
 * | opcode | 坐标对数 | SVG 命令 |
 * | --- | --- | --- |
 * | 0 | 0 | `Z` |
 * | 1 | 1 | `M` |
 * | 2 | 1 | `L` |
 * | 3 | 2 | `Q`（控制点, 终点）|
 * | 4 | 3 | `C`（cp1, cp2, 终点）|
 *
 * ⚠️ **MUST NOT** 直接用 core 的 `geometryBlobToSVGPath()` —— 它默认 `decimals = 2`，有损。
 * od-format 不依赖 core，所以自己实现。
 *
 * 无损判据：坐标是 float32，`Math.fround(Number(s)) === f` 是「解析回来还等于原值」的
 * 充分必要条件。逐坐标成立 ⇒ 整条路径逐字节还原。
 */
import { OdEncodeError, OdDecodeError } from './errors'

const CMD_CLOSE = 0
const CMD_MOVE_TO = 1
const CMD_LINE_TO = 2
const CMD_QUAD_TO = 3
const CMD_CUBIC_TO = 4

/** 坐标对的字节数（两个 float32）。 */
const PAIR_BYTES = 8

/** 去掉小数末尾多余的 0（`1.500` → `1.5`，`1.0` → `1`）。 */
function trimZeros(s: string): string {
  if (!s.includes('.') || s.includes('e') || s.includes('E')) return s
  const trimmed = s.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

/**
 * 把一个坐标编码成**最短的**、且能无损还原成同一个 float32 的十进制串。
 *
 * 做法：逐步增加有效数字位数，用 `Math.fround(Number(s)) === f` 精确检验。
 * float32 只有约 7 位十进制有效数字，所以 sig ≤ 9 一定收敛。
 */
export function encodeCoord(value: number): string {
  if (!Number.isFinite(value)) {
    throw new OdEncodeError(
      'OD1100',
      'geometry',
      `坐标不是有限数（${value}）`,
      'NaN / ±Infinity 无法写入 JSON，编码器必须拒绝而不是静默写成 null'
    )
  }
  const f = Math.fround(value)
  if (f === 0) return '0' // 同时把 -0 归一化成 0（规则 F2）
  for (let sig = 1; sig <= 9; sig++) {
    const candidate = plainDecimal(f, sig)
    if (candidate !== undefined && Math.fround(Number(candidate)) === f) {
      return trimZeros(candidate)
    }
  }
  // 兜底：float32 的精确十进制展开一定能通过 fround 检验
  const exact = f.toString()
  if (Math.fround(Number(exact)) === f) return exact
  throw new OdEncodeError('OD1100', 'geometry', `坐标无法无损编码：${value}`)
}

/**
 * 用给定有效数字位数生成**不带指数**的十进制串；不合适时返回 undefined（走指数形式）。
 */
function plainDecimal(f: number, sig: number): string | undefined {
  const exp = Math.floor(Math.log10(Math.abs(f)))
  // 指数太极端时用指数形式（toPrecision 会自动处理）
  if (exp < -6 || exp > 20) {
    const s = f.toPrecision(sig)
    return Math.fround(Number(s)) === f ? s : undefined
  }
  const decimals = Math.max(0, sig - 1 - exp)
  const s = f.toFixed(decimals)
  return Math.fround(Number(s)) === f ? s : undefined
}

/** blob → SVG path `d` 字符串。 */
export function blobToSvgPath(blob: Uint8Array): string {
  if (blob.length === 0) return ''
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const parts: string[] = []
  let o = 0
  while (o < blob.length) {
    const cmd = blob[o++]!
    switch (cmd) {
      case CMD_CLOSE:
        parts.push('Z')
        break
      case CMD_MOVE_TO:
      case CMD_LINE_TO: {
        if (o + PAIR_BYTES > blob.length) {
          throw new OdDecodeError('OD1100', 'geometry', 'blob 长度不足以容纳坐标对')
        }
        const x = dv.getFloat32(o, true)
        const y = dv.getFloat32(o + 4, true)
        o += PAIR_BYTES
        parts.push(`${cmd === CMD_MOVE_TO ? 'M' : 'L'}${encodeCoord(x)} ${encodeCoord(y)}`)
        break
      }
      case CMD_QUAD_TO: {
        if (o + PAIR_BYTES * 2 > blob.length) {
          throw new OdDecodeError('OD1100', 'geometry', 'blob 长度不足以容纳二次贝塞尔')
        }
        const x1 = dv.getFloat32(o, true)
        const y1 = dv.getFloat32(o + 4, true)
        const x = dv.getFloat32(o + 8, true)
        const y = dv.getFloat32(o + 12, true)
        o += PAIR_BYTES * 2
        parts.push(`Q${encodeCoord(x1)} ${encodeCoord(y1)} ${encodeCoord(x)} ${encodeCoord(y)}`)
        break
      }
      case CMD_CUBIC_TO: {
        if (o + PAIR_BYTES * 3 > blob.length) {
          throw new OdDecodeError('OD1100', 'geometry', 'blob 长度不足以容纳三次贝塞尔')
        }
        const x1 = dv.getFloat32(o, true)
        const y1 = dv.getFloat32(o + 4, true)
        const x2 = dv.getFloat32(o + 8, true)
        const y2 = dv.getFloat32(o + 12, true)
        const x = dv.getFloat32(o + 16, true)
        const y = dv.getFloat32(o + 20, true)
        o += PAIR_BYTES * 3
        parts.push(
          `C${encodeCoord(x1)} ${encodeCoord(y1)} ${encodeCoord(x2)} ${encodeCoord(y2)} ${encodeCoord(x)} ${encodeCoord(y)}`
        )
        break
      }
      default:
        throw new OdDecodeError(
          'OD1100',
          'geometry',
          `未知的几何 opcode ${cmd}`,
          '合法 opcode 是 0(close)/1(move)/2(line)/3(quad)/4(cubic)'
        )
    }
  }
  return parts.join(' ')
}

/** SVG path `d` 字符串 → blob。只接受 `M` / `L` / `Q` / `C` / `Z`（绝对命令）。 */
export function svgPathToBlob(d: string): Uint8Array {
  const out: number[] = []
  const tokens = d.match(/[MLQCZ]|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []
  let i = 0
  const need = (n: number): string[] => {
    if (i + n > tokens.length) {
      throw new OdDecodeError('OD1100', 'geometry', `SVG path 缺少参数：期望 ${n} 个，得到 ${tokens.length - i} 个`)
    }
    const slice = tokens.slice(i, i + n)
    i += n
    return slice
  }
  while (i < tokens.length) {
    const cmd = tokens[i++]!
    switch (cmd) {
      case 'M':
      case 'L': {
        const [x, y] = need(2)
        out.push(cmd === 'M' ? CMD_MOVE_TO : CMD_LINE_TO)
        out.push(...float32Bytes(Number(x)), ...float32Bytes(Number(y)))
        break
      }
      case 'Q': {
        const [x1, y1, x, y] = need(4)
        out.push(CMD_QUAD_TO)
        out.push(...float32Bytes(Number(x1)), ...float32Bytes(Number(y1)))
        out.push(...float32Bytes(Number(x)), ...float32Bytes(Number(y)))
        break
      }
      case 'C': {
        const [x1, y1, x2, y2, x, y] = need(6)
        out.push(CMD_CUBIC_TO)
        out.push(...float32Bytes(Number(x1)), ...float32Bytes(Number(y1)))
        out.push(...float32Bytes(Number(x2)), ...float32Bytes(Number(y2)))
        out.push(...float32Bytes(Number(x)), ...float32Bytes(Number(y)))
        break
      }
      case 'Z':
        out.push(CMD_CLOSE)
        break
      default:
        throw new OdDecodeError(
          'OD1100',
          'geometry',
          `不支持的 SVG path 命令 "${cmd}"`,
          'od-format 只接受绝对命令 M / L / Q / C / Z'
        )
    }
  }
  return Uint8Array.from(out)
}

/** 把一个 double 拆成 float32 的小端字节。 */
function float32Bytes(value: number): number[] {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setFloat32(0, value, true)
  return [...new Uint8Array(buf)]
}
