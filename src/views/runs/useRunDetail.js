/**
 * Run 详情的状态与动作。
 *
 * 数据源 `GET /runs/{id}`（B1 补了 inputs / 时间戳 / 节点 error·耗时·attempts）。
 * 轮询用 usePolling —— 终态自动停，切走本页也停。
 */
import { ref, computed } from 'vue'
import { runApi } from '@/api/agentflow'
import { usePolling } from '@/composables/usePolling'
import { statusClass } from '@/views/bug-solve/useBugSolveRun'
import { nodeHealthOf, nodeStatusOf, runHealthOf, runStatusOf, withoutNodeHealth } from '@/utils/runStatus'

const TERMINAL = new Set(['success', 'failed', 'cancelled'])

export function useRunDetail(getRunId) {
  const run = ref(null)
  const loading = ref(false)
  const error = ref('')
  const selectedNode = ref(null)
  const detailTab = ref('output')
  const stopping = ref(false)
  const pausing = ref(false)
  const resuming = ref(false)
  /** 上一次暂停的说明（区分"跑完这节点就停"与"它其实早停了、已直接置暂停"） */
  const pausingNote = ref('')

  /** 后端原值（`success` / `failed` …）。**判终态/轮询用这个**，不要用下面的展示值。 */
  const status = computed(() => run.value?.status || '')
  /**
   * 展示状态：中断的 run 报 `halted` 而不是 `success`（判据见 `@/utils/runStatus`）。
   *
   * 与 `status` 分开是**故意的**：`running` / `isTerminal` 这些控制轮询与按钮的
   * 判断必须看后端原值 —— 拿展示值去判，`halted` 不在 `TERMINAL` 里，
   * 轮询就永远停不下来（终态 run 会被 2 秒一轮地反复拉）。
   */
  const displayStatus = computed(() => runStatusOf(run.value))
  const isTerminal = computed(() => TERMINAL.has(status.value))
  const running = computed(() => !!status.value && !isTerminal.value)

  /**
   * 整条 run 的执行告警（已归一化，来自响应**顶层** `health`）。
   *
   * 与 `detail.health`（节点级，来自 `nodes[nid].output._health`）是**两种形状**的
   * 数据源，不是同一份东西 —— 归一化在 `@/utils/runStatus` 里做掉了，这里不用管差异。
   * 单开一个 computed 是因为详情页要在**不止一个节点**的角度上给一句总账：
   * 「这条 run 有没有问题」，否则得逐个节点点开才知道。
   */
  const runHealth = computed(() => runHealthOf(run.value))

  /** 单个节点的展示状态（触发中断的那个节点报 `halted`，不是 `done`）。 */
  function nodeStatus(nid, rawStatus) {
    return nodeStatusOf(run.value, nid, rawStatus)
  }

  // ── 右侧面板的两个页签 ─────────────────────────────────────────────
  //
  // 为什么是页签而不是上下堆叠：两块内容都要占满面板高度才有用（节点详情的字段
  // 列表、审批卡的上游载荷），堆在一起只能各分一半，两边都挤。
  //
  // 待审批是**阻塞态**（run 停在那儿等人），所以默认落到它那一页；但**只在第一次
  // 出现时跳一次**，用户手动切过之后一律不动他的视图 —— 否则「正在看某个节点」
  // 被后台出现的审批拽走，比不跳更烦人。徽标在任何页签下都在，不跳也不会漏。
  const panelTab = ref('detail')
  /** 用户是否自己切过页签（切过就不再替他跳） */
  const tabTouched = ref(false)
  /** 本次 run 是否已自动跳过（每个 run 只跳一次，见上） */
  let autoJumped = false

  const pendingApprovals = computed(() => run.value?.pending_approvals || [])

  /**
   * 审批历史（含已处理的），**待办的排最前**。
   *
   * 页签要回答的第一个问题是「还欠着什么」，不是「以前批过什么」，所以按状态分档
   * 而不是按库里的 node_id 顺序原样铺开。同档内保持 node_id 序（稳定，不随轮询抖动）。
   */
  const approvals = computed(() => {
    const rank = { WAITING_APPROVAL: 0, REJECTED: 1, TIMED_OUT: 1, APPROVED: 2 }
    return [...(run.value?.approvals || [])].sort(
      (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
        || String(a.node_id).localeCompare(String(b.node_id)),
    )
  })

  /** 用户显式切页签（点节点不算「切过」—— 那是对节点表达意图，不是对面板） */
  function setPanelTab(t) {
    tabTouched.value = true
    panelTab.value = t
  }

  const nodes = computed(() => Object.entries(run.value?.nodes || {}))

  const totals = computed(() => {
    const list = nodes.value.map(([, n]) => n)
    return {
      count: list.length,
      done: list.filter((n) => n.status === 'done').length,
      failed: list.filter((n) => n.status === 'failed').length,
      durationMs: list.reduce((s, n) => s + (n.duration_ms || 0), 0),
    }
  })

  const detail = computed(() => {
    const nid = selectedNode.value
    const n = nid ? run.value?.nodes?.[nid] : null
    if (!n) return null
    return {
      nid,
      // 展示状态：halt 节点显示 halted（库里的原值是 done）
      status: nodeStatusOf(run.value, nid, n.status),
      tokens: n.tokens || 0,
      cost: typeof n.cost === 'number' ? n.cost.toFixed(4) : '0.0',
      durationMs: n.duration_ms,
      attempts: n.attempts || 0,
      error: n.error,
      // **传对象本身**，交给 NodePayload 按字段渲染。
      // 原先是这里 JSON.stringify 成一个大块，再由 <pre> 直出 —— 一个上千字的
      // 摘要会把其余字段顶出屏幕，读的人以为这个节点只收到一个输入。
      //
      // `_health` 摘掉：它由 NodeHealth 在字段列表**上方**单独渲染。不摘的话同一份
      // 告警会再列一遍，而且混在几十个业务字段中间 —— 正是要消灭的那种"看不见"。
      output: withoutNodeHealth(n.output === undefined ? null : n.output),
      params: n.params || {},
      /** 该节点的执行告警（已归一化）。`_health` 缺失时为"健康"，不是 null。 */
      health: nodeHealthOf(run.value, nid),
      /** 节点尚未跑出结果（渲染用；与 status 分开，避免和状态文案混淆） */
      isRunning: n.status === 'running',
    }
  })

  /** 上一次加载的 run_id —— 换 run 时用来复位面板状态（见 load） */
  let lastRid = ''

  async function load() {
    const rid = getRunId()
    if (!rid) return
    if (rid !== lastRid) {
      // 换了 run 就复位面板：上一个 run 的页签选择与「已跳过」对本条没有意义。
      // 放在 load 里而不是 start 里，是因为 start 还会被 onActivated 调用
      // （keep-alive 回到本页），那时**不该**把用户选的页签重置掉。
      lastRid = rid
      autoJumped = false
      tabTouched.value = false
      panelTab.value = 'detail'
    }
    try {
      run.value = await runApi.get(rid)
      error.value = ''
      // 待审批出现 → 替用户跳到审批页签（每 run 一次；用户已经动过面板就不跳）
      if (!autoJumped && !tabTouched.value && pendingApprovals.value.length) {
        autoJumped = true
        panelTab.value = 'approvals'
      }
    } catch (err) {
      error.value = err?.message || '加载 run 失败'
    } finally {
      loading.value = false
    }
  }

  const poller = usePolling(load, {
    interval: 2000,
    enabled: () => !!getRunId() && running.value,
  })

  async function start() {
    loading.value = true
    await load()
    if (running.value) poller.start()
  }

  async function stop() {
    const rid = getRunId()
    if (!rid) return
    stopping.value = true
    try {
      await runApi.stop(rid)
      await load()
    } catch (err) {
      error.value = err?.message || '停止失败'
    } finally {
      stopping.value = false
    }
  }

  /**
   * 这条 run **还有执行者吗**：`true` / `false` / `null` = 不知道。
   *
   * 判据在后端（执行租约），前端只呈现。**三态都要区分**：
   * `null` 是"判不了"（没接线 lock 或查询失败），不能当 `false` 用 ——
   * 那会在后端抖一下的时候把真在跑的 run 说成僵尸。
   */
  const executorAlive = computed(() =>
    run.value?.executor_alive === undefined ? null : run.value.executor_alive)

  /** 僵尸：状态说在跑，但**明确没有**执行者 —— 它不会自己再动了 */
  const looksStranded = computed(
    () => status.value === 'running' && executorAlive.value === false)

  async function pause() {
    const rid = getRunId()
    if (!rid) return
    pausing.value = true
    try {
      const out = await runApi.pause(rid)
      // 后端在"明确没有执行者"时会走强制路径（直接置 paused）。这个区别对使用者
      // 有意义：一种是"跑完这个节点就停"，一种是"它其实早停了"。
      pausingNote.value = out?.forced
        ? '这条 run 已无执行者，已直接置为暂停。点「恢复」可从断点续跑。'
        : '已请求暂停，当前节点跑完即停。'
      await load()
    } catch (err) {
      error.value = err?.message || '暂停失败'
    } finally {
      pausing.value = false
    }
  }

  async function resume() {
    const rid = getRunId()
    if (!rid) return
    resuming.value = true
    try {
      await runApi.resume(rid)
      await load()
    } catch (err) {
      error.value = err?.message || '恢复失败'
    } finally {
      resuming.value = false
    }
  }

  async function approve(nodeId) {
    try {
      await runApi.approve(getRunId(), nodeId)
      await load()
    } catch (err) {
      error.value = err?.message || '审批失败'
    }
  }

  async function reject(nodeId) {
    try {
      await runApi.reject(getRunId(), nodeId)
      await load()
    } catch (err) {
      error.value = err?.message || '驳回失败'
    }
  }

  function selectNode(nid) {
    selectedNode.value = nid
    detailTab.value = 'output'
    // 点节点 = 要看它的详情 → 切到详情页签。
    // 同时标记「用户已动过面板」：他正在看某个节点时，不该被后台出现的审批拽走
    // （待审批的徽标在任何页签下都看得见，不跳也不会漏）。
    tabTouched.value = true
    panelTab.value = 'detail'
  }

  return {
    run,
    loading,
    error,
    status,
    /** 展示状态（halted 的 run 不再显示 success）—— 见 displayStatus 的说明 */
    displayStatus,
    nodeStatus,
    isTerminal,
    running,
    nodes,
    totals,
    detail,
    /** run 级执行告警（顶层 `health` 归一化而来，见 runHealth 的说明） */
    runHealth,
    detailTab,
    /** 右侧面板页签：`detail` | `approvals` */
    panelTab,
    /** 切面板页签（用户显式操作，会关掉后续的自动跳转） */
    setPanelTab,
    /** 待审批（阻塞态，决定徽标显不显示） */
    pendingApprovals,
    /** 全部审批（待办排前）—— 页签里的列表用它，不是 pendingApprovals */
    approvals,
    selectedNode,
    stopping,
    pausing,
    resuming,
    pausingNote,
    /** `true`/`false`/`null`（未知）—— 判据在后端，前端只呈现 */
    executorAlive,
    /** 状态说在跑、但明确没有执行者 —— 僵尸 */
    looksStranded,
    start,
    stop,
    pause,
    resume,
    /** 只停轮询，不停止 run（离开本页时用） */
    stopPolling: poller.stop,
    approve,
    reject,
    selectNode,
    statusClass,
  }
}
