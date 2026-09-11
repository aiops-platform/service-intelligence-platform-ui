<!--
  外壳（双世界版）。
  DOM 结构对齐改造前的 index.html：header → .app-body（侧边栏 + main）→ footer，
  另加 #toastContainer 与 legacy 宿主。

  当前（S2）导航是直连的：点侧边栏直接调 js/app.js 暴露的 __SIP_SHOW_PAGE。
  S4 会把这里换成 Vue Router（URL 可分享/可刷新），届时 navigate 的实现替换为
  router.push，其余不动。
-->
<script setup>
import { ref, computed, provide, onMounted } from 'vue'
import { NAV, PANEL_ID, DEFAULT_SLUG, navKeyOf } from '@/router/nav'
import AppHeader from '@/components/shell/AppHeader.vue'
import AppSidebar from '@/components/shell/AppSidebar.vue'
import AppFooter from '@/components/shell/AppFooter.vue'
import LegacyPanels from '@/components/LegacyPanels.vue'

const activeKey = ref(navKeyOf(DEFAULT_SLUG) || 'service-ops')
const activeSlug = ref(DEFAULT_SLUG)
const footerPanel = ref(NAV.find((n) => n.key === activeKey.value)?.panel || '')

const activeSidebar = computed(
  () => NAV.find((n) => n.key === activeKey.value)?.sidebar ?? null,
)

// 折叠状态：改造前是纯本地状态、初始全展开（index.html 里各分组都带 expanded）
const expanded = ref(
  new Set(['knowledge-studio', 'ticket-workspace', 'ticket-workspace-svc', 'observability', 'apm', 'agent-fleet']),
)
provide('expandedGroups', {
  has: (key) => expanded.value.has(key),
  toggle: (key) => {
    const next = new Set(expanded.value)
    next.has(key) ? next.delete(key) : next.add(key)
    expanded.value = next
  },
})

/** 切到某个 slug（侧边栏叶子点击）。S4 起改为 router.push。 */
function navigate(slug) {
  const panelId = PANEL_ID[slug]
  if (!panelId) {
    console.warn('[sip] 未知 slug：', slug)
    return
  }
  activeSlug.value = slug
  activeKey.value = navKeyOf(slug) || activeKey.value
  footerPanel.value = NAV.find((n) => n.key === activeKey.value)?.panel || footerPanel.value
  window.__SIP_SHOW_PAGE?.(panelId)
}

/**
 * 点顶部域。有侧边栏的域落到它的 landing slug；
 * 5 个空壳域按改造前的 else 分支语义：落到 service-ops 概览，并把该页标题改成域名。
 */
function selectDomain(item) {
  if (item.sidebar) {
    activeKey.value = item.key
    footerPanel.value = item.panel
    navigate(item.landing)
  } else {
    activeKey.value = item.key
    footerPanel.value = item.panel
    activeSlug.value = DEFAULT_SLUG
    window.__SIP_SHOW_PAGE?.(PANEL_ID[DEFAULT_SLUG])
    // 标题/描述节点在 legacy 的 #page-service-ops 内，归 app.js 所有 → 走受控入口（接缝 S9）
    window.__SIP_SET_DOMAIN_HEADER?.(item.label, '')
  }
}

provide('navigate', navigate)

onMounted(() => {
  // 首屏对齐改造前的默认可见面板（page-service-ops 是唯一没有 display:none 的）
  window.__SIP_SHOW_PAGE?.(PANEL_ID[DEFAULT_SLUG])
})
</script>

<template>
  <AppHeader :active-key="activeKey" @select="selectDomain" />

  <div class="app-body">
    <AppSidebar :sidebar="activeSidebar" :active-slug="activeSlug" />

    <main id="main-content">
      <LegacyPanels />
    </main>
  </div>

  <AppFooter :panel="footerPanel" />

  <div class="toast-container" id="toastContainer"></div>
</template>
