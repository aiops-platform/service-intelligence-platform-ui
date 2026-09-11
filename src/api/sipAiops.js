/**
 * sip-aiops 后端（日志 / 指标 / 告警）。
 *
 * 改造前这批端点硬编码在 app.js 的 9 处（`http://localhost:8080/api/sip-aiops` 出现两次
 * `var API_BASE` + 7 处内联绝对 URL），且**不带任何认证头**。现在统一走相对路径 /api/sip-aiops，
 * 由 dev proxy 或生产 nginx 转发。
 *
 * 只列本方案两个视图需要的端点 —— 其余（app-indicator、metric-alert、app-alert…）
 * 等对应视图迁移时再补，避免写一堆没人调的死代码。
 */
import { createClient } from './http'

export const sipAiops = createClient({ name: 'sipAiops', timeout: 20000 })

export const logAlertApi = {
  /** 日志告警分页列表 */
  list: (params) => sipAiops.get('/log-alert', { params }),

  /** KPI 汇总（log 页的 shape 与 metric 页不同，由后端按同一端点区分） */
  summary: (params) => sipAiops.get('/alert-summary', { params }),

  /** 服务下拉选项 */
  services: () => sipAiops.get('/app-indicator/services'),

  /**
   * 单条告警的 Agent 分析详情。
   *
   * 注意这里**只剥一层信封**：响应是 `{success, data:{success, data:{…}}}`，
   * 本方法返回 `{success, data}`，调用方继续判 `.success` / 读 `.data`
   * —— 与改造前 app.js:2269 的写法一致，不要顺手多剥一层。
   */
  analysis: (id) => sipAiops.get(`/log-alert/${id}/analysis`),
}

/** 指标告警（page-metrics-analysis 用，本次未迁移，先留着供详情模态按前缀复用） */
export const metricAlertApi = {
  analysis: (id) => sipAiops.get(`/metric-alert/${id}/analysis`),
}

/** 详情模态按 apiPrefix 取对应端点的统一入口（沿用改造前的参数化设计） */
export const ALERT_ANALYSIS_BY_PREFIX = {
  'log-alert': logAlertApi.analysis,
  'metric-alert': metricAlertApi.analysis,
}
