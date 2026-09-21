<!--
  Log Analysis（原 index.html:1113-1193 的 #page-log-analysis 面板）。
  class 与 DOM 结构逐字沿用，继续复用 styles.css。

  与改造前的两处差异（都是刻意的）：
  - 表格行由 `rows` 渲染（恒 10 行，不足补空行占位），不再是 innerHTML 拼串
  - Detail 按钮直接调 useLogAnalysis.openDetail（旧版是渲染后逐个 addEventListener）
-->
<script setup>
import { onActivated, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLogAnalysis } from './useLogAnalysis'
import { formatTime } from '@/utils/time'
import { truncateText } from '@/utils/format'

const route = useRoute()
const {
  service,
  severity,
  status,
  rows,
  total,
  services,
  kpi,
  loading,
  loadServices,
  reload,
  applyService,
  applySeverity,
  applyStatus,
  openDetail,
} = useLogAnalysis()

const SEVERITY_CHIPS = [
  { value: 'all', label: 'All Severity' },
  { value: 'WARNING', label: 'Warning', dot: '#f59e0b' },
  { value: 'CRITICAL', label: 'Critical', dot: '#ef4444' },
]
const STATUS_CHIPS = [
  { value: 'all', label: 'Active' },
  { value: 'OPEN', label: 'Open', dot: '#ef4444' },
  { value: 'ACKNOWLEDGED', label: "Ack'd", dot: '#3b82f6' },
  { value: 'RESOLVED', label: 'Resolved', dot: '#10b981' },
]

/** URL query → 服务筛选（替代改造前的 sessionStorage.navContext） */
function applyQuery() {
  const svc = route.query.serviceName
  if (svc) applyService(String(svc))
}

onMounted(async () => {
  await loadServices()
  applyQuery()
  reload()
})

// 已在本页时再点一次（如从 metrics-analysis 下钻同一服务）也要生效
watch(() => route.query.serviceName, applyQuery)

// keep-alive：切走再切回时刷新一次（对应改造前 _pageRefreshers 的语义）
onActivated(() => {
  if (route.query.serviceName) applyQuery()
})
</script>

<template>
  <div id="page-log-analysis" class="page-panel" style="display: block">
    <div class="breadcrumb">
      Service Ops <span class="breadcrumb-sep">&rsaquo;</span> APM
      <span class="breadcrumb-sep">&rsaquo;</span> <strong>Log Analysis</strong>
    </div>
    <div class="flex justify-between items-center page-header">
      <h1 class="page-title">
        Log Analysis
        <span style="font-size: 12px; color: var(--text-tertiary); margin-left: 10px">Error Log Anomalies</span>
      </h1>
      <div style="display: flex; align-items: center; gap: 12px">
        <button class="si-refresh-btn" id="laRefreshBtn" title="Refresh data" @click="reload">
          <svg
            class="si-refresh-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Refresh
        </button>
        <span class="text-secondary text-sm" id="laServiceLabel">{{ service ? 'Filtered: ' + service : '' }}</span>
      </div>
    </div>

    <!-- Stats Row -->
    <div class="reflow-stats" style="grid-template-columns: repeat(5, 1fr)">
      <div class="kpi-card">
        <div class="kpi-header"><span>Total Log Anomalies</span></div>
        <div>
          <div class="kpi-value" style="color: var(--accent-blue)" id="laTotal">{{ kpi.total }}</div>
          <div class="kpi-sub">All error log alerts</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Unique Services</span></div>
        <div>
          <div class="kpi-value" style="color: #10b981" id="laServices">{{ kpi.uniqueServices }}</div>
          <div class="kpi-sub">services affected</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Critical</span></div>
        <div>
          <div class="kpi-value" style="color: #ef4444" id="laCritical">{{ kpi.critical }}</div>
          <div class="kpi-sub">CRITICAL severity</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Open</span></div>
        <div>
          <div class="kpi-value" style="color: #f59e0b" id="laOpen">{{ kpi.open }}</div>
          <div class="kpi-sub">awaiting action</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Resolved</span></div>
        <div>
          <div class="kpi-value" style="color: #10b981" id="laResolved">{{ kpi.resolved }}</div>
          <div class="kpi-sub">error logs resolved</div>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="reflow-filter-bar">
      <select id="laServiceFilter" :value="service" @change="applyService($event.target.value)">
        <option value="">All Services</option>
        <option v-for="svc in services" :key="svc" :value="svc">{{ svc }}</option>
      </select>
      <span style="margin-left: 12px"></span>
      <button
        v-for="chip in SEVERITY_CHIPS"
        :key="'sev-' + chip.value"
        class="filter-chip la-sev-filter"
        :class="{ active: severity === chip.value }"
        :data-filter="chip.value"
        @click="applySeverity(chip.value)"
      >
        <span v-if="chip.dot" class="chip-dot" :style="{ background: chip.dot }"></span> {{ chip.label }}
      </button>
      <span style="margin-left: 12px"></span>
      <button
        v-for="chip in STATUS_CHIPS"
        :key="'st-' + chip.value"
        class="filter-chip la-status-filter"
        :class="{ active: status === chip.value }"
        :data-filter="chip.value"
        @click="applyStatus(chip.value)"
      >
        <span v-if="chip.dot" class="chip-dot" :style="{ background: chip.dot }"></span> {{ chip.label }}
      </button>
    </div>

    <!-- Table -->
    <div class="table-container" id="laTableContainer">
      <div class="si-loading-overlay" :class="{ visible: loading }" id="laLoadingOverlay">
        <div class="si-loading-spinner"></div>
        <div>Loading log alerts...</div>
      </div>
      <table class="reflow-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Service</th>
            <th>Severity</th>
            <th>Status</th>
            <th>Summary</th>
            <th>Time</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="laTableBody">
          <!-- 恒 10 行：有数据渲染真实行，否则空行占位（保持表格高度稳定） -->
          <tr v-for="(row, i) in rows" :key="i" :class="{ 'alert-empty-row': !row }">
            <template v-if="row">
              <td class="col-title">{{ row.title || 'Untitled' }}</td>
              <td>{{ row.serviceName || '-' }}</td>
              <td>
                <span class="alert-tag" :class="'severity-' + String(row.severity || 'INFO').toLowerCase()">
                  {{ row.severity || 'INFO' }}
                </span>
              </td>
              <td>
                <span class="alert-tag" :class="'status-' + String(row.status || 'OPEN').toLowerCase()">
                  {{ row.status || 'OPEN' }}
                </span>
              </td>
              <td class="col-summary" :title="row.summary || ''">{{ truncateText(row.summary, 60) }}</td>
              <td class="col-time">{{ formatTime(row.detectedAt) }}</td>
              <td><button class="btn-alert-detail" :data-id="row.id" @click.stop="openDetail(row)">Detail</button></td>
            </template>
            <td v-else colspan="7">&nbsp;</td>
          </tr>
        </tbody>
      </table>
      <div class="pagination" id="laPagination">
        <span>Total <span id="laRowCount">{{ total }}</span> alerts</span>
        <span style="color: var(--text-tertiary)">Click Detail for agent analysis</span>
      </div>
    </div>
  </div>
</template>
