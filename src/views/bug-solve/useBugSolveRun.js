/**
 * Bug Solve 的状态与动作。
 *
 * 来源：js/app.js 的 initBugSolve（7318-7753，435 行 / 21 个内部函数）。
 * 改造前闭包里的 11 个变量升为 ref；`canvas` 由 GraphCanvas 组件持有，经 getCanvas 取用。
 *
 * 轮询从裸 setInterval 改为 usePolling —— 顺带修掉"切走本页后仍 2 秒一轮"。
 */
import { ref, computed } from 'vue'
import { workflowApi, runApi } from '@/api/agentflow'
import { usePolling } from '@/composables/usePolling'
import { nodeStatusOf, runStatusOf } from '@/utils/runStatus'

const TERMINAL = { success: 1, failed: 1, cancelled: 1 }

// 状态 → 类名的表已收进 `@/utils/runStatus`（那里同时住着「halted 怎么派生」的规则）。
// 这里**原样再导出**：BugSolveView 与 useRunDetail 一直是从本模块 import 的，
// 搬个家不该顺手改掉两个调用方。
export { statusClass } from '@/utils/runStatus'

export function useBugSolveRun({ getCanvas }) {
  const workflows = ref([])
  const workflowId = ref(null)
  const runId = ref(null)
  const runStatus = ref(null)
  const running = ref(false)
  const pendingApprovals = ref([])
  const selectedNode = ref(null)
  const currentNodeData = ref(null)
  const currentGraph = ref(null)
  const detailTab = ref('output')
  /** 自动跟随当前执行节点进右侧详情；用户点选后停止 */
  const autoFollow = ref(true)

  const error = ref('')
  const ticketText = ref('')
  // 来自 run 响应字段（不是按节点求和 —— 原实现即如此）
  const totalTokens = ref(0)
  const totalCost = ref('0.0')
  /**
   * 中断判据（`outcome` / `halted_at`）。
   *
   * 本模块原先只存 `runStatus = data.status`，而中断的 run 那个值也是 `success`
   * —— 于是「证据不足、什么都没诊断出来」在本页显示成绿色的成功。判据与颜色
   * 的规则统一在 `@/utils/runStatus`（Run Detail 用的是同一份）。
   */
  const runMeta = ref(null)

  /** 单个节点的展示状态（halt 节点报 `halted`，不是 `done`） */
  function nodeStatus(nid, rawStatus) {
    return nodeStatusOf(runMeta.value, nid, rawStatus)
  }

  /** 左侧「当前节点」提示文案 */
  const stepLabel = computed(() => {
    const data = currentNodeData.value
    if (!data) return '—'
    const statusMap = {}
    Object.keys(data).forEach((nid) => (statusMap[nid] = nodeStatus(nid, data[nid].status)))
    const runNid = Object.keys(statusMap).filter((nid) => statusMap[nid] === 'running')[0] || null

    if (runNid) {
      const graph = currentGraph.value
      let agent = ''
      if (graph && graph.nodes) {
        const hit = graph.nodes.find((n) => n.id === runNid && n.agent)
        if (hit) agent = ` (${hit.agent})`
      }
      return runNid + agent
    }
    if (runStatus.value === 'waiting_approval') return '待审批'
    if (TERMINAL[runStatus.value]) return '—'
    return '排队中…'
  })

  const detail = computed(() => {
    const nid = selectedNode.value
    const data = currentNodeData.value
    if (!nid || !data || !data[nid]) return null
    const n = data[nid]
    const st = nodeStatus(nid, n.status)
    return {
      nid,
      status: st,
      tokens: n.tokens || 0,
      cost: typeof n.cost === 'number' ? n.cost.toFixed(4) : '0.0',
      // **传对象本身**，交给 NodePayload 按字段渲染（原先 JSON.stringify 成一个大块
      // 再由 <pre> 直出，一个上千字的摘要就会把其余字段顶出屏幕）。
      output: n.output === undefined ? null : n.output,
      params: n.params || {},
      /** running 节点 output 尚未产出 —— 实时自动跟随时给「正在执行」反馈 */
      isRunning: st === 'running',
    }
  })

  const showError = (msg) => {
    error.value = msg
  }
  const clearError = () => {
    error.value = ''
  }

  async function loadWorkflows() {
    try {
      const data = await workflowApi.list()
      workflows.value = Array.isArray(data) ? data : []
      // 先前选中的流程若已被删除，清掉选择
      if (workflowId.value && !workflows.value.some((w) => w.id === workflowId.value)) {
        workflowId.value = null
      }
    } catch (err) {
      showError('加载流程失败: ' + (err?.message || 'network error'))
    }
  }

  async function onWorkflowChange(id) {
    workflowId.value = id || null
    resetRun()
    if (!workflowId.value) {
      getCanvas()?.reset()
      return
    }
    try {
      const data = await workflowApi.detail(workflowId.value)
      if (data.graph) getCanvas()?.render(data.graph, {})
    } catch (err) {
      showError('加载流程详情失败: ' + (err?.message || 'network error'))
    }
  }

  /** 解析 ticket JSON。成功返回对象（空文本 → {}）；失败返回 null 并展示错误。 */
  function parseTicket() {
    const text = (ticketText.value || '').trim()
    if (!text) return {}
    try {
      const obj = JSON.parse(text)
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('需为 JSON 对象')
      return obj
    } catch (err) {
      showError('Ticket JSON 解析失败: ' + err.message)
      return null
    }
  }

  /** 轮询：enabled 谓词保证只在运行中且拿到 runId 时才转 */
  const poller = usePolling(
    async () => {
      const data = await runApi.get(runId.value)
      applyRun(data)
    },
    { interval: 2000, enabled: () => running.value && !!runId.value },
  )

  async function start() {
    clearError()
    if (!workflowId.value) {
      showError('请先选择已保存流程')
      return
    }
    const ticket = parseTicket()
    if (ticket === null) return
    if (running.value) return

    running.value = true
    autoFollow.value = true // 新 run 重新自动跟随
    runStatus.value = 'started'
    try {
      const data = await runApi.start({ workflow_id: workflowId.value, ticket })
      runId.value = data.run_id
      poller.start()
    } catch (err) {
      showError('启动失败: ' + (err?.message || 'network error'))
      running.value = false
      poller.stop()
    }
  }

  function applyRun(data) {
    if (!runId.value || data.run_id !== runId.value) return
    runMeta.value = { outcome: data.outcome, halted_at: data.halted_at }
    runStatus.value = runStatusOf(data)
    totalTokens.value = data.total_tokens || 0
    totalCost.value = typeof data.total_cost === 'number' ? data.total_cost.toFixed(4) : '0.0'
    pendingApprovals.value = data.pending_approvals || []
    currentNodeData.value = data.nodes || {}
    if (data.graph) currentGraph.value = data.graph

    const statusMap = {}
    Object.keys(currentNodeData.value).forEach((nid) => {
      statusMap[nid] = nodeStatus(nid, currentNodeData.value[nid].status)
    })
    const runNid = Object.keys(statusMap).filter((nid) => statusMap[nid] === 'running')[0] || null

    getCanvas()?.render(data.graph || currentGraph.value, statusMap)

    // 自动跟随：运行中把右侧详情切到正在跑的节点
    if (autoFollow.value && runNid) selectedNode.value = runNid
    if (selectedNode.value && currentNodeData.value[selectedNode.value]) {
      // detail 计算属性会自动重算，无需显式 renderDetail（原实现是命令式重绘）
    } else if (selectedNode.value) {
      selectedNode.value = null
    }

    if (TERMINAL[data.status]) {
      running.value = false
      poller.stop()
    }
  }

  async function stop() {
    clearError()
    if (!runId.value) return
    poller.stop()
    try {
      await runApi.stop(runId.value)
      running.value = false
      runStatus.value = 'cancelled'
      // 停止后拉一次最终状态，刷新节点着色（cancelled 落图）
      applyRun(await runApi.get(runId.value))
    } catch (err) {
      showError('停止失败: ' + (err?.message || 'network error'))
    }
  }

  async function approve(nodeId) {
    if (!runId.value || !nodeId) return
    try {
      await runApi.approve(runId.value, nodeId)
      pendingApprovals.value = pendingApprovals.value.filter((p) => p.node_id !== nodeId)
    } catch (err) {
      showError('审批失败: ' + (err?.message || 'network error'))
    }
  }

  async function reject(nodeId) {
    if (!runId.value || !nodeId) return
    try {
      await runApi.reject(runId.value, nodeId)
      pendingApprovals.value = pendingApprovals.value.filter((p) => p.node_id !== nodeId)
    } catch (err) {
      showError('驳回失败: ' + (err?.message || 'network error'))
    }
  }

  function selectNode(nid) {
    autoFollow.value = false // 用户手动点选 → 停止自动跟随
    selectedNode.value = nid
  }

  function resetRun() {
    poller.stop()
    running.value = false
    autoFollow.value = true
    runId.value = null
    runStatus.value = null
    pendingApprovals.value = []
    selectedNode.value = null
    currentNodeData.value = null
    currentGraph.value = null
    detailTab.value = 'output'
    totalTokens.value = 0
    totalCost.value = '0.0'
  }

  function setDetailTab(tab) {
    detailTab.value = tab
  }

  return {
    workflows,
    workflowId,
    runId,
    runStatus,
    running,
    pendingApprovals,
    selectedNode,
    currentNodeData,
    currentGraph,
    detailTab,
    autoFollow,
    error,
    ticketText,
    totalTokens,
    totalCost,
    stepLabel,
    detail,
    loadWorkflows,
    onWorkflowChange,
    start,
    stop,
    approve,
    reject,
    selectNode,
    resetRun,
    setDetailTab,
    clearError,
  }
}
