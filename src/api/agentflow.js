/**
 * agentflow 控制面（workflow / run）。
 *
 * 改造前硬编码 `http://localhost:8000`，且这个 base 被 6 个不同名字的变量重复声明
 * （AGENTFLOW_BASE / WS_API_BASE / BS_API_BASE / MCP_API_BASE / AGC_API_BASE / AGENT_API_BASE）。
 * 现在统一走相对路径 /agentflow，由 dev proxy（`rewrite` 剥前缀）或生产 nginx 转发 ——
 * agentflow 的路由挂在根路径（/workflows、/runs/{id}），所以前缀是必须的。
 */
import { createClient } from './http'

export const agentflow = createClient({ name: 'agentflow', timeout: 30000 })

export const workflowApi = {
  list: () => agentflow.get('/workflows'),
  detail: (id) => agentflow.get(`/workflows/${id}`),
  preview: (yaml) => agentflow.post('/workflows/preview', { yaml }),
}

/** 工单（Ticket Inbox）。字段形状对齐后端 bug_report（ServiceNow 风格事件）。 */
export const ticketApi = {
  list: (params) => agentflow.get('/tickets', { params }),
  detail: (tid) => agentflow.get(`/tickets/${tid}`),

  /**
   * 建工单。`number`/`service`/`namespace` 可由后端从 bug_report 兜底取，不必传。
   */
  create: (payload) => agentflow.post('/tickets', payload),

  /** 从工单发起一次 run（组合端点）。不传 workflow_id 则用库里第一个已保存流程。 */
  run: (tid, workflowId) =>
    agentflow.post(`/tickets/${tid}/run`, workflowId ? { workflow_id: workflowId } : {}),
}

/** run 列表（Ticket/Run 页面共用）。 */
export const runsApi = {
  list: (params) => agentflow.get('/runs', { params }),
}

/** agent 编队（Agent 目录页）。 */
export const agentsApi = {
  /** 全部 agent：含 role/stage/local_tools(带 level)/mcp_tools/bound_servers。 */
  list: () => agentflow.get('/agents'),
  /** 单 agent 详情：含完整 system_prompt / schema / stored。 */
  detail: (name) => agentflow.get(`/agents/${encodeURIComponent(name)}`),
  /** 按 agent 聚合的执行统计（样本为空时各值为 null）。 */
  stats: () => agentflow.get('/agents/stats'),
}

export const runApi = {
  /** 发起 run。body: {workflow_id, ticket} */
  start: (payload) => agentflow.post('/run', payload),

  /** 取 run 快照（轮询用） */
  get: (id) => agentflow.get(`/runs/${id}`),

  stop: (id) => agentflow.post(`/runs/${id}/stop`),

  /** 审批 / 驳回：body 均为 {node_id} */
  approve: (id, nodeId) => agentflow.post(`/runs/${id}/approve`, { node_id: nodeId }),
  reject: (id, nodeId) => agentflow.post(`/runs/${id}/reject`, { node_id: nodeId }),

  /** 节点执行轨迹（run viewer 用） */
  traces: (id) => agentflow.get(`/runs/${id}/traces`),
}
