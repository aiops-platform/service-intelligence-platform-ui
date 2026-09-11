<!--
  当前域对应的侧边栏。
  只渲染「激活域」的那一个，等价于改造前 hideAllSidebars() + 目标 .classList.add('visible')；
  仍带上 visible 类，因为 styles.css:242 靠 `.sidebar.visible { display:block }` 显示。
-->
<script setup>
import SidebarGroup from './SidebarGroup.vue'

defineProps({
  sidebar: { type: Object, default: null },
  activeSlug: { type: String, default: '' },
})
</script>

<template>
  <aside v-if="sidebar" class="sidebar visible" :id="sidebar.id">
    <div class="sidebar-section-title">{{ sidebar.title }}</div>
    <div class="sidebar-nav">
      <SidebarGroup
        v-for="group in sidebar.groups"
        :key="group.key"
        :group="group"
        :active-slug="activeSlug"
      />
    </div>
  </aside>
</template>
