/**
 * 编辑器取证：打开壳，截「编辑态」和「实时预览态」两张图，再验证预览里的按钮真的能交互。
 *
 * 用法：node scripts/editor-shot.mjs <url> <输出目录>
 */
import { existsSync, mkdirSync } from 'node:fs'

const CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  'playwright',
  '/usr/local/lib/node_modules/playwright/index.mjs'
].filter(Boolean)

let chromium = null
for (const candidate of CANDIDATES) {
  try {
    const mod = await import(candidate)
    chromium = mod.chromium ?? mod.default?.chromium
    if (chromium) break
  } catch {
    /* 试下一个 */
  }
}
if (!chromium) {
  console.error('EDITOR SHOT: SKIP —— 找不到 playwright')
  process.exit(2)
}

const url = process.argv[2] ?? 'http://localhost:5173/'
const outDir = process.argv[3] ?? 'out'
mkdirSync(outDir, { recursive: true })

const launchOptions = {
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
}
const fullChrome = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome'
if (existsSync(fullChrome)) launchOptions.executablePath = fullChrome

const browser = await chromium.launch(launchOptions)
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const logs = []
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[error] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(url, { waitUntil: 'load', timeout: 90000 })
await page.waitForTimeout(9000)

const info = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  const gl = c?.getContext('webgl2')
  return {
    canvasCount: document.querySelectorAll('canvas').length,
    webgl2: !!gl,
    surfaceError: c?.getAttribute('data-surface-error') ?? null,
    hasToolbar: !!document.querySelector('.toolbar'),
    layerItems: document.querySelectorAll('.panel.left .item').length,
    islands: document.querySelectorAll('[data-test-id="play-islands"]').length
  }
})

await page.screenshot({ path: `${outDir}/editor-edit.png` })

// ── 开实时预览 ────────────────────────────────────────
const playBtn = page.locator('.play-toggle')
await playBtn.click()
await page.waitForTimeout(4000)

/**
 * 预览岛的真实 DOM 在 **shadow root** 里（上游 useShadowContainer + Teleport），
 * 所以 document.querySelectorAll 查不到 —— 必须钻进每个 island 的 shadowRoot。
 */
const afterPlay = await page.evaluate(() => {
  const hosts = Array.from(document.querySelectorAll('[data-island]'))
  const shadowButtons = hosts.flatMap((host) =>
    Array.from(host.shadowRoot?.querySelectorAll('button') ?? [])
  )
  const shadowTags = hosts.flatMap((host) =>
    Array.from(host.shadowRoot?.querySelectorAll('*') ?? []).map((el) =>
      el.tagName.toLowerCase()
    )
  )
  return {
    islands: document.querySelectorAll('[data-test-id="play-islands"]').length,
    islandHosts: hosts.length,
    islandButtons: shadowButtons.length,
    islandTags: [...new Set(shadowTags)].sort(),
    buttonLabels: shadowButtons.map((b) => b.textContent?.trim()).filter(Boolean),
    hint: document.querySelector('.playing-hint')?.textContent?.trim() ?? null
  }
})
await page.screenshot({ path: `${outDir}/editor-play.png` })

// ── 悬停预览里的按钮，看有没有切到 Hover 变体 ──────────
// shadow root 里的元素 Playwright 的 CSS 选择器也进不去，用鼠标坐标点。
let hoverShot = null
let hoverFill = null
const btnBox = await page.evaluate(() => {
  const host = document.querySelector('[data-island]')
  const btn = host?.shadowRoot?.querySelector('button')
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
})
if (btnBox) {
  await page.mouse.move(btnBox.x, btnBox.y)
  await page.waitForTimeout(1400)
  hoverFill = await page.evaluate(() => {
    const host = document.querySelector('[data-island]')
    const btn = host?.shadowRoot?.querySelector('button')
    return btn ? getComputedStyle(btn).backgroundColor : null
  })
  hoverShot = `${outDir}/editor-play-hover.png`
  await page.screenshot({ path: hoverShot })
}

console.log('INFO:', JSON.stringify(info, null, 2))
console.log('AFTER PLAY:', JSON.stringify(afterPlay, null, 2))
console.log('--- console errors ---')
console.log(logs.slice(0, 12).join('\n') || '(none)')
console.log('HOVER FILL:', hoverFill)
console.log(`shots -> ${outDir}/editor-edit.png, editor-play.png${hoverShot ? ', editor-play-hover.png' : ''}`)

await browser.close()

const ok =
  info.canvasCount >= 1 &&
  info.webgl2 === true &&
  afterPlay.islands > 0 &&
  afterPlay.islandButtons > 0
console.log(ok ? 'EDITOR SHOT: PASS' : 'EDITOR SHOT: FAIL')
process.exit(ok ? 0 : 1)
