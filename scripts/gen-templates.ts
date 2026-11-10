#!/usr/bin/env tsx
/**
 * 中文社媒尺寸模板生成器（OpenDesigner 差异化层 · 中文内容创作工作流）。
 *
 * 产出两样东西：
 *   1. `templates/*.od.json` —— 可直接打开改文案的中文社媒尺寸模板（od 纯文本格式）。
 *   2. `docs/templates/sizes.md` —— 尺寸清单 + 派生规则说明（由本脚本生成，**不手改**）。
 *
 * 只用 od-format 的公开 API 造文档，不手写 od 文本：
 *   import { fromEngine, stringifyOd, validate } from '@opendesigner/od-format'
 *
 * 三条硬约束：
 *   - **幂等**：同样的输入 → 逐字节相同的输出。做到这点靠三件事：
 *     ① 节点 id 全部显式指定（odId 形态，恒等映射，不靠引擎铸 id）；
 *     ② 布局是纯函数，没有随机 / 时间输入；
 *     ③ 写盘前先比内容，相同就不动文件。
 *   - **可校验**：每个模板写盘前都过 `validate()`，有 error 或 warning 直接抛。
 *   - **可派生**：`deriveVariants(source, targets)` 把主模板的内容派生到别的尺寸，
 *     规则见 §5 的注释块（docs/templates/sizes.md 与之同源）。
 *
 * 跑法：
 *   npx tsx scripts/gen-templates.ts           # 生成
 *   npx tsx scripts/gen-templates.ts --check   # 漂移检查（磁盘上的文件与生成结果不一致就退出码 1）
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SceneGraph, type Fill, type NodeType, type SceneNode, type Stroke } from '@open-pencil/scene-graph'
import {
  fromEngine,
  parseJsonc,
  stringifyOd,
  validate,
  type OdDocument,
} from '@opendesigner/od-format'

// ---------------------------------------------------------------------------
// 0. 基础设施
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_DIR = join(REPO_ROOT, 'templates')
const DOC_PATH = join(REPO_ROOT, 'docs', 'templates', 'sizes.md')

/** 设计工具里的字体名；中文内容统一用它（用户可随时改 `text.font.family`）。 */
const FONT_FAMILY = 'Noto Sans SC'

/** 参考宽度：所有字号以「1080 宽的画板」为基准，再按画板宽度等比换算。 */
const REFERENCE_WIDTH = 1080

/** 字号基准表（1080 宽画板下的 px）。 */
const BASE_FONTS = {
  eyebrow: 30,
  title: 84,
  body: 38,
  points: 32,
  badge: 26,
  footer: 22,
  imageLabel: 24,
} as const

type FontKey = keyof typeof BASE_FONTS
type FontSet = Record<FontKey, number>

/** 字号下限 / 上限（再小就不可读，再大就撑版面）。 */
const FONT_MIN: FontSet = {
  eyebrow: 12,
  title: 20,
  body: 14,
  points: 13,
  badge: 11,
  footer: 10,
  imageLabel: 11,
}

const FONT_MAX: FontSet = {
  eyebrow: 72,
  title: 180,
  body: 96,
  points: 80,
  badge: 60,
  footer: 44,
  imageLabel: 56,
}

function must<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function round(value: number): number {
  return Math.round(value)
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** '#RRGGBB' → 引擎的 Color（0..1，保留 3 位小数避免浮点噪音）。 */
function hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`非法颜色：${hex}`)
  const num = Number.parseInt(full, 16)
  return {
    r: round(((num >> 16) & 0xff) / 255 * 1000) / 1000,
    g: round(((num >> 8) & 0xff) / 255 * 1000) / 1000,
    b: round((num & 0xff) / 255 * 1000) / 1000,
    a: 1,
  }
}

/** 纯色填充。 */
function solidFill(hex: string): Fill {
  return {
    type: 'SOLID',
    color: hexToColor(hex),
    opacity: 1,
    visible: true,
  }
}

/** 虚线描边。 */
function dashedStroke(hex: string, weight: number): Stroke {
  return {
    type: 'SOLID',
    color: hexToColor(hex),
    opacity: 1,
    visible: true,
    weight,
    align: 'INSIDE',
    cap: 'NONE',
    join: 'MITER',
    dashPattern: [12, 8],
  }
}

// ---------------------------------------------------------------------------
// 1. 尺寸表 —— 全仓库唯一事实源（模板与文档都从这里派生）
// ---------------------------------------------------------------------------

/** 安全区留白，单位是**比例**：left/right 相对宽度，top/bottom 相对高度。 */
interface SafeSpec {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  /** 平台 UI 遮挡说明（进文档，用户改稿时能看懂为什么要留白）。 */
  readonly reason: string
}

interface SizeSpec {
  /** 文件名主干（`templates/<key>.od.json`）。 */
  readonly key: string
  readonly platform: string
  readonly format: string
  readonly width: number
  readonly height: number
  readonly ratio: string
  /** 用途说明（进文档表格）。 */
  readonly purpose: string
  readonly safe: SafeSpec
  /** 平台主色 / 强调色（十六进制）。 */
  readonly primary: string
  readonly accent: string
  /** 深色模式下的主色 / 强调色（默认同浅色）。 */
  readonly primaryDark?: string
  readonly accentDark?: string
}

/**
 * 尺寸表。
 *
 * 留白比例来自各平台的真实 UI 遮挡：
 *   - 抖音 / 视频号：右侧有互动按钮栏、底部有文案与话题条 → 右 0.14 / 底 0.16
 *   - 微信封面：两端会被裁成 1:1 的分享卡片 → 底 0.16
 *   - 小红书：底部有标题 / 作者信息条 → 底 0.10
 *   - GitHub README 头图：窄屏裁两侧、还会跟随深浅色主题 → 左右 0.05
 */
const SIZE_SPECS: readonly SizeSpec[] = [
  {
    key: 'xiaohongshu-note',
    platform: '小红书',
    format: '竖版笔记',
    width: 1080,
    height: 1440,
    ratio: '3:4',
    purpose: '笔记首图 / 图文封面，信息流里占屏最大，竖版适合长文案与步骤图。',
    safe: { left: 0.08, right: 0.08, top: 0.06, bottom: 0.1, reason: '底部标题条与作者信息条' },
    primary: '#E2483D',
    accent: '#F2B705',
  },
  {
    key: 'xiaohongshu-square',
    platform: '小红书',
    format: '方形',
    width: 1080,
    height: 1080,
    ratio: '1:1',
    purpose: '方形封面，适合单品、清单类笔记，在双列信息流里与竖版同权重。',
    safe: { left: 0.08, right: 0.08, top: 0.06, bottom: 0.1, reason: '底部标题条与作者信息条' },
    primary: '#E2483D',
    accent: '#F2B705',
  },
  {
    key: 'wechat-cover',
    platform: '微信公众号',
    format: '封面',
    width: 900,
    height: 383,
    ratio: '2.35:1',
    purpose: '公众号头图。分享到聊天 / 朋友圈时会被裁成 1:1，核心信息必须压在中间安全带。',
    safe: { left: 0.06, right: 0.06, top: 0.12, bottom: 0.16, reason: '两端会被裁切成 1:1 的分享卡片' },
    primary: '#07C160',
    accent: '#F2B705',
  },
  {
    key: 'zhihu-header',
    platform: '知乎',
    format: '文章头图',
    width: 1200,
    height: 675,
    ratio: '16:9',
    purpose: '文章头图，出现在回答卡片与文章列表顶部。',
    safe: { left: 0.06, right: 0.06, top: 0.1, bottom: 0.14, reason: '底部标题浮层' },
    primary: '#0084FF',
    accent: '#F2B705',
  },
  {
    key: 'weibo-image',
    platform: '微博',
    format: '配图',
    width: 1200,
    height: 1200,
    ratio: '1:1',
    purpose: '单图微博配图；九宫格会被裁成 1:1 或 16:9，主体居中更安全。',
    safe: { left: 0.08, right: 0.08, top: 0.06, bottom: 0.1, reason: '底部话题条与水印' },
    primary: '#E6162D',
    accent: '#F2B705',
  },
  {
    key: 'bilibili-cover',
    platform: '哔哩哔哩',
    format: '封面',
    width: 1920,
    height: 1080,
    ratio: '16:9',
    purpose: '视频封面，首页与推荐位都按 16:9 展示；底部有时长条、右侧有控件。',
    safe: { left: 0.06, right: 0.06, top: 0.1, bottom: 0.16, reason: '底部时长 / 进度条与右侧控件' },
    primary: '#FB7299',
    accent: '#23ADE5',
  },
  {
    key: 'douyin-vertical',
    platform: '抖音 / 视频号',
    format: '竖版',
    width: 1080,
    height: 1920,
    ratio: '9:16',
    purpose: '竖版短视频封面与图集，全屏播放，右侧有互动按钮栏、底部有文案条。',
    safe: {
      left: 0.08,
      right: 0.14,
      top: 0.06,
      bottom: 0.16,
      reason: '右侧互动按钮栏 + 底部标题 / 话题条',
    },
    primary: '#FE2C55',
    accent: '#25F4EE',
  },
  {
    key: 'x-twitter-image',
    platform: 'X / Twitter',
    format: '配图',
    width: 1600,
    height: 900,
    ratio: '16:9',
    purpose: '横版推文配图，时间线按 16:9 展示，信息密度可以高一些。',
    safe: { left: 0.06, right: 0.06, top: 0.12, bottom: 0.14, reason: '时间线卡片上下留白' },
    primary: '#1D9BF0',
    accent: '#F2B705',
  },
  {
    key: 'github-readme-banner',
    platform: 'GitHub',
    format: 'README 头图',
    width: 1280,
    height: 640,
    ratio: '2:1',
    purpose: '仓库 README 顶图，窄屏会裁掉两侧，主体文字必须落在中间。',
    safe: { left: 0.05, right: 0.05, top: 0.1, bottom: 0.14, reason: '窄屏裁切两侧 + 深浅色主题切换' },
    primary: '#24292F',
    accent: '#2DA44E',
  },
  {
    key: 'moments',
    platform: '朋友圈',
    format: '九宫格配图',
    width: 1080,
    height: 1080,
    ratio: '1:1',
    purpose: '朋友圈九宫格首图；九宫格会被裁成 1:1 或 4:3，主体留中间。',
    safe: { left: 0.1, right: 0.1, top: 0.08, bottom: 0.12, reason: '九宫格裁切 + 折叠时的文字遮罩' },
    primary: '#2E7D32',
    accent: '#F2B705',
  },
  {
    key: 'linkedin-image',
    platform: 'LinkedIn',
    format: '文章配图',
    width: 1200,
    height: 627,
    ratio: '1.91:1',
    purpose: 'LinkedIn 文章封面 / 动态配图，桌面端宽幅展示。',
    safe: { left: 0.06, right: 0.06, top: 0.12, bottom: 0.14, reason: '信息流卡片裁切' },
    primary: '#0A66C2',
    accent: '#F2B705',
  },
  {
    key: 'instagram-story',
    platform: 'Instagram',
    format: 'Story',
    width: 1080,
    height: 1920,
    ratio: '9:16',
    purpose: '竖版 Story / Reels 封面，顶部有账号栏、底部有回复栏。',
    safe: {
      left: 0.08,
      right: 0.12,
      top: 0.08,
      bottom: 0.14,
      reason: '顶部账号栏 + 底部回复栏',
    },
    primary: '#E1306C',
    accent: '#F2B705',
  },
  {
    key: 'taobao-main-image',
    platform: '淘宝',
    format: '主图',
    width: 800,
    height: 800,
    ratio: '1:1',
    purpose: '商品主图，搜索结果与详情页首屏；平台要求主图干净，文字靠边。',
    safe: { left: 0.06, right: 0.06, top: 0.06, bottom: 0.06, reason: '主图审核要求留白干净' },
    primary: '#FF5000',
    accent: '#F2B705',
  },
  {
    key: 'ppt-16x9',
    platform: 'PPT / 演示',
    format: '16:9 幻灯片',
    width: 1920,
    height: 1080,
    ratio: '16:9',
    purpose: '演示文稿首页 / 章节页，投屏与会议屏共用。',
    safe: { left: 0.05, right: 0.05, top: 0.08, bottom: 0.1, reason: '投影 overscan 与页码' },
    primary: '#1F2937',
    accent: '#F2B705',
  },
]

// ---------------------------------------------------------------------------
// 2. 文案 —— 每个平台一套真内容（不是占位空壳）
// ---------------------------------------------------------------------------

interface Content {
  readonly eyebrow: string
  readonly title: string
  readonly body: string
  readonly points: string
  readonly badge: string
  readonly imageLabel: string
  /** 页脚（由尺寸与派生来源生成，不在表里手写）。 */
  readonly footer: string
}

const CONTENT_BY_KEY: Readonly<Record<string, Omit<Content, 'footer'>>> = {
  'xiaohongshu-note': {
    eyebrow: '居家研究所 · 第 08 期',
    title: '把家收拾成\n你真正喜欢的样子',
    body: '断舍离不是扔东西，是把注意力还给真正重要的部分。\n三步走完，空间会自己松一口气。',
    points: '① 一次只整理一个抽屉\n② 每件物品给一个固定的家\n③ 留白比收纳盒更值钱',
    badge: '收藏这份清单',
    imageLabel: '图片占位 · 封面主图（建议暖色调实拍）',
  },
  'xiaohongshu-square': {
    eyebrow: '居家研究所 · 第 08 期',
    title: '把家收拾成\n你真正喜欢的样子',
    body: '断舍离不是扔东西，是把注意力还给真正重要的部分。',
    points: '① 一次只整理一个抽屉\n② 每件物品给一个固定的家\n③ 留白比收纳盒更值钱',
    badge: '收藏这份清单',
    imageLabel: '图片占位 · 封面主图',
  },
  'wechat-cover': {
    eyebrow: '深度长文',
    title: '一线城市通勤者的\n居住成本观察',
    body: '我们记录了 128 位受访者的居住与通勤数据，试图回答一个问题：',
    points: '① 租金占比的中位数\n② 通勤时长的真实代价',
    badge: '点击阅读全文',
    imageLabel: '图片占位 · 文章头图',
  },
  'zhihu-header': {
    eyebrow: '知乎 · 精选回答',
    title: '为什么大部分人\n做不好复利式的努力？',
    body: '复利被讲得太多，以至于很多人忽略了它的前置条件——持续性。',
    points: '① 复利的三个前提\n② 普通人最容易断在哪一步\n③ 一份可执行的年度清单',
    badge: '赞同 · 收藏',
    imageLabel: '图片占位 · 回答头图',
  },
  'weibo-image': {
    eyebrow: '@设计笔记',
    title: '配色不用多，\n两个色就够好看',
    body: '主色定气质，强调色定节奏。剩下的交给留白。',
    points: '#配色 #设计干货 #视觉设计',
    badge: '转发 · 关注',
    imageLabel: '图片占位 · 正文配图',
  },
  'bilibili-cover': {
    eyebrow: '硬核拆解 · 第 12 期',
    title: '我用 30 天，把\n旧笔记本改成了工作站',
    body: '预算 800 元，改造一台 2015 年的老笔记本。实测数据全公开。',
    points: '00:00  开场与目标\n03:20  拆机与方案\n08:45  实测性能对比',
    badge: '三连支持一下',
    imageLabel: '图片占位 · 封面主视觉',
  },
  'douyin-vertical': {
    eyebrow: '60 秒讲清楚',
    title: '3 个动作，\n让桌面立刻变清爽',
    body: '不用买收纳盒，先把这三件事做掉。',
    points: '① 全部归位\n② 视线归零\n③ 每天 5 分钟复位',
    badge: '关注看下一期',
    imageLabel: '图片占位 · 竖版主图',
  },
  'x-twitter-image': {
    eyebrow: 'OpenDesigner',
    title: '设计文件应该是\n纯文本，不是二进制',
    body: '当设计文件能 diff、能被 agent 直接改写，协作方式就变了。',
    points: '· 文本格式，Git diff 友好\n· Agent 可直接 patch\n· .fig 双向转换',
    badge: 'Open source',
    imageLabel: '图片占位 · 配图',
  },
  'github-readme-banner': {
    eyebrow: 'opendesigner',
    title: 'OpenDesigner\n文本优先的设计工作台',
    body: '用 .od 纯文本格式描述画布，Agent 直接读写，评审走 Git diff。',
    points: '· npm workspaces monorepo\n· TypeScript + zod\n· 零后端，本地优先',
    badge: 'MIT License',
    imageLabel: '图片占位 · README 头图',
  },
  moments: {
    eyebrow: '周末在家',
    title: '新买的灯到了，\n晚上终于能看清书了',
    body: '换了暖光灯泡，色温 3000K，读书不刺眼了。',
    points: '· 色温 3000K\n· 亮度 60%\n· 安装 10 分钟',
    badge: '配图 1/3',
    imageLabel: '图片占位 · 实拍',
  },
  'linkedin-image': {
    eyebrow: 'OPEN DESIGNER',
    title: 'Design files should be\ntext, not binary',
    body: 'We are building a local-first design canvas where agents patch files directly.',
    points: '· Plain-text .od format\n· Git-friendly reviews\n· Local-first, no backend',
    badge: 'Now open source',
    imageLabel: 'Image placeholder · cover',
  },
  'instagram-story': {
    eyebrow: 'STORY',
    title: '3 steps to a\ncleaner desk',
    body: 'No storage boxes needed. Start with these three.',
    points: '① Put everything back\n② Clear the sightline\n③ Reset 5 min daily',
    badge: 'Swipe up',
    imageLabel: 'Image placeholder · story',
  },
  'taobao-main-image': {
    eyebrow: '限时直降',
    title: '桌面收纳三件套\n到手价 ¥39',
    body: '抽屉分格 + 线缆理线 + 桌下抽屉，一套解决桌面杂乱。',
    points: '· 抽屉分格盒 ×2\n· 理线夹 ×4\n· 桌下抽屉 ×1',
    badge: '限时 7 天',
    imageLabel: '图片占位 · 商品主图',
  },
  'ppt-16x9': {
    eyebrow: '季度业务回顾',
    title: '2026 Q3 增长复盘\n三件最值得说的事',
    body: '整体增长 24%，其中两个渠道贡献了 71% 的增量。',
    points: '① 渠道结构变化\n② 留存拐点出现在第 3 周\n③ 下季度两个优先级',
    badge: '内部资料',
    imageLabel: '图片占位 · 配图',
  },
}

// ---------------------------------------------------------------------------
// 3. 布局引擎 —— 纯函数，无随机、无时间输入（幂等的前提）
// ---------------------------------------------------------------------------

type Orientation = 'portrait' | 'square' | 'landscape'
type LayoutFamily = 'stack' | 'split'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Placed {
  readonly kind: 'eyebrow' | 'title' | 'accentBar' | 'body' | 'points'
  readonly rect: Rect
}

/** 画板方向：由宽高比决定，不在尺寸表里写死。 */
function orientationOf(width: number, height: number): Orientation {
  const ratio = width / height
  if (ratio > 1.15) return 'landscape'
  if (ratio < 0.87) return 'portrait'
  return 'square'
}

/** 版式族：stack（图文上下）/ split（左右分栏）。 */
function layoutFamilyOf(orientation: Orientation): LayoutFamily {
  return orientation === 'landscape' ? 'split' : 'stack'
}

/** 按比例换算字号 + 上下限收敛。 */
function scaleFontSet(fonts: FontSet, factor: number): FontSet {
  const out = {} as FontSet
  for (const key of Object.keys(BASE_FONTS) as FontKey[]) {
    out[key] = clamp(round(fonts[key] * factor), FONT_MIN[key], FONT_MAX[key])
  }
  return out
}

/**
 * 派生规则的第 2 步：**高度收敛**。
 *
 * 纯按宽度等比换算，在「宽而矮」的画板上会算出撑破版面的标题
 * （900×383 的封面按 1080 宽换算是 70px 标题，两行就顶掉半个版面）。
 * 所以再按画板高度收一道：标题 ≤ 0.16×高、正文 ≤ 0.09×高。
 */
function clampByHeight(fonts: FontSet, height: number): FontSet {
  const out = { ...fonts }
  out.title = Math.min(out.title, round(height * 0.16))
  out.body = Math.min(out.body, round(height * 0.09))
  out.points = Math.min(out.points, round(height * 0.08))
  out.eyebrow = Math.min(out.eyebrow, round(height * 0.06))
  out.badge = Math.min(out.badge, round(height * 0.07))
  out.footer = Math.min(out.footer, round(height * 0.05))
  out.imageLabel = Math.min(out.imageLabel, round(height * 0.06))
  for (const key of Object.keys(BASE_FONTS) as FontKey[]) {
    out[key] = clamp(out[key], FONT_MIN[key], FONT_MAX[key])
  }
  return out
}

function countLines(text: string): number {
  return text.split('\n').length
}

/** 粗略文本宽度估算：CJK 按 1 em，西文按 0.55 em。 */
function approxTextWidth(text: string, fontSize: number): number {
  let units = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    units += isWide ? 1 : 0.55
  }
  return units * fontSize
}

interface StackItem {
  readonly kind: Placed['kind'] | 'gap'
  readonly h: number
}

/**
 * **视觉行数**（不是文本里的 \\n 数）。
 *
 * 文本框宽度变了，同一段中文就会换行 —— 派生到更窄的画板时，
 * 行数会变多。只按 \\n 数行会算出「装得下」的假象，版面上其实溢出。
 */
function visualLines(text: string, fontSize: number, width: number): number {
  if (width <= 0) return countLines(text)
  let total = 0
  for (const line of text.split('\n')) {
    const w = approxTextWidth(line, fontSize)
    total += Math.max(1, Math.ceil(w / width))
  }
  return total
}

/**
 * 文本块的纵向堆叠：眉标 → 标题 → 强调条 → 正文 → 要点。
 *
 * @param width 文本框宽度（决定换行数）
 */
function computeStack(fonts: FontSet, content: Content, width: number): StackItem[] {
  return [
    { kind: 'eyebrow', h: round(fonts.eyebrow * 1.45) },
    { kind: 'gap', h: round(fonts.eyebrow * 0.55) },
    { kind: 'title', h: round(fonts.title * 1.3 * visualLines(content.title, fonts.title, width)) },
    { kind: 'gap', h: round(fonts.title * 0.3) },
    { kind: 'accentBar', h: Math.max(6, round(fonts.title * 0.13)) },
    { kind: 'gap', h: round(fonts.body * 0.85) },
    { kind: 'body', h: round(fonts.body * 1.75 * visualLines(content.body, fonts.body, width)) },
    { kind: 'gap', h: round(fonts.body * 0.55) },
    { kind: 'points', h: round(fonts.points * 1.95 * visualLines(content.points, fonts.points, width)) },
  ]
}

/**
 * 派生规则 D4b：**横版重排时裁行**。
 *
 * 竖版的文案是按「通栏宽度 + 高画板」写的；搬到左右分栏的横版之后，
 * 文本框宽度只剩 56%、高度只剩几行，正文和要点必须裁行才放得下。
 * 这不是「内容丢了」，是**同一段文案的换行点变了**（设计师换尺寸时也是这么干的）。
 */
function trimContentForSplit(content: Content): Content {
  const bodyLines = content.body.split('\n')
  const pointLines = content.points.split('\n')
  return {
    ...content,
    body: bodyLines.slice(0, 1).join('\n'),
    points: pointLines.slice(0, 2).join('\n'),
  }
}

function stackHeight(items: readonly StackItem[]): number {
  return items.reduce((sum, item) => sum + item.h, 0)
}

/** 把纵向堆叠铺到画布上（x / 宽由调用方给）。 */
function placeStack(
  items: readonly StackItem[],
  x: number,
  y: number,
  width: number,
  fonts: FontSet
): Placed[] {
  const out: Placed[] = []
  let cursor = y
  for (const item of items) {
    if (item.kind === 'gap') {
      cursor += item.h
      continue
    }
    const w = item.kind === 'accentBar' ? round(fonts.title * 1.8) : width
    out.push({ kind: item.kind, rect: { x, y: cursor, w, h: item.h } })
    cursor += item.h
  }
  return out
}

export interface Layout {
  readonly orientation: Orientation
  readonly family: LayoutFamily
  readonly fonts: FontSet
  /** 为「不溢出」额外缩小的比例（1 = 没缩）。 */
  readonly shrinkFactor: number
  readonly safe: Rect
  readonly items: Placed[]
  readonly image: Rect
  readonly badge: Rect
  readonly footer: Rect
}

/** 安全区矩形（按目标尺寸重算，不缩放源模板的绝对留白）。 */
function computeSafe(spec: SizeSpec): Rect {
  const s = spec.safe
  return {
    x: round(spec.width * s.left),
    y: round(spec.height * s.top),
    w: round(spec.width * (1 - s.left - s.right)),
    h: round(spec.height * (1 - s.top - s.bottom)),
  }
}

/** 计算整版布局（纯函数）。 */
function computeLayout(spec: SizeSpec, fonts: FontSet, content: Content): Layout {
  const orientation = orientationOf(spec.width, spec.height)
  const family = layoutFamilyOf(orientation)
  const safe = computeSafe(spec)
  const gap = Math.max(8, round(safe.h * 0.035))

  // 标签行（badge + footer）固定在安全区底部
  const badgeH = round(fonts.badge * 2.2)
  const badgeW = round(approxTextWidth(content.badge, fonts.badge) + fonts.badge * 1.8)
  const footerW = round(approxTextWidth(content.footer, fonts.footer))
  const badgeRowY = safe.y + safe.h - badgeH
  const badge: Rect = { x: safe.x, y: badgeRowY, w: badgeW, h: badgeH }
  const footer: Rect = { x: safe.x + safe.w - footerW, y: badgeRowY, w: footerW, h: badgeH }
  const contentBottom = badgeRowY - gap

  let current = { ...fonts }
  let shrinkFactor = 1
  let items: Placed[] = []
  let image: Rect = { x: safe.x, y: safe.y, w: safe.w, h: 0 }

  if (family === 'stack') {
    // 图上文下：**图片占位拿走它应得的那一份**（版面骨架），文字吃掉剩下的；
    // 文字放不下就缩字号，缩到底还放不下才让图片让位（但不低于 24%）。
    const imageShare = orientation === 'portrait' ? 0.38 : 0.36
    const area = { x: safe.x, y: safe.y, w: safe.w, h: contentBottom - safe.y }
    const minImageH = round(area.h * 0.24)
    let imageH = round(area.h * imageShare)
    let avail = area.h - gap - imageH
    let stack = computeStack(current, content, safe.w)
    for (let iter = 0; iter < 24; iter++) {
      const textH = stackHeight(stack)
      if (textH <= avail) break
      if (current.title <= FONT_MIN.title && current.body <= FONT_MIN.body) {
        // 字号到底了 → 让图片让位
        imageH = Math.max(minImageH, imageH - (textH - avail))
        avail = area.h - gap - imageH
        break
      }
      // 直接按「还差多少」算缩放比，两三轮就收敛（比固定 0.94 步进快得多）
      const step = clamp((avail / textH) * 0.98, 0.55, 0.98)
      shrinkFactor = round(shrinkFactor * step * 1000) / 1000
      current = scaleFontSet(current, step)
      stack = computeStack(current, content, safe.w)
    }
    image = { x: safe.x, y: safe.y, w: safe.w, h: round(imageH) }
    const stackY = safe.y + image.h + gap
    items = placeStack(stack, safe.x, stackY, safe.w, current)
  } else {
    // 左右分栏：文字在左 56%，图片在右 40%
    const textColW = round(safe.w * 0.56)
    const textCol = { x: safe.x, y: safe.y, w: textColW, h: contentBottom - safe.y }
    let stack = computeStack(current, content, textColW)
    for (let iter = 0; iter < 24; iter++) {
      const textH = stackHeight(stack)
      if (textH <= textCol.h) break
      if (current.title <= FONT_MIN.title && current.body <= FONT_MIN.body) break
      const step = clamp((textCol.h / textH) * 0.98, 0.55, 0.98)
      shrinkFactor = round(shrinkFactor * step * 1000) / 1000
      current = scaleFontSet(current, step)
      stack = computeStack(current, content, textColW)
    }
    const usedH = stackHeight(stack)
    const offset = Math.max(0, round((textCol.h - usedH) / 2))
    items = placeStack(stack, textCol.x, textCol.y + offset, textCol.w, current)
    image = {
      x: safe.x + round(safe.w * 0.6),
      y: safe.y,
      w: round(safe.w * 0.4),
      h: contentBottom - safe.y,
    }
  }

  // 版面自检：文字栈不能溢出安全区（溢出了模板就是坏的，宁可生成失败也不要写出去）
  const last = items.length > 0 ? items[items.length - 1] : undefined
  if (last) {
    const stackBottom = last.rect.y + last.rect.h
    if (stackBottom > contentBottom + 1) {
      throw new Error(
        `文案溢出安全区：${spec.platform} ${spec.format}（${spec.width}×${spec.height}）` +
          `文字栈底 ${stackBottom} > 安全区底 ${contentBottom}`
      )
    }
  }

  return {
    orientation,
    family,
    fonts: current,
    shrinkFactor,
    safe,
    items,
    image,
    badge,
    footer,
  }
}

// ---------------------------------------------------------------------------
// 4. 渲染：布局 → 引擎图 → od 文档
// ---------------------------------------------------------------------------

interface Palette {
  readonly primary: string
  readonly accent: string
  readonly primaryDark: string
  readonly accentDark: string
  readonly surface: string
  readonly surfaceDark: string
  readonly ink: string
  readonly inkDark: string
  readonly muted: string
  readonly mutedDark: string
  readonly placeholder: string
  readonly placeholderDark: string
  readonly onAccent: string
  readonly onAccentDark: string
}

function paletteOf(spec: SizeSpec): Palette {
  return {
    primary: spec.primary,
    accent: spec.accent,
    primaryDark: spec.primaryDark ?? spec.primary,
    accentDark: spec.accentDark ?? spec.accent,
    surface: '#FDF8F3',
    surfaceDark: '#1A1614',
    ink: '#241C17',
    inkDark: '#F5EFE9',
    muted: '#7A6A5F',
    mutedDark: '#A2938A',
    placeholder: '#E6E1DB',
    placeholderDark: '#2A2521',
    onAccent: '#FFFFFF',
    onAccentDark: '#1A1614',
  }
}

/** 变量 id（odId 形态，恒等映射）。 */
const VAR_IDS = {
  primary: 'var~primary',
  accent: 'var~accent',
  surface: 'var~surface',
  ink: 'var~ink',
  muted: 'var~muted',
  placeholder: 'var~placeholder',
  onAccent: 'var~on-accent',
} as const

const COLLECTION_ID = 'vcol~brand'
const MODE_LIGHT = 'mode~light'
const MODE_DARK = 'mode~dark'

interface RenderContext {
  readonly spec: SizeSpec
  readonly content: Content
  readonly palette: Palette
  readonly layout: Layout
  /** 节点 id 前缀。 */
  readonly idPrefix: string
  /** 派生来源（独立模板没有）。 */
  readonly derivedFrom?: { readonly key: string; readonly label: string }
}

/** 文本节点的公共属性。 */
function textProps(
  rect: Rect,
  text: string,
  fontSize: number,
  lineHeightFactor: number,
  align: 'LEFT' | 'CENTER' | 'RIGHT',
  colorHex: string,
  colorVar: string,
  fontWeight: number
): Partial<SceneNode> {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    text,
    fontSize,
    fontFamily: FONT_FAMILY,
    fontWeight,
    lineHeight: round(fontSize * lineHeightFactor),
    textAlignHorizontal: align,
    textAlignVertical: 'TOP',
    textAutoResize: 'NONE',
    fills: [solidFill(colorHex)],
    boundVariables: { 'fills/0/color': colorVar },
  }
}

/**
 * 把布局渲染成引擎图。
 *
 * **图层顺序也是版式的一部分**：
 *   - stack（图文上下）：底板 → 图片 → 文字 → 标签 → 页脚 → 安全区
 *   - split（左右分栏）：底板 → 文字 → 图片 → 标签 → 页脚 → 安全区
 * 竖版↔横版切换时，绘制顺序真的会变（不是只改坐标）。
 */
function renderGraph(ctx: RenderContext): SceneGraph {
  const { spec, content, palette, layout } = ctx
  let counter = 0
  const graph = new SceneGraph(() => `tpl-${++counter}`)
  graph.nodes.clear()

  const id = (kind: string, slug: string): string => `${kind}~${ctx.idPrefix}-${slug}`

  // --- 根：画板 ---
  const root = graph.createNodeWithId(id('frame', 'artboard'), 'FRAME', null, {
    name: `画板 · ${spec.platform} ${spec.format} · ${spec.width}×${spec.height}`,
    x: 0,
    y: 0,
    width: spec.width,
    height: spec.height,
    clipsContent: true,
    fills: [],
    guides: [
      { id: 'guide-safe-left', axis: 'x', position: layout.safe.x },
      { id: 'guide-safe-right', axis: 'x', position: layout.safe.x + layout.safe.w },
      { id: 'guide-safe-top', axis: 'y', position: layout.safe.y },
      { id: 'guide-safe-bottom', axis: 'y', position: layout.safe.y + layout.safe.h },
    ],
  })
  graph.rootId = root.id

  // --- 变量 / 变量集合 / 模式 ---
  graph.variableCollections.set(COLLECTION_ID, {
    id: COLLECTION_ID,
    name: '品牌色板',
    modes: [
      { modeId: MODE_LIGHT, name: '浅色' },
      { modeId: MODE_DARK, name: '深色' },
    ],
    defaultModeId: MODE_LIGHT,
    variableIds: Object.values(VAR_IDS),
  } as never)

  const variables: ReadonlyArray<readonly [string, string, string, string, string]> = [
    [VAR_IDS.primary, '主色', palette.primary, palette.primaryDark, '品牌主色：栏目标签、标签底板'],
    [VAR_IDS.accent, '强调色', palette.accent, palette.accentDark, '强调色：色条、安全区参考线'],
    [VAR_IDS.surface, '画布底色', palette.surface, palette.surfaceDark, '画板背景'],
    [VAR_IDS.ink, '主文字色', palette.ink, palette.inkDark, '标题、正文、要点'],
    [VAR_IDS.muted, '次要文字色', palette.muted, palette.mutedDark, '页脚、图片占位说明'],
    [VAR_IDS.placeholder, '图片占位灰', palette.placeholder, palette.placeholderDark, '图片占位矩形的填充'],
    [VAR_IDS.onAccent, '强调色上的文字', palette.onAccent, palette.onAccentDark, '标签文字'],
  ]
  for (const [varId, name, light, dark, description] of variables) {
    graph.variables.set(varId, {
      id: varId,
      name,
      type: 'COLOR',
      collectionId: COLLECTION_ID,
      valuesByMode: {
        [MODE_LIGHT]: hexToColor(light),
        [MODE_DARK]: hexToColor(dark),
      },
      description,
      hiddenFromPublishing: false,
    } as never)
  }
  graph.activeMode.set(COLLECTION_ID, MODE_LIGHT)

  // --- 图层（按绘制顺序创建，childIds 顺序即绘制顺序）---
  graph.createNodeWithId(id('rect', 'bg'), 'RECTANGLE', root.id, {
    name: '背景底板',
    x: 0,
    y: 0,
    width: spec.width,
    height: spec.height,
    fills: [solidFill(palette.surface)],
    boundVariables: { 'fills/0/color': VAR_IDS.surface },
  })

  const createImageBlock = (): void => {
    graph.createNodeWithId(id('rect', 'image'), 'RECTANGLE', root.id, {
      name: '图片占位 · 封面主图',
      x: layout.image.x,
      y: layout.image.y,
      width: layout.image.w,
      height: layout.image.h,
      cornerRadius: round(Math.min(layout.image.w, layout.image.h) * 0.02),
      fills: [solidFill(palette.placeholder)],
      boundVariables: { 'fills/0/color': VAR_IDS.placeholder },
    })
    const labelH = round(layout.fonts.imageLabel * 1.7)
    const labelRect: Rect = {
      x: layout.image.x,
      y: layout.image.y + round(layout.image.h / 2 - labelH / 2),
      w: layout.image.w,
      h: labelH,
    }
    graph.createNodeWithId(id('text', 'image-label'), 'TEXT', root.id, {
      name: '图片占位说明',
      ...textProps(
        labelRect,
        content.imageLabel,
        layout.fonts.imageLabel,
        1.6,
        'CENTER',
        palette.muted,
        VAR_IDS.muted,
        400
      ),
    })
  }

  const createTextStack = (): void => {
    for (const placed of layout.items) {
      const r = placed.rect
      switch (placed.kind) {
        case 'eyebrow':
          graph.createNodeWithId(id('text', 'eyebrow'), 'TEXT', root.id, {
            name: '栏目标签',
            ...textProps(
              r,
              content.eyebrow,
              layout.fonts.eyebrow,
              1.45,
              'LEFT',
              palette.primary,
              VAR_IDS.primary,
              500
            ),
            letterSpacing: round(layout.fonts.eyebrow * 0.08),
          })
          break
        case 'title':
          graph.createNodeWithId(id('text', 'title'), 'TEXT', root.id, {
            name: '主标题',
            ...textProps(
              r,
              content.title,
              layout.fonts.title,
              1.3,
              'LEFT',
              palette.ink,
              VAR_IDS.ink,
              700
            ),
          })
          break
        case 'accentBar':
          graph.createNodeWithId(id('rect', 'accent-bar'), 'RECTANGLE', root.id, {
            name: '强调色条',
            x: r.x,
            y: r.y,
            width: r.w,
            height: r.h,
            cornerRadius: round(r.h / 2),
            fills: [solidFill(palette.accent)],
            boundVariables: { 'fills/0/color': VAR_IDS.accent },
          })
          break
        case 'body':
          graph.createNodeWithId(id('text', 'body'), 'TEXT', root.id, {
            name: '正文',
            ...textProps(
              r,
              content.body,
              layout.fonts.body,
              1.75,
              'LEFT',
              palette.ink,
              VAR_IDS.ink,
              400
            ),
          })
          break
        case 'points':
          graph.createNodeWithId(id('text', 'points'), 'TEXT', root.id, {
            name: '要点列表',
            ...textProps(
              r,
              content.points,
              layout.fonts.points,
              1.95,
              'LEFT',
              palette.ink,
              VAR_IDS.ink,
              400
            ),
          })
          break
        default:
          break
      }
    }
  }

  if (layout.family === 'stack') {
    createImageBlock()
    createTextStack()
  } else {
    createTextStack()
    createImageBlock()
  }

  graph.createNodeWithId(id('rect', 'badge'), 'RECTANGLE', root.id, {
    name: '标签底板',
    x: layout.badge.x,
    y: layout.badge.y,
    width: layout.badge.w,
    height: layout.badge.h,
    cornerRadius: round(layout.badge.h / 2),
    fills: [solidFill(palette.primary)],
    boundVariables: { 'fills/0/color': VAR_IDS.primary },
  })

  graph.createNodeWithId(id('text', 'badge-label'), 'TEXT', root.id, {
    name: '标签文字',
    x: layout.badge.x,
    y: layout.badge.y,
    width: layout.badge.w,
    height: layout.badge.h,
    ...textProps(
      { x: layout.badge.x, y: layout.badge.y, w: layout.badge.w, h: layout.badge.h },
      content.badge,
      layout.fonts.badge,
      2.2,
      'CENTER',
      palette.onAccent,
      VAR_IDS.onAccent,
      600
    ),
    textAlignVertical: 'CENTER',
  })

  graph.createNodeWithId(id('text', 'footer'), 'TEXT', root.id, {
    name: '页脚 · 平台与尺寸',
    ...textProps(
      layout.footer,
      content.footer,
      layout.fonts.footer,
      2.2,
      'RIGHT',
      palette.muted,
      VAR_IDS.muted,
      400
    ),
    textAlignVertical: 'CENTER',
  })

  graph.createNodeWithId(id('rect', 'safe-area'), 'RECTANGLE', root.id, {
    name: '安全区 Safe Area · 内容勿越界',
    x: layout.safe.x,
    y: layout.safe.y,
    width: layout.safe.w,
    height: layout.safe.h,
    fills: [],
    strokes: [dashedStroke(palette.accent, 2)],
    boundVariables: { 'strokes/0/color': VAR_IDS.accent },
  })

  // --- 来源信息（pluginData 是引擎原生字段，round-trip 不丢）---
  const provenance = {
    template: ctx.derivedFrom
      ? {
          kind: 'derived',
          source: ctx.derivedFrom.key,
          sourceLabel: ctx.derivedFrom.label,
          platform: spec.platform,
          format: spec.format,
          width: spec.width,
          height: spec.height,
          ratio: spec.ratio,
        }
      : {
          kind: 'standalone',
          platform: spec.platform,
          format: spec.format,
          width: spec.width,
          height: spec.height,
          ratio: spec.ratio,
        },
    layout: {
      orientation: layout.orientation,
      family: layout.family,
      safeArea: {
        left: spec.safe.left,
        right: spec.safe.right,
        top: spec.safe.top,
        bottom: spec.safe.bottom,
      },
      fonts: layout.fonts,
      shrinkFactor: layout.shrinkFactor,
    },
  }
  const rootNode = graph.nodes.get(root.id)
  if (!rootNode) throw new Error('根节点缺失')
  rootNode.pluginData = [
    { pluginId: 'opendesigner', key: 'template', value: JSON.stringify(provenance) },
  ]

  return graph
}

// ---------------------------------------------------------------------------
// 5. 模板模型 & 「一键多尺寸派生」
// ---------------------------------------------------------------------------

interface TemplateModel {
  readonly spec: SizeSpec
  readonly content: Content
  readonly layout: Layout
  readonly doc: OdDocument
  /** 文件名主干（`templates/<fileKey>.od.json`）。 */
  readonly fileKey: string
  readonly derivedFrom?: { readonly key: string; readonly label: string }
}

/** 页脚文案：平台 · 尺寸 · 比例（派生件再加一行来源）。 */
function footerTextFor(spec: SizeSpec, derivedFrom?: { key: string; label: string }): string {
  const base = `${spec.platform} · ${spec.width}×${spec.height} · ${spec.ratio}`
  return derivedFrom ? `${base} · 派生自 ${derivedFrom.label}` : base
}

/**
 * 派生规则（**唯一实现**；docs/templates/sizes.md 的 §2 与之同源）：
 *
 *   D1 画板尺寸 —— 用目标尺寸替换源画板；根节点宽高、参考线、安全区、文本框全部重算。
 *   D2 安全区 —— **按目标尺寸重算**，不缩放源模板的绝对留白：
 *                 目标平台在尺寸表里有自己的留白规则就用它的（抖音右侧按钮栏、
 *                 微信两端裁切等）；没有就沿用源比例，按目标宽高重新折算成绝对像素。
 *   D3 字号 —— **按画板宽度等比换算**：新字号 = 源字号 × (目标宽 / 源宽)，
 *                 再过两道收敛：**高度收敛**（标题 ≤ 0.16×高、正文 ≤ 0.09×高）与
 *                 **不溢出收敛**（文字栈超出安全区就同比缩字号重排）。
 *   D4 版式重排 —— 源与目标的画板方向不同（portrait / square / landscape）就**换版式族**：
 *                 stack（图文上下）↔ split（左右分栏）。换族时不是缩放坐标：
 *                 图片占位从「安全区顶部通栏」搬到「右栏 40%」，文本栈从「图下方通栏」
 *                 搬到「左栏 56% 并垂直居中」；文本框宽度变了 → 换行点变了；
 *                 **图层的绘制顺序也跟着变**（stack 是「图 → 文」，split 是「文 → 图」）。
 *   D5 内容 —— 文案原样继承；页脚改写成「目标平台 · 目标尺寸 · 派生来源」。
 */

/** 派生规则的第 3 步：字号按画板宽度等比换算 + 高度收敛。 */
function deriveFonts(sourceFonts: FontSet, sourceWidth: number, target: SizeSpec): FontSet {
  const scaled = scaleFontSet(sourceFonts, target.width / sourceWidth)
  return clampByHeight(scaled, target.height)
}

/** 派生一个尺寸。 */
function deriveVariant(source: TemplateModel, targetSpec: SizeSpec): TemplateModel {
  // D2：安全区按目标尺寸重算（目标平台自己的规则）
  const target: SizeSpec = { ...targetSpec }

  // D3：字号按宽度等比换算 + 高度收敛
  const fonts = deriveFonts(source.layout.fonts, source.spec.width, target)

  // D4：换版式族 → 文本框宽度变了 → 换行点变了 → 横版要裁行（D4b）
  const targetFamily = layoutFamilyOf(orientationOf(target.width, target.height))
  const content: Omit<Content, 'footer'> =
    targetFamily !== source.layout.family
      ? trimContentForSplit(source.content)
      : source.content

  const derivedFrom = {
    key: source.fileKey,
    label: `${source.spec.platform} ${source.spec.format}`,
  }
  const built = buildTemplate({
    spec: target,
    content,
    fonts,
    idPrefix: target.key,
    derivedFrom,
  })

  return {
    spec: target,
    content: built.content,
    layout: built.layout,
    doc: built.doc,
    fileKey: `${source.fileKey}--${target.key}`,
    derivedFrom,
  }
}

/**
 * 一键多尺寸派生：**把一个主模板的内容派生到多个尺寸**。
 *
 * @param source  主模板（独立模板或上一轮派生结果）
 * @param targets 目标尺寸（来自尺寸表）
 */
export function deriveVariants(
  source: TemplateModel,
  targets: readonly SizeSpec[]
): TemplateModel[] {
  return targets.map((target) => deriveVariant(source, target))
}

// ---------------------------------------------------------------------------
// 6. 生成 od 文档
// ---------------------------------------------------------------------------

interface BuildInput {
  readonly spec: SizeSpec
  readonly content: Omit<Content, 'footer'>
  readonly fonts: FontSet
  readonly idPrefix: string
  readonly derivedFrom?: { readonly key: string; readonly label: string }
}

function buildTemplate(input: BuildInput): {
  doc: OdDocument
  layout: Layout
  content: Content
} {
  // 页脚随目标平台走（独立模板 = 平台+尺寸；派生件再加来源）
  const content: Content = {
    ...input.content,
    footer: footerTextFor(input.spec, input.derivedFrom),
  }
  // 布局只算一次（页脚宽度只影响页脚自身的 x，不影响正文栈）
  const layout = computeLayout(input.spec, input.fonts, content)
  const graph = renderGraph({
    spec: input.spec,
    content,
    palette: paletteOf(input.spec),
    layout,
    idPrefix: input.idPrefix,
    derivedFrom: input.derivedFrom,
  })
  return { doc: fromEngine(graph), layout, content }
}

// ---------------------------------------------------------------------------
// 7. 主流程
// ---------------------------------------------------------------------------

interface GeneratedFile {
  readonly path: string
  readonly relative: string
  readonly text: string
}

function specByKey(key: string): SizeSpec {
  const found = SIZE_SPECS.find((spec) => spec.key === key)
  if (!found) throw new Error(`尺寸表里没有 ${key}`)
  return found
}

function contentByKey(key: string): Omit<Content, 'footer'> {
  const found = CONTENT_BY_KEY[key]
  if (!found) throw new Error(`文案表里没有 ${key}`)
  return found
}

/** 独立模板：按自己的尺寸，从基准字号起步。 */
function buildStandalone(spec: SizeSpec): TemplateModel {
  const fonts = clampByHeight(
    scaleFontSet({ ...BASE_FONTS }, spec.width / REFERENCE_WIDTH),
    spec.height
  )
  const built = buildTemplate({
    spec,
    content: contentByKey(spec.key),
    fonts,
    idPrefix: spec.key,
  })
  return {
    spec,
    content: built.content,
    layout: built.layout,
    doc: built.doc,
    fileKey: spec.key,
  }
}

const MASTER_KEY = 'xiaohongshu-note'
const DERIVE_TARGET_KEYS = ['wechat-cover', 'zhihu-header', 'douyin-vertical'] as const

function main(argv: readonly string[]): number {
  const checkOnly = argv.includes('--check')

  // --- 1. 独立模板 ---
  const standalone = new Map<string, TemplateModel>()
  for (const spec of SIZE_SPECS) {
    standalone.set(spec.key, buildStandalone(spec))
  }

  // --- 2. 一键多尺寸派生：主模板 → 3 个尺寸 ---
  const master = must(standalone.get(MASTER_KEY), '主模板缺失')
  const derived = deriveVariants(
    master,
    DERIVE_TARGET_KEYS.map((key) => specByKey(key))
  )

  const all: TemplateModel[] = [...standalone.values(), ...derived]

  // --- 3. 序列化 + 校验 ---
  const outputs: GeneratedFile[] = []
  for (const model of all) {
    const text = stringifyOd(model.doc)
    const raw = parseJsonc(text)
    const result = validate(raw)
    if (!result.ok) {
      const first = result.errors[0]
      throw new Error(
        `模板 ${model.fileKey} 校验失败（${result.errors.length} 个 error）：` +
          `${first?.code ?? ''} ${first?.path ?? ''} ${first?.message ?? ''}`
      )
    }
    if (result.warnings.length > 0) {
      const lines = result.warnings.map((w) => `  ${w.code} ${w.path} ${w.message}`)
      throw new Error(`模板 ${model.fileKey} 有 warning：\n${lines.join('\n')}`)
    }
    outputs.push({
      path: join(TEMPLATE_DIR, `${model.fileKey}.od.json`),
      relative: `templates/${model.fileKey}.od.json`,
      text,
    })
  }

  // --- 4. 文档 ---
  const docText = renderDoc(all, DERIVE_TARGET_KEYS)
  outputs.push({ path: DOC_PATH, relative: 'docs/templates/sizes.md', text: docText })

  // --- 5. 落盘 / 比对 ---
  let drift = 0
  for (const file of outputs) {
    const current = readIfExists(file.path)
    if (checkOnly) {
      if (current !== file.text) {
        drift += 1
        process.stdout.write(`✗ 漂移：${file.relative}\n`)
      }
      continue
    }
    mkdirSync(dirname(file.path), { recursive: true })
    if (current === file.text) {
      process.stdout.write(`= 未变：${file.relative}\n`)
      continue
    }
    writeFileSync(file.path, file.text, 'utf8')
    process.stdout.write(`✓ 已写入：${file.relative}\n`)
  }

  if (checkOnly) {
    if (drift > 0) {
      process.stdout.write(
        `\n检查失败：${drift} 个文件与生成结果不一致（跑一次生成即可修复）\n`
      )
      return 1
    }
    process.stdout.write(`\n检查通过：${outputs.length} 个文件与生成结果逐字节一致\n`)
    return 0
  }

  process.stdout.write(`\n共 ${outputs.length} 个文件，sha256（前 16 位）：\n`)
  for (const file of outputs) {
    process.stdout.write(`  ${sha256(file.text).slice(0, 16)}  ${file.relative}\n`)
  }
  return 0
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 8. 文档生成（docs/templates/sizes.md）
// ---------------------------------------------------------------------------

function renderDoc(models: readonly TemplateModel[], deriveTargets: readonly string[]): string {
  const standalone = models.filter((m) => !m.derivedFrom)
  const derivedModels = models.filter((m) => m.derivedFrom)
  const lines: string[] = []

  lines.push('# 中文社媒尺寸模板')
  lines.push('')
  lines.push('> **本文件由 `scripts/gen-templates.ts` 生成，不要手改。**')
  lines.push('> 改尺寸 / 改文案 / 加平台 → 改脚本里的 `SIZE_SPECS` / `CONTENT_BY_KEY`，再跑一次生成。')
  lines.push('')
  lines.push('```bash')
  lines.push('npx tsx scripts/gen-templates.ts           # 生成 templates/*.od.json 与本文件')
  lines.push('npx tsx scripts/gen-templates.ts --check   # 漂移检查（CI 用：不一致就退出码 1）')
  lines.push('npm run od -- validate templates/<file>.od.json')
  lines.push('```')
  lines.push('')
  lines.push(
    'OpenDesigner 面向全球开发者，没有中文社媒尺寸模板；这一层是**成本最低、感知最强**的差异点。' +
      '这里给的是**能直接打开改文案**的成品：每个模板都是 od 纯文本（含真实中文文案、' +
      '主色 / 强调色变量、安全区参考），不是空画板。'
  )
  lines.push('')

  lines.push('## 1. 尺寸清单')
  lines.push('')
  lines.push('| 平台 / 场景 | 尺寸 | 比例 | 用途 | 安全区 左/右/上/下 | 文件 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const model of standalone) {
    const s = model.spec
    const safe = [s.safe.left, s.safe.right, s.safe.top, s.safe.bottom]
      .map((v) => `${round(v * 100 * 100) / 100}%`)
      .join(' / ')
    lines.push(
      `| ${s.platform} ${s.format} | ${s.width}×${s.height} | ${s.ratio} | ${s.purpose} | ${safe} | [\`templates/${model.fileKey}.od.json\`](../../templates/${model.fileKey}.od.json) |`
    )
  }
  lines.push('')
  lines.push('安全区留白不是随手定的，来自各平台的真实 UI 遮挡：')
  lines.push('')
  for (const model of standalone) {
    lines.push(`- **${model.spec.platform} ${model.spec.format}**：${model.spec.safe.reason}。`)
  }
  lines.push('')

  lines.push('## 2. 一键多尺寸派生')
  lines.push('')
  lines.push(
    '`scripts/gen-templates.ts` 里的 `deriveVariants(source, targets)` 把**一个主模板的内容**' +
      '派生到其它尺寸。派生不是「复制 + 缩放」，规则如下：'
  )
  lines.push('')
  lines.push('| 编号 | 规则 | 说明 |')
  lines.push('| --- | --- | --- |')
  lines.push('| D1 | 画板尺寸 | 根节点宽高换成目标尺寸；参考线、安全区、文本框全部重算。 |')
  lines.push(
    '| D2 | 安全区重算 | 安全区**按目标尺寸重算**，不缩放源模板的绝对留白：目标平台在尺寸表里' +
      '有留白规则就用它的（抖音右侧按钮栏、微信两端裁切等），没有就按源比例重新折算成绝对像素。 |'
  )
  lines.push(
    '| D3 | 字号等比换算 | `新字号 = 源字号 × (目标宽 / 源宽)`，再过两道收敛：' +
      '**高度收敛**（标题 ≤ 0.16×高、正文 ≤ 0.09×高）与**不溢出收敛**（文字栈超出安全区就同比缩字号重排）。 |'
  )
  lines.push(
    '| D4 | 竖版↔横版重排 | 源与目标画板方向不同就**换版式族**：`stack`（图文上下）↔ `split`（左右分栏）。' +
      '换族时图片占位从「安全区顶部通栏」搬到「右栏 40%」，文本栈从「图下方通栏」搬到「左栏 56% 并垂直居中」；' +
      '文本框宽度变了 → 换行点变了；**图层绘制顺序也跟着变**（stack 是「图 → 文」，split 是「文 → 图」）。 |'
  )
  lines.push(
    '| D4b | 横版裁行 | 换到左右分栏后文本框只剩 56% 宽、几行高，正文取第 1 行、要点取前 2 行 —— ' +
      '**同一段文案的换行点变了**，不是内容丢了（设计师换尺寸也是这么干的）。 |'
  )
  lines.push('| D5 | 内容继承 | 文案原样继承；页脚改写成「目标平台 · 目标尺寸 · 派生来源」。 |')
  lines.push('')
  lines.push(
    '每个模板的根节点上都记了 `pluginData`（引擎原生字段，往返不丢）：' +
      '`template`（来源：独立 or 派生自谁）+ `layout`（方向、版式族、安全区比例、生效字号、`shrinkFactor`）。' +
      '`shrinkFactor` 是「不溢出收敛」实际缩了多少 —— 1 表示字号完全按 D3 换算、没有为塞进版面而缩小。'
  )
  lines.push('### 演示：主模板 + 3 个派生尺寸')
  lines.push('')
  const master = models.find((m) => m.fileKey === MASTER_KEY)
  if (master) {
    lines.push(
      `主模板：**${master.spec.platform} ${master.spec.format} ${master.spec.width}×${master.spec.height}**` +
        `（[\`templates/${master.fileKey}.od.json\`](../../templates/${master.fileKey}.od.json)）`
    )
    lines.push('')
  }
  lines.push('| 派生文件 | 目标尺寸 | 方向变化 | 版式族 | 标题字号 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const model of derivedModels) {
    const source = models.find((m) => m.fileKey === model.derivedFrom?.key)
    const srcOrientation = source ? orientationOf(source.spec.width, source.spec.height) : '—'
    const dstOrientation = orientationOf(model.spec.width, model.spec.height)
    const changed = srcOrientation === dstOrientation ? '不变' : `${srcOrientation} → ${dstOrientation}`
    lines.push(
      `| [\`templates/${model.fileKey}.od.json\`](../../templates/${model.fileKey}.od.json) | ${model.spec.width}×${model.spec.height}（${model.spec.ratio}） | ${changed} | ${model.layout.family} | ${model.layout.fonts.title}px |`
    )
  }
  lines.push('')
  lines.push(
    `派生目标（\`DERIVE_TARGET_KEYS\`）：${deriveTargets.map((k) => `\`${k}\``).join('、')}。`
  )
  lines.push('')
  lines.push(
    '派生件与尺寸表里**同名平台的独立模板**是两回事：独立模板是该平台的通用版式；' +
      '派生件是**这份主模板的内容**落到另一个尺寸。两套都在 `templates/` 里，可以直接对比。'
  )
  lines.push('')

  lines.push('## 3. 每个模板里有什么')
  lines.push('')
  lines.push('每个模板都是一棵 **根画板 FRAME**，下面挂这些图层（绘制顺序按版式族微调）：')
  lines.push('')
  lines.push('| 图层 | 类型 | 作用 |')
  lines.push('| --- | --- | --- |')
  lines.push('| 画板 · 平台 格式 · 尺寸 | FRAME | 根节点，`clipsContent` 打开，4 条参考线标出安全区 |')
  lines.push('| 背景底板 | RECTANGLE | 填充绑定 `画布底色` 变量 |')
  lines.push('| 图片占位 · 封面主图 | RECTANGLE | 灰色填充（`图片占位灰` 变量）+ 圆角，替换成真图即可 |')
  lines.push('| 图片占位说明 | TEXT | 告诉用户这块该放什么图 |')
  lines.push('| 栏目标签 | TEXT | 眉标，主色 |')
  lines.push('| 主标题 | TEXT | 中文示例标题（两行），字重 700 |')
  lines.push('| 强调色条 | RECTANGLE | 强调色，胶囊圆角 |')
  lines.push('| 正文 | TEXT | 两行正文 |')
  lines.push('| 要点列表 | TEXT | 编号要点 |')
  lines.push('| 标签底板 / 标签文字 | RECTANGLE + TEXT | 主色胶囊 + 强调色上的文字 |')
  lines.push('| 页脚 · 平台与尺寸 | TEXT | 右对齐，标注平台、尺寸、比例 |')
  lines.push('| 安全区 Safe Area · 内容勿越界 | RECTANGLE | 虚线描边（强调色），标出内容不能越界的范围 |')
  lines.push('')
  lines.push('### 变量与主题')
  lines.push('')
  lines.push('每个模板带一个变量集合 `品牌色板`，两个模式：**浅色**（默认激活）/ **深色**，7 个颜色变量：')
  lines.push('')
  lines.push('| 变量 | 作用 |')
  lines.push('| --- | --- |')
  lines.push('| 主色 | 栏目标签、标签底板 |')
  lines.push('| 强调色 | 强调色条、安全区参考线 |')
  lines.push('| 画布底色 | 背景底板 |')
  lines.push('| 主文字色 | 标题、正文、要点 |')
  lines.push('| 次要文字色 | 页脚、图片占位说明 |')
  lines.push('| 图片占位灰 | 图片占位矩形 |')
  lines.push('| 强调色上的文字 | 标签文字 |')
  lines.push('')
  lines.push(
    '颜色不是写死在节点上的：节点的 `fills.0.color` / `strokes.0.color` **绑定到变量**' +
      '（`bindings.fields`），所以切一次主题就能整体换肤。改品牌色只改变量，不用逐个节点改。'
  )
  lines.push('')

  lines.push('## 4. 怎么用')
  lines.push('')
  lines.push('```bash')
  lines.push('# 看一眼模板里有什么')
  lines.push('npm run od -- inspect templates/xiaohongshu-note.od.json')
  lines.push('')
  lines.push('# 改文案：直接编辑 od 文本里的 text.content（纯文本，Git diff 友好）')
  lines.push('# 校验')
  lines.push('npm run od -- validate templates/xiaohongshu-note.od.json')
  lines.push('```')
  lines.push('')
  lines.push(
    `字体用的是 **${FONT_FAMILY}**（思源黑体 / Noto Sans SC 一族）。机器上没有这个字体时编辑器会回退，` +
      '不影响文件本身 —— `text.font.family` 是个普通字段，改成「苹方」「微软雅黑」都行。'
  )
  lines.push('')

  lines.push('## 5. 幂等与校验')
  lines.push('')
  lines.push('- **幂等**：节点 id 全部显式指定、布局是纯函数、写盘前先比内容，所以跑两次输出**逐字节相同**。')
  lines.push('- **自检**：`npx tsx scripts/gen-templates.ts --check` 会重算一遍并与磁盘比对，不一致就退出码 1。')
  lines.push('- **校验**：每个模板落盘前都过 `validate()`，有 error 或 warning 直接抛，不写盘。')
  lines.push('')
  lines.push('```bash')
  lines.push('npx tsx scripts/gen-templates.ts --check')
  lines.push('for f in templates/*.od.json; do npm run od -- validate "$f"; done')
  lines.push('```')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 6. 文件索引')
  lines.push('')
  lines.push('| 文件 | 来源 | 尺寸 |')
  lines.push('| --- | --- | --- |')
  for (const model of models) {
    const origin = model.derivedFrom
      ? `派生自 \`${model.derivedFrom.key}\``
      : '独立模板'
    lines.push(
      `| [\`templates/${model.fileKey}.od.json\`](../../templates/${model.fileKey}.od.json) | ${origin} | ${model.spec.width}×${model.spec.height}（${model.spec.ratio}） |`
    )
  }
  lines.push('')
  lines.push(
    `本文件与 \`templates/\` 下的 ${models.length} 个模板由同一个脚本生成，` +
      '改平台清单请改 `scripts/gen-templates.ts` 里的 `SIZE_SPECS` / `CONTENT_BY_KEY`。'
  )
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 9. 入口
// ---------------------------------------------------------------------------

const isMainModule = ((): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return resolve(entry) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isMainModule) {
  process.exit(main(process.argv.slice(2)))
}
