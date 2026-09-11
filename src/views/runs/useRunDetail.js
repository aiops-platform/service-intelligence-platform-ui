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

const TERMINAL = new Set(['success', 'failed', 'cancelled'])

export function useRunDetail(getRunId) {
  const run = ref(null)
  const loading = ref(false)
  const error = ref('')
  const selectedNode = ref(null)
  const detailTab = ref('output')
  const stopping = ref(false)

  const status = computed(() => run.value?.status || '')
  const isTerminal = computed(() => TERMINAL.has(status.value))
  const running = computed(() => !!status.value && !isTerminal.value)

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
      status: n.status || 'pending',
      tokens: n.tokens || 0,
      cost: typeof n.cost === 'number' ? n.cost.toFixed(4) : '0.0',
      durationMs: n.duration_ms,
      attempts: n.attempts || 0,
      error: n.error,
      output: n.output === undefined || n.output === null ? '(无输出)' : JSON.stringify(n.output, null, 2),
      params: JSON.stringify(n.params || {}, null, 2),
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
