/**
 * 告警详情模态的全局单例状态。
 *
 * 为什么是模块级而非 per-component：这个模态**被两个视图共用** ——
 * 已迁移的 log-analysis，以及未迁移的 metrics-analysis（经接缝 S4 从旧代码调用）。
 * 全文档只应存在一个实例（改造前 #alertDetailOverlay 的 id 唯一性也依赖这一点）。
 */
import { ref } from 'vue'
import { ALERT_ANALYSIS_BY_PREFIX } from '@/api/sipAiops'

const visible = ref(false)
const title = ref('Alert Detail')
/** idle | loading | ready | error */
const state = ref('idle')
const html = ref('')
const errorMsg = ref('')

function close() {
  visible.value = false
  state.value = 'idle'
  html.value = ''
  errorMsg.value = ''
}

/**
 * 打开详情。沿用改造前的参数化设计：apiPrefix ∈ 'log-alert' | 'metric-alert'。
 *
 * 响应是 `{success, data:{success, data:{…}}}`：api 层只剥一层，这里再判一次
 * 内层 `.success` 后取 `.data` —— 与改造前 app.js:2320 的判定一致。
 */
export async function openAlertDetail(apiPrefix, alert) {
  const fetchAnalysis = ALERT_ANALYSIS_BY_PREFIX[apiPrefix]
  if (!fetchAnalysis) {
    console.warn('[sip] 未知的 apiPrefix：', apiPrefix)
    return
  }

  title.value = 'Agent Analysis - ' + (alert.title || 'Untitled')
  html.value = ''
  errorMsg.value = ''
  state.value = 'loading'
  visible.value = true

  try {
    const resp = await fetchAnalysis(alert.id)
    if (!resp || !resp.success || !resp.data) {
      throw new Error(resp && resp.data ? resp.data.error || 'Analysis not available' : 'Invalid response')
    }
    const { renderAnalysisContent } = await import('@/components/alert-detail/renderAnalysis')
    html.value = renderAnalysisContent(alert, resp.data)
    state.value = 'ready'
  } catch (err) {
    errorMsg.value = err?.message || String(err)
    state.value = 'error'
  }
}

export function useAlertDetail() {
  return { visible, title, state, html, errorMsg, open: openAlertDetail, close }
}
