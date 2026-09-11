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
