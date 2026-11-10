import {
  CJK_FALLBACK_FAMILIES_LINUX,
  CJK_FALLBACK_FAMILIES_MACOS,
  CJK_FALLBACK_FAMILIES_WINDOWS
} from '@open-pencil/core'
import { fontManager } from '@open-pencil/core/text'

/**
 * 中文字体接入。
 *
 * 引擎自带的字体只有 Inter（拉丁）和 Noto Naskh Arabic，中文得自己解决。
 * 引擎本来有三条路：本地字体（要浏览器的 Font Access 授权）、内置字体、
 * 以及联网的 provider。这三条在本项目里都不合适：
 *
 * - provider 链（google → fontsource → bunny → fontshare）的问题是
 *   **第一个 provider 的初始化失败会毒化整条链**：google provider 要读
 *   fonts.google.com/metadata/fonts，这个域在不少网络里不通，
 *   于是后面本来可用的 fontsource 根本轮不到。
 * - provider 给回来的还是**子集**：不带字符时只给 latin 子集（3 万多字节），
 *   中文全是豆腐块，而且这份子集会被缓存下来，反而把正确的中文子集挡住。
 *
 * 所以走引擎的 `hostFontLoader` 钩子：文档里用到哪些字，我们就向
 * Google Fonts 的 CSS API（`text=` 参数）要**只含这些字**的子集。
 * 精确、小、快，而且只依赖一个域（fonts.googleapis.com + fonts.gstatic.com）。
 *
 * 取不到时返回 null，引擎会退回内置字体（Inter），不至于整个编辑器开天窗。
 */

const GOOGLE_CSS = 'https://fonts.googleapis.com/css2'

/** 引擎的 style 名字 → CSS 字重 */
const WEIGHT_BY_STYLE: Record<string, number> = {
  Thin: 100,
  Light: 300,
  Regular: 400,
  Medium: 500,
  SemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  Black: 900
}

/** URL 长度有限，一次最多要这么多字 */
const MAX_CHARS = 400

/**
 * 子集里必须额外带上的字符。
 *
 * 引擎自己画的标签（组件集变体名 "State=Default"、尺寸 "200×56"）
 * 用的也是这个字体，但那些字**不在文档里** —— 只按文档字符取子集的话，
 * 这些标签会变成豆腐块。所以基础 ASCII 和常用符号一定要带上。
 */
const ALWAYS_INCLUDE = [
  // 可打印 ASCII（注意撇号和反引号）
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  // 引擎标签会用到的符号（尺寸标签是 "200×56"）
  '×·—–…‘’“”«»°′″'
].join('')

/**
 * CJK 兜底族 → Google Fonts 上真实存在的族。
 *
 * 引擎画图层标签（画板标题、组件集名、尺寸胶囊）时，字体列表是
 * `[Inter, ...本地 CJK 兜底族]`。Inter 没有中文字形；本地兜底族
 * （Noto Sans CJK SC / 文泉驿 / Droid Sans Fallback）在容器和 CI 里
 * 根本不存在 —— 于是中文图层名全是豆腐块，而正文却是好的，特别难查。
 *
 * 把这些族**重定向**到 Google 上同名的中文族：字体数据注册回原来的族名，
 * 引擎的字体列表照旧能命中，中文字形就有了。
 *
 * 只重定向 Linux 那一组：macOS 的 PingFang 和 Windows 的微软雅黑是系统自带、
 * 本来就有中文字形，重定向反而会降级它们在真机上的观感。
 */
const FAMILY_REDIRECT: Record<string, string> = {
  'Noto Sans CJK SC': 'Noto Sans SC',
  'Noto Sans CJK TC': 'Noto Sans TC',
  'Noto Sans CJK JP': 'Noto Sans JP',
  'Noto Sans CJK KR': 'Noto Sans KR',
  'WenQuanYi Micro Hei': 'Noto Sans SC',
  'Droid Sans Fallback': 'Noto Sans SC'
}

/** 不在 Google Fonts 上的族（系统字体）。macOS/Windows 的不动，见上面的说明。 */
const SYSTEM_ONLY_FAMILIES = new Set<string>([
  ...CJK_FALLBACK_FAMILIES_MACOS,
  ...CJK_FALLBACK_FAMILIES_WINDOWS
])

/** 当前文档用到的字符。hostFontLoader 是按族+字重回调的，拿不到字符，得自己存。 */
let currentCharacters = ''

/** 文档内容变了就调一次，让下次取字体时带上正确的字符集。 */
export function setFontCharacters(characters: string): void {
  currentCharacters = characters
}

/** 文档字符 + 一定要带的基础字符，去重后拼起来。 */
function charactersToRequest(): string {
  const all = new Set<string>(ALWAYS_INCLUDE)
  for (const ch of currentCharacters) all.add(ch)
  return Array.from(all).join('')
}

/** 拿 Google Fonts 的 CSS 里指向字体文件的 URL。 */
async function resolveFontUrl(family: string, weight: number, chars: string): Promise<string | null> {
  const query = `${encodeURIComponent(family)}:wght@${weight}`
  const text = chars ? `&text=${encodeURIComponent(chars)}` : ''
  const css = await fetch(`${GOOGLE_CSS}?family=${query}${text}`).then((r) =>
    r.ok ? r.text() : ''
  )
  const match = css.match(/src:\s*url\((https:[^)]+)\)/)
  return match ? match[1] : null
}

async function fetchSubset(family: string, style: string): Promise<ArrayBuffer | null> {
  if (SYSTEM_ONLY_FAMILIES.has(family)) return null
  const weight = WEIGHT_BY_STYLE[style] ?? 400
  // 字太多时 URL 会爆，退回整族字体（Google 会给按 unicode-range 切好的一组，取第一个）
  const wanted = charactersToRequest()
  const chars = wanted.length > MAX_CHARS ? '' : wanted
  // 重定向只影响「去哪儿取字体」，注册回 provider 时仍然用原来的族名
  const url = await resolveFontUrl(FAMILY_REDIRECT[family] ?? family, weight, chars)
  if (!url) return null
  const response = await fetch(url)
  if (!response.ok) return null
  return await response.arrayBuffer()
}

/**
 * 已经取到的字体数据，按族缓存。
 *
 * 留着有两个用处：
 * 1. 把某个族**再注册成默认字体**（见 installHostFontLoader 里的注释）；
 * 2. 文档换字之后，能用同一份数据重新注册，不必再联网。
 */
const fontDataByFamily = new Map<string, ArrayBuffer>()

/**
 * 装上字体钩子。装之前要先 setFontCharacters，否则拿不到字符集。
 *
 * 顺带解决一个隐蔽的问题：**引擎自己画的图层标签**（画板标题、组件集名、
 * 尺寸胶囊）不指定字体族，走的是 provider 的默认字体。默认字体是内置 Inter，
 * 没有中文字形；沙箱的 headless 浏览器也没装系统中文字体 ——
 * 于是这些标签全是豆腐块，而正文却是好的，排查起来很绕。
 *
 * Skia 里**用空 family 名注册的字体会成为默认字体**。所以这里把文档主字体
 * 再注册一份成默认，标签也就有中文字形了。
 */
export function installHostFontLoader(): void {
  fontManager.setHostFontLoader(async (family, style = 'Regular') => {
    try {
      const data = await fetchSubset(family, style)
      if (!data) return null
      fontDataByFamily.set(family, data)
      // 让没有指定字体的文本（引擎的标签）也用上这份带中文字形的字体
      try {
        fontManager.provider()?.registerFont(data, '')
      } catch {
        /* 注册失败也不影响正文渲染 */
      }
      return data
    } catch {
      return null
    }
  })
}

/** 已经加载过的字体数据（用来在文档换字后免联网重取）。 */
export function cachedFontData(family: string): ArrayBuffer | undefined {
  return fontDataByFamily.get(family)
}

/**
 * 把某个族**注册成 provider 的默认字体**。
 *
 * Skia 里用空 family 名注册的字体会成为 default typeface，
 * 而引擎的图层标签（画板标题、组件集名、尺寸胶囊）正好走默认字体。
 * 默认字体是内置 Inter —— 没有中文字形，于是中文图层名全是豆腐块。
 *
 * 注意时机：provider 是渲染器初始化时才 attach 的，
 * 字体可能比它先加载完，所以这里要能重试。
 */
export function promoteDefaultFont(family: string): boolean {
  const data = fontDataByFamily.get(family)
  if (!data) return false
  const provider = fontManager.provider()
  if (!provider) return false
  try {
    provider.registerFont(data, '')
    return true
  } catch {
    return false
  }
}

/**
 * 等 provider 就绪后把默认字体提升上去。
 *
 * 字体加载和渲染器初始化是两条独立的路，谁先谁后不确定，
 * 所以这里轮询几次：provider 一 attach 上就立刻补注册。
 */
export function promoteDefaultFontWhenReady(
  family: string,
  onDone?: (ok: boolean) => void,
  attempts = 30
): void {
  let tries = 0
  const tick = (): void => {
    tries += 1
    if (promoteDefaultFont(family)) {
      onDone?.(true)
      return
    }
    if (tries >= attempts) {
      onDone?.(false)
      return
    }
    setTimeout(tick, 200)
  }
  tick()
}
