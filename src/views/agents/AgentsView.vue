<!--
  Agent 目录 —— 元素周期表布局 + 右侧 Inspector。

  按参考站（sip-platform.web.app/agents/，用户截图 11.png / 12.png）的结构：
    页头 → tier 筛选条 → 周期表（大组 = role，行 = stage，单元格 = 编号+符号+名称+tier 徽章）
    → 右侧 Inspector（点单元格填充）→ 底部 tier 汇总条。

  与参考站的差异（数据事实，不硬凑）：我们有 15 个 agent / 2 大组，参考站有 156 / 9 行，
  所以格子会稀疏 —— 布局按真实数量自适应，cell 定宽自动换行。

  样式新增段见 css/styles.css 末尾「Agent 目录（周期表）」。
-->
<script setup>
import { onMounted, onActivated } from 'vue'
import { useAgents, symbolOf } from './useAgents'

const {
  TIERS, TIER_COLOR, loading, error, tierFilter, search,
  selected, selectedDetail, detailLoading, counts, visible, groups, load, select, close,
} = useAgents()

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** 空样本显示「暂无数据」而不是 0 —— stats 在无 Key / 无 run 时各值为 null */
function fmtStat(v, suffix = '') {
  return v === null || v === undefined ? '暂无数据' : `${v}${suffix}`
}

onMounted(load)
onActivated(load)
</script>

<template>
  <div id="page-agents" class="page-panel" style="display: block">
    <div class="flex justify-between items-center page-header">
      <div>
        <h1 class="page-title">Agents</h1>
        <p class="page-desc">
          agentflow 编队 · {{ counts.all }} 个 agent ·
          诊断侧（detect → diagnose）与解决侧（fix → verify → deliver → learn）·
          自治度从 T1 只读咨询到 T3+ 半自动。点任意格子查看该 agent 的能力面。
        </p>
      </div>
      <span class="agents-fleet-chip">{{ counts.all }} AGENT FLEET</span>
    </div>

    <!-- tier 筛选 -->
    <div class="agents-tier-bar">
      <button class="agents-tier-chip" :class="{ active: tierFilter === 'all' }"
              @click="tierFilter = 'all'">
        ALL · {{ counts.all }}
      </button>
      <button v-for="t in TIERS" :key="t.key" class="agents-tier-chip"
              :class="{ active: tierFilter === t.key }" @click="tierFilter = t.key">
        <span class="agents-tier-dot" :style="{ background: t.color }"></span>
        {{ t.label }} · {{ counts[t.key] || 0 }}
      </button>
      <input v-model="search" type="text" class="agents-search"
             placeholder="Search agent name or description..." />
    </div>

    <div v-if="error" class="si-error-bar" style="display: flex">
      <span class="si-error-msg"><span class="si-error-icon">!</span><span>{{ error }}</span></span>
    </div>

    <div class="agents-layout">
      <!-- 周期表 -->
      <div class="agents-table-wrap">
        <div class="si-loading-overlay" :class="{ visible: loading }">
          <div class="si-loading-spinner"></div>
          <div>Loading agent fleet...</div>
        </div>

        <section v-for="g in groups" :key="g.role" class="agents-group">
          <h2 class="agents-group-title">{{ g.label }}</h2>
          <div v-for="row in g.rows" :key="row.stage" class="agents-row">
            <div class="agents-row-label">{{ row.label }}</div>
            <div class="agents-row-cells">
              <button
                v-for="a in row.items"
                :key="a.name"
                class="agents-cell"
                :class="{ selected: selected?.name === a.name }"
                :style="{ '--tier': TIER_COLOR[a.tier] }"
                :title="a.description"
                @click="select(a)"
              >
                <span class="agents-cell-code">{{ a.code }}</span>
                <span class="agents-cell-symbol">{{ a.symbol }}</span>
                <span class="agents-cell-name">{{ a.name }}</span>
                <span class="agents-cell-tier">{{ a.tier }}</span>
              </button>
            </div>
          </div>
        </section>

        <div v-if="!loading && visible.length === 0" class="agents-empty">
          没有匹配的 agent。
        </div>
      </div>

      <!-- Inspector -->
      <aside class="agents-inspector" :class="{ open: !!selected }">
        <template v-if="selected">
          <div class="agents-insp-head">
            <span class="agents-insp-code">{{ selected.code }} · {{ selected.symbol }}</span>
            <button class="ap-modal-close" @click="close">&times;</button>
          </div>
          <h3 class="agents-insp-title">{{ selected.name }}</h3>
          <div class="agents-insp-path">{{ selected.role }} &rsaquo; {{ selected.stage }}</div>

          <div class="agents-insp-badges">
            <span class="agents-symbol-box" :style="{ '--tier': TIER_COLOR[selected.tier] }">
              {{ selected.symbol }}
            </span>
            <span class="agents-chip" :style="{ '--tier': TIER_COLOR[selected.tier] }">
              {{ selected.tier }}
            </span>
            <span class="agents-chip agents-chip-plain">
              {{ selected.enabled ? 'ENABLED' : 'DISABLED' }}
            </span>
            <span class="agents-chip agents-chip-plain">{{ selected.origin }}</span>
            <span v-if="selected.reasoning_enabled" class="agents-chip agents-chip-plain">
              REASONING
            </span>
          </div>

          <p class="agents-insp-desc">{{ selected.description }}</p>

          <!-- 工具面（替代参考站的 THRESHOLD 条） -->
          <div class="agents-insp-section">
            <div class="agents-insp-section-title">
              TOOLS · 本地 {{ selected.localCount }} · MCP {{ selected.mcpCount }}
            </div>
            <div class="agents-tool-badges">
              <span v-for="t in selected.local_tools" :key="t.name" class="agents-tool"
                    :class="{ 'agents-tool-l2': t.level === 'L2' }"
                    :title="t.description">
                {{ t.name }}
                <span class="agents-tool-meta">{{ t.level }}<template v-if="t.needs_approval"> · 审批</template></span>
              </span>
              <span v-for="t in selected.mcp_tools" :key="t.name" class="agents-tool agents-tool-mcp"
                    :title="t.server">
                {{ t.tool }}
                <span class="agents-tool-meta">{{ t.server }}</span>
              </span>
              <span v-if="!selected.localCount && !selected.mcpCount" class="agents-tools-empty">
                <template v-if="(selected.bound_servers || []).length">
                  已绑定 MCP server 但尚无工具快照（未探测过）
                </template>
                <template v-else>无工具</template>
              </span>
            </div>
          </div>

          <div v-if="(selected.bound_servers || []).length" class="agents-insp-section">
            <div class="agents-insp-section-title">MCP SERVERS</div>
            <div class="agents-tool-badges">
              <span v-for="s in selected.bound_servers" :key="s.id" class="agents-tool agents-tool-mcp">
                {{ s.name }}<span class="agents-tool-meta">{{ s.transport }}</span>
              </span>
            </div>
          </div>

          <!-- 执行统计（B3 的 /agents/stats）；无样本时显示「暂无数据」而非 0 -->
          <div class="agents-insp-section">
            <div class="agents-insp-section-title">OPERATIONAL METRICS · 最近 50 个 run</div>
            <div class="agents-metrics-row">
              <div class="agents-metric">
                <div class="agents-metric-label">NODES RUN</div>
                <div class="agents-metric-value">{{ fmtStat(selected.stat?.runs) }}</div>
              </div>
              <div class="agents-metric">
                <div class="agents-metric-label">SUCCESS</div>
                <div class="agents-metric-value">
                  {{ selected.stat?.success_rate == null ? '暂无数据'
                     : Math.round(selected.stat.success_rate * 100) + '%' }}
                </div>
              </div>
              <div class="agents-metric">
                <div class="agents-metric-label">AVG LATENCY</div>
                <div class="agents-metric-value">{{ fmtMs(selected.stat?.avg_duration_ms) }}</div>
              </div>
              <div class="agents-metric">
                <div class="agents-metric-label">AVG TOKENS</div>
                <div class="agents-metric-value">{{ fmtStat(selected.stat?.avg_tokens) }}</div>
              </div>
            </div>
          </div>

          <!-- 详情（含完整 prompt / schema）按需加载 -->
          <div class="agents-insp-section">
            <div class="agents-insp-section-title">SYSTEM PROMPT</div>
            <div v-if="detailLoading" class="agents-tools-empty">加载中…</div>
            <pre v-else class="agents-prompt">{{ selectedDetail?.system_prompt || '—' }}</pre>
          </div>

          <div class="agents-insp-section">
            <div class="agents-insp-section-title">OUTPUT SCHEMA</div>
            <pre class="agents-prompt">{{ JSON.stringify(selectedDetail?.schema || {}, null, 2) }}</pre>
          </div>
        </template>

        <div v-else class="agents-insp-empty">
          <div class="agents-insp-empty-title">◎ AGENT INSPECTOR</div>
          <p>点击周期表上的任意格子，查看该 agent 的角色、工具面、自治 tier 与执行统计。</p>
        </div>
      </aside>
    </div>

    <!-- 底部汇总条（对齐参考站） -->
    <div class="agents-summary">
      <div v-for="t in TIERS" :key="t.key" class="agents-summary-item">
        <div class="agents-summary-value" :style="{ color: t.color }">{{ counts[t.key] || 0 }}</div>
        <div class="agents-summary-label">{{ t.label }}</div>
      </div>
      <div class="agents-summary-item">
        <div class="agents-summary-value">{{ counts.all }}</div>
        <div class="agents-summary-label">TOTAL AGENTS</div>
      </div>
    </div>
  </div>
</template>
