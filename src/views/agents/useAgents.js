/**
 * Agent 目录的数据与推导。
 *
 * 数据源 `GET /agents`（B3 富化：local_tools 带 level/needs_approval、mcp_tools、
 * bound_servers、role/stage/origin/enabled）+ `GET /agents/{name}`（详情，含完整 prompt）
 * + `GET /agents/stats`（执行统计）。
 */
import { ref, computed } from 'vue'
import { agentsApi } from '@/api/agentflow'

/**
 * 沙箱外真实副作用的 agent —— 与后端 `SIDE_EFFECT_AGENTS`（executor/dag_executor.py:52）对齐。
 * 这四个字母改动会打出去（发 PR / 动集群），是自治度最高的一档。
 */
const SIDE_EFFECT_AGENTS = new Set(['committer', 'infra-remediator'])

/**
 * 自治 tier。**后端没有显式 tier 字段**，从工具面 + 角色推导（这是 B3 让
 * `local_tools` 带上 `level`/`needs_approval` 的原因 —— 只给名字就推不出来）。
 *
 * | tier | 判据 | 例子 |
 * |---|---|---|
 * | T3+ 半自动 | 在 SIDE_EFFECT_AGENTS（沙箱外副作用） | committer / infra-remediator |
 * | T3 受限执行 | 有 L2 工具（沙箱内执行），或工具需审批 | fix-implementer / tester |
 * | T2 起草待批 | 解决侧但不直接执行（产计划/评审） | fix-planner / reviewer |
 * | T1 只读咨询 | 其余（诊断侧、learn） | triage / root-cause / postmortem |
 */
export function deriveTier(agent) {
  if (SIDE_EFFECT_AGENTS.has(agent.name)) return 'T3+'
  const tools = agent.local_tools || []
  if (tools.some((t) => t.level === 'L2') || tools.some((t) => t.needs_approval)) return 'T3'
  if (agent.stage === 'learn') return 'T1'
  return agent.role === 'fix' ? 'T2' : 'T1'
}

export const TIERS = [
  { key: 'T1', label: 'T1 只读咨询', color: '#8b5cf6' },
  { key: 'T2', label: 'T2 起草待批', color: '#3b82f6' },
  { key: 'T3', label: 'T3 受限执行', color: '#14b8a6' },
  { key: 'T3+', label: 'T3+ 半自动', color: '#f59e0b' },
]

const TIER_COLOR = Object.fromEntries(TIERS.map((t) => [t.key, t.color]))

/** 2 字母符号：取连字符分词的首字母（log-analyst → LA，triage → TR） */
export function symbolOf(name) {
  const parts = String(name).split(/[-_]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return String(name).slice(0, 2).toUpperCase()
}

const STAGE_LABEL = {
  detect: 'Detect',
  diagnose: 'Diagnose',
  fix: 'Fix',
  verify: 'Verify',
  deliver: 'Deliver',
  learn: 'Learn',
  other: 'Other',
}

const ROLE_LABEL = { diagnose: '诊断侧 · Diagnose', fix: '解决侧 · Fix' }

export function useAgents() {
  const agents = ref([])
  const stats = ref({})
  const loading = ref(false)
  const error = ref('')
  const tierFilter = ref('all')
  const search = ref('')
  /** 选中的 agent（Inspector） */
  const selected = ref(null)
  const selectedDetail = ref(null)
  const detailLoading = ref(false)

  /** 给每个 agent 挂上派生字段（tier / 符号 / 编号） */
  const enriched = computed(() => {
    const counters = {}
    return agents.value.map((a) => {
      const role = a.role || 'diagnose'
      counters[role] = (counters[role] || 0) + 1
      const s = stats.value[a.name] || null
      return {
        ...a,
        tier: deriveTier(a),
        symbol: symbolOf(a.name),
        code: `${role === 'diagnose' ? 'D' : 'F'}-${String(counters[role]).padStart(2, '0')}`,
        stat: s,
        localCount: (a.local_tools || []).length,
        mcpCount: (a.mcp_tools || []).length,
      }
    })
  })

  const counts = computed(() => {
    const c = { all: enriched.value.length }
    for (const t of TIERS) c[t.key] = 0
    for (const a of enriched.value) c[a.tier] = (c[a.tier] || 0) + 1
    return c
  })

  const visible = computed(() => {
    const q = search.value.trim().toLowerCase()
    return enriched.value.filter((a) => {
      if (tierFilter.value !== 'all' && a.tier !== tierFilter.value) return false
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q)
      )
    })
  })

  /**
   * 周期表的行：按 role 分两大组，组内按 stage 分行。
   * 参考站（sip-platform）也是这个结构（大组 → 行 → 单元格）。
   */
  const groups = computed(() => {
    const byRole = new Map()
    for (const a of visible.value) {
      const role = a.role || 'diagnose'
      if (!byRole.has(role)) byRole.set(role, new Map())
      const byStage = byRole.get(role)
      if (!byStage.has(a.stage)) byStage.set(a.stage, [])
      byStage.get(a.stage).push(a)
    }
    const order = ['detect', 'diagnose', 'fix', 'verify', 'deliver', 'learn', 'other']
    return [...byRole.entries()].map(([role, byStage]) => ({
      role,
      label: ROLE_LABEL[role] || role,
      rows: [...byStage.entries()]
        .sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]))
        .map(([stage, items]) => ({ stage, label: STAGE_LABEL[stage] || stage, items })),
    }))
  })

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const [list, st] = await Promise.all([
        agentsApi.list(),
        // 统计失败不该拖垮整个页面（无 Key / 无数据时它可能是空的）
        agentsApi.stats().catch(() => ({ agents: {} })),
      ])
      agents.value = Array.isArray(list) ? list : []
      stats.value = st?.agents || {}
    } catch (err) {
      error.value = err?.message || '加载 agent 编队失败'
      agents.value = []
    } finally {
      loading.value = false
    }
  }

  async function select(agent) {
    selected.value = agent
    selectedDetail.value = null
    detailLoading.value = true
    try {
      selectedDetail.value = await agentsApi.detail(agent.name)
    } catch (err) {
      error.value = err?.message || '加载 agent 详情失败'
    } finally {
      detailLoading.value = false
    }
  }

  function close() {
    selected.value = null
    selectedDetail.value = null
  }

  return {
    TIERS,
    TIER_COLOR,
    agents,
    loading,
    error,
    tierFilter,
    search,
    selected,
    selectedDetail,
    detailLoading,
    enriched,
    counts,
    visible,
    groups,
    load,
    select,
    close,
  }
}
