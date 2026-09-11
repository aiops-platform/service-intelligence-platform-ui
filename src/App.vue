<!--
  外壳（双世界版，路由驱动）。
  DOM 结构对齐改造前的 index.html：header → .app-body（侧边栏 + main）→ footer，
  另加 #toastContainer 与 legacy 宿主。

  所有权：已迁移的视图归 Vue（走 <RouterView>）；其余 15 个仍归 js/app.js，
  DOM 在持久存在的 LegacyPanels 里，只切显隐、绝不卸载。
-->
<script setup>
import { ref, computed, provide, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAV, PANEL_ID, DEFAULT_SLUG, navKeyOf, resolveSlug } from '@/router/nav'
import AppHeader from '@/components/shell/AppHeader.vue'
import AppSidebar from '@/components/shell/AppSidebar.vue'
import AppFooter from '@/components/shell/AppFooter.vue'
import LegacyPanels from '@/components/LegacyPanels.vue'

const route = useRoute()
const router = useRouter()

/** 当前 slug 完全由 URL 决定（可分享、可刷新、可前进后退） */
const activeSlug = computed(() => resolveSlug(route.path.slice(1)) || DEFAULT_SLUG)

/**
 * 高亮域同样由路由派生：空壳域（/constellation 等）带 meta.domainKey，
 * 其余由 slug 反查所属域。**不存组件内覆盖状态** —— 那会与 URL 形成两套真源。
 */
const activeKey = computed(
  () => route.meta.domainKey ?? navKeyOf(activeSlug.value) ?? 'service-ops',
)
const activeSidebar = computed(() => NAV.find((n) => n.key === activeKey.value)?.sidebar ?? null)
const footerPanel = computed(() => NAV.find((n) => n.key === activeKey.value)?.panel || '')
const isLegacyRoute = computed(() => route.meta.legacy !== false)

/**
 * 空壳域会把 service-ops 概览页的标题改成域名（接缝 S9）。
 * 那三个节点归 legacy 所有，这里只负责在路由变化时驱动它，并在离开空壳域时**还原**，
 * 否则标题会一直停在最后一次点过的域名上。
 */
const originalHeader = ref(null)

function syncDomainHeader() {
  const dk = route.meta.domainKey
  if (dk) {
    const domain = NAV.find((n) => n.key === dk)
    window.__SIP_SET_DOMAIN_HEADER?.(domain?.label || '', '')
    return
  }
  if (route.meta.panelId === PANEL_ID[DEFAULT_SLUG] && originalHeader.value) {
    window.__SIP_SET_DOMAIN_HEADER?.(originalHeader.value.title, originalHeader.value.desc)
  }
}

/** 首次进入 service-ops 时把原始标题/描述留底（此后可能被空壳域改写） */
function captureOriginalHeader() {
  if (originalHeader.value) return
  const t = document.querySelector('#sip-legacy-host #page-service-ops .page-title')
  const d = document.querySelector('#sip-legacy-host #page-service-ops .page-desc')
  if (t) originalHeader.value = { title: t.textContent, desc: d ? d.textContent : '' }
}

watch(() => route.fullPath, syncDomainHeader)

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

/** 切到某个 slug（侧边栏叶子点击） */
function navigate(slug) {
  if (!PANEL_ID[slug]) {
    console.warn('[sip] 未知 slug：', slug)
    return
  }
  router.push(`/${slug}`)
}
provide('navigate', navigate)

/**
 * 点顶部域。有侧边栏的域落到它的 landing；
 * 5 个空壳域按改造前 initNavigation 的 else 分支语义：落到 service-ops 概览，
 * 并把该页标题改成域名（经接缝 S9，因为那两个节点归 legacy 所有）。
 */
function selectDomain(item) {
  // 有侧边栏的域落到它的 landing；空壳域走自己的路由（meta.domainKey 驱动高亮与标题）
  router.push(item.sidebar ? `/${item.landing}` : `/${item.key}`)
}

/** legacy 装载完成后留底 service-ops 的原始标题（此后可能被空壳域改写） */
function onLegacyBooted() {
  captureOriginalHeader()
  syncDomainHeader()
}
</script>

<template>
  <AppHeader :active-key="activeKey" @select="selectDomain" />

  <div class="app-body">
    <AppSidebar :sidebar="activeSidebar" :active-slug="activeSlug" />

    <main id="main-content">
      <!-- 持久容器：只切显隐，绝不卸载（否则 app.js 的监听器与定时器会丢） -->
      <LegacyPanels v-show="isLegacyRoute" @booted="onLegacyBooted" />
      <RouterView v-if="!isLegacyRoute" />
    </main>
  </div>

  <AppFooter :panel="footerPanel" />

  <div class="toast-container" id="toastContainer"></div>
</template>
