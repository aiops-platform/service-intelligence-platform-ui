<!--
  Ticket Inbox —— 完整流程的**入口**。

  从「抓到一条 ticket」开始：新建/查看工单 → 发起诊断 → 跳 Run 详情看诊断/修复/审批全过程。
  class 全部复用既有 styles.css，不新增样式。
-->
<script setup>
import { ref, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { useTickets } from './useTickets'
import { runStatusLabel, runStatusOf, statusLabel } from '@/utils/runStatus'
import { formatTimeAgo } from '@/utils/time'

const router = useRouter()
const {
  STATUS_FILTERS,
  loading,
  error,
  statusFilter,
  draft,
  creating,
  runningId,
  counts,
  visible,
  load,
  create,
  startRun,
  detail,
  detailRuns,
  detailLoading,
  detailError,
  openDetail,
  closeDetail,
  rerunFromDetail,
  nodeBreakdown,
  activeNodeCount,
  formatDuration,
  windowWarning,
  ticketDisplayStatus,
  ticketStatusLabel,
} = useTickets()

const showNew = ref(false)
const refreshing = ref(false)

async function refresh() {
  refreshing.value = true
  try {
    await load()
  } finally {
    setTimeout(() => (refreshing.value = false), 600)
  }
}

async function submitNew() {
  const created = await create()
  if (created) showNew.value = false
}

/** 发起诊断 → 跳 Run 详情（这是「从 ticket 走到流程」的那一步） */
async function diagnose(ticket) {
  const out = await startRun(ticket)
  if (out?.run_id) router.push({ name: 'run-detail', params: { runId: out.run_id } })
}

function openRun(ticket) {
  const runId = ticket.run_ids?.[ticket.run_ids.length - 1]
  if (runId) router.push({ name: 'run-detail', params: { runId } })
}

function goRun(runId) {
  closeDetail()
  router.push({ name: 'run-detail', params: { runId } })
}

/** 详情里再发起一次，然后直接去 Run 详情看过程 */
async function diagnoseFromDetail() {
  const out = await rerunFromDetail()
  if (out?.run_id) goRun(out.run_id)
}

onMounted(load)
onActivated(load)
</script>

<template>
  <div id="page-tickets" class="page-panel" style="display: block">
    <div class="breadcrumb">
      Service Ops <span class="breadcrumb-sep">&rsaquo;</span> Ticket Workspace
      <span class="breadcrumb-sep">&rsaquo;</span> <strong>Ticket Inbox</strong>
    </div>

    <div class="flex justify-between items-center page-header">
      <h1 class="page-title">
        Ticket Inbox
        <span style="font-size: 12px; color: var(--text-tertiary); margin-left: 10px">
          captured ticket → diagnose → fix → approve → commit
        </span>
      </h1>
      <div style="display: flex; align-items: center; gap: 12px">
        <button class="btn btn-yellow" @click="showNew = true">+ New Ticket</button>
        <button class="si-refresh-btn" :disabled="refreshing" @click="refresh">
          <svg class="si-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Refresh
        </button>
      </div>
    </div>

    <!-- Stats -->
    <div class="reflow-stats" style="grid-template-columns: repeat(8, 1fr)">
      <div class="kpi-card">
        <div class="kpi-header"><span>Total Tickets</span></div>
        <div><div class="kpi-value" style="color: var(--accent-blue)">{{ counts.all }}</div>
          <div class="kpi-sub">captured events</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>New</span></div>
        <div><div class="kpi-value" style="color: #8b5cf6">{{ counts.new }}</div>
          <div class="kpi-sub">awaiting triage</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>In Progress</span></div>
        <div><div class="kpi-value" style="color: #f59e0b">{{ counts.running }}</div>
          <div class="kpi-sub">run started</div></div>
      </div>
      <!-- 停在审批门：不往下走了，等的是人 —— 与"进行中"分开才有意义 -->
      <div class="kpi-card">
        <div class="kpi-header"><span>待审批</span></div>
        <div><div class="kpi-value" style="color: #d97706">{{ counts.waiting_approval }}</div>
          <div class="kpi-sub">waiting for approval</div></div>
      </div>
      <!-- 审批被否决（人工驳回 / 超时自动拒绝）：run 的 status 也是 success，
           不单列就会被算成 Resolved —— 方案被否了却显示"事故已解决" -->
      <div class="kpi-card">
        <div class="kpi-header"><span>审批不通过</span></div>
        <div><div class="kpi-value" style="color: #dc2626">{{ counts.rejected }}</div>
          <div class="kpi-sub">approval rejected</div></div>
      </div>
      <!-- 跑完了但没诊断出结果（run 停在 halt 节点）：不会自己往下走了，等人补信息 -->
      <div class="kpi-card">
        <div class="kpi-header"><span>需要补充信息</span></div>
        <div><div class="kpi-value" style="color: #b45309">{{ counts.needs_info }}</div>
          <div class="kpi-sub">evidence insufficient</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Resolved</span></div>
        <div><div class="kpi-value" style="color: #10b981">{{ counts.resolved }}</div>
          <div class="kpi-sub">closed</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Failed</span></div>
        <div><div class="kpi-value" style="color: #ef4444">{{ counts.failed }}</div>
          <div class="kpi-sub">needs attention</div></div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="reflow-filter-bar">
      <button
        v-for="f in STATUS_FILTERS"
        :key="f.value"
        class="filter-chip"
        :class="{ active: statusFilter === f.value }"
        @click="statusFilter = f.value"
      >
        {{ f.label }}
      </button>
    </div>

    <div v-if="error" class="si-error-bar" style="display: flex">
      <span class="si-error-msg"><span class="si-error-icon">!</span><span>{{ error }}</span></span>
    </div>

    <!-- Table -->
    <div class="table-container">
      <div class="si-loading-overlay" :class="{ visible: loading }">
        <div class="si-loading-spinner"></div>
        <div>Loading tickets...</div>
      </div>
      <table class="reflow-table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Summary</th>
            <th>Service</th>
            <th>Severity</th>
            <th>Status</th>
            <th>Run</th>
            <th>Captured</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <!-- 整行可点：查看工单内容与它跑过的 run。行内按钮一律 @click.stop，
               否则点「发起诊断」会连带把详情也打开 -->
          <tr
            v-for="t in visible"
            :key="t.id"
            class="ticket-row"
            :class="{ active: detail?.id === t.id }"
            @click="openDetail(t)"
          >
            <td class="col-title">{{ t.number || t.id }}</td>
            <td class="col-summary" :title="t.title">{{ t.title }}</td>
            <td>{{ t.service || '-' }}</td>
            <td>
              <span v-if="t.severity" class="alert-tag" :class="'severity-' + t.severity">
                {{ String(t.severity).toUpperCase() }}
              </span>
              <span v-else>-</span>
            </td>
            <td>
              <!-- 展示状态：run 停在 halt 节点的工单报"缺少必要信息"，不再是 running -->
              <span class="alert-tag" :class="'status-' + ticketDisplayStatus(t)">
                {{ ticketStatusLabel(t) }}
              </span>
            </td>
            <td>
              <button
                v-if="t.run_ids && t.run_ids.length"
                class="btn btn-sm"
                @click.stop="openRun(t)"
              >
                {{ t.run_ids.length }} run{{ t.run_ids.length > 1 ? 's' : '' }}
              </button>
              <span v-else style="color: var(--text-tertiary)">—</span>
            </td>
            <td class="col-time">{{ formatTimeAgo(t.created_at) }}</td>
            <td>
              <button
                class="btn btn-yellow btn-sm"
                :disabled="runningId === t.id"
                @click.stop="diagnose(t)"
              >
                {{ runningId === t.id ? '发起中…' : '发起诊断' }}
              </button>
            </td>
          </tr>
          <tr v-if="!loading && visible.length === 0" class="alert-empty-row">
            <td colspan="8" style="text-align: center; padding: 24px; color: var(--text-tertiary)">
              还没有工单。点右上角「+ New Ticket」新建一条，或从告警页发起。
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 工单详情：内容 + 运行情况 -->
    <div class="ap-modal-overlay" :class="{ open: !!detail }" @click.self="closeDetail">
      <div v-if="detail" class="ap-modal" style="max-width: 760px">
        <div class="ap-modal-header">
          <h3>
            {{ detail.number || detail.id }}
            <span class="alert-tag" :class="'status-' + ticketDisplayStatus(detail)">
              {{ ticketStatusLabel(detail) }}
            </span>
          </h3>
          <button class="ap-modal-close" @click="closeDetail">&times;</button>
        </div>

        <div class="ap-modal-body">
          <div class="ticket-detail-title">{{ detail.title }}</div>

          <div class="ticket-detail-meta">
            <span><b>服务</b> {{ detail.service || '—' }}</span>
            <span><b>namespace</b> {{ detail.namespace || '—' }}</span>
            <span>
              <b>severity</b>
              <span v-if="detail.severity" class="alert-tag" :class="'severity-' + detail.severity">
                {{ String(detail.severity).toUpperCase() }}
              </span>
              <span v-else>—</span>
            </span>
            <span><b>创建</b> {{ formatTimeAgo(detail.created_at) }}</span>
          </div>

          <!-- 诊断窗口：这是最容易出错、也最该被看见的一行 -->
          <div class="apm-field">
            <label>诊断窗口</label>
            <div class="ticket-detail-window">
              {{ detail.inputs?.window_start || '—' }}
              <span class="ticket-detail-arrow">→</span>
              {{ detail.inputs?.window_end || '—' }}
            </div>
            <p v-if="windowWarning(detail)" class="ticket-detail-warn">
              ⚠ {{ windowWarning(detail) }} —— 不带偏移的时间会被按 <b>UTC</b> 解释，
              窗口整体错 8 小时，查询**静默返回空**。修复前建的工单会有这个问题。
            </p>
            <p v-else class="ticket-detail-hint">
              窗口由建单时下发，平台不替你猜 —— 窗口错了，取回的数据就没有意义。
            </p>
          </div>

          <div class="apm-field">
            <label>工单内容（诊断的输入 <code>bug_report</code>）</label>
            <pre class="ticket-detail-json">{{ JSON.stringify(detail.inputs?.bug_report ?? {}, null, 2) }}</pre>
          </div>

          <!-- 运行情况 -->
          <div class="apm-field">
            <label>
              运行情况
              <span style="color: var(--text-tertiary)">
                （{{ detailRuns.length }} 个 run<template v-if="detailLoading"> · 加载中…</template>）
              </span>
            </label>

            <div v-if="detailError" class="si-error-msg" style="margin-bottom: 8px">
              <span class="si-error-icon">!</span><span>{{ detailError }}</span>
            </div>

            <div v-if="detailRuns.length" class="ticket-run-list">
              <div
                v-for="r in detailRuns"
                :key="r.run_id"
                class="ticket-run"
                @click="goRun(r.run_id)"
              >
                <div class="ticket-run-head">
                  <span class="ticket-run-wf">{{ r.workflow || '—' }}</span>
                  <!-- 走 runStatusOf 而不是 r.status：停在 halt 节点的 run 也是
                       success，直接显示会与列表列（缺少必要信息）自相矛盾 -->
                  <span class="alert-tag" :class="'status-' + runStatusOf(r)">
                    {{ runStatusLabel(r) }}
                  </span>
                  <span v-if="activeNodeCount(r)" class="alert-tag status-waiting_approval">
                    {{ activeNodeCount(r) }} 个节点进行中
                  </span>
                  <span class="ticket-run-id">{{ r.run_id }}</span>
                </div>
                <div class="ticket-run-meta">
                  <span v-for="[s, n] in nodeBreakdown(r)" :key="s" class="ticket-run-node"
                        :title="s">
                    {{ statusLabel(s) }} <b>{{ n }}</b>
                  </span>
                  <span v-if="formatDuration(r.created_at, r.updated_at)" class="ticket-run-dur">
                    耗时 {{ formatDuration(r.created_at, r.updated_at) }}
                  </span>
                  <span v-if="r.pending_approvals?.length" class="ticket-run-pending">
                    待审批 {{ r.pending_approvals.length }}
                  </span>
                </div>
              </div>
            </div>
            <div v-else-if="!detailLoading" class="ticket-detail-hint">
              这条工单还没跑过。点右下角「发起诊断」开始。
            </div>
          </div>
        </div>

        <div class="ap-modal-footer" style="display: flex; justify-content: space-between; gap: 8px; padding: 12px 16px">
          <button
            class="btn btn-yellow btn-sm"
            :disabled="runningId === detail.id"
            @click="diagnoseFromDetail"
          >
            {{ runningId === detail.id ? '发起中…' : (detailRuns.length ? '再跑一次' : '发起诊断') }}
          </button>
          <button class="btn btn-sm" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>

    <!-- New ticket 模态 -->
    <div class="ap-modal-overlay" :class="{ open: showNew }" @click.self="showNew = false">
      <div class="ap-modal" style="max-width: 640px">
        <div class="ap-modal-header">
          <h3>New Ticket</h3>
          <button class="ap-modal-close" @click="showNew = false">&times;</button>
        </div>
        <div class="ap-modal-body">
          <div class="apm-field">
            <label>工单号 <span style="color: var(--text-tertiary)">（可空）</span></label>
            <input v-model="draft.number" type="text" placeholder="INC0012345" />
          </div>
          <div class="apm-field">
            <label>摘要 short_description <span style="color: #ef4444">*</span></label>
            <input v-model="draft.title" type="text" placeholder="订单服务结账无响应" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
            <div class="apm-field">
              <label>受影响服务 cmdb_ci.name</label>
              <input v-model="draft.service" type="text" placeholder="order-service" />
            </div>
            <div class="apm-field">
              <label>namespace</label>
              <input v-model="draft.namespace" type="text" placeholder="order" />
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
            <div class="apm-field">
              <label>Severity</label>
              <select v-model="draft.severity">
                <option value="critical">critical</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </div>
            <div class="apm-field">
              <label>trace_id <span style="color: var(--text-tertiary)">（可空）</span></label>
              <input v-model="draft.traceId" type="text" placeholder="trace-20260819-…" />
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
            <div class="apm-field">
              <label>诊断窗口起 window_start <span style="color: #ef4444">*</span></label>
              <input v-model="draft.windowStart" type="datetime-local" step="1" />
            </div>
            <div class="apm-field">
              <label>诊断窗口止 window_end <span style="color: #ef4444">*</span></label>
              <input v-model="draft.windowEnd" type="datetime-local" step="1" />
            </div>
          </div>
          <p style="font-size: 12px; color: var(--text-tertiary); margin-top: 4px">
            时间窗由调用方下发（平台不替你猜）—— 窗口错了，取回的数据就没有意义。
          </p>
        </div>
        <div class="ap-modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px">
          <button class="btn btn-outline" @click="showNew = false">取消</button>
          <button class="btn btn-yellow" :disabled="creating" @click="submitNew">
            {{ creating ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
