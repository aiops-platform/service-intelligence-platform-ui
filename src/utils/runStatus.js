/**
 * run / 节点的**展示状态** —— 把「中断」从「成功」里分出来。
 *
 * ## 为什么不能只看 `run.status`
 *
 * 后端对 run 的判定是两层的（`api/app.py` 的 `_halted_node`）：
 *
 * - `status`：**有没有节点失败**。中断的 run 没有节点失败（halt 节点自己是 DONE、
 *   其余 PENDING 全部 SKIPPED），所以 `status` 照样是 `success`。
 * - `outcome`：**按图走完**（`completed`）还是**中途判定证据不足**（`halted`），
 *   另给 `halted_at` 指出停在哪个节点。
 *
 * 于是「证据不足、什么都没诊断出来」和「顺利跑完」在 `status` 上长得一模一样。
 * 实测踩过：一条零证据的 run（scope 定不了位、四个取证节点全负证据）走完全程报了
 * `success` —— 界面上是**绿色的成功**，而它其实什么结论都没给出。
 *
 * ## 判据为什么放在前端而不是改后端状态机
 *
 * `outcome` 是后端**现算**的（判据来自冻结的 snapshot + checkpoint，不可变，
 * 所以可复现），刻意不落库、也不动 `run.status` —— 那样会连带改状态机、
 * Worker 接单 CAS、审批终态判定。展示层读 `outcome` 是零风险的。
 *
 * ## 三个消费面必须用同一份判据
 *
 * 图上的节点配色、节点表的状态、run 头部的徽章 —— 分散在三处各写一遍的话，
 * 会出现「图上是绿的、表里写着 done、徽章说中断」这种自相矛盾的界面。
 */

/** 中断状态名。**不是** `done`、也**不是** `success` —— 它自己就是一档。 */
export const HALTED = 'halted'
/** 审批被否决（人工驳回 / 超时自动拒绝）。同样不是 `success`。 */
export const REJECTED = 'rejected'

/** 这条 run 是不是**中途中断**（`kind: halt` 被触发）。 */
export function isHalted(run) {
  return !!run && run.outcome === 'halted' && !!run.halted_at
}

/**
 * 这条 run 是不是**审批被否决**（`outcome=rejected`）。
 *
 * ⚠️ 它**同样**是 `status=success`：审批超时后 sweeper 把节点置成
 * `rejected-canceled` 再发 resume，下游照常收敛，run 一样跑完。
 * 实测（run_d8f3a5c560）：`approve-plan` 是"超时自动拒绝"，run 报 success，
 * 列表显示成 **resolved** —— 方案审批被否了却显示"事故已解决"。
 */
export function isRejected(run) {
  return !!run && run.outcome === REJECTED && !!run.rejected_at
}

/**
 * 整条 run 的展示状态：中断报 `halted`、被否决报 `rejected`，其余用后端给的原值。
 *
 * 未知值原样透出（不映射成"其它"）—— 后端加新状态时这里不该变成一句谎话。
 */
export function runStatusOf(run) {
  if (!run) return ''
  if (isHalted(run)) return HALTED
  if (isRejected(run)) return REJECTED
  return run.status || ''
}

/**
 * 否决的**理由**（`timeout` | `manual` | null）。
 *
 * 为什么值得单列：超时和人工驳回都落到 `rejected`，但读的人需要知道
 * **有没有人拍过板** —— "没人来处理"和"有人明确否了"是两个完全不同的后续动作。
 */
export function rejectReasonOf(run) {
  return isRejected(run) ? run.reject_reason || null : null
}

/**
 * 单个节点的展示状态。
 *
 * 触发中断的那个节点在库里是 `done`（它确实跑完了），但展示成 `done` 会让人以为
 * "这一步正常通过"。所以**只有它**改报 `halted` —— 其余节点照旧。
 *
 * @param run        `GET /runs/{id}` 的返回（含 `outcome` / `halted_at`）
 * @param nid        节点 id
 * @param rawStatus  该节点在 `run.nodes[nid].status` 里的原值
 */
export function nodeStatusOf(run, nid, rawStatus) {
  if (isHalted(run) && run.halted_at === nid) return HALTED
  // 否决节点**不改名**（`rejected` / `rejected-canceled` 本身就是准确的状态名），
  // 只保证它有颜色 —— 见 NODE_STATUS_CLASS 里那条补的映射。
  return rawStatus || 'pending'
}

/**
 * 节点状态 → 着色类名。
 *
 * ⚠️ 类名是 `css/styles.css` 的消费方（`.bs-node-status-*`），改名会**静默掉样式**
 * —— 页面上不会有任何报错，只是节点变成没有颜色的默认样式。
 */
export const NODE_STATUS_CLASS = {
  done: 'bs-node-status-done',
  halted: 'bs-node-status-halted',
  running: 'bs-node-status-running',
  pending: 'bs-node-status-pending',
  failed: 'bs-node-status-failed',
  cancelled: 'bs-node-status-cancelled',
  rejected: 'bs-node-status-rejected',
  // ⚠️ 这条原先漏了，后果不是"少个颜色"而是**说反话**：`rejected-canceled`
  // 会落到 statusClass 的兜底 `bs-node-status-pending` —— 一个被超时否决的审批节点
  // 在图上渲染成**灰色"还没跑"**。审批超时是本次才发现的状态，所以一直没暴露。
  'rejected-canceled': 'bs-node-status-rejected',
  waiting_approval: 'bs-node-status-waiting',
  skipped: 'bs-node-status-skipped',
}

export function statusClass(st) {
  return NODE_STATUS_CLASS[st] || 'bs-node-status-pending'
}
