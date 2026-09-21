<!--
  节点入参 / 输出的**按字段展示**（Run Detail 与 Bug Solve 共用）。

  ## 为什么不能直接 `<pre>{{ JSON.stringify(x, null, 2) }}</pre>`

  因为那样**等于没展示**。实测（run_d8f3a5c560 的 rca 节点）：

      {
        "code": "目标服务来源：target_service 为空，目标 order-service 取自入参 log_services…（上千字）",
        "logs": "…", "trace": "…", "metrics": "…", "infra": "…", "know": "…", …
      }

  `rca` 声明了 **9 个入参**，落库的 9 个也都在（后端没问题），但 `code` 一个值就占满
  整个面板，其余 8 个被顶到几百像素之外 —— 读的人以为**这个节点只收到一个输入**。
  这不是排版瑕疵，是**误导**。

  所以两件事一起做：
  1. **一行一字段**（键在左、值在右），不再是一个 JSON 大块；
  2. **长值默认折叠**（见 `LONG_CHARS` / `LONG_LINES`），点「展开」再看全文。
     光做 ① 不够：一行一字段之后，那个上千字的值依然占满屏幕，其余字段照样看不见。

  ## 递归

  对象套对象、数组里装对象都很常见（`notable[]` / `suspicious_files[]`）。
  组件**引用自身**（`NodePayload` 在模板里用自己），不自己实现一套遍历 ——
  每层都复用同一套「一行一字段 + 折叠」的规则。

  ## 空值

  `null` / `undefined` 显示 `—`（灰），空数组/空对象显示「（空）」。
  **不显示成空字符串**：那分不清"没有这个字段"与"字段是空串"。
-->

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  /**
   * 要展示的对象。**传对象本身，不要传 JSON 字符串** ——
   * 组件要按字段拆开，字符串进来就只剩"再解析一次"这一条路（那正是要摆脱的写法）。
   */
  value: { type: [Object, Array], default: null },
  /** 递归深度（自增），用于缩进与数组项编号 */
  depth: { type: Number, default: 0 },
  /** 数组项 / 子块的小标题，如 `#1` */
  label: { type: String, default: '' },
})

/** 超过这个字符数的字符串默认折叠 */
const LONG_CHARS = 200
/** 超过这个行数的字符串默认折叠 */
const LONG_LINES = 4

/** 本组件实例内已展开的键（按 key 记，递归时每层各有各的实例） */
const expanded = ref(new Set())
function toggle(k) {
  const s = new Set(expanded.value)
  s.has(k) ? s.delete(k) : s.add(k)
  expanded.value = s
}

/**
 * `[{ k, v }, …]`，**不是** `Object.entries` 的裸数组。
 *
 * ⚠️ 直接 `v-for="(v, k) in Object.entries(obj)"` 是错的（第一版就这么写的）：
 * Vue 对**数组**的 `v-for` 把第二个参数当**下标**，于是 `k` 渲染成 `0/1/2…`、
 * `v` 拿到的是 `[key, value]` 整对 —— 页面上 9 行都在、看着挺像回事，
 * 但键名列全是数字、值列把"键名+值"当数组又展开了一遍。
 * 实测靠 CDP 打印 DOM 才发现（肉眼看只是"有点怪"）。
 */
const entries = computed(() =>
  Object.entries(props.value || {}).map(([k, v]) => ({ k, v })),
)

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** 值 → 展示文本。`null` 单独走样式，这里只处理能直接显示成一行文本的。 */
function fmt(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  return String(v)
}

function isEmpty(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/** 长文本才给折叠开关 —— 短值加个开关只是噪音 */
function isLong(v) {
  return typeof v === 'string' && (v.length > LONG_CHARS || v.split('\n').length > LONG_LINES)
}
</script>

<template>
  <div class="bs-payload" :class="{ 'bs-payload-nested': depth > 0 }">
    <div v-if="label" class="bs-payload-label">{{ label }}</div>

    <div v-for="e in entries" :key="e.k" class="bs-payload-row">
      <div class="bs-payload-key" :title="String(e.k)">{{ e.k }}</div>
      <div class="bs-payload-val">
        <!-- 对象 → 递归 -->
        <NodePayload v-if="isObject(e.v)" :value="e.v" :depth="depth + 1" />

        <!-- 数组 -->
        <div v-else-if="Array.isArray(e.v)" class="bs-payload-arr">
          <div v-if="!e.v.length" class="bs-payload-empty">（空）</div>
          <div v-for="(it, i) in e.v" :key="i" class="bs-payload-item">
            <NodePayload v-if="isObject(it)" :value="it" :depth="depth + 1" :label="`#${i + 1}`" />
            <!-- 数组里的长字符串同样折叠：`notable[].error_message` 就是这种 -->
            <template v-else-if="isLong(it)">
              <div class="bs-payload-text bs-payload-clamp"
                   :class="{ open: expanded.has(`${e.k}[${i}]`) }">{{ it }}</div>
              <button type="button" class="bs-payload-toggle"
                      @click="toggle(`${e.k}[${i}]`)">
                {{ expanded.has(`${e.k}[${i}]`) ? '收起' : `展开（${it.length} 字符）` }}
              </button>
            </template>
            <span v-else class="bs-payload-text">{{ fmt(it) }}</span>
          </div>
        </div>

        <!-- 长文本：默认折叠，点开看全文 -->
        <template v-else-if="isLong(e.v)">
          <div class="bs-payload-text bs-payload-clamp" :class="{ open: expanded.has(e.k) }">
            {{ e.v }}
          </div>
          <button type="button" class="bs-payload-toggle" @click="toggle(e.k)">
            {{ expanded.has(e.k) ? '收起' : `展开（${e.v.length} 字符）` }}
          </button>
        </template>

        <!-- 普通标量 -->
        <span v-else class="bs-payload-text" :class="{ 'bs-payload-empty': isEmpty(e.v) }">
          {{ fmt(e.v) }}
        </span>
      </div>
    </div>

    <div v-if="!entries.length && depth > 0" class="bs-payload-empty">（空）</div>
  </div>
</template>
