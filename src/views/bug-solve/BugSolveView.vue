<!--
  Bug Solve（原 index.html:1485-1556 的 #page-bug-solve 面板）。
  class 与 DOM 结构逐字沿用，继续复用 styles.css。

  与改造前的差异：待审批卡片与右侧详情由**模板**渲染（原实现是 innerHTML 拼串 +
  容器上做事件委托），因此不再需要 escapeHtml，也不会再有 XSS 面。
-->
<script setup>
import { ref, onMounted, onActivated } from 'vue'
import { useBugSolveRun, statusClass } from './useBugSolveRun'
import GraphCanvas from '@/components/graph/GraphCanvas.vue'

const canvasRef = ref(null)
const refreshing = ref(false)

const run = useBugSolveRun({ getCanvas: () => canvasRef.value })
const {
  workflows,
  workflowId,
  runId,
  runStatus,
  running,
  pendingApprovals,
  selectedNode,
  detailTab,
  error,
  ticketText,
  totalTokens,
  totalCost,
  stepLabel,
  detail,
  loadWorkflows,
  onWorkflowChange,
  start,
  stop,
  approve,
  reject,
  selectNode,
  setDetailTab,
} = run

/** 节点着色：状态类 + approval 节点附加样式（逐字移植原 nodeStyle） */
function nodeStyle(n, st) {
  let cls = statusClass(st)
  if (n.kind === 'approval') cls += ' bs-node-approval'
  return { cls, label: n.id + (n.agent ? ` (${n.agent})` : '') }
}

const HINT =
  '选择流程后预览图；点击「开始解决问题」运行。节点按状态着色：绿=done 蓝=running 灰=pending 红=failed 橙=cancelled 琥珀=待审批。Scroll to zoom · drag to pan.'

async function refreshWorkflows() {
  refreshing.value = true
  try {
    await loadWorkflows()
  } finally {
    // 原实现有 600ms 的视觉反馈窗口
    setTimeout(() => (refreshing.value = false), 600)
  }
}

onMounted(loadWorkflows)
// 切回本页时刷新已保存流程列表（对应改造前 _pageRefreshers['page-bug-solve']）
onActivated(loadWorkflows)
</script>

<template>
  <div id="page-bug-solve" class="page-panel" style="display: block">
    <div class="breadcrumb">
      Agents <span class="breadcrumb-sep">&rsaquo;</span> Agent Fleet
      <span class="breadcrumb-sep">&rsaquo;</span> <strong>Bug Solve</strong>
    </div>
    <div class="flex justify-between items-center page-header">
      <h1 class="page-title">
        Bug Solve
        <span style="font-size: 12px; color: var(--text-tertiary); margin-left: 10px">
          pick a workflow &rarr; paste ticket JSON &rarr; run the agent fleet &rarr; approve / inspect
        </span>
      </h1>
      <div style="display: flex; align-items: center; gap: 12px">
        <button
          class="si-refresh-btn"
          id="bsRefreshBtn"
          title="Refresh saved workflows"
          :disabled="refreshing"
          @click="refreshWorkflows"
        >
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
      </div>
    </div>

    <div class="bs-body">
      <!-- Left: workflow + ticket + run controls -->
      <div class="bs-panel">
        <div class="apm-field">
          <label for="bsWorkflow">Workflow</label>
          <select id="bsWorkflow" :value="workflowId || ''" @change="onWorkflowChange($event.target.value)">
            <option value="">-- 选择已保存流程 --</option>
            <option v-for="w in workflows" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
        <div class="apm-field">
          <label for="bsTicket">Ticket JSON</label>
          <textarea
            id="bsTicket"
            v-model="ticketText"
            rows="9"
            spellcheck="false"
            placeholder='{
  "bug_report": {
    "title": "checkout 下单偶发 500",
    "trace_id": "abc123"
  }
}'
          ></textarea>
        </div>
        <div class="bs-actions">
          <button class="btn btn-yellow" id="bsStartBtn" :disabled="running" @click="start">
            开始解决问题
          </button>
          <button class="btn btn-outline" id="bsStopBtn" v-show="running" @click="stop">停止</button>
        </div>
        <div class="bs-error" id="bsError" v-show="error">{{ error }}</div>

        <div class="bs-stats" id="bsStats" v-show="runId" style="display: flex">
          <div class="bs-stat">
            <span class="bs-stat-label">Run ID</span><span class="bs-stat-value" id="bsRunId">{{ runId || '—' }}</span>
          </div>
          <div class="bs-stat">
            <span class="bs-stat-label">状态</span
            ><span class="bs-stat-value" id="bsStatus">{{ runStatus || '—' }}</span>
          </div>
          <div class="bs-stat">
            <span class="bs-stat-label">当前节点</span
            ><span class="bs-stat-value" id="bsStep">{{ stepLabel }}</span>
          </div>
          <div class="bs-stat">
            <span class="bs-stat-label">总 Tokens</span
            ><span class="bs-stat-value" id="bsTokens">{{ totalTokens }}</span>
          </div>
          <div class="bs-stat">
            <span class="bs-stat-label">总 Cost</span
            ><span class="bs-stat-value" id="bsCost">{{ totalCost }}</span>
          </div>
        </div>

        <div class="bs-approvals-title">待审批</div>
        <div class="bs-approvals" id="bsApprovals">
          <div v-if="pendingApprovals.length === 0" class="bs-list-empty">暂无待审批项。</div>
          <div v-for="p in pendingApprovals" :key="p.node_id" class="bs-approval-card" :data-node="p.node_id">
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
              <button class="btn btn-sm bs-approve-btn" data-action="approve" @click="approve(p.node_id)">
                通过
              </button>
              <button class="btn btn-sm bs-reject-btn" data-action="reject" @click="reject(p.node_id)">
                驳回
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: graph canvas + node detail -->
      <div class="bs-main">
        <GraphCanvas ref="canvasRef" :hint="HINT" :node-style="nodeStyle" @node-click="selectNode" />
        <div class="bs-detail" id="bsDetail">
          <template v-if="detail">
            <div class="bs-detail-head">
              <span class="bs-detail-node">{{ detail.nid }}</span>
              <span class="bs-badge" :class="'bs-badge-' + detail.status">{{ detail.status }}</span>
              <span class="bs-detail-meta">tokens {{ detail.tokens }} · cost {{ detail.cost }}</span>
            </div>
            <div class="bs-tabs">
              <button
                class="bs-tab"
                :class="{ active: detailTab === 'output' }"
                data-tab="output"
                @click="setDetailTab('output')"
              >
                输出 Output
              </button>
              <button
                class="bs-tab"
                :class="{ active: detailTab === 'prompt' }"
                data-tab="prompt"
                @click="setDetailTab('prompt')"
              >
                输入 Prompt
              </button>
            </div>
            <div class="bs-content">
              <pre>{{ detailTab === 'output' ? detail.outputHtml : detail.promptHtml }}</pre>
            </div>
          </template>
          <div v-else class="bs-detail-empty">点击图中节点查看详情。</div>
        </div>
      </div>
    </div>
  </div>
</template>
