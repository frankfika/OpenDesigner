# 中文社媒尺寸模板

> **本文件由 `scripts/gen-templates.ts` 生成，不要手改。**
> 改尺寸 / 改文案 / 加平台 → 改脚本里的 `SIZE_SPECS` / `CONTENT_BY_KEY`，再跑一次生成。

```bash
npx tsx scripts/gen-templates.ts           # 生成 templates/*.od.json 与本文件
npx tsx scripts/gen-templates.ts --check   # 漂移检查（CI 用：不一致就退出码 1）
npm run od -- validate templates/<file>.od.json
```

OpenDesigner 面向全球开发者，没有中文社媒尺寸模板；这一层是**成本最低、感知最强**的差异点。这里给的是**能直接打开改文案**的成品：每个模板都是 od 纯文本（含真实中文文案、主色 / 强调色变量、安全区参考），不是空画板。

## 1. 尺寸清单

| 平台 / 场景 | 尺寸 | 比例 | 用途 | 安全区 左/右/上/下 | 文件 |
| --- | --- | --- | --- | --- | --- |
| 小红书 竖版笔记 | 1080×1440 | 3:4 | 笔记首图 / 图文封面，信息流里占屏最大，竖版适合长文案与步骤图。 | 8% / 8% / 6% / 10% | [`templates/xiaohongshu-note.od.json`](../../templates/xiaohongshu-note.od.json) |
| 小红书 方形 | 1080×1080 | 1:1 | 方形封面，适合单品、清单类笔记，在双列信息流里与竖版同权重。 | 8% / 8% / 6% / 10% | [`templates/xiaohongshu-square.od.json`](../../templates/xiaohongshu-square.od.json) |
| 微信公众号 封面 | 900×383 | 2.35:1 | 公众号头图。分享到聊天 / 朋友圈时会被裁成 1:1，核心信息必须压在中间安全带。 | 6% / 6% / 12% / 16% | [`templates/wechat-cover.od.json`](../../templates/wechat-cover.od.json) |
| 知乎 文章头图 | 1200×675 | 16:9 | 文章头图，出现在回答卡片与文章列表顶部。 | 6% / 6% / 10% / 14% | [`templates/zhihu-header.od.json`](../../templates/zhihu-header.od.json) |
| 微博 配图 | 1200×1200 | 1:1 | 单图微博配图；九宫格会被裁成 1:1 或 16:9，主体居中更安全。 | 8% / 8% / 6% / 10% | [`templates/weibo-image.od.json`](../../templates/weibo-image.od.json) |
| 哔哩哔哩 封面 | 1920×1080 | 16:9 | 视频封面，首页与推荐位都按 16:9 展示；底部有时长条、右侧有控件。 | 6% / 6% / 10% / 16% | [`templates/bilibili-cover.od.json`](../../templates/bilibili-cover.od.json) |
| 抖音 / 视频号 竖版 | 1080×1920 | 9:16 | 竖版短视频封面与图集，全屏播放，右侧有互动按钮栏、底部有文案条。 | 8% / 14% / 6% / 16% | [`templates/douyin-vertical.od.json`](../../templates/douyin-vertical.od.json) |
| X / Twitter 配图 | 1600×900 | 16:9 | 横版推文配图，时间线按 16:9 展示，信息密度可以高一些。 | 6% / 6% / 12% / 14% | [`templates/x-twitter-image.od.json`](../../templates/x-twitter-image.od.json) |
| GitHub README 头图 | 1280×640 | 2:1 | 仓库 README 顶图，窄屏会裁掉两侧，主体文字必须落在中间。 | 5% / 5% / 10% / 14% | [`templates/github-readme-banner.od.json`](../../templates/github-readme-banner.od.json) |
| 朋友圈 九宫格配图 | 1080×1080 | 1:1 | 朋友圈九宫格首图；九宫格会被裁成 1:1 或 4:3，主体留中间。 | 10% / 10% / 8% / 12% | [`templates/moments.od.json`](../../templates/moments.od.json) |
| LinkedIn 文章配图 | 1200×627 | 1.91:1 | LinkedIn 文章封面 / 动态配图，桌面端宽幅展示。 | 6% / 6% / 12% / 14% | [`templates/linkedin-image.od.json`](../../templates/linkedin-image.od.json) |
| Instagram Story | 1080×1920 | 9:16 | 竖版 Story / Reels 封面，顶部有账号栏、底部有回复栏。 | 8% / 12% / 8% / 14% | [`templates/instagram-story.od.json`](../../templates/instagram-story.od.json) |
| 淘宝 主图 | 800×800 | 1:1 | 商品主图，搜索结果与详情页首屏；平台要求主图干净，文字靠边。 | 6% / 6% / 6% / 6% | [`templates/taobao-main-image.od.json`](../../templates/taobao-main-image.od.json) |
| PPT / 演示 16:9 幻灯片 | 1920×1080 | 16:9 | 演示文稿首页 / 章节页，投屏与会议屏共用。 | 5% / 5% / 8% / 10% | [`templates/ppt-16x9.od.json`](../../templates/ppt-16x9.od.json) |

安全区留白不是随手定的，来自各平台的真实 UI 遮挡：

- **小红书 竖版笔记**：底部标题条与作者信息条。
- **小红书 方形**：底部标题条与作者信息条。
- **微信公众号 封面**：两端会被裁切成 1:1 的分享卡片。
- **知乎 文章头图**：底部标题浮层。
- **微博 配图**：底部话题条与水印。
- **哔哩哔哩 封面**：底部时长 / 进度条与右侧控件。
- **抖音 / 视频号 竖版**：右侧互动按钮栏 + 底部标题 / 话题条。
- **X / Twitter 配图**：时间线卡片上下留白。
- **GitHub README 头图**：窄屏裁切两侧 + 深浅色主题切换。
- **朋友圈 九宫格配图**：九宫格裁切 + 折叠时的文字遮罩。
- **LinkedIn 文章配图**：信息流卡片裁切。
- **Instagram Story**：顶部账号栏 + 底部回复栏。
- **淘宝 主图**：主图审核要求留白干净。
- **PPT / 演示 16:9 幻灯片**：投影 overscan 与页码。

## 2. 一键多尺寸派生

`scripts/gen-templates.ts` 里的 `deriveVariants(source, targets)` 把**一个主模板的内容**派生到其它尺寸。派生不是「复制 + 缩放」，规则如下：

| 编号 | 规则 | 说明 |
| --- | --- | --- |
| D1 | 画板尺寸 | 根节点宽高换成目标尺寸；参考线、安全区、文本框全部重算。 |
| D2 | 安全区重算 | 安全区**按目标尺寸重算**，不缩放源模板的绝对留白：目标平台在尺寸表里有留白规则就用它的（抖音右侧按钮栏、微信两端裁切等），没有就按源比例重新折算成绝对像素。 |
| D3 | 字号等比换算 | `新字号 = 源字号 × (目标宽 / 源宽)`，再过两道收敛：**高度收敛**（标题 ≤ 0.16×高、正文 ≤ 0.09×高）与**不溢出收敛**（文字栈超出安全区就同比缩字号重排）。 |
| D4 | 竖版↔横版重排 | 源与目标画板方向不同就**换版式族**：`stack`（图文上下）↔ `split`（左右分栏）。换族时图片占位从「安全区顶部通栏」搬到「右栏 40%」，文本栈从「图下方通栏」搬到「左栏 56% 并垂直居中」；文本框宽度变了 → 换行点变了；**图层绘制顺序也跟着变**（stack 是「图 → 文」，split 是「文 → 图」）。 |
| D4b | 横版裁行 | 换到左右分栏后文本框只剩 56% 宽、几行高，正文取第 1 行、要点取前 2 行 —— **同一段文案的换行点变了**，不是内容丢了（设计师换尺寸也是这么干的）。 |
| D5 | 内容继承 | 文案原样继承；页脚改写成「目标平台 · 目标尺寸 · 派生来源」。 |

每个模板的根节点上都记了 `pluginData`（引擎原生字段，往返不丢）：`template`（来源：独立 or 派生自谁）+ `layout`（方向、版式族、安全区比例、生效字号、`shrinkFactor`）。`shrinkFactor` 是「不溢出收敛」实际缩了多少 —— 1 表示字号完全按 D3 换算、没有为塞进版面而缩小。
### 演示：主模板 + 3 个派生尺寸

主模板：**小红书 竖版笔记 1080×1440**（[`templates/xiaohongshu-note.od.json`](../../templates/xiaohongshu-note.od.json)）

| 派生文件 | 目标尺寸 | 方向变化 | 版式族 | 标题字号 |
| --- | --- | --- | --- | --- |
| [`templates/xiaohongshu-note--wechat-cover.od.json`](../../templates/xiaohongshu-note--wechat-cover.od.json) | 900×383（2.35:1） | portrait → landscape | split | 32px |
| [`templates/xiaohongshu-note--zhihu-header.od.json`](../../templates/xiaohongshu-note--zhihu-header.od.json) | 1200×675（16:9） | portrait → landscape | split | 49px |
| [`templates/xiaohongshu-note--douyin-vertical.od.json`](../../templates/xiaohongshu-note--douyin-vertical.od.json) | 1080×1920（9:16） | 不变 | stack | 71px |

派生目标（`DERIVE_TARGET_KEYS`）：`wechat-cover`、`zhihu-header`、`douyin-vertical`。

派生件与尺寸表里**同名平台的独立模板**是两回事：独立模板是该平台的通用版式；派生件是**这份主模板的内容**落到另一个尺寸。两套都在 `templates/` 里，可以直接对比。

## 3. 每个模板里有什么

每个模板都是一棵 **根画板 FRAME**，下面挂这些图层（绘制顺序按版式族微调）：

| 图层 | 类型 | 作用 |
| --- | --- | --- |
| 画板 · 平台 格式 · 尺寸 | FRAME | 根节点，`clipsContent` 打开，4 条参考线标出安全区 |
| 背景底板 | RECTANGLE | 填充绑定 `画布底色` 变量 |
| 图片占位 · 封面主图 | RECTANGLE | 灰色填充（`图片占位灰` 变量）+ 圆角，替换成真图即可 |
| 图片占位说明 | TEXT | 告诉用户这块该放什么图 |
| 栏目标签 | TEXT | 眉标，主色 |
| 主标题 | TEXT | 中文示例标题（两行），字重 700 |
| 强调色条 | RECTANGLE | 强调色，胶囊圆角 |
| 正文 | TEXT | 两行正文 |
| 要点列表 | TEXT | 编号要点 |
| 标签底板 / 标签文字 | RECTANGLE + TEXT | 主色胶囊 + 强调色上的文字 |
| 页脚 · 平台与尺寸 | TEXT | 右对齐，标注平台、尺寸、比例 |
| 安全区 Safe Area · 内容勿越界 | RECTANGLE | 虚线描边（强调色），标出内容不能越界的范围 |

### 变量与主题

每个模板带一个变量集合 `品牌色板`，两个模式：**浅色**（默认激活）/ **深色**，7 个颜色变量：

| 变量 | 作用 |
| --- | --- |
| 主色 | 栏目标签、标签底板 |
| 强调色 | 强调色条、安全区参考线 |
| 画布底色 | 背景底板 |
| 主文字色 | 标题、正文、要点 |
| 次要文字色 | 页脚、图片占位说明 |
| 图片占位灰 | 图片占位矩形 |
| 强调色上的文字 | 标签文字 |

颜色不是写死在节点上的：节点的 `fills.0.color` / `strokes.0.color` **绑定到变量**（`bindings.fields`），所以切一次主题就能整体换肤。改品牌色只改变量，不用逐个节点改。

## 4. 怎么用

```bash
# 看一眼模板里有什么
npm run od -- inspect templates/xiaohongshu-note.od.json

# 改文案：直接编辑 od 文本里的 text.content（纯文本，Git diff 友好）
# 校验
npm run od -- validate templates/xiaohongshu-note.od.json
```

字体用的是 **Noto Sans SC**（思源黑体 / Noto Sans SC 一族）。机器上没有这个字体时编辑器会回退，不影响文件本身 —— `text.font.family` 是个普通字段，改成「苹方」「微软雅黑」都行。

## 5. 幂等与校验

- **幂等**：节点 id 全部显式指定、布局是纯函数、写盘前先比内容，所以跑两次输出**逐字节相同**。
- **自检**：`npx tsx scripts/gen-templates.ts --check` 会重算一遍并与磁盘比对，不一致就退出码 1。
- **校验**：每个模板落盘前都过 `validate()`，有 error 或 warning 直接抛，不写盘。

```bash
npx tsx scripts/gen-templates.ts --check
for f in templates/*.od.json; do npm run od -- validate "$f"; done
```

---

## 6. 文件索引

| 文件 | 来源 | 尺寸 |
| --- | --- | --- |
| [`templates/xiaohongshu-note.od.json`](../../templates/xiaohongshu-note.od.json) | 独立模板 | 1080×1440（3:4） |
| [`templates/xiaohongshu-square.od.json`](../../templates/xiaohongshu-square.od.json) | 独立模板 | 1080×1080（1:1） |
| [`templates/wechat-cover.od.json`](../../templates/wechat-cover.od.json) | 独立模板 | 900×383（2.35:1） |
| [`templates/zhihu-header.od.json`](../../templates/zhihu-header.od.json) | 独立模板 | 1200×675（16:9） |
| [`templates/weibo-image.od.json`](../../templates/weibo-image.od.json) | 独立模板 | 1200×1200（1:1） |
| [`templates/bilibili-cover.od.json`](../../templates/bilibili-cover.od.json) | 独立模板 | 1920×1080（16:9） |
| [`templates/douyin-vertical.od.json`](../../templates/douyin-vertical.od.json) | 独立模板 | 1080×1920（9:16） |
| [`templates/x-twitter-image.od.json`](../../templates/x-twitter-image.od.json) | 独立模板 | 1600×900（16:9） |
| [`templates/github-readme-banner.od.json`](../../templates/github-readme-banner.od.json) | 独立模板 | 1280×640（2:1） |
| [`templates/moments.od.json`](../../templates/moments.od.json) | 独立模板 | 1080×1080（1:1） |
| [`templates/linkedin-image.od.json`](../../templates/linkedin-image.od.json) | 独立模板 | 1200×627（1.91:1） |
| [`templates/instagram-story.od.json`](../../templates/instagram-story.od.json) | 独立模板 | 1080×1920（9:16） |
| [`templates/taobao-main-image.od.json`](../../templates/taobao-main-image.od.json) | 独立模板 | 800×800（1:1） |
| [`templates/ppt-16x9.od.json`](../../templates/ppt-16x9.od.json) | 独立模板 | 1920×1080（16:9） |
| [`templates/xiaohongshu-note--wechat-cover.od.json`](../../templates/xiaohongshu-note--wechat-cover.od.json) | 派生自 `xiaohongshu-note` | 900×383（2.35:1） |
| [`templates/xiaohongshu-note--zhihu-header.od.json`](../../templates/xiaohongshu-note--zhihu-header.od.json) | 派生自 `xiaohongshu-note` | 1200×675（16:9） |
| [`templates/xiaohongshu-note--douyin-vertical.od.json`](../../templates/xiaohongshu-note--douyin-vertical.od.json) | 派生自 `xiaohongshu-note` | 1080×1920（9:16） |

本文件与 `templates/` 下的 17 个模板由同一个脚本生成，改平台清单请改 `scripts/gen-templates.ts` 里的 `SIZE_SPECS` / `CONTENT_BY_KEY`。
