<!--
  侧边栏的一个可折叠分组。class 与 DOM 结构逐字对齐改造前的 index.html，
  折叠语义也保持一致：点分组标题切换自身的 .expanded 与子容器的 .collapsed
  （styles.css:326/331 依赖这两个类，不改样式表）。
  只有 Service Ops 域存在嵌套（APM › Smart Inspection），故支持递归。

  **可导航的分组头**：分组带 `slug` 时（目前只有 Smart Inspection），它同时是一个
  叶子 —— 点标签进页面、点左侧箭头展开/收起。这样「Smart Inspection 底下挂着三个
  子页面」与「它自己还是个能点进去的页面」可以并存。

  点击分区是必要的，不是口味问题：整行都导航就没法收起子项，整行都只展开就丢了页面
  （那个页面有两条应用内入口，见 nav.js 该分组上的注释）。没有 slug 的分组保持改造前
  的行为 —— 整行点击都是展开/收起。
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
/** 分组头自己是不是一个页面（见文件头注释） */
const isPage = computed(() => !!props.group.slug)
const isActive = computed(() => isPage.value && props.group.slug === props.activeSlug)

/**
 * 箭头：只做展开/收起。
 * `@click.stop` 是**必需的** —— 不然这一下会继续冒泡到下面那个整行处理器，
 * 点箭头就变成「又展开又跳页」。
 */
function toggle() {
  expandedGroups.toggle(props.group.key)
}

/** 整行点击：是页面就导航，否则仍是展开/收起（改造前的唯一语义） */
function onHeaderClick() {
  isPage.value ? navigate(props.group.slug) : toggle()
}
</script>

<template>
  <div
    class="sidebar-item has-children"
    :class="{ expanded: isExpanded, active: isActive }"
    :data-toggle="group.key"
    @click.stop="onHeaderClick"
  >
    <span class="sidebar-arrow" @click.stop="toggle"></span>
    <span class="sidebar-label">{{ group.label }}</span>
  </div>
  <div class="sidebar-children" :id="group.key" :class="{ collapsed: !isExpanded }">
    <div
      v-for="item in group.items || []"
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
