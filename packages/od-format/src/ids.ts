/**
 * odId —— od 格式的语义 ID 层（规格 §2）。
 *
 * **核心结论（§2.6）**：od 文件里**不存**「引擎 ID 映射表」。文件里出现的所有 id 都是 odId，
 * 而 odId ↔ engineId 是**恒等映射** —— 加载时直接把 odId 注入成引擎的 node id。
 *
 * 理由（三条独立，任一条都足以否决「存映射表」）：
 *  1. engineId 每次会话都变（`${随机会话号}:${计数器}`），写进文件 = 每次保存都产生 diff 噪音。
 *  2. 写进去也没用 —— 那是上一轮会话的陈旧值。
 *  3. 破坏「同一份设计导入两次得到同一份文件」。
 *
 * 恒等映射之所以可行：引擎**不解析** node id（全源码扫描确认 `split(':')` 只出现在图标名解析里），
 * 且引擎提供 `createNodeWithId(id, type, parentId, overrides)` 接受任意字符串。
 */

/** odId 的 kind 前缀全集（规格 §2.3）。 */
export const OD_ID_KINDS = [
  'canvas',
  'frame',
  'group',
  'rect',
  'ellipse',
  'text',
  'line',
  'star',
  'poly',
  'vector',
  'bool',
  'section',
  'comp',
  'compSet',
  'inst',
  'connector',
  'shape',
  'var',
  'vcol',
  'mode',
  'prop',
] as const

export type OdIdKind = (typeof OD_ID_KINDS)[number]

/**
 * odId 的完整正则（规格 §2.2，MUST 用这一条判定一个字符串是不是 odId）。
 *
 * 关键性质：引擎 id（`48213:57`）**永远不可能**匹配它（没有 `~`），
 * odId **永远不可能**匹配引擎 id 格式（含 `~`）→ 判定无歧义。
 */
export const OD_ID_PATTERN = new RegExp(
  `^(?:${OD_ID_KINDS.join('|')})~[a-z0-9]+(?:-[a-z0-9]+)*(?:~[1-9][0-9]*)?$`
)

const OD_ID_KIND_SET: ReadonlySet<string> = new Set(OD_ID_KINDS)

/** 判断一个字符串是不是合法 odId。 */
export function isOdId(value: unknown): value is string {
  return typeof value === 'string' && OD_ID_PATTERN.test(value)
}

/** 取 odId 的 kind 前缀；不是 odId 则返回 undefined。 */
export function odIdKind(value: string): OdIdKind | undefined {
  if (!isOdId(value)) return undefined
  const kind = value.slice(0, value.indexOf('~'))
  return OD_ID_KIND_SET.has(kind) ? (kind as OdIdKind) : undefined
}

/** 取 odId 的 slug 部分；不是 odId 则返回 undefined。 */
export function odIdSlug(value: string): string | undefined {
  if (!isOdId(value)) return undefined
  const rest = value.slice(value.indexOf('~') + 1)
  const cut = rest.lastIndexOf('~')
  return cut === -1 ? rest : rest.slice(0, cut)
}

/** 取 odId 的判别器（`~1` → 1）；没有判别器则返回 undefined。 */
export function odIdDiscriminator(value: string): number | undefined {
  if (!isOdId(value)) return undefined
  const cut = value.lastIndexOf('~')
  if (cut === -1) return undefined
  const disc = value.slice(cut + 1)
  if (!/^[1-9][0-9]*$/.test(disc)) return undefined
  return Number(disc)
}

/**
 * slug 生成算法（规格 §2.4，规范性）。
 *
 * 1. NFKD 规范化，剥离组合记号（é → e）
 * 2. 转小写
 * 3. 任何不在 [a-z0-9] 的字符 → "-"
 * 4. 连续的 "-" 折叠为一个；去掉首尾 "-"
 * 5. 结果为空 → "n"
 * 6. 长度 > 24 → 截断到 24；若第 24 位落在 "-" 上，回退到最后一个 "-" 处
 *
 * 注意「标题」→ `n`：中文名不含 ASCII 字母，slug 会退化。这是可接受的 ——
 * 中文文档的可读性主要由 `name` 字段本身承担，odId 的作用是**稳定句柄**而非阅读材料。
 */
export function slugify(name: string): string {
  let s = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  s = s.toLowerCase()
  s = s.replace(/[^a-z0-9]+/g, '-')
  s = s.replace(/^-+/, '').replace(/-+$/, '')
  if (s.length === 0) return 'n'
  if (s.length > 24) {
    s = s.slice(0, 24)
    if (s.endsWith('-')) {
      const cut = s.lastIndexOf('-')
      s = cut > 0 ? s.slice(0, cut) : 'n'
    }
  }
  return s.length === 0 ? 'n' : s
}

/** 引擎 NodeType → odId 的 kind 前缀（规格 §2.3）。 */
export const NODE_TYPE_KINDS: Readonly<Record<string, OdIdKind>> = {
  CANVAS: 'canvas',
  FRAME: 'frame',
  GROUP: 'group',
  RECTANGLE: 'rect',
  ROUNDED_RECTANGLE: 'rect',
  ELLIPSE: 'ellipse',
  TEXT: 'text',
  LINE: 'line',
  STAR: 'star',
  POLYGON: 'poly',
  VECTOR: 'vector',
  BOOLEAN_OPERATION: 'bool',
  SECTION: 'section',
  COMPONENT: 'comp',
  COMPONENT_SET: 'compSet',
  INSTANCE: 'inst',
  CONNECTOR: 'connector',
  SHAPE_WITH_TEXT: 'shape',
}

/** 取引擎 NodeType 对应的 kind；未知类型退回 `shape`。 */
export function kindOfNodeType(nodeType: string): OdIdKind {
  return NODE_TYPE_KINDS[nodeType] ?? 'shape'
}

/**
 * IdRegistry —— 语义 ID 注册表（规格 §2.11 的实现契约）。
 *
 * 三件事：
 * 1. **铸造** odId：`(kind, slug)` 冲突时追加判别器，判别器来自只增不减的单调计数器。
 * 2. **恒等映射**：加载路径把 od 文件里的 odId 直接注入引擎（`adopt`）。
 * 3. **计数器持久化**：`ordinal()` 写回 `meta.ordinal`，保证判别器跨会话绝不复用。
 */
export class IdRegistry {
  /** engineId → odId */
  private readonly byEngine = new Map<string, string>()
  /** odId → engineId */
  private readonly byOd = new Map<string, string>()
  /** 已占用的 odId 集合（用于唯一性检查） */
  private readonly used = new Set<string>()
  /**
   * 曾被用过的 **base**（`kind~slug`，不带判别器）。
   *
   * 为什么单独记：规格 §2.5 的铸造算法只看「文档里已用的 odId 集合」，
   * 于是「删掉唯一的 `frame~hero`，再建一个同名节点」会**复用** `frame~hero` ——
   * 这与规格 §2.9「删除后重建同名节点获得新 odId，不复用旧 odId」直接矛盾
   * （单计数器 `meta.ordinal` 表达不了「某个 base 曾被用过」）。
   *
   * 这里取**更安全的语义**：base 一旦用过就不再复用。
   * 残留缺口：节点在**上一次会话**就被删掉并落盘的话，它的 base 不在文件里，
   * 跨会话仍可能被复用 —— 这个缺口需要额外的持久化状态才能堵上，
   * 已在 `docs/p0-acceptance.md` 立记录。
   */
  private readonly usedBases = new Set<string>()
  /** 判别器单调计数器 */
  private counter = 0

  /**
   * 登记「这个 odId 就是引擎 node id」（恒等映射），返回该 engineId。
   *
   * MUST NOT 消耗判别器 —— 加载路径上 odId 是已铸好的，不能因为重新加载就换判别器。
   */
  adopt(odId: string): string {
    const existing = this.byOd.get(odId)
    if (existing !== undefined) return existing
    if (this.used.has(odId)) {
      throw new Error(`IdRegistry.adopt: odId 重复登记 "${odId}"`)
    }
    this.registerBase(odId)
    this.used.add(odId)
    this.byEngine.set(odId, odId)
    this.byOd.set(odId, odId)
    return odId
  }

  /**
   * 解析 engineId → odId；必要时铸造。
   *
   * 三级判定（MUST 按此顺序，规格 §2.8）：
   * 1. engineId 本身匹配 odId 正则 → 直接用（恒等映射）
   * 2. registry 里有登记 → 返回登记的 odId
   * 3. 都不是 → 铸造新 odId 并登记
   */
  resolve(engineId: string, seed: { kind: OdIdKind; name: string }): string {
    // 优先级 1：engineId 本身就是 odId（加载过的文档恒走这条路）
    if (isOdId(engineId)) {
      if (!this.used.has(engineId)) {
        this.registerBase(engineId)
        this.used.add(engineId)
        this.byEngine.set(engineId, engineId)
        this.byOd.set(engineId, engineId)
      }
      return engineId
    }
    // 优先级 2：registry 里有登记
    const registered = this.byEngine.get(engineId)
    if (registered !== undefined) return registered
    // 优先级 3：铸造（**必须登记映射** —— 否则同一 engineId 再 resolve 一次会再铸一个 odId）
    const minted = this.mint(seed)
    this.byEngine.set(engineId, minted)
    this.byOd.set(minted, engineId)
    return minted
  }

  /** 登记显式绑定（加载时用）。 */
  bind(engineId: string, odId: string): void {
    if (this.used.has(odId) && this.byOd.get(odId) !== engineId) {
      throw new Error(`IdRegistry.bind: odId "${odId}" 已被占用`)
    }
    this.registerBase(odId)
    this.used.add(odId)
    this.byEngine.set(engineId, odId)
    this.byOd.set(odId, engineId)
  }

  /** 登记一个 odId 的 base（`kind~slug`）。 */
  private registerBase(odId: string): void {
    const cut = odId.lastIndexOf('~')
    if (cut <= 0) return
    // 只有判别器部分才剥掉；`kind~slug` 本身已是最短的 base
    const base = odId.slice(0, cut)
    if (/^[1-9][0-9]*$/.test(odId.slice(cut + 1))) {
      this.usedBases.add(base)
    } else {
      this.usedBases.add(odId)
    }
  }

  /** 查询，不铸造。 */
  peek(engineId: string): string | undefined {
    return this.byEngine.get(engineId)
  }

  /** 反查。 */
  engineIdOf(odId: string): string | undefined {
    return this.byOd.get(odId)
  }

  /** 已铸造的 odId 集合（校验唯一性）。 */
  known(): ReadonlySet<string> {
    return this.used
  }

  /** 当前判别器计数器的值（写回 `meta.ordinal`）。 */
  ordinal(): number {
    return this.counter
  }

  /** 从文件里的 `meta.ordinal` 恢复计数器（加载时用）。 */
  restoreOrdinal(value: number): void {
    if (!Number.isFinite(value) || value < 0) return
    if (value > this.counter) this.counter = value
  }

  /** 铸造一个 odId 并登记（内部用，也供外部显式铸造）。 */
  mint(seed: { kind: OdIdKind; name: string }): string {
    const base = `${seed.kind}~${slugify(seed.name)}`
    let candidate = base
    // base 一旦用过就不再复用（见 usedBases 的注释）
    if (this.used.has(candidate) || this.usedBases.has(base)) {
      // 判别器只增不减 —— 删掉 frame~hero~1 再新建同名会拿到更大的判别器
      do {
        this.counter += 1
        candidate = `${base}~${this.counter}`
      } while (this.used.has(candidate))
    }
    this.registerBase(candidate)
    this.used.add(candidate)
    return candidate
  }

  /** 把铸造结果登记到 engineId 上（`mint` 的配套动作）。 */
  register(engineId: string, odId: string): void {
    this.registerBase(odId)
    this.used.add(odId)
    this.byEngine.set(engineId, odId)
    this.byOd.set(odId, engineId)
  }
}

/**
 * 从一组 odId 里取最大的判别器（规格 §2.5 / §2.8）。
 *
 * 加载路径用 `max(doc.meta.ordinal, 本函数的结果)` 初始化计数器；
 * 独立的 `fromEngine(graph)` 用本函数的结果初始化 —— 否则 `meta.ordinal` 会被写回 0，
 * 判别器就可能被复用（§2.5 的保证失效）。
 */
export function maxDiscriminatorOf(odIds: Iterable<string>): number {
  let max = 0
  for (const id of odIds) {
    const disc = odIdDiscriminator(id)
    if (disc !== undefined && disc > max) max = disc
  }
  return max
}
