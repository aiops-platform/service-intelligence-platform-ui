<!--
  侧边栏的一个可折叠分组。class 与 DOM 结构逐字对齐改造前的 index.html，
  折叠语义也保持一致：点分组标题切换自身的 .expanded 与子容器的 .collapsed
  （styles.css:326/331 依赖这两个类，不改样式表）。
  只有 Service Ops 域存在一层嵌套（Observability › APM），故支持递归。
-->
<script setup>
import { inject, computed } from 'vue'

const props = defineProps({
  group: { type: Object, required: true },
  /** 当前激活的 slug，用于给叶子加 .active（改造前由点击时手工维护） */
  activeSlug: { type: String, default: '' },
})

const expandedGroups = inject('expandedGroups')
const navigate = inject('navigate')

const isExpanded = computed(() => expandedGroups.has(props.group.key))
</script>

<template>
  <div
    class="sidebar-item has-children"
    :class="{ expanded: isExpanded }"
    :data-toggle="group.key"
    @click.stop="expandedGroups.toggle(group.key)"
  >
    <span class="sidebar-arrow"></span>
    <span class="sidebar-label">{{ group.label }}</span>
  </div>
  <div class="sidebar-children" :id="group.key" :class="{ collapsed: !isExpanded }">
    <div
      v-for="item in group.items"
      :key="item.slug"
      class="sidebar-item"
      :class="{ active: item.slug === activeSlug }"
      :data-page="item.slug"
      @click="navigate(item.slug)"
    >
      <span class="sidebar-label">{{ item.label }}</span>
    </div>

    <SidebarGroup
      v-for="sub in group.groups || []"
      :key="sub.key"
      :group="sub"
      :active-slug="activeSlug"
    />
  </div>
</template>
