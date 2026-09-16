/**
 * CMDB 编辑器的状态与动作。
 *
 * ## 一个绕不开的事实：**服务端才是校验权威**
 *
 * 前端能做的是"把表单渲染得对"，做不了的是"这份改动合法吗"——合法性依赖整张图：
 * 边端点是否存在、端点类型是否被该边允许、id 前缀是否与 type 一致、tags 是否在封闭
 * 词表内、calls 边是否指向已知 app……这些都要看**整份文档**。
 *
 * 所以这里刻意**不**在前端复刻一套校验规则（两份规则一定会漂移），而是：
 * 保存 → 服务端整份过 `build_graph` → 不通过就 422 且**文件一个字节都不动** →
 * 把后端的原话显示出来。用户看到的是"为什么不行"，不是"保存失败"。
 *
 * ## schema 为什么必须从后端拿
 *
 * 每种节点类型的 `attributes` 形状住在后端的 `NODE_ATTR_MODELS`（pydantic 旁表），
 * `docs/cmdb-entities.schema.json` 里**没有**。所以表单字段只能来自
 * `GET /admin/cmdb/schema` 的 `attribute_models`；没登记模型的类型走自由 KV。
 */
import { computed, ref } from 'vue'
import { cmdbApi, describeError } from '@/api/cmdb'

/** 节点的可编辑信封字段。`id` / `type` 是身份，后端明确拒绝修改，这里也不给入口。 */
const EDITABLE = ['display_name', 'description', 'tags', 'keywords', 'attributes', 'notes']

export function useCmdb() {
  const loading = ref(false)
  const saving = ref(false)
  /** 后端返回的失败原文——必须原样展示，它带着"为什么这次没生效" */
  const error = ref('')
  /** 最近一次成功的动作，给用户一个"真的生效了"的正反馈 */
  const notice = ref('')

  const schema = ref(null)
  const summary = ref(null)
  const nodes = ref({})
  const edges = ref([])

  const activeType = ref('')
  const search = ref('')
  const selectedId = ref('')
  /** 正在编辑的草稿（选中节点时从节点深拷贝一份） */
  const draft = ref(null)

  // 新建节点表单
  const creating = ref(false)
  const newDraft = ref(emptyNewNode())

  function emptyNewNode() {
    return { type: '', name: '', display_name: '', description: '', keywordsText: '', tags: [] }
  }

  // 新建边表单
  const linking = ref(false)
  const edgeDraft = ref(emptyEdge())

  function emptyEdge() {
    return { key: '', targetId: '' }
  }

  // ---------------------------------------------------------------------
  // 派生
  // ---------------------------------------------------------------------
  const nodeTypes = computed(() =>
    (schema.value?.node_types || []).map((t) => ({
      ...t,
      count: (nodes.value[t.key] || []).length,
    })),
  )

  const visibleTypes = computed(() => nodeTypes.value.filter((t) => t.count > 0))

  const listNodes = computed(() => {
    const all = nodes.value[activeType.value] || []
    const q = search.value.trim().toLowerCase()
    if (!q) return all
    return all.filter((n) =>
      [n.id, n.name, n.display_name, n.description, ...(n.keywords || [])]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    )
  })

  const selected = computed(() =>
    (nodes.value[activeType.value] || []).find((n) => n.id === selectedId.value) || null,
  )

  /** 与选中节点相关的边（双向）——删节点前必须让用户看到这些，否则 409 会显得莫名其妙 */
  const relatedEdges = computed(() => {
    if (!selectedId.value) return []
    return edges.value.filter((e) => e.from === selectedId.value || e.to === selectedId.value)
  })

  /**
   * 当前类型的 attributes 表单字段。
   *
   * `null` = 该类型没登记属性模型（开放 KV），调用方应退回 JSON 文本框编辑而不是硬套表单。
   * `anyOf` 里的 `{"type":"null"}` 是 pydantic 对 `X | None` 的写法，要拆出来——
   * 否则每个可空字段都会渲染成一个没用的联合类型。
   *
   * ## 条件必填是必须并进来的
   *
   * `model.required` 只列"任何情况下都必填"的（app 只有 `kind`），因为 JSON Schema
   * **表达不了条件必填**。可 `source=kubernetes` 时那 6 个运行时字段其实必填——
   * 只照 `required` 渲染，用户就看不到"必填"，填完一保存才被拒。
   * 后端把这张表单独给了（`conditional_required`），这里按判别字段的**当前取值**取用。
   */
  const attrFields = computed(() => {
    if (!selected.value || !schema.value) return null
    const typeKey = selected.value.type
    const model = schema.value.attribute_models?.[typeKey]
    if (!model) return null

    const required = new Set(model.required || [])
    const cond = schema.value.conditional_required?.[typeKey]
    if (cond) {
      const current = draft.value?.attributes?.[cond.discriminator]
      for (const f of cond.required_if?.[current] || []) required.add(f)
    }

    return Object.entries(model.properties || {}).map(([key, spec]) => {
      const variants = spec.anyOf || [spec]
      const real = variants.find((v) => v.type !== 'null') || {}
      const nullable = variants.length > 1 || spec.type === 'null'
      return {
        key,
        label: real.title || key,
        type: real.type || 'string',
        enum: real.enum || null,
        nullable,
        required: required.has(key),
        description: real.description || '',
      }
    })
  })

  const canSubmitDraft = computed(() => !!draft.value && !saving.value)

  // ---------------------------------------------------------------------
  // 建边：以**当前选中节点**为一端
  // ---------------------------------------------------------------------
  /**
   * 从选中节点出发，可以建哪些边。
   *
   * 端点类型由 ontology 声明（`from_types` / `to_types`），这里据此判三件事：
   *   1. 这个边类型能不能用在当前节点上，以及它在哪一端
   *   2. 另一端**只能是哪些类型的节点** —— 这是把"102 个节点里挑一个"
   *      缩成"10 个 codebase 里挑一个"的关键，也让用户不可能选错类型
   *   3. `role` 决定提交时谁当 `from`：
   *        'from' → 选中节点是起点
   *        'to'   → 选中节点是终点（有向边时方向不能反）
   *        'either' → 两端类型相同（如 calls app→app），默认选中节点当起点
   *
   * 无向边的 `role` 用 'from' 表示——后端对无向边两个方向都收（校验器里那条
   * `not spec.directed and ft in spec.to_types`），所以方向不影响合法性。
   */
  const edgeOptions = computed(() => {
    if (!selected.value || !schema.value) return []
    const t = selected.value.type
    const out = []
    for (const spec of schema.value.edge_types || []) {
      const asFrom = (spec.from_types || []).includes(t)
      const asTo = (spec.to_types || []).includes(t)
      if (!asFrom && !asTo) continue
      out.push({
        key: spec.key,
        label: spec.label_zh || spec.label,
        layer: spec.layer,
        directed: spec.directed,
        role: asFrom && asTo ? 'either' : asFrom ? 'from' : 'to',
        // 另一端允许的类型：选中节点当起点时看 to_types，当终点时看 from_types
        targetTypes: asFrom ? spec.to_types : spec.from_types,
      })
    }
    return out
  })

  const currentEdgeOption = computed(
    () => edgeOptions.value.find((o) => o.key === edgeDraft.value.key) || null,
  )

  /** 另一端的候选节点。按 edgeOptions 给出的类型白名单过滤——用户选不出非法的组合。 */
  const candidateTargets = computed(() => {
    const opt = currentEdgeOption.value
    if (!opt) return []
    const allowed = new Set(opt.targetTypes || [])
    const out = []
    for (const [typeKey, list] of Object.entries(nodes.value)) {
      if (!allowed.has(typeKey)) continue
      for (const n of list) {
        // 自环只在边类型两端都允许该类型时才给（如 incident → incident 的风暴扇出）
        if (n.id === selectedId.value && !(opt.targetTypes || []).includes(selected.value.type)) {
          continue
        }
        out.push(n)
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  })

  async function createEdge() {
    const opt = currentEdgeOption.value
    if (!opt || !edgeDraft.value.targetId) return
    saving.value = true
    try {
      const me = selectedId.value
      const other = edgeDraft.value.targetId
      const [from, to] = opt.role === 'to' ? [other, me] : [me, other]
      await cmdbApi.createEdge({ type: opt.key, from, to })
      edgeDraft.value = emptyEdge()
      linking.value = false
      await load()
      ok(`已建立 ${opt.key}：${from} → ${to}`)
    } catch (err) {
      fail(err)
    } finally {
      saving.value = false
    }
  }

  // ---------------------------------------------------------------------
  // 动作
  // ---------------------------------------------------------------------
  function fail(err) {
    error.value = describeError(err)
    notice.value = ''
  }

  function ok(msg) {
    notice.value = msg
    error.value = ''
  }

  async function load({ keepSelection = true } = {}) {
    loading.value = true
    error.value = ''
    try {
      const [s, sum, bundle] = await Promise.all([
        cmdbApi.schema(),
        cmdbApi.summary(),
        cmdbApi.nodes(),
      ])
      schema.value = s
      summary.value = sum
      nodes.value = bundle.nodes || {}
      edges.value = bundle.edges || []

      // 维护选中项：默认落在第一个有数据的类型上
      if (!activeType.value || !nodes.value[activeType.value]) {
        activeType.value = visibleTypes.value[0]?.key || ''
      }
      if (keepSelection && selectedId.value) {
        const still = (nodes.value[activeType.value] || []).some((n) => n.id === selectedId.value)
        if (!still) select(null)
      }
    } catch (err) {
      fail(err)
    } finally {
      loading.value = false
    }
  }

  function select(node) {
    selectedId.value = node?.id || ''
    draft.value = node ? toDraft(node) : null
    // 换节点就把建边表单收回初始态——否则会把上一个节点的边类型/目标带到新节点上，
    // 而那个组合多半是非法的（端点类型对不上）
    linking.value = false
    edgeDraft.value = emptyEdge()
  }

  /**
   * 删边。
   *
   * 和建边是一对：既然「一个 app 只能有一个仓库」被改成了校验期报错，就必须让用户
   * 能**在页面上解掉**多余的边——否则他只能看着那句报错，然后回去开终端。
   */
  async function removeEdge(edgeId) {
    saving.value = true
    try {
      await cmdbApi.removeEdge(edgeId)
      await load()
      ok(`已删除边 ${edgeId}`)
    } catch (err) {
      fail(err)
    } finally {
      saving.value = false
    }
  }

  /** 节点 → 草稿。数组/对象都要深拷贝，否则编辑会直接改到列表里的那一份。 */
  function toDraft(node) {
    return {
      id: node.id,
      type: node.type,
      name: node.name,
      display_name: node.display_name ?? '',
      description: node.description ?? '',
      notes: node.notes ?? '',
      tags: [...(node.tags || [])],
      keywordsText: (node.keywords || []).join('、'),
      keywords: [...(node.keywords || [])],
      attributes: JSON.parse(JSON.stringify(node.attributes || {})),
      attributesText: JSON.stringify(node.attributes || {}, null, 2),
    }
  }

  function syncAttributesText() {
    if (draft.value) {
      draft.value.attributesText = JSON.stringify(draft.value.attributes || {}, null, 2)
    }
  }

  /** 提交时的载荷：只发后端认得的字段，且不含 id / type（后端会拒）。 */
  function draftPayload() {
    const d = draft.value
    const tags = d.tags || []
    const keywords = splitKeywords(d.keywordsText)
    return {
      display_name: d.display_name || null,
      description: d.description || null,
      notes: d.notes || null,
      tags,
      keywords,
      attributes: d.usingJsonAttributes ? parseAttributesText(d.attributesText) : d.attributes,
    }
  }

  /** 关键词输入：中英文顿号/逗号/换行都当分隔符——用户不该为了分个词去查文档 */
  function splitKeywords(text) {
    return String(text || '')
      .split(/[、,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
  }

  function parseAttributesText(text) {
    const trimmed = String(text || '').trim()
    if (!trimmed) return {}
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('attributes 必须是一个 JSON 对象')
      }
      return parsed
    } catch (err) {
      // 抛出去会被 fail() 显示；这里给一句人话，而不是 JSON.parse 的原始报错
      throw new Error(`attributes 不是合法 JSON：${err.message}`)
    }
  }

  async function save() {
    if (!draft.value) return
    saving.value = true
    try {
      await cmdbApi.updateNode(draft.value.id, draftPayload())
      await load()
      ok(`已保存 ${draft.value.id}`)
    } catch (err) {
      fail(err)
    } finally {
      saving.value = false
    }
  }

  async function remove({ cascade = false } = {}) {
    if (!selectedId.value) return
    saving.value = true
    try {
      const r = await cmdbApi.removeNode(selectedId.value, { cascade })
      const extra = r.deleted_edges?.length ? `（连同 ${r.deleted_edges.length} 条边）` : ''
      select(null)
      await load()
      ok(`已删除${extra}`)
    } catch (err) {
      fail(err)
    } finally {
      saving.value = false
    }
  }

  async function create() {
    saving.value = true
    try {
      const d = newDraft.value
      const node = {
        id: `${d.type}:${d.name}`,
        type: d.type,
        name: d.name,
        display_name: d.display_name || null,
        description: d.description || null,
        tags: d.tags || [],
        keywords: splitKeywords(d.keywordsText),
        attributes: {},
      }
      await cmdbApi.createNode(node)
      creating.value = false
      newDraft.value = emptyNewNode()
      // 切到新节点所在的类型，并把选中落到它身上——否则用户看不到自己刚建的东西
      activeType.value = node.type
      selectedId.value = node.id
      await load()
      const created = (nodes.value[node.type] || []).find((n) => n.id === node.id)
      if (created) select(created)
      ok(`已新增 ${node.id}`)
    } catch (err) {
      fail(err)
    } finally {
      saving.value = false
    }
  }

  return {
    EDITABLE,
    loading, saving, error, notice,
    schema, summary, nodes, edges,
    activeType, search, selectedId, selected, draft, relatedEdges, attrFields,
    listNodes, nodeTypes, visibleTypes, canSubmitDraft,
    creating, newDraft,
    linking, edgeDraft, edgeOptions, currentEdgeOption, candidateTargets,
    load, select, save, remove, create, syncAttributesText, splitKeywords,
    createEdge, removeEdge,
  }
}
