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

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/**
 * @param graphNode 图节点 `{ id, agent, kind }`（来自 `_workflow_graph`）
 * @param runNode   run 的节点状态 `{ status, duration_ms, tokens, cost, attempts, error }`
 * @returns `{ title, rows: [[label, value], …] }`
 */
export function nodeTipOf(graphNode, runNode) {
  const g = graphNode || {}
  const n = runNode || {}
  const rows = [
    ['agent', g.agent || '—'],
    ['kind', g.kind || 'agent'],
    ['status', n.status || 'pending'],
    ['耗时', fmtMs(n.duration_ms)],
    ['tokens', n.tokens ?? 0],
    ['cost', typeof n.cost === 'number' ? n.cost.toFixed(4) : '0.0000'],
  ]
  if ((n.attempts || 0) > 1) rows.push(['重试', `${n.attempts - 1} 次`])
  if (n.error) rows.push(['error', String(n.error).slice(0, 160)])
  return { title: g.id || '—', rows }
}

/** 从图数据里按 id 取节点（图很小，线性找即可）。 */
export function graphNodeById(graph, nid) {
  return (graph?.nodes || []).find((n) => n.id === nid) || null
}
