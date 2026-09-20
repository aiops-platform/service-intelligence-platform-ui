<!--
  Run 详情 —— 流程主体。

  DAG（复用 GraphCanvas）+ 节点清单（状态/耗时/重试/错误）+ 节点详情 + 待审批。
  数据来自 GET /runs/{id}（B1 补了 inputs / 时间戳 / 节点 error·耗时·attempts）。
-->
<script setup>
import { onActivated, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRunDetail } from './useRunDetail'
import GraphCanvas from '@/components/graph/GraphCanvas.vue'
import { graphNodeById, nodeTipOf } from '@/components/graph/nodeTip'
import { agentsApi } from '@/api/agentflow'
import { formatTime } from '@/utils/time'

const route = useRoute()
const router = useRouter()

const state = useRunDetail(() => String(route.params.runId || ''))

const {
  run: runData, loading, error, status, displayStatus, nodeStatus, running, nodes,
  totals, detail, detailTab,
  stopping, start, stop, stopPolling, approve, reject, selectNode, statusClass,
} = state

/** 节点着色复用 bug-solve 的映射（同一套 .bs-node 样式） */
function nodeStyle(n, st) {
  let cls = statusClass(st)
  if (n.kind === 'approval') cls += ' bs-node-approval'
  // 图里只显示**节点名**（节点 id）；agent 看详情面板，不往图上堆
  return { cls, label: n.id }
}

const HINT = 'Click a node to inspect its output · params · duration · error。'

/** 悬停 1.5s 的节点提示（内容口径与 Bug Solve 一致，见 nodeTip.js） */
/**
 * agent → 描述（Agents 页同一份，后端 `AGENT_DESCRIPTIONS`，可被租户 agent_configs 覆盖）。
 * 只取一次：图上的节点都指向固定几个 agent，没必要跟着轮询反复拉。
 * 取不到就留空——提示其余字段照常显示，不因为这一项失败而整个不弹。
 */
const agentDesc = ref({})
onMounted(async () => {
  try {
    const list = await agentsApi.list()
    agentDesc.value = Object.fromEntries(
      (list || []).map((a) => [a.name, a.description || '']),
    )
  } catch {
    /* 忽略：拿不到就不显示这一行 */
  }
})

function nodeTip(nid) {
  const g = graphNodeById(runData.value?.graph, nid)
  return nodeTipOf(g, runData.value?.nodes?.[nid], agentDesc.value?.[g?.agent])
}



function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

watch(() => route.params.runId, () => start(), { immediate: true })
onActivated(() => start())
onDeactivated(() => stopPolling())

/**
 * 把图喂给 GraphCanvas 引擎。
 *
 * GraphCanvas 是**命令式**的（`<svg>` 内容由引擎 innerHTML 整段重写，Vue 不参与），
 * 所以必须在数据变化时显式调 `render()` —— 光传 props 不会画出来。
 * 首个 render 可能在子组件 mount 前到达，故 watch 里判空跳过，由下一次数据变化补上。
 */
const canvasRef = ref(null)

watch(
  () => runData.value?.nodes,
  () => {
    const graph = runData.value?.graph
    if (!graph || !canvasRef.value) return
    const statusMap = {}
    for (const [nid, n] of Object.entries(runData.value?.nodes || {})) {
      // 走 nodeStatus 而不是 n.status：halt 节点该上自己的颜色（见 utils/runStatus）
      statusMap[nid] = nodeStatus(nid, n.status)
    }
    canvasRef.value.render(graph, statusMap)
  },
  { deep: true },
)
</script>

<template>
  <div id="page-run-detail" class="page-panel" style="display: block">
    <div class="breadcrumb">
      Service Ops <span class="breadcrumb-sep">&rsaquo;</span> Ticket Workspace
      <span class="breadcrumb-sep">&rsaquo;</span> <strong>Run Detail</strong>
    </div>

    <div class="flex justify-between items-center page-header">
      <h1 class="page-title">
        {{ runData?.workflow || 'Run' }}
        <span style="font-size: 12px; color: var(--text-tertiary); margin-left: 10px">
          {{ route.params.runId }}
        </span>
      </h1>
      <div style="display: flex; align-items: center; gap: 12px">
        <!-- 展示状态：halted 的 run 不再是绿色的 success（见 utils/runStatus） -->
        <span class="alert-tag" :class="'status-' + displayStatus">
          {{ displayStatus || '…' }}
        </span>
        <button v-if="running" class="btn btn-outline" :disabled="stopping" @click="stop">
          {{ stopping ? '停止中…' : '停止' }}
        </button>
        <button class="btn btn-outline" @click="router.back()">返回</button>
      </div>
    </div>

    <div v-if="error" class="si-error-bar" style="display: flex">
      <span class="si-error-msg"><span class="si-error-icon">!</span><span>{{ error }}</span></span>
    </div>

    <!-- 概览 -->
    <div class="reflow-stats" style="grid-template-columns: repeat(5, 1fr)">
      <div class="kpi-card">
        <div class="kpi-header"><span>Nodes</span></div>
        <div><div class="kpi-value" style="color: var(--accent-blue)">{{ totals.count }}</div>
          <div class="kpi-sub">{{ totals.done }} done · {{ totals.failed }} failed</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Total Tokens</span></div>
        <div><div class="kpi-value" style="color: #8b5cf6">{{ runData?.total_tokens || 0 }}</div>
          <div class="kpi-sub">across nodes</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Total Cost</span></div>
        <div><div class="kpi-value" style="color: #10b981">
          {{ (runData?.total_cost || 0).toFixed(4) }}</div>
          <div class="kpi-sub">USD</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Node Time</span></div>
        <div><div class="kpi-value" style="color: #f59e0b">{{ fmtMs(totals.durationMs) }}</div>
          <div class="kpi-sub">sum of node durations</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header"><span>Pending Approvals</span></div>
        <div><div class="kpi-value" style="color: #ef4444">
          {{ (runData?.pending_approvals || []).length }}</div>
          <div class="kpi-sub">awaiting human</div></div>
      </div>
    </div>

    <!-- 工单上下文：inputs 回显（B1 新增，此前查不回来） -->
    <div v-if="runData?.inputs?.bug_report" class="ai-summary-card" style="margin: 12px 0">
      <div class="card-title">Captured Ticket</div>
      <div class="one-liner">
        {{ runData.inputs.bug_report.short_description || runData.inputs.bug_report.number || '—' }}
      </div>
      <div class="risk-confidence-row">
        <span v-if="runData.inputs.bug_report.number" class="risk-tag low-risk">
          {{ runData.inputs.bug_report.number }}
        </span>
        <span v-if="runData.inputs.bug_report.cmdb_ci?.name" class="confidence-tag low">
          {{ runData.inputs.bug_report.cmdb_ci.name }}
        </span>
        <span v-if="runData.inputs.window_start" class="confidence-tag medium">
          window {{ runData.inputs.window_start }} → {{ runData.inputs.window_end }}
        </span>
      </div>
    </div>

    <div class="bs-body">
      <!-- 左：DAG -->
      <div class="bs-main" style="flex: 2">
        <GraphCanvas ref="canvasRef" :hint="HINT" :node-style="nodeStyle"
                   :node-tip="nodeTip" @node-click="selectNode" />
      </div>

      <!-- 右：节点详情 / 待审批 -->
      <div class="bs-panel" style="flex: 1; max-width: 460px">
        <div v-if="(runData?.pending_approvals || []).length" class="bs-approvals-title">待审批</div>
        <div v-for="p in runData?.pending_approvals || []" :key="p.node_id" class="bs-approval-card">
          <div class="bs-approval-head">
            <span class="bs-approval-node">{{ p.node_id }}</span>
            <span v-if="p.trigger" class="bs-trigger">{{ p.trigger }}</span>
            <span v-else class="bs-trigger bs-trigger-plain">人工审批</span>
          </div>
          <div v-if="p.upstream" class="bs-upstreams">
            <div v-for="(out, u) in p.upstream" :key="u" class="bs-upstream">
              <div class="bs-upstream-label">{{ u }}</div>
              <pre>{{ JSON.stringify(out, null, 2) }}</pre>
            </div>
          </div>
          <div class="bs-approval-actions">
            <button class="btn btn-sm bs-approve-btn" @click="approve(p.node_id)">通过</button>
            <button class="btn btn-sm bs-reject-btn" @click="reject(p.node_id)">驳回</button>
          </div>
        </div>

        <div class="bs-detail">
          <template v-if="detail">
            <div class="bs-detail-head">
              <span class="bs-detail-node">{{ detail.nid }}</span>
              <span class="bs-badge" :class="'bs-badge-' + detail.status">{{ detail.status }}</span>
              <span class="bs-detail-meta">
                {{ fmtMs(detail.durationMs) }} · tokens {{ detail.tokens }} · cost {{ detail.cost }}
                <template v-if="detail.attempts > 1"> · 重试 {{ detail.attempts - 1 }}</template>
              </span>
            </div>
            <div v-if="detail.error" class="alert-error" style="display: block; margin: 8px 0">
              {{ detail.error }}
            </div>
            <div class="bs-tabs">
              <button class="bs-tab" :class="{ active: detailTab === 'output' }"
                      @click="detailTab = 'output'">输出 Output</button>
              <button class="bs-tab" :class="{ active: detailTab === 'params' }"
                      @click="detailTab = 'params'">输入 Params</button>
            </div>
            <div class="bs-content">
              <pre>{{ detailTab === 'output' ? detail.output : detail.params }}</pre>
            </div>
          </template>
          <div v-else class="bs-detail-empty">点击图中节点查看详情。</div>
        </div>
      </div>
    </div>

    <!-- 节点清单（等价于时间线，按图的层级顺序） -->
    <div class="table-container" style="margin-top: 16px">
      <table class="reflow-table">
        <thead>
          <tr><th>Node</th><th>Agent</th><th>Status</th><th>Duration</th>
              <th>Tokens</th><th>Cost</th><th>Attempts</th><th>Error</th></tr>
        </thead>
        <tbody>
          <tr v-for="[nid, n] in nodes" :key="nid" @click="selectNode(nid)" style="cursor: pointer">
            <td class="col-title">{{ nid }}</td>
            <td>{{ (runData?.graph?.nodes || []).find((g) => g.id === nid)?.agent || '—' }}</td>
            <td>
              <span class="alert-tag" :class="'status-' + nodeStatus(nid, n.status)">
                {{ nodeStatus(nid, n.status) }}
              </span>
            </td>
            <td class="col-time">{{ fmtMs(n.duration_ms) }}</td>
            <td>{{ n.tokens || 0 }}</td>
            <td class="col-time">{{ typeof n.cost === 'number' ? n.cost.toFixed(4) : '0.0' }}</td>
            <td>{{ n.attempts || 0 }}</td>
            <td class="col-summary" :title="n.error || ''">{{ n.error || '—' }}</td>
          </tr>
          <tr v-if="!loading && nodes.length === 0" class="alert-empty-row">
            <td colspan="8" style="text-align: center; padding: 24px; color: var(--text-tertiary)">
              没有节点数据。
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
