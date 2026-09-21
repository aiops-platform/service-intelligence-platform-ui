/**
 * Ticket Inbox 的状态与动作。
 *
 * 工单是**流程的入口**：从「抓到一条 ticket」开始 → 发起诊断 → 跳到 Run 详情看
 * 诊断/修复/审批的全过程。数据源是 agentflow 的 `/tickets`（B2 新增）。
 */
import { ref, computed } from 'vue'
import { ticketApi, runApi } from '@/api/agentflow'
import { REJECTED, runStatusLabel, statusLabel } from '@/utils/runStatus'

/**
 * 还在跑的节点状态。
 *
 * ⚠️ 这张表只用来**标注**"进行中"，不用来判"已了结"——后端返回的任何未知状态
 * 都会落到"其它"里如实展示，而不是被悄悄算成跑完。判据单边定义，错也只错在
 * 少标一个"运行中"，不会把没跑完的说成跑完了。
 */
const ACTIVE_NODE_STATUSES = new Set(['running', 'pending', 'waiting_approval'])

const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'new', label: '新建' },
  { value: 'running', label: '进行中' },
  // 停在审批门等人批 —— 不往下走了，与"进行中"必须分开
  { value: 'waiting_approval', label: '待审批' },
  // 审批被否决：run 的 status 也是 success，不单列会被显示成 resolved
  { value: 'rejected', label: '审批不通过' },
  // 跑完了但**什么都没诊断出来**：run 停在 halt 节点。与"进行中"必须分开 ——
  // 它不会自己往下走了，等人补信息（服务名 / trace_id）。
  { value: 'needs_info', label: '需要补充信息' },
  { value: 'resolved', label: '已解决' },
  { value: 'failed', label: '失败' },
]

/**
 * 工单的**展示状态**。
 *
 * ## 为什么不能直接显示 `ticket.status`
 *
 * 后端只在发起 run 时把工单置成 `running`，**之后没有任何代码再改它**
 * （`TICKET_RESOLVED` / `TICKET_FAILED` 定义了但从未被写入）——所以列表里那条
 * 会永远是 running，哪怕 run 早就失败或中断了。
 *
 * 判据只能来自 run。后端 `GET /tickets` 顺带返回 `latest_run`
 * （`{run_id, status, outcome, halted_at}`，见 `api/app.py` 的 `_with_latest_run`）。
 *
 * 所以**工单的展示状态几乎完全由 run 派生**，`ticket.status` 只在"没发起过 run"时
 * 才用得上。这不是绕远路，是实情：后端那份状态本来就没有后续。
 */
export const NEEDS_INFO = 'needs_info'
/** run 停在审批门（等人批）。展示值直接复用 `waiting_approval` —— 那个类名
 *  `.alert-tag.status-waiting_approval` 早就有了（工单详情里的 run 列表在用）。 */
export const WAITING_APPROVAL = 'waiting_approval'
/** run 被人工暂停（等人 resume）。后端能产生，但前端目前**没有暂停入口** ——
 *  所以这一档是防御性的：真出现时显示成「已暂停」，而不是悄悄算成"进行中"。 */
export const PAUSED = 'paused'
/** 审批被否决（人工驳回 / 超时自动拒绝） */
export { REJECTED }

/**
 * run **确实在往前走**的状态。
 *
 * ⚠️ `waiting_approval` **不在**这里：它不动了，在等人。混进"进行中"等于把一个
 * 需要人动手的状态藏起来 —— 与 halted 被算成 success 是同一类错误，
 * 只是这次藏的是"等你审批"。
 */
const RUN_ACTIVE = new Set(['running', 'pending', 'queued'])

/**
 * run 终态 → 工单展示状态。
 *
 * ⚠️ `success` → `resolved` 是个**约定**：一条按图跑完的 run 意味着诊断→修复→
 * 提交这条链走完了。它**不等于**"事故已确认解决"（那要看 PR 有没有合、服务有没有
 * 真恢复）——本测试床没有那条反馈回路，所以这是现有信号里最接近的一个。
 * 要改口径只改这张表。
 */
const RUN_TERMINAL_TO_TICKET = {
  success: 'resolved',
  failed: 'failed',
  cancelled: 'failed',
}

export function ticketDisplayStatus(t) {
  const r = t?.latest_run
  // 没发起过 run（或后端没给）→ 用后端自己的状态（new / running…）
  if (!r) return t?.status || ''
  // 中断优先于一切：run 的 status 是 success，但它什么都没诊断出来
  if (r.outcome === 'halted') return NEEDS_INFO
  // 审批被否决（人工驳回 / 超时自动拒绝）同样是 status=success —— 见 isRejected。
  // **必须排在 RUN_TERMINAL_TO_TICKET 之前**：否则会被映射成 resolved，
  // 也就是"方案被否了"显示成"事故已解决"。
  if (r.outcome === REJECTED && r.rejected_at) return REJECTED
  // 审批门：不往下走了，等的是**人**。必须排在 RUN_ACTIVE 之前 ——
  // 混进 running 的话，"等你审批"这条最该被看见的信息就没了。
  if (r.status === WAITING_APPROVAL) return WAITING_APPROVAL
  // 暂停同理：也是"等人"（等人 resume）。不单列的话它会掉进下面的兜底
  // `t?.status`，而工单自己的状态是 running —— 于是显示成"进行中"。
  // 注：`paused` **不在** RUN_ACTIVE 里，所以这个分支必须在兜底之前。
  if (r.status === PAUSED) return PAUSED
  if (RUN_ACTIVE.has(r.status)) return 'running'
  return RUN_TERMINAL_TO_TICKET[r.status] || t?.status || ''
}

/**
 * 展示状态的**中文**文案。**入参是工单**（不是状态字符串）。
 *
 * 文案统一来自 `@/utils/runStatus` 的 `STATUS_LABELS`；这里只多一个分支：
 * 否决要看**理由**才能定文案（超时 / 人工驳回）。
 *
 * ⚠️ 除了那个分支，**一律从工单自己的展示状态出发**，不能直接甩给 run 的文案：
 * 同一件事在两级叫法不同 —— run 说「中断」（技术视角，停在 halt 节点），
 * 工单说「缺少必要信息」（业务视角，等人补服务名 / trace_id）。
 * 实测踩过：改成 `runStatusLabel(t.latest_run)` 后，列表里 6 条
 * "缺少必要信息" 一起变成了"中断"。
 *
 * 传字符串进来也兼容（旧调用点），走纯查表。
 */
export function ticketStatusLabel(t) {
  if (typeof t === 'string') return statusLabel(t)
  const st = ticketDisplayStatus(t)
  if (st === REJECTED) {
    return t?.latest_run?.reject_reason === 'timeout' ? '审批超时' : '审批不通过'
  }
  return statusLabel(st)
}

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

  // 计数与过滤都走**展示状态**：否则"中断"的工单会被算进 In Progress，
  // 点进去却一条都看不到（列表按展示状态过滤，计数按原始状态统计）。
  const counts = computed(() => {
    const c = {
      all: tickets.value.length, new: 0, running: 0,
      waiting_approval: 0, rejected: 0, needs_info: 0, resolved: 0, failed: 0,
    }
    for (const t of tickets.value) {
      const st = ticketDisplayStatus(t)
      if (c[st] !== undefined) c[st] += 1
    }
    return c
  })

  const visible = computed(() =>
    statusFilter.value === 'all'
      ? tickets.value
      : tickets.value.filter((t) => ticketDisplayStatus(t) === statusFilter.value),
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

  /**
   * 节点状态分布：`[[状态, 个数], …]`，按个数降序。
   *
   * **如实分组、不做解释性归类**——后端在用的取值有 done / skipped / rejected /
   * rejected-canceled，将来还会加。把它们硬映射成"成功/失败/其它"会在加新状态时
   * 变成一句谎话；直接列出来则永远是准的。
   */
  function nodeBreakdown(run) {
    const counts = {}
    for (const n of Object.values(run?.nodes || {})) {
      const s = n.status || 'unknown'
      counts[s] = (counts[s] || 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }

  /**
   * 判断一个时间串**是否自描述**（带 `Z` 或 `±HH:MM` 偏移）。
   *
   * 为什么值得单独判一次：不带偏移的串会被 MCP server 按 **UTC** 解释，
   * 而人填的是本地时间 → 窗口整体错 8 小时，**查询静默返回空**。
   * 这是本模块文件头用整段注释记录的那个坑（`toIsoWithOffset`），建单侧已修，
   * 但**修复之前建的工单仍然躺在库里**。详情页把它标出来，比事后翻库强。
   */
  function isWindowSelfDescribing(value) {
    if (!value || typeof value !== 'string') return true // 空值不报"格式错"，另有缺失提示
    return /(Z|[+-]\d{2}:?\d{2})$/.test(value.trim())
  }

  /** 该工单的诊断窗口是否有问题（缺偏移 → 会被按 UTC 解释） */
  function windowWarning(ticket) {
    const s = ticket?.inputs?.window_start
    const e = ticket?.inputs?.window_end
    const bad = []
    if (s && !isWindowSelfDescribing(s)) bad.push('window_start')
    if (e && !isWindowSelfDescribing(e)) bad.push('window_end')
    if (!s || !e) return '这条工单没有诊断窗口'
    return bad.length ? `${bad.join(' / ')} 不带时区偏移` : ''
  }

  /** 还在跑的节点数（判据见 ACTIVE_NODE_STATUSES） */
  function activeNodeCount(run) {
    return Object.values(run?.nodes || {}).filter((n) =>
      ACTIVE_NODE_STATUSES.has(n.status),
    ).length
  }

  /**
   * 起止 → 人类可读耗时。
   *
   * 注意 ``run.created_at``/``updated_at`` 是**带时区**的 ISO 串（后端自己带的），
   * 与工单时间窗那种"故意不带时区"的字段不是一回事——这里只做差，不做时区换算。
   */
  function formatDuration(from, to) {
    if (!from || !to) return ''
    const ms = new Date(to).getTime() - new Date(from).getTime()
    if (!Number.isFinite(ms) || ms < 0) return ''
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s`
    return `${Math.floor(m / 60)}h ${m % 60}m`
  }

  // ---------------------------------------------------------------------
  // 详情：点列表里的一条，看工单内容 + 运行情况
  // ---------------------------------------------------------------------
  /** 当前查看的工单。打开时**现取**一次，状态才是新的（列表可能已经放了很久） */
  const detail = ref(null)
  /** 它的 run 快照（`run_ids` 逐条取；跨租户/已删的取不到就跳过） */
  const detailRuns = ref([])
  const detailLoading = ref(false)
  const detailError = ref('')

  /**
   * 打开详情。
   *
   * 先用**行数据打底**再拉全量：列表里的对象本就有 title/service/inputs，
   * 弹窗能立刻有内容，而不是先空一下。拉回来若发现看的是同一条才替换——
   * 中途点了别的工单就丢弃这次结果，免得把 A 的详情贴到 B 上。
   */
  async function openDetail(ticket) {
    detail.value = ticket
    detailRuns.value = []
    detailError.value = ''
    detailLoading.value = true
    const wanted = ticket.id
    try {
      const fresh = await ticketApi.detail(wanted)
      const ids = fresh?.run_ids || []
      // 逐条取；单条失败（比如 run 被清理了）不该让整个详情打不开
      const runs = await Promise.all(ids.map((id) => runApi.get(id).catch(() => null)))
      if (detail.value?.id !== wanted) return // 期间切了别的工单
      detail.value = fresh
      detailRuns.value = runs.filter(Boolean)
    } catch (err) {
      if (detail.value?.id === wanted) detailError.value = err?.message || '加载详情失败'
    } finally {
      if (detail.value?.id === wanted) detailLoading.value = false
    }
  }

  function closeDetail() {
    detail.value = null
    detailRuns.value = []
    detailError.value = ''
    detailLoading.value = false
  }

  /** 从详情里再发起一次诊断（工单已 resolved/failed 时想重跑） */
  async function rerunFromDetail() {
    if (!detail.value) return null
    const out = await startRun(detail.value)
    if (out) await openDetail(detail.value)
    return out
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
    detail,
    detailRuns,
    detailLoading,
    detailError,
    openDetail,
    closeDetail,
    rerunFromDetail,
    nodeBreakdown,
    activeNodeCount,
    formatDuration,
    windowWarning,
    // 展示状态：中断的工单不再显示 running（见 ticketDisplayStatus）
    ticketDisplayStatus,
    ticketStatusLabel,
  }
}
