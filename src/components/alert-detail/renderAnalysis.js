/**
 * 告警详情的内容渲染。
 *
 * 来源：js/app.js 的 renderAlertAnalysisContent(406 行) + renderToolExecution(24)
 * + renderToolResult(44) + renderLogQueryResult(41)，共约 515 行，逐段移植。
 *
 * ## 为什么保留「拼 HTML 字符串」
 *
 * 这块内容是**一次渲染、无响应式**——每次打开调制解调器按 API 数据生成一份静态 DOM，
 * 之后不再变。Vue 的模板/响应式在这里买不到任何东西，拆成 8 个组件只是把同一批条件
 * 分散到 8 个文件里，反而更难比对。故按「单组件 + 事件委托」处理（见计划稿 §5.3 的权衡）。
 *
 * ## 两条必须遵守的约束
 *
 * 1. **`escapeHtml` 不能省**。本模块的产物经 `v-html` 注入，而 `v-html` **不做转义**。
 *    改造前这里对每个插值都调了 escapeHtml，移植时逐处保留。
 * 2. **不再有 `onclick`**。改造前有 9 处内联处理器（3 处 `window._showToast`、
 *    3 处匿名 IIFE、2 处 `_toggleCollapsible`、1 处 `_toggleEvidence`）—— 这类处理器
 *    在 `v-html` 注入的 HTML 里**不会被 Vue 编译、也不会执行**，按钮会全部失效。
 *    现改为 `data-action` 属性，由 AlertDetailModal 的**单个委托监听器**分发。
 */

import { formatTimeAgo } from '@/utils/time'
import { escapeHtml } from '@/utils/format'

/** 唯一 id 计数器（改造前用 Math.random，多次渲染可能撞号且不可复现） */
let uid = 0
const nextId = (prefix) => `${prefix}-${++uid}`

/** 归一化 action 文案：既支持字符串数组，也支持 {description|action} 对象数组 */
function actionText(act) {
  if (typeof act === 'string') return act
  return act.description || act.action || JSON.stringify(act)
}

// ── 工具执行结果渲染 ────────────────────────────────────────

function renderLogQueryResult(data) {
  const logs = data.logs || []
  const total = data.total_count !== undefined ? data.total_count : logs.length
  let h = ''
  h +=
    '<div class="log-entries-header">Found <strong>' +
    logs.length +
    '</strong> log entries' +
    (total !== logs.length ? ' (total: ' + total + ')' : '') +
    '</div>'

  if (logs.length === 0) {
    return h + '<div class="no-analysis-note">No matching log entries found.</div>'
  }

  logs.forEach((entry) => {
    const level = (entry.log_level || 'INFO').toUpperCase()
    const stackId = entry.stack_trace ? nextId('ls') : null

    h +=
      '<div class="log-entry"><div class="log-entry-bar">' +
      '<span class="log-level-badge ' +
      escapeHtml(level) +
      '">' +
      escapeHtml(level) +
      '</span>' +
      '<span class="log-entry-time">' +
      escapeHtml(entry.timestamp || '') +
      '</span>'
    if (entry.thread) {
      h +=
        '<span style="font-size:10px;color:var(--text-tertiary);">thread:' +
        escapeHtml(entry.thread) +
        '</span>'
    }
    h += '</div><div class="log-entry-msg">' + escapeHtml(entry.message || '') + '</div>'
    if (stackId) {
      h +=
        '<span class="log-stack-toggle" data-action="toggle-stack" data-target="' +
        stackId +
        '">Show Stack Trace</span>' +
        '<div class="log-stack-trace" id="' +
        stackId +
        '">' +
        escapeHtml(entry.stack_trace) +
        '</div>'
    }
    h += '</div>'
  })

  return h
}

function renderToolResult(toolName, result) {
  if (!result) {
    return '<span style="color:var(--text-tertiary);font-style:italic;">No output</span>'
  }
  const resultStr = String(result)

  if (toolName === 'query_app_logs') {
    try {
      return renderLogQueryResult(JSON.parse(resultStr))
    } catch {
      /* 不是 JSON，继续往下走 */
    }
  }

  if (toolName.indexOf('git_') === 0 || toolName.indexOf('mcp_git_') === 0 || toolName.indexOf('mcp__') === 0) {
    const label = toolName.replace(/^(mcp_|mcp__)/, '')
    return (
      '<div class="detail-block"><label>' +
      escapeHtml(label) +
      ' Output</label><div class="code-block">' +
      escapeHtml(resultStr) +
      '</div></div>'
    )
  }

  try {
    const parsed = JSON.parse(resultStr)
    if (parsed && typeof parsed === 'object') {
      if (parsed.logs && Array.isArray(parsed.logs)) return renderLogQueryResult(parsed)
      return '<div class="code-block">' + escapeHtml(JSON.stringify(parsed, null, 2)) + '</div>'
    }
  } catch {
    /* 不是 JSON，按纯文本走 */
  }

  const preview = resultStr.length > 2000 ? resultStr.substring(0, 2000) + '...[truncated]' : resultStr
  return '<div class="raw-result">' + escapeHtml(preview) + '</div>'
}

function renderToolExecution(tool) {
  const toolName = tool.tool_name || 'unknown'
  const args = tool.args || {}
  const hasArgs = Object.keys(args).length > 0
  const argsId = hasArgs ? nextId('te') : null

  let h =
    '<div class="tool-exec"><div class="tool-exec-hd">' +
    '<span class="tool-exec-icon">T</span>' +
    '<span class="tool-exec-name">' +
    escapeHtml(toolName) +
    '</span>'
  if (hasArgs) {
    h +=
      '<span class="tool-exec-args-toggle" data-action="toggle-args" data-target="' +
      argsId +
      '">Args &#9660;</span>'
  }
  h += '</div>'
  if (hasArgs) {
    h +=
      '<div class="tool-exec-args" id="' + argsId + '">' + escapeHtml(JSON.stringify(args, null, 2)) + '</div>'
  }
  h += '<div class="tool-exec-result">' + renderToolResult(toolName, tool.result || '') + '</div></div>'
  return h
}

// ── 主体渲染 ────────────────────────────────────────────────

/**
 * @param {object} alert    告警对象（列表行原样传来）
 * @param {object} analysis analysis 接口返回的内层数据（调用方已剥一层信封）
 * @returns {string} 可直接 v-html 的 HTML
 */
export function renderAnalysisContent(alert, analysis) {
  const invocations = analysis.invocations || []
  const firstInv = invocations[0] || {}
  const inv = firstInv.invocation || {}
  const ar = firstInv.analysis_result || {}
  const thinkingChain = firstInv.thinking_chain || []
  const rawOutput = firstInv.raw_output || null

  const rootCause = ar.root_cause || {}
  const recommendations = ar.recommendations || {}
  const codeAnalysis = ar.code_analysis || {}
  const errorSnapshot = ar.error_snapshot || {}
  const impactAssessment = ar.impact_assessment || {}
  const diagnosisChain = ar.diagnosis_chain || []

  const immediate = recommendations.immediate || recommendations.urgent || []
  const shortTerm = recommendations.short_term || []
  const longTerm = recommendations.long_term || []

  const sev = String(alert.severity || 'info').toLowerCase()
  const sevUpper = String(alert.severity || 'INFO').toUpperCase()
  const heroClass =
    sev === 'critical' ? 'hero-banner' : sev === 'warning' ? 'hero-banner hero-warning' : 'hero-banner hero-info'
  const sevBadgeClass = sev === 'critical' ? 'critical' : sev === 'warning' ? 'warning' : 'info'

  const serviceName = alert.serviceName || alert.service_name || ''
  const detectedAt = alert.detected_at || alert.detectedAt || alert.createdAt || alert.created_at || ''
  const timeAgo = detectedAt ? formatTimeAgo(detectedAt) : ''

  let html = ''

  // ── 1. Hero Banner ──
  html +=
    '<div class="' +
    heroClass +
    '"><span class="hero-severity-badge ' +
    sevBadgeClass +
    '">' +
    escapeHtml(sevUpper) +
    '</span>' +
    '<div class="hero-title">' +
    escapeHtml(alert.title || alert.summary || 'Log Error Alert') +
    '</div><div class="hero-meta">'
  if (timeAgo) html += '<span>' + escapeHtml(timeAgo) + '</span>'
  if (serviceName) {
    html += '<span class="hero-meta-dot"></span><span>' + escapeHtml(serviceName) + '</span>'
  }
  html += '</div></div>'

  // ── 2. AI Summary & Root Cause ──
  html += '<div class="ai-summary-card"><div class="card-title">AI Summary &amp; Root Cause</div>'

  let oneLiner = rootCause.summary || ar.summary || ''
  if (!oneLiner && rootCause.type) {
    oneLiner = rootCause.type + (rootCause.detail ? ': ' + String(rootCause.detail).substring(0, 200) : '')
  }
  if (oneLiner) html += '<div class="one-liner">' + escapeHtml(oneLiner) + '</div>'

  html += '<div class="risk-confidence-row">'
  if (ar.risk_level) {
    const rl = String(ar.risk_level).toLowerCase()
    const riskCls = rl === 'high' || rl === 'critical' ? 'high-risk' : rl === 'medium' ? 'medium-risk' : 'low-risk'
    html += '<span class="risk-tag ' + riskCls + '">' + escapeHtml(String(ar.risk_level).toUpperCase()) + ' RISK</span>'
  }
  if (ar.confidence) {
    const conf = String(ar.confidence).toLowerCase()
    const confLabel = String(ar.confidence).charAt(0).toUpperCase() + String(ar.confidence).slice(1)
    const confCls = conf === 'high' ? 'high' : conf === 'medium' ? 'medium' : 'low'
    html += '<span class="confidence-tag ' + confCls + '">' + escapeHtml(confLabel) + ' Confidence'
    if (Number(ar.confidence)) html += ' &middot; ' + escapeHtml(String(ar.confidence)) + '%'
    html += '</span>'
  }
  html += '</div>'

  if (codeAnalysis.primary_file || rootCause.type) {
    html += '<div class="root-cause-loc">'
    if (codeAnalysis.primary_file) {
      html +=
        '<span class="file-loc">' +
        escapeHtml(String(codeAnalysis.primary_file)) +
        (codeAnalysis.primary_line ? ':' + escapeHtml(String(codeAnalysis.primary_line)) : '') +
        '</span>'
    }
    if (codeAnalysis.primary_method) {
      html += '<span>&middot; ' + escapeHtml(String(codeAnalysis.primary_method)) + '()</span>'
    }
    if (codeAnalysis.last_commit) {
      html +=
        '<span>&middot; Last modified by <strong>' +
        escapeHtml(String(codeAnalysis.last_commit).substring(0, 8)) +
        '</strong> (' +
        escapeHtml(codeAnalysis.last_author || '') +
        ')'
      if (codeAnalysis.last_commit_date) {
        html += ' &middot; ' + escapeHtml(String(codeAnalysis.last_commit_date))
      }
      html += '</span>'
    }
    html += '</div>'
  }

  const kb = ar.kb_match
  if (kb && (kb.title || kb.source_id)) {
    html += '<div class="kb-match-row">KB Match: <strong>' + escapeHtml(kb.title || kb.source_id) + '</strong>'
    if (kb.similarity_score !== undefined) {
      html += '<span class="match-pct">' + Math.round(kb.similarity_score * 100) + '% Match</span>'
    }
    html += '</div>'
  }
  html += '</div>'

  // ── 3. Impact Assessment ──
  if (impactAssessment.severity || impactAssessment.business_impact) {
    html +=
      '<div class="impact-assessment-card"><div class="card-title">Impact Assessment</div><div class="evidence-sub-grid">'
    if (impactAssessment.severity) {
      html +=
        '<div class="evidence-kv"><span class="kv-label">Severity</span>' +
        '<span class="kv-value highlight-red">' +
        escapeHtml(String(impactAssessment.severity).toUpperCase()) +
        '</span></div>'
    }
    if (impactAssessment.business_impact) {
      html +=
        '<div class="evidence-kv full-width"><span class="kv-label">Business Impact</span>' +
        '<span class="kv-value">' +
        escapeHtml(String(impactAssessment.business_impact)) +
        '</span></div>'
    }
    const risks = impactAssessment.downstream_risks || []
    if (risks.length > 0) {
      html +=
        '<div class="evidence-kv full-width"><span class="kv-label">Downstream Risks</span>' +
        '<span class="kv-value">' +
        risks.map((r) => '&bull; ' + escapeHtml(r)).join(' ') +
        '</span></div>'
    }
    html += '</div></div>'
  }

  // ── 4. Recommended Actions ──
  if (immediate.length > 0 || shortTerm.length > 0 || longTerm.length > 0) {
    html += '<div class="actions-card"><div class="card-title">Recommended Actions</div><div class="actions-grid">'

    if (immediate.length > 0) {
      html +=
        '<div class="action-group immediate"><div class="action-group-title">Immediate Actions</div><div class="action-items">'
      immediate.forEach((act, i) => {
        const txt = actionText(act)
        // 改造前：idx 0/1/2 分别弹不同的 toast。现改为 data-action，由委托监听器分发。
        if (i === 0) {
          html +=
            '<button class="action-btn primary" data-action="toast" data-type="info" data-msg="Copied: ' +
            escapeHtml(String(txt).substring(0, 60)) +
            '">' +
            escapeHtml(txt) +
            '</button>'
        } else if (i === 1) {
          html +=
            '<button class="action-btn" data-action="toast" data-type="success" data-msg="Action submitted">' +
            escapeHtml(txt) +
            '</button>'
        } else {
          html +=
            '<button class="action-btn" data-action="toast" data-type="success" data-msg="Suggestion recorded">' +
            escapeHtml(txt) +
            '</button>'
        }
      })
      html += '</div></div>'
    }

    if (shortTerm.length > 0) {
      html +=
        '<div class="action-group short-term"><div class="action-group-title">Short-term Improvements</div><div class="action-items">'
      shortTerm.forEach((act) => {
        html += '<span class="action-text">' + escapeHtml(actionText(act)) + '</span>'
      })
      html += '</div></div>'
    }

    if (longTerm.length > 0) {
      html +=
        '<div class="action-group long-term"><div class="action-group-title">Long-term Recommendations</div><div class="action-items">'
      longTerm.forEach((act) => {
        html += '<span class="action-text">' + escapeHtml(actionText(act)) + '</span>'
      })
      html += '</div></div>'
    }

    html += '</div></div>'
  }

  // ── 5. Diagnosis Timeline + Evidence ──
  if (diagnosisChain.length > 0) {
    html += '<div class="timeline-wrapper"><div class="card-title">Diagnosis Timeline</div><div class="timeline">'

    diagnosisChain.forEach((dc, idx) => {
      const stepTitle = dc.step || 'Step ' + (idx + 1)
      const decision = dc.decision || ''
      const finding = dc.finding || ''
      const isSkip =
        decision.indexOf('skip') >= 0 ||
        decision.indexOf('SKIP') >= 0 ||
        decision.indexOf('跳过') >= 0 ||
        decision.indexOf('无需') >= 0
      const isFinal = idx === diagnosisChain.length - 1
      const stepCls = isSkip ? 'timeline-step skipped' : isFinal ? 'timeline-step final' : 'timeline-step'

      html +=
        '<div class="' +
        stepCls +
        '"><div class="timeline-step-header"><strong>Step ' +
        (idx + 1) +
        '</strong> &middot; ' +
        escapeHtml(stepTitle)
      if (isSkip) html += '<span class="step-badge skipped-badge">SKIPPED</span>'
      if (isFinal) html += '<span class="step-badge final-badge">FINAL</span>'
      html += '</div>'
      if (finding || decision) {
        html += '<div class="timeline-step-body">'
        if (finding) {
          html +=
            '<div class="diag-finding"><span class="diag-label">FINDING</span>' +
            '<span class="diag-text">' +
            escapeHtml(finding) +
            '</span></div>'
        }
        if (decision) {
          html +=
            '<div class="diag-decision"><span class="diag-label diag-label-decision">DECISION</span>' +
            '<span class="diag-text">' +
            escapeHtml(decision) +
            '</span></div>'
        }
        html += '</div>'
      }
      html += '</div>'
    })

    html += '</div>'

    const stepsWithDetail = diagnosisChain.filter((dc) => !!(dc.finding || dc.decision))
    const hasEvidence = !!(
      errorSnapshot.service_name ||
      errorSnapshot.exception_type ||
      codeAnalysis.primary_file ||
      stepsWithDetail.length > 0
    )
    if (hasEvidence) {
      html +=
        '<button class="toggle-evidence-btn" id="toggleEvidenceBtn" data-action="toggle-evidence">' +
        '&#128194; 展开全部证据卡片 <span class="chevron">&#9662;</span></button>'
      html += '<div class="evidence-sub-cards" id="evidenceSubCards">'

      // Error Snapshot
      if (errorSnapshot.service_name || errorSnapshot.exception_type || errorSnapshot.error_message) {
        html += '<div class="evidence-sub-section-label">Error Snapshot</div><div class="evidence-sub-grid">'
        const esFields = [
          { k: 'Service', v: errorSnapshot.service_name },
          { k: 'Exception Type', v: errorSnapshot.exception_type, red: true },
          { k: 'Error Message', v: errorSnapshot.error_message, full: true },
          { k: 'Error Count', v: errorSnapshot.error_count, red: true, big: true },
          { k: 'First Seen', v: errorSnapshot.first_seen },
          { k: 'Last Seen', v: errorSnapshot.last_seen },
        ]
        esFields.forEach((f) => {
          if (f.v === undefined || f.v === null || f.v === '') return
          const cls = f.full ? ' evidence-kv full-width' : ' evidence-kv'
          const valCls = 'kv-value' + (f.red ? ' highlight-red' : '')
          if (f.big) {
            html +=
              '<div class="' +
              cls +
              '"><span class="kv-label">' +
              escapeHtml(f.k) +
              '</span><span class="' +
              valCls +
              '" style="font-size:1.1rem;font-weight:700;color:#dc2626;">' +
              escapeHtml(String(f.v)) +
              '</span></div>'
          } else {
            html +=
              '<div class="' +
              cls +
              '"><span class="kv-label">' +
              escapeHtml(f.k) +
              '</span><span class="' +
              valCls +
              '">' +
              escapeHtml(String(f.v)) +
              '</span></div>'
          }
        })
        html += '</div>'
      }

      // Code Traceability
      if (codeAnalysis.primary_file || codeAnalysis.last_author || codeAnalysis.last_commit) {
        html += '<div class="evidence-sub-section-label">Code Traceability</div><div class="evidence-sub-grid">'
        const ctFields = [
          {
            k: 'Primary File',
            v: codeAnalysis.primary_file
              ? codeAnalysis.primary_file + (codeAnalysis.primary_line ? ':' + codeAnalysis.primary_line : '')
              : null,
          },
          { k: 'Method', v: codeAnalysis.primary_method },
          { k: 'Last Author', v: codeAnalysis.last_author },
          { k: 'Last Commit', v: codeAnalysis.last_commit },
          { k: 'Commit Date', v: codeAnalysis.last_commit_date },
          { k: 'Commit Message', v: codeAnalysis.last_commit_message },
        ]
        ctFields.forEach((f) => {
          if (!f.v) return
          html +=
            '<div class="evidence-kv"><span class="kv-label">' +
            escapeHtml(f.k) +
            '</span><span class="kv-value">' +
            escapeHtml(String(f.v)) +
            '</span></div>'
        })

        const apis = codeAnalysis.affected_apis || []
        if (apis.length > 0) {
          html += '<div class="evidence-kv full-width"><span class="kv-label">Affected APIs</span>'
          apis.forEach((api) => {
            html +=
              '<span class="kv-value" style="display:inline-block;margin-right:10px;">' +
              escapeHtml((api.method || 'GET') + ' ' + (api.path || '')) +
              (api.description ? ' &mdash; ' + escapeHtml(api.description) : '') +
              '</span>'
          })
          html += '</div>'
        }

        const changes = codeAnalysis.recent_changes || []
        if (changes.length > 0) {
          html += '<div class="evidence-kv full-width"><span class="kv-label">Recent Changes</span>'
          changes.forEach((rc) => {
            html +=
              '<span class="kv-value">' +
              escapeHtml(
                (rc.commit || '') + ' | ' + (rc.author || '') + ' | ' + (rc.date || '') + ' | ' + (rc.summary || ''),
              ) +
              '</span>'
          })
          html += '</div>'
        }
        html += '</div>'
      }

      html += '</div>'
    }

    html += '</div>'
  }

  // ── 6. Raw Alert Details（可折叠）──
  const hasRawDetails =
    alert.errorMessage || alert.stackTrace || alert.sourceFile || alert.gitCommit || alert.errorFingerprint
  if (hasRawDetails) {
    html +=
      '<div class="collapsible-section">' +
      '<button class="collapsible-trigger" data-action="toggle-collapsible" aria-expanded="false">' +
      'Raw Alert Details <span class="chevron">&#9662;</span></button>' +
      '<div class="collapsible-content"><div class="collapsible-inner">'

    if (alert.sourceFile || alert.gitCommit || alert.errorFingerprint) {
      html += '<div class="evidence-sub-grid" style="margin-bottom:12px;">'
      if (alert.sourceFile) {
        html +=
          '<div class="evidence-kv"><span class="kv-label">Source File</span><span class="kv-value">' +
          escapeHtml(alert.sourceFile) +
          (alert.lineNumber ? ':' + escapeHtml(String(alert.lineNumber)) : '') +
          '</span></div>'
      }
      if (alert.gitCommit) {
        html +=
          '<div class="evidence-kv"><span class="kv-label">Git Commit</span><span class="kv-value">' +
          escapeHtml(String(alert.gitCommit).substring(0, 12)) +
          '</span></div>'
      }
      if (alert.errorFingerprint) {
        html +=
          '<div class="evidence-kv"><span class="kv-label">Fingerprint</span><span class="kv-value">' +
          escapeHtml(String(alert.errorFingerprint).substring(0, 16)) +
          '...</span></div>'
      }
      html +=
        '<div class="evidence-kv"><span class="kv-label">Severity</span>' +
        '<span class="kv-value highlight-red">' +
        escapeHtml(String(alert.severity || 'N/A').toUpperCase()) +
        '</span></div>' +
        '<div class="evidence-kv"><span class="kv-label">Status</span>' +
        '<span class="kv-value">' +
        escapeHtml(String(alert.status || 'N/A').toUpperCase()) +
        '</span></div>' +
        '<div class="evidence-kv"><span class="kv-label">Alert Type</span>' +
        '<span class="kv-value">' +
        escapeHtml(alert.alertType || alert.alertSubType || 'N/A') +
        '</span></div></div>'
    }

    if (alert.errorMessage) {
      html +=
        '<div class="evidence-sub-section-label">Error Message</div>' +
        '<div class="code-block" style="max-height:80px;">' +
        escapeHtml(String(alert.errorMessage).substring(0, 2000)) +
        '</div>'
    }
    if (alert.stackTrace) {
      html +=
        '<div class="evidence-sub-section-label">Stack Trace</div>' +
        '<div class="code-block" style="max-height:200px;">' +
        escapeHtml(String(alert.stackTrace).substring(0, 3000)) +
        '</div>'
    }
    html += '</div></div></div>'
  }

  // ── 7. Agent Execution Log（可折叠）──
  html +=
    '<div class="collapsible-section">' +
    '<button class="collapsible-trigger" data-action="toggle-collapsible" aria-expanded="false">' +
    'Agent Execution Log <span class="chevron">&#9662;</span></button>' +
    '<div class="collapsible-content"><div class="collapsible-inner">'

  html +=
    '<div class="invocation-meta">' +
    '<div class="meta-item">Agent: <strong>' +
    escapeHtml(inv.agent_id || 'N/A') +
    '</strong></div>' +
    '<div class="meta-item">Model: <strong>' +
    escapeHtml(inv.model_name || 'N/A') +
    '</strong></div>' +
    '<div class="meta-item">Latency: <strong>' +
    (inv.latency_ms || 0) +
    'ms</strong></div>'
  if (inv.token_usage) {
    html +=
      '<div class="meta-item">Tokens: <strong>' +
      (inv.token_usage.total_tokens || 0).toLocaleString() +
      '</strong> (in: ' +
      (inv.token_usage.input_tokens || 0).toLocaleString() +
      ' out: ' +
      (inv.token_usage.output_tokens || 0).toLocaleString() +
      ')</div>'
  }
  html += '<div class="meta-item">Status: <strong>' + escapeHtml(inv.execution_status || 'N/A') + '</strong></div></div>'

  if (thinkingChain.length > 0) {
    thinkingChain.forEach((step, idx) => {
      const purpose = step.purpose || 'tool_call'
      const isFinal = purpose === 'final_response'
      const tools = step.tool_executions || []
      const toolNames = tools.map((t) => t.tool_name || 'unknown').join(', ')
      const cardCls = isFinal ? 'think-step final-response-card' : 'think-step'

      html +=
        '<div class="' +
        cardCls +
        '"><div class="think-step-header" data-action="toggle-think-step">' +
        '<span class="think-step-num">Step ' +
        (idx + 1) +
        '/' +
        thinkingChain.length +
        '</span>' +
        '<span class="think-step-purpose ' +
        escapeHtml(purpose) +
        '">' +
        (isFinal ? 'Final' : 'Tool') +
        '</span>' +
        '<span class="think-step-tools">' +
        escapeHtml(toolNames || (isFinal ? 'Analysis output' : 'No tools')) +
        '</span>' +
        '<span class="think-step-tokens">' +
        ((step.input_tokens || 0) + (step.output_tokens || 0)).toLocaleString() +
        ' tok</span>' +
        '<span class="think-step-toggle">&#9654;</span>' +
        '</div><div class="think-step-body">'

      if (tools.length > 0) tools.forEach((tool) => (html += renderToolExecution(tool)))

      if (isFinal) {
        html +=
          '<div style="font-size:11px;color:var(--text-tertiary);padding:8px 0;">' +
          'Analysis complete. Full report rendered in the summary sections above.</div>'
      }
      html += '</div></div>'
    })
  } else if (rawOutput) {
    html += '<div class="agent-conclusion">' + escapeHtml(String(rawOutput)) + '</div>'
  } else {
    html += '<div class="no-analysis-note">No thinking chain data available for this invocation.</div>'
  }

  html += '</div></div>'

  return html
}
