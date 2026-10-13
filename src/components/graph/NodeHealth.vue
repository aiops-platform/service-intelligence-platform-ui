<!--
  节点的**执行告警**（Run Detail 与 Bug Solve 共用）。

  ## 为什么单开一个组件，而不是塞进 `NodePayload`

  `NodePayload` 是**通用递归渲染器**，而且被审批卡的上游载荷共用（那些载荷里没有
  `_health`）。往它里面加健康度分支，等于让一个通用组件认识一种业务字段；
  审批卡那边还会渲染出一个空块。所以这里单开，由两个视图各自挂在字段列表**上方**。

  ## 为什么要挂在最上面

  `_health` 本来就在节点的 `output` 里，`NodePayload` 一直在渲染它 —— 问题是它
  混在几十个业务字段中间，实测一个上千字的摘要把其余字段全顶出屏幕，
  读的人以为这个节点只收到一个输入。**错误信息"在页面上"和"看得见"是两回事。**

  ## 两档

  - **红（`unmet` 非空）**：承诺的交付**没做成** —— 那个工具被调用过，却从未成功。
    属于"报错"那一级。此时节点实际上是 `failed`。
  - **琥珀（只有 `failed`）**：有工具调用出错，但 agent 的目标达成了。属于"警告"那一级。
    节点是 `done` —— 这正是原先在图上一片绿、与"一切正常"分不开的那种。

  判据不在这里：本组件只呈现，状态由 `@/utils/runStatus` 统一派生（见那里的说明）。
-->

<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** 已归一化的健康度（`normalizeHealth` 的产物，见 `@/utils/runStatus`） */
  health: { type: Object, required: true },
  /** 节点的展示状态 —— 只用来把标题写得准确，不参与判档 */
  status: { type: String, default: '' },
})

/** 交付未做成 → 红档。这是"没干成"，不是"有瑕疵"。 */
const critical = computed(() => props.health.unmet.length > 0)

const title = computed(() => {
  const h = props.health
  if (critical.value) {
    return `交付未发生（${h.unmet.join('、')} 被调用过，却从未成功）`
  }
  return `执行告警：${h.warnings.length} 个工具调用失败`
})
</script>

<template>
  <div class="bs-health" :class="critical ? 'bs-health-critical' : 'bs-health-warn'">
    <div class="bs-health-title">
      {{ title }}
      <template v-if="props.health.truncated">
        （另有 {{ props.health.truncated }} 条未列出）
      </template>
    </div>
    <!-- 逐条列出：工具名 + 分级 + 原始错误。**错误原文不折叠** —— 用户的诉求就是
         "要能看到错误信息"，而多行 git 报错靠 pre-wrap 保留换行才读得动。 -->
    <div v-for="(w, i) in props.health.warnings" :key="i" class="bs-health-item">
      <span class="bs-health-tool">{{ w.tool }} · {{ w.impact || '—' }} · {{ w.state || 'error' }}</span>
      <div v-if="w.error" class="bs-health-err">{{ w.error }}</div>
    </div>
  </div>
</template>
