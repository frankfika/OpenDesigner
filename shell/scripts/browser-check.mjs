/**
 * 浏览器取证：打开壳，检查 canvas 是否存在、WebGL2 是否可用、有没有 surfaceError，并截图。
 *
 * 用来验证 `npm run dev` 没有白屏（见 docs/sdk-notes.md §5 坑 E）。
 *
 * 用法：node scripts/browser-check.mjs <url> <截图路径>
 * 依赖 Playwright。没装的话跳过本项，用 `npm run render-check` 顶上（不依赖浏览器）。
 *
 * Playwright 装在全局时用 PLAYWRIGHT_MODULE 指定其入口，
 * 默认先试项目内 'playwright'，再试常见的全局路径。
 */
import { existsSync } from 'node:fs'

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
    // 试下一个
  }
}

if (!chromium) {
  console.error('BROWSER CHECK: SKIP —— 找不到 playwright，跳过（用 npm run render-check 顶上）')
  process.exit(2)
}

const url = process.argv[2] ?? 'http://localhost:5173/'
const shot = process.argv[3] ?? 'out/browser-shot.png'

const launchOptions = {
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
}
// 没有 headless_shell 时退回完整 chrome
const fullChrome = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome'
if (existsSync(fullChrome)) launchOptions.executablePath = fullChrome

const browser = await chromium.launch(launchOptions)
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(url, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(6000)

const info = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  const out = {
    canvasCount: document.querySelectorAll('canvas').length,
    bodyText: document.body.innerText.slice(0, 120)
  }
  if (c) {
    out.w = c.width
    out.h = c.height
    out.surfaceError = c.getAttribute('data-surface-error')
    const gl = c.getContext('webgl2')
    out.webgl2 = !!gl
    if (gl) out.glRenderer = gl.getParameter(gl.RENDERER)
  }
  return out
})

await page.screenshot({ path: shot })
await browser.close()

console.log('PAGE INFO:', JSON.stringify(info, null, 2))
console.log('--- console/page logs ---')
console.log(logs.join('\n') || '(none)')
console.log(`screenshot -> ${shot}`)

const ok = info.canvasCount === 1 && info.webgl2 === true && !info.surfaceError
console.log(ok ? 'BROWSER CHECK: PASS' : 'BROWSER CHECK: FAIL')
process.exit(ok ? 0 : 1)
