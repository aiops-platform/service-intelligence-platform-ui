/**
 * Log Analysis 视图的状态与动作。
 *
 * 来源：js/app.js 的 initLogAnalysis（改造前在闭包里持有 currentPage / currentService /
 * currentSeverity / currentStatus / allAlerts，靠 document.getElementById 反写 DOM）。
 * 这里升成 ref，DOM 交给模板。
 */
import { ref, computed } from 'vue'
import { logAlertApi } from '@/api/sipAiops'
import { openAlertDetail } from '@/composables/useAlertDetail'

/** 表格恒定的行数（改造前的 for (var i=0;i<10;i++)） */
const ROW_COUNT = 10

export function useLogAnalysis() {
  const page = ref(0)
  const service = ref('')
  const severity = ref('all')
  const status = ref('all')

  const alerts = ref([])
  const total = ref(0)
  const services = ref([])
  const kpi = ref({ total: 0, uniqueServices: 0, critical: 0, open: 0, resolved: 0 })

  const loading = ref(false)
  const error = ref('')

  /**
   * 恒 10 行：不足补 null（模板渲染成空行占位）。
   * 这是改造前的视觉需求 —— 保持表格高度稳定，切换筛选时不跳动。**重写极易丢**。
   */
  const rows = computed(() => {
    const out = []
    for (let i = 0; i < ROW_COUNT; i++) out.push(alerts.value[i] ?? null)
    return out
  })

  async function loadServices() {
    try {
      // 响应 {success, data:[...]} —— api 层已剥掉信封，这里直接是数组
      services.value = (await logAlertApi.services()) || []
    } catch (err) {
      console.warn('LA: 服务列表加载失败：', err.message)
    }
  }

  async function reload() {
    loading.value = true
    error.value = ''

    const params = { page: page.value, size: ROW_COUNT }
    if (service.value) params.serviceName = service.value
    if (severity.value !== 'all') params.severity = severity.value
    if (status.value !== 'all') params.status = status.value

    try {
      const data = await logAlertApi.list(params)
      alerts.value = data?.content || []
      total.value = data?.total || 0
    } catch (err) {
      console.warn('LA: 告警列表加载失败：', err.message)
      error.value = err.message
      alerts.value = []
      total.value = 0
    } finally {
      loading.value = false
    }

    // KPI 与列表是两条独立请求（改造前亦然）—— KPI 失败不影响表格
    try {
      const summary = await logAlertApi.summary(service.value ? { serviceName: service.value } : undefined)
      const l = summary?.log
      if (l) {
        kpi.value = {
          total: l.total || 0,
          uniqueServices: l.uniqueServices || 0,
          critical: l.critical || 0,
          open: l.open || 0,
          resolved: l.resolved || 0,
        }
      }
    } catch {
      /* 改造前此处也是静默 .catch(function(){}) */
    }
  }

  function reset() {
    service.value = ''
    severity.value = 'all'
    status.value = 'all'
    page.value = 0
  }

  function applyService(next) {
    service.value = next || ''
    page.value = 0
    return reload()
  }

  function applySeverity(next) {
    severity.value = next
    page.value = 0
    return reload()
  }

  function applyStatus(next) {
    status.value = next
    page.value = 0
    return reload()
  }

  /** 行内 Detail 按钮 → 详情模态（apiPrefix 沿用改造前的 'log-alert'） */
  function openDetail(alert) {
    if (alert) openAlertDetail('log-alert', alert)
  }

  return {
    page,
    service,
    severity,
    status,
    alerts,
    rows,
    total,
    services,
    kpi,
    loading,
    error,
    loadServices,
    reload,
    reset,
    applyService,
    applySeverity,
    applyStatus,
    openDetail,
  }
}
