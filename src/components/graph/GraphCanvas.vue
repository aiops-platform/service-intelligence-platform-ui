<!--
  SVG 图 Canvas 外壳（Bug Solve 用；Workflow Studio 迁移后也复用同一套）。

  **硬约束：`<svg>` 内必须是空的，一个 Vue 插值子节点都不能有。**
  图内容由引擎的 `innerHTML` 整段重写（连 `<defs>` 里的箭头 marker 一起），
  Vue 若也渲染 svg 子节点，两边会互相覆盖。

  `.bs-stage` 层由模板显式渲染（改造前是引擎动态创建 —— 那会挪动 Vue 管理的节点）。
-->
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { createGraphCanvas } from './useGraphCanvas'

const props = defineProps({
  /** 节点着色规则 (node, status) => { cls, label } */
  nodeStyle: { type: Function, default: null },
  hint: { type: String, default: '' },
})
const emit = defineEmits(['node-click'])

const zoomEl = ref(null)
const svgEl = ref(null)
const stageEl = ref(null)
const hintEl = ref(null)

let canvas = null
let unbind = null

onMounted(() => {
  canvas = createGraphCanvas({
    zoomEl: zoomEl.value,
    svgEl: svgEl.value,
    stageEl: stageEl.value,
    hintEl: hintEl.value,
    markerId: 'bsArrow',
    nodeCls: 'bs-node',
    edgeCls: 'bs-edge',
    nodeStyle: props.nodeStyle,
    onNodeClick: (nid) => emit('node-click', nid),
  })
  unbind = canvas.mount()
})

onUnmounted(() => {
  unbind?.()
  canvas = null
})

defineExpose({
  render: (graph, statusMap) => canvas?.render(graph, statusMap),
  reset: () => canvas?.reset(),
})
</script>

<template>
  <!--
    id 与原始标记保持一致（引擎虽改用 ref 取元素，但 styles.css 里存在 ID 选择器：
    `#bsZoomFit` 让 Fit 按钮变宽，区别于方形的 +/−。去掉 id 会静默丢样式。）
  -->
  <!--
    `bs-graph-fit` 是本组件专属的修饰类（`.bs-canvas` 本身与 legacy-panels 共用，
    不能直接给它加高度）。它给图区一个**受限高度**——见 css/styles.css 里的说明：
    没有它，`.bs-zoom` 会被 SVG 撑到全高，fit 恒等于 1，图看起来是被裁掉/空白。
  -->
  <div class="bs-canvas bs-graph-fit">
    <div class="bs-canvas-hint" id="bsHint" ref="hintEl">{{ hint }}</div>
    <div class="bs-zoom" id="bsZoom" ref="zoomEl">
      <!-- 舞台层：变换只施加在这里，.bs-zoom 保持不动充当视口/裁剪面（内容才会按视口居中） -->
      <div class="bs-stage" ref="stageEl">
        <!-- 空 svg：内容全部由引擎的 innerHTML 写入 -->
        <svg class="bs-graph" id="bsGraph" ref="svgEl" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
    </div>
    <!--
      ⚠️ 这里**没有**缩放控件了：图固定以 fit 模式展示（滚轮/拖拽也一并移除）。

      **但 `.bs-zoom-controls` / `.bs-zoom-btn` / `#bsZoomFit` 的样式不能从
      styles.css 删掉**——legacy 的 `js/app.js` 还在用同一套类名渲染自己的缩放条
      （`controlsCls: 'bs-zoom-controls'`，两处：pcRunZoomControls / bsZoomControls）。
      那正是本仓记录过的坑：**样式表也是类名的消费方**，从一个世界删掉会让另一个静默掉样式。

      要恢复本组件的缩放，把按钮加回来 + 重新接上引擎的监听即可（引擎侧已移除）。
    -->
  </div>
</template>
