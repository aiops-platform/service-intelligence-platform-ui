<!--
  Ticket Inbox —— 完整流程的**入口**。

  从「抓到一条 ticket」开始：新建/查看工单 → 发起诊断 → 跳 Run 详情看诊断/修复/审批全过程。
  class 全部复用既有 styles.css，不新增样式。
-->
<script setup>
import { ref, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { useTickets } from './useTickets'
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
    <div class="reflow-stats" style="grid-template-columns: repeat(5, 1fr)">
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
          <tr v-for="t in visible" :key="t.id">
            <td class="col-title">{{ t.number || t.id }}</td>
            <td class="col-summary" :title="t.title">{{ t.title }}</td>
            <td>{{ t.service || '-' }}</td>
            <td>
              <span v-if="t.severity" class="alert-tag" :class="'severity-' + t.severity">
                {{ String(t.severity).toUpperCase() }}
              </span>
              <span v-else>-</span>
            </td>
            <td><span class="alert-tag" :class="'status-' + t.status">{{ t.status }}</span></td>
            <td>
              <button v-if="t.run_ids && t.run_ids.length" class="btn btn-sm" @click="openRun(t)">
                {{ t.run_ids.length }} run{{ t.run_ids.length > 1 ? 's' : '' }}
              </button>
              <span v-else style="color: var(--text-tertiary)">—</span>
            </td>
            <td class="col-time">{{ formatTimeAgo(t.created_at) }}</td>
            <td>
              <button
                class="btn btn-yellow btn-sm"
                :disabled="runningId === t.id"
                @click="diagnose(t)"
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
