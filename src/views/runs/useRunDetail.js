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
import { nodeStatusOf, runStatusOf } from '@/utils/runStatus'

const TERMINAL = new Set(['success', 'failed', 'cancelled'])

export function useRunDetail(getRunId) {
  const run = ref(null)
  const loading = ref(false)
  const error = ref('')
  const selectedNode = ref(null)
  const detailTab = ref('output')
  const stopping = ref(false)

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

  /** 单个节点的展示状态（触发中断的那个节点报 `halted`，不是 `done`）。 */
  function nodeStatus(nid, rawStatus) {
    return nodeStatusOf(run.value, nid, rawStatus)
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
      output: n.output === undefined ? null : n.output,
      params: n.params || {},
      /** 节点尚未跑出结果（渲染用；与 status 分开，避免和状态文案混淆） */
      isRunning: n.status === 'running',
    }
  })

  async function load() {
    const rid = getRunId()
    if (!rid) return
    try {
      run.value = await runApi.get(rid)
      error.value = ''
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
    detailTab,
    selectedNode,
    stopping,
    start,
    stop,
    /** 只停轮询，不停止 run（离开本页时用） */
    stopPolling: poller.stop,
    approve,
    reject,
    selectNode,
    statusClass,
  }
}
