<!--
  CMDB 实体图谱的浏览与编辑（路由 `/cmdb`）。

  **不属于任何域**：入口在头部右上的用户菜单里（点姓名 → 编辑 CMDB）。
  它是一张给少数人用的运维工具表，不是产品叙事的一部分——放进某个域会让它出现在
  演示动线的导航里。见 router/index.js 的 EXTRA_ROUTES。

  CMDB 的载体是 **aiops-datasource-mcp-server 的实体文件**
  （`data/cmdb-entities.json`），不是 agentflow、也不是 sip-aiops。这一页通过那台服务的
  `/admin/cmdb/**` 端点读写它（dev proxy 把 `/api/cmdb` rewrite 过去）。

  ## 三条决定了这个界面长什么样的后端事实

  1. **写前整份过校验，不过就整个不生效。** 合法性依赖整张图（边端点是否存在、端点类型
     是否被允许、id 前缀是否与 type 一致、tags 是否在封闭词表内），不是单条记录能判的。
     所以前端**不复刻**校验规则，而是把后端的原话显示出来——见 useCmdb.js 的文件头。
  2. **`id` / `type` 不可改**（改了就是另一个节点），后端明确拒绝，界面也就只读。
  3. **删节点默认拒绝被引用的节点**（409 并列出挡路的边）。所以这里把"相关边"直接摆在
     表单旁边——用户删之前就该看见有什么连着它。

  ## 节点分两类来源，表单因此不是一张

  `attributes.source` 是判别字段：`kubernetes`（运行时目录，6 个字段必填）与
  `otr-inventory`（业务盘点，运行时字段**本来就是 null**，因为那份数据里根本没有）。
  表单字段完全由后端的 `attribute_models` 生成，没登记模型的类型退回自由 JSON 编辑。
-->
<script setup>
import { onMounted, onActivated } from 'vue'
import { useCmdb } from './useCmdb'

const {
  loading, saving, error, notice,
  schema, summary, activeType, search, selectedId, selected, draft, relatedEdges, attrFields,
  listNodes, visibleTypes, creating, newDraft,
  linking, edgeDraft, edgeOptions, currentEdgeOption, candidateTargets,
  load, select, save, remove, create, syncAttributesText,
  createEdge, removeEdge,
} = useCmdb()

onMounted(load)
onActivated(load)

/** 删除前确认。文案里带上关联边数量——那正是后端会用来拒绝的理由。 */
function confirmRemove() {
  const n = relatedEdges.value.length
  const ask = n
    ? `删除 ${selected.value.id}？\n\n它还被 ${n} 条边引用。确定后会连同这些边一起删除，且不可撤销。`
    : `删除 ${selected.value.id}？此操作不可撤销。`
  if (window.confirm(ask)) remove({ cascade: n > 0 })
}

function tagsText(node) {
  return (node.tags || []).join(' ')
}
</script>

<template>
  <div id="page-cmdb" class="page-panel" style="display: block">
    <div class="flex justify-between items-center page-header">
      <div>
        <h1 class="page-title">CMDB 实体图谱</h1>
        <p class="page-desc">
          <template v-if="summary">
            {{ summary.node_count }} 个节点 · {{ summary.edge_count }} 条边 ·
            schema {{ summary.schema_version }} ·
            <span class="cmdb-path">{{ summary.path }}</span>
          </template>
          <template v-else>正在载入…</template>
        </p>
      </div>
      <button class="cmdb-btn" :disabled="loading" @click="load()">
        {{ loading ? '载入中…' : '刷新' }}
      </button>
    </div>

    <!-- 后端拒绝的原话直接显示——4xx 不是"网络抽风"，是这次编辑真的没生效 -->
    <div v-if="error" class="cmdb-banner cmdb-banner-error">
      <div class="cmdb-banner-title">改动未生效</div>
      <pre class="cmdb-banner-body">{{ error }}</pre>
    </div>
    <div v-if="notice" class="cmdb-banner cmdb-banner-ok">{{ notice }}</div>

    <div class="cmdb-body">
      <!-- 左：类型 + 清单 -->
      <aside class="cmdb-list">
        <div class="cmdb-types">
          <button
            v-for="t in visibleTypes" :key="t.key"
            class="cmdb-type-chip" :class="{ active: activeType === t.key }"
            @click="activeType = t.key; select(null)"
          >
            {{ t.label_zh }} <span class="cmdb-type-count">{{ t.count }}</span>
          </button>
        </div>

        <input v-model="search" class="cmdb-input" placeholder="搜 id / 名称 / 关键词…" />

        <button class="cmdb-btn cmdb-btn-wide" @click="creating = true">
          + 新增{{ (schema?.node_types || []).find((t) => t.key === activeType)?.label_zh || '节点' }}
        </button>

        <div class="cmdb-nodes">
          <button
            v-for="n in listNodes" :key="n.id"
            class="cmdb-node" :class="{ active: n.id === selectedId }"
            @click="select(n)"
          >
            <span class="cmdb-node-name">{{ n.display_name || n.name }}</span>
            <span class="cmdb-node-id">{{ n.id }}</span>
            <span v-if="n.tags && n.tags.length" class="cmdb-node-tags">{{ tagsText(n) }}</span>
          </button>
          <div v-if="!listNodes.length" class="cmdb-empty">该类型下没有节点</div>
        </div>
      </aside>

      <!-- 右：Inspector -->
      <section class="cmdb-inspector">
        <!-- 新增表单 -->
        <template v-if="creating">
          <div class="cmdb-insp-title">新增节点</div>
          <label class="cmdb-field">
            <span class="cmdb-label">type <b class="cmdb-req">必填</b></span>
            <select v-model="newDraft.type" class="cmdb-input">
              <option value="">— 选择类型 —</option>
              <option v-for="t in schema?.node_types || []" :key="t.key" :value="t.key">
                {{ t.key }} · {{ t.label_zh }}
              </option>
            </select>
          </label>
          <label class="cmdb-field">
            <span class="cmdb-label">name <b class="cmdb-req">必填</b></span>
            <input v-model="newDraft.name" class="cmdb-input" placeholder="kebab-case，如 parts-forecast" />
            <span class="cmdb-hint">
              id 会是 <code>{{ newDraft.type || 'type' }}:{{ newDraft.name || 'name' }}</code>
              —— 前缀必须与 type 一致，后端会校验
            </span>
          </label>
          <label class="cmdb-field">
            <span class="cmdb-label">显示名</span>
            <input v-model="newDraft.display_name" class="cmdb-input" />
          </label>
          <label class="cmdb-field">
            <span class="cmdb-label">描述</span>
            <input v-model="newDraft.description" class="cmdb-input" />
          </label>
          <label class="cmdb-field">
            <span class="cmdb-label">关键词</span>
            <input v-model="newDraft.keywordsText" class="cmdb-input" placeholder="顿号或逗号分隔" />
            <span class="cmdb-hint">
              attributes 建完后再填：不同类型的属性形状不同，后端会按类型校验
            </span>
          </label>
          <div class="cmdb-actions">
            <button class="cmdb-btn cmdb-btn-primary" :disabled="saving || !newDraft.type || !newDraft.name" @click="create">
              创建
            </button>
            <button class="cmdb-btn" @click="creating = false; newDraft.type = ''; newDraft.name = ''">取消</button>
          </div>
        </template>

        <!-- 编辑表单 -->
        <template v-else-if="draft">
          <div class="cmdb-insp-title">
            {{ draft.display_name || draft.name }}
            <span class="cmdb-insp-id">{{ draft.id }}</span>
          </div>

          <label class="cmdb-field">
            <span class="cmdb-label">id / type <b class="cmdb-ro">只读</b></span>
            <input class="cmdb-input" :value="`${draft.type}:${draft.name}`" readonly />
            <span class="cmdb-hint">它们是节点的身份与分桶依据；要换就删了重建</span>
          </label>

          <label class="cmdb-field">
            <span class="cmdb-label">显示名</span>
            <input v-model="draft.display_name" class="cmdb-input" />
          </label>

          <label class="cmdb-field">
            <span class="cmdb-label">描述</span>
            <textarea v-model="draft.description" class="cmdb-input" rows="2"></textarea>
          </label>

          <label class="cmdb-field">
            <span class="cmdb-label">关键词</span>
            <input v-model="draft.keywordsText" class="cmdb-input" placeholder="顿号或逗号分隔" />
            <span class="cmdb-hint">
              业务层按「用户会怎么描述它出问题」写（「退货」「打不出单」），
              不要写「XX 业务域选择」这种没人会说的词
            </span>
          </label>

          <div class="cmdb-field">
            <span class="cmdb-label">标签 <b class="cmdb-ro">封闭词表</b></span>
            <div class="cmdb-tags">
              <label v-for="a in schema?.key_attributes || []" :key="a.key" class="cmdb-tag">
                <input type="checkbox" :value="a.key" v-model="draft.tags" />
                {{ a.label_zh }}
              </label>
            </div>
            <span class="cmdb-hint">
              只能取本体声明的静态标签；带时间窗口的派生指标会被后端硬拒
            </span>
          </div>

          <!-- attributes：有登记模型的按 schema 生成表单 -->
          <div class="cmdb-field">
            <span class="cmdb-label">attributes</span>

            <template v-if="attrFields">
              <div class="cmdb-attrs">
                <label v-for="f in attrFields" :key="f.key" class="cmdb-attr">
                  <span class="cmdb-attr-key">
                    {{ f.key }}
                    <b v-if="f.required" class="cmdb-req">必填</b>
                    <b v-else-if="f.nullable" class="cmdb-ro">可空</b>
                  </span>

                  <select v-if="f.enum" v-model="draft.attributes[f.key]" class="cmdb-input">
                    <option :value="null">— null —</option>
                    <option v-for="v in f.enum" :key="v" :value="v">{{ v }}</option>
                  </select>

                  <select v-else-if="f.type === 'boolean'" v-model="draft.attributes[f.key]" class="cmdb-input">
                    <option :value="null">— null —</option>
                    <option :value="true">true</option>
                    <option :value="false">false</option>
                  </select>

                  <input
                    v-else-if="f.type === 'integer' || f.type === 'number'"
                    class="cmdb-input" type="number"
                    :value="draft.attributes[f.key]"
                    @input="draft.attributes[f.key] = $event.target.value === '' ? null : Number($event.target.value)"
                  />

                  <input
                    v-else
                    class="cmdb-input"
                    :value="draft.attributes[f.key]"
                    @input="draft.attributes[f.key] = $event.target.value === '' ? null : $event.target.value"
                  />
                </label>
              </div>
              <span class="cmdb-hint">
                字段由该类型的后端模型生成。标「必填」的留空会被拒绝——例如
                <code>source=kubernetes</code> 的 app 必须有 namespace / owner / tier 等 6 个字段
              </span>
            </template>

            <!-- 没登记模型的类型：开放 KV，退回 JSON -->
            <template v-else>
              <textarea
                v-model="draft.attributesText" class="cmdb-input cmdb-json" rows="6"
                @blur="syncAttributesText"
              ></textarea>
              <span class="cmdb-hint">
                该类型的 attributes 未登记模型（开放结构），按 JSON 编辑，后端仍会校验合法性
              </span>
            </template>
          </div>

          <label class="cmdb-field">
            <span class="cmdb-label">备注</span>
            <textarea v-model="draft.notes" class="cmdb-input" rows="2"></textarea>
          </label>

          <div class="cmdb-actions">
            <button class="cmdb-btn cmdb-btn-primary" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </button>
            <button class="cmdb-btn" @click="select(null)">取消</button>
            <button class="cmdb-btn cmdb-btn-danger" :disabled="saving" @click="confirmRemove">
              删除
            </button>
          </div>

          <!-- 相关边：删节点前就该看见有什么连着它 -->
          <div class="cmdb-field">
            <span class="cmdb-label">相关边 · {{ relatedEdges.length }}</span>
            <div v-if="relatedEdges.length" class="cmdb-edges">
              <div v-for="e in relatedEdges" :key="e.id" class="cmdb-edge">
                <span class="cmdb-edge-type">{{ e.type }}</span>
                <span class="cmdb-edge-end" :class="{ self: e.from === selectedId }">{{ e.from }}</span>
                <span class="cmdb-edge-arrow">→</span>
                <span class="cmdb-edge-end" :class="{ self: e.to === selectedId }">{{ e.to }}</span>
                <button
                  class="cmdb-edge-del" :disabled="saving"
                  :title="`删除边 ${e.id}`" @click="removeEdge(e.id)"
                >×</button>
              </div>
            </div>
            <div v-else class="cmdb-empty">没有边引用它 —— 可以直接删除</div>

            <!-- 建边：以当前节点为一端 -->
            <div class="cmdb-link">
              <button v-if="!linking" class="cmdb-btn cmdb-btn-wide" @click="linking = true">
                + 新建边（从本节点出发）
              </button>

              <template v-else>
                <label class="cmdb-field">
                  <span class="cmdb-label">边类型</span>
                  <select v-model="edgeDraft.key" class="cmdb-input" @change="edgeDraft.targetId = ''">
                    <option value="">— 选择边类型 —</option>
                    <option v-for="o in edgeOptions" :key="o.key" :value="o.key">
                      {{ o.label }}（{{ o.key }}{{ o.directed ? '，有向' : '，无向' }}）
                    </option>
                  </select>
                  <span v-if="currentEdgeOption" class="cmdb-hint">
                    {{ currentEdgeOption.role === 'to'
                      ? `方向是「对方 → 本节点」——本节点是这条边的终点`
                      : `方向是「本节点 → 对方」` }}；
                    另一端只能是 <code>{{ currentEdgeOption.targetTypes.join(' / ') }}</code>
                  </span>
                </label>

                <label v-if="currentEdgeOption" class="cmdb-field">
                  <span class="cmdb-label">
                    另一端 · {{ candidateTargets.length }} 个候选
                  </span>
                  <select v-model="edgeDraft.targetId" class="cmdb-input">
                    <option value="">— 选择节点 —</option>
                    <option v-for="n in candidateTargets" :key="n.id" :value="n.id">
                      {{ n.display_name || n.name }} · {{ n.id }}
                    </option>
                  </select>
                  <span class="cmdb-hint">
                    候选已按边类型允许的端点类型过滤，选不出非法组合；最终仍由后端校验
                  </span>
                </label>

                <div class="cmdb-actions">
                  <button
                    class="cmdb-btn cmdb-btn-primary"
                    :disabled="saving || !edgeDraft.key || !edgeDraft.targetId"
                    @click="createEdge"
                  >建立</button>
                  <button class="cmdb-btn" @click="linking = false; edgeDraft.key = ''; edgeDraft.targetId = ''">
                    取消
                  </button>
                </div>
              </template>
            </div>
          </div>
        </template>

        <div v-else class="cmdb-insp-empty">
          <div class="cmdb-insp-empty-title">◎ CMDB</div>
          <p>从左侧选一个节点查看并编辑，或新增一个。</p>
          <p class="cmdb-hint">
            本页写的是 aiops-datasource-mcp-server 的实体文件；保存后
            <code>get_service_topology</code> / <code>infer_candidate_services</code>
            等工具**下一次调用**即生效，无需重启。
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
