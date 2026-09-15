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
/**
 * 本地时间 → **带时区偏移**的 ISO8601 串。
 *
 * ## 为什么必须带偏移（这不是洁癖，是会静默毁掉诊断的那种坑）
 *
 * 时间窗的链路是：浏览器 → 工单 inputs → workflow params → agent → MCP 工具 → ES 查询。
 * **时区信息只在第一步存在**（人点选时刻的那一刻），之后每一环都只是转传字符串。
 * 而 MCP server 对不带时区的串按 **UTC** 解释：
 *
 *     # aiops-datasource-mcp-server/tools/datasource.py
 *     return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt
 *
 * 于是"北京时间 17:10"被当成"UTC 17:10"= 次日凌晨 01:10（北京），窗口整体错 8 小时，
 * **查询返回空、且不报错** —— 和 §6.11 的 VM 时钟问题是同一个失败模式：
 * 数据都在，只是窗口错了。
 *
 * 实测对照（同一时间窗，只差时区写法）：
 *     "2026-09-14T17:10:00+08:00"  → ES 命中 6 条 ERROR ✓
 *     "2026-09-14T17:10:00Z" / 不带 → 0 条 ✗
 *
 * 因此在这里（浏览器）补齐偏移，让下游拿到的是**自描述**的时间。
 * 用浏览器实际偏移（而非写死 +08:00），换时区/夏令时的环境也不会错。
 */
function toIsoWithOffset(value) {
  // 入参可能是 datetime-local 的串（"2026-09-14T17:10" / 带秒），也可能是 Date
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return typeof value === 'string' ? value : ''
  const pad = (n) => String(n).padStart(2, '0')
  // getTimezoneOffset() 返回"UTC - 本地"的分钟数，符号与 ISO 相反 → 取负
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/**
 * 默认窗口：最近 1 小时。
 *
 * **返回 naive 本地串**（`2026-09-14T17:10:00`）—— 因为它的消费方是
 * `<input type="datetime-local">`，那个控件**只接受不带时区的值**，
 * 塞带偏移的串进去会显示为空。
 * 转成带偏移的 ISO 是在提交时做的（见 `draftToPayload`）。
 */
function defaultWindow(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const naive = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return { start: naive(new Date(now.getTime() - 3600_000)), end: naive(now) }
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
      // 表单里是 datetime-local 给的 naive 本地串 → 补上时区偏移再提交。
      // 不补的话 MCP server 会按 UTC 解释，窗口整体错 8 小时且**静默返回空**（见 toIsoWithOffset 注释）
      window_start: d.windowStart ? toIsoWithOffset(d.windowStart) : undefined,
      window_end: d.windowEnd ? toIsoWithOffset(d.windowEnd) : undefined,
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
