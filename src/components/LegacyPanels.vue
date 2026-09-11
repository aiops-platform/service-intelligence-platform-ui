<!--
  未迁移的 15 个视图 + 12 个共享模态的宿主。

  v-html 绑定的是**冻结常量**（legacyPanelsHtml），不是 ref/computed —— 这是硬约束：
  一旦 Vue 重渲染这棵子树，js/app.js 绑好的监听器与它渲染的内容会全部被冲掉。
  装载完成后这棵子树完全归 js/app.js 所有，Vue 只负责注入一次。

  ensureLegacyBooted() 幂等，见 src/legacy/bridge.js。
-->
<script setup>
import { onMounted } from 'vue'
import { legacyPanelsHtml, ensureLegacyBooted } from '@/legacy/bridge'

const emit = defineEmits(['booted'])

onMounted(async () => {
  try {
    await ensureLegacyBooted()
    emit('booted')
  } catch (err) {
    console.error('[sip] 旧世界装载失败：', err)
  }
})
</script>

<template>
  <div id="sip-legacy-host" v-html="legacyPanelsHtml"></div>
</template>
