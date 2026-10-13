/**
 * 节点悬停提示的内容（Run Detail 与 Bug Solve 共用）。
 *
 * 为什么要抽出来：两个页面各有自己的数据源（`runData.graph.nodes` / `bugSolve.graph`），
 * 但**展示哪些字段、叫什么名字**应当一致——否则同一张图在两个页面 hover 出来的东西不一样。
 *
 * 返回值是**结构化**的 `{ title, rows }`，不是 HTML：
 * 引擎用 `textContent` 逐项渲染。节点 id / agent 名 / error 文本都是数据，
 * 拼 HTML 就是 XSS 口子。
 */

import { DEGRADED, nodeHealthOfNode, nodeStatusLabel } from '@/utils/runStatus'

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/**
 * @param graphNode 图节点 `{ id, agent, kind }`（来自 `_workflow_graph`）
 * @param runNode   run 的节点状态
 *                  `{ status, output, duration_ms, tokens, cost, attempts, error }`
 * @returns `{ title, rows: [[label, value], …] }`
 */
export function nodeTipOf(graphNode, runNode, agentDesc) {
  const g = graphNode || {}
  const n = runNode || {}
  // 用 `n.status` 的**派生**值（不是原值）：不然图上是琥珀边、hover 出来写"完成"，
  // 同一个节点在同一屏上自相矛盾 —— 正是 `@/utils/runStatus` 头注释要防的那种事。
  const health = nodeHealthOfNode(n)
  const st = n.status === 'done' && health.degraded ? DEGRADED : n.status || 'pending'
  const rows = [
    ['agent', g.agent || '—'],
    ['kind', g.kind || 'agent'],
    // 状态也用中文：这张表在 Run Detail 与 Bug Solve 两处共用，
    // 与页面上的节点状态文案必须一致（否则同一个节点两个地方叫两个名字）
    ['status', nodeStatusLabel(st)],
    ['耗时', fmtMs(n.duration_ms)],
    ['tokens', n.tokens ?? 0],
    ['cost', typeof n.cost === 'number' ? n.cost.toFixed(4) : '0.0000'],
  ]
  if ((n.attempts || 0) > 1) rows.push(['重试', `${n.attempts - 1} 次`])
  if (n.error) rows.push(['error', String(n.error).slice(0, 160)])
  // 执行告警：逐条列出失败的工具调用。**必须在这里露出来** —— 节点的颜色说明了
  // "有事"，但说不清"什么事"；把原始错误带上，鼠标停一下就能查。
  health.warnings.forEach((w) => {
    const tail = w.error ? `：${String(w.error).slice(0, 120)}` : ''
    rows.push([`告警·${w.impact || 'tool'}`, `${w.tool} ${w.state}${tail}`])
  })
  if (health.unmet.length) rows.push(['未交付', health.unmet.join('、')])
  // **主描述 = agent 的描述**（Agents 页同一份，后端 AGENT_DESCRIPTIONS，可被租户
  // agent_configs 覆盖）。这是"这个节点在干什么"最直接的一句话。
  //
  // 次描述 = 节点自己在 YAML 里写的 description（若 workflow 作者填了）。
  // 两者是**不同维度**：agent 描述说"这类活是什么"，节点描述说"这一处具体做什么"。
  //
  // 都以**独立段落**呈现，不是 label/value 行 —— 可能较长，塞进行里会把 key 列挤没。
  return { title: g.id || '—', desc: agentDesc || '', nodeDesc: g.description || '', rows }
}

/** 从图数据里按 id 取节点（图很小，线性找即可）。 */
export function graphNodeById(graph, nid) {
  return (graph?.nodes || []).find((n) => n.id === nid) || null
}
