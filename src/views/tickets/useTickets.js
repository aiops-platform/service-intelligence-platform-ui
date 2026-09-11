/**
 * Ticket Inbox 的状态与动作。
 *
 * 工单是**流程的入口**：从「抓到一条 ticket」开始 → 发起诊断 → 跳到 Run 详情看
 * 诊断/修复/审批的全过程。数据源是 agentflow 的 `/tickets`（B2 新增）。
 */
import { ref, computed } from 'vue'
import { ticketApi } from '@/api/agentflow'

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'running', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'failed', label: 'Failed' },
]

/** 默认时间窗：最近 1 小时。v5.5 §7.1 要求窗口由调用方下发，不能留给平台猜。 */
function defaultWindow(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const iso = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  return { start: iso(new Date(now.getTime() - 3600_000)), end: iso(now) }
}

export function useTickets() {
  const tickets = ref([])
  const loading = ref(false)
  const error = ref('')
  const statusFilter = ref('all')

  /** 新建表单（字段对齐测试数据里的 ServiceNow 事件形状） */
  const draft = ref(emptyDraft())
  const creating = ref(false)
  /** 正在发起诊断的 ticket id（防重复点击） */
  const runningId = ref('')

  function emptyDraft() {
    const w = defaultWindow()
    return {
      number: '',
      title: '',
      service: '',
      namespace: 'order',
      severity: 'high',
      traceId: '',
      windowStart: w.start,
      windowEnd: w.end,
    }
  }

  /** 表单 → `POST /tickets` 的 body */
  function draftToPayload(d) {
    const bugReport = {
      number: d.number || undefined,
      short_description: d.title,
      cmdb_ci: { name: d.service || undefined, namespace: d.namespace || undefined },
    }
    if (d.traceId) bugReport.correlation_hint = { trace_id: d.traceId }
    const payload = {
      title: d.title,
      bug_report: bugReport,
      window_start: d.windowStart || undefined,
      window_end: d.windowEnd || undefined,
      severity: d.severity || undefined,
    }
    return payload
  }

  const counts = computed(() => {
    const c = { all: tickets.value.length, new: 0, running: 0, resolved: 0, failed: 0 }
    for (const t of tickets.value) {
      if (c[t.status] !== undefined) c[t.status] += 1
    }
    return c
  })

  const visible = computed(() =>
    statusFilter.value === 'all'
      ? tickets.value
      : tickets.value.filter((t) => t.status === statusFilter.value),
  )

  async function load() {
    loading.value = true
    error.value = ''
    try {
      tickets.value = (await ticketApi.list()) || []
    } catch (err) {
      error.value = err?.message || '加载工单失败'
      tickets.value = []
    } finally {
      loading.value = false
    }
  }

  async function create() {
    if (!draft.value.title.trim()) {
      error.value = '摘要（title）必填'
      return null
    }
    creating.value = true
    error.value = ''
    try {
      const created = await ticketApi.create(draftToPayload(draft.value))
      tickets.value = [created, ...tickets.value]
      draft.value = emptyDraft()
      return created
    } catch (err) {
      error.value = err?.message || '建工单失败'
      return null
    } finally {
      creating.value = false
    }
  }

  /**
   * 发起诊断。返回 `{run_id}`；调用方负责跳转到 Run 详情。
   * 失败时把后端的 detail 直接展示（例如"库里没有已保存的 workflow"）。
   */
  async function startRun(ticket) {
    runningId.value = ticket.id
    error.value = ''
    try {
      const out = await ticketApi.run(ticket.id, ticket.workflowId)
      await load() // 工单状态转为 running、run_ids 更新
      return out
    } catch (err) {
      error.value = err?.message || '发起诊断失败'
      return null
    } finally {
      runningId.value = ''
    }
  }

  return {
    STATUS_FILTERS,
    tickets,
    loading,
    error,
    statusFilter,
    draft,
    creating,
    runningId,
    counts,
    visible,
    load,
    create,
    startRun,
  }
}
