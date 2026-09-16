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
import AlertDetailModal from '@/components/AlertDetailModal.vue'
import { openAlertDetail } from '@/composables/useAlertDetail'

// 接缝 S4：未迁移的视图（metrics-analysis）经 openAlertDetailGeneric 调到这里。
// 全文档只有一个模态实例 —— #alertDetailOverlay 已从 legacy 树移除（S1）。
window.__SIP_OPEN_ALERT_DETAIL = (apiPrefix, alert) => openAlertDetail(apiPrefix, alert)

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
 * 侧边栏收起：仅 Service Ops 域（nav.js 该域的 collapsible 字段），且默认收起。
 * 状态只活在本组件实例里 —— App 全局只挂载一次（main.js），router.push 不重挂，
 * 所以 SPA 内切页天然保留、刷新页面自然回到默认收起，不需要 localStorage。
 */
const collapsed = ref(true)

/**
 * 域判定用 navKeyOf(activeSlug) 而**不是** activeKey：后者带 `?? 'service-ops'` 兜底，
 * 会让域外路由误命中 Service Ops —— 典型是 /runs/:runId（router/index.js 的 EXTRA_ROUTES），
 * 它的 activeSlug 是字面量 `runs/<id>`，navKeyOf 返回 null，正好把把手挡在域外。
 * 而 navKeyOf 对 /service-ops 本身返回 'service-ops'（nav.js 里 DEFAULT_SLUG 的特殊分支）。
 */
const slugDomainKey = computed(() => navKeyOf(activeSlug.value))
const sidebarCollapsible = computed(
  () => !!activeSidebar.value && !!NAV.find((n) => n.key === slugDomainKey.value)?.collapsible,
)
const showSidebar = computed(
  () => !!activeSidebar.value && !(sidebarCollapsible.value && collapsed.value),
)

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
    <AppSidebar v-if="showSidebar" :sidebar="activeSidebar" :active-slug="activeSlug" />

    <!--
      Service Ops 域的折叠把手。放在这里而不是 AppSidebar 内部：收起时那个组件整个
      被卸载，把手必须留在外面才存在得了。
      用真 <button> 而非 div[role=button]：默认收起意味着键盘用户若够不到它，
      就完全没有任何路径打开该域的导航。
    -->
    <button
      v-if="sidebarCollapsible"
      type="button"
      class="sidebar-grip"
      :class="{ expanded: !collapsed }"
      :aria-expanded="String(!collapsed)"
      :aria-controls="activeSidebar.id"
      :title="collapsed ? '展开导航' : '收起导航'"
      @click="collapsed = !collapsed"
    ></button>

    <main id="main-content">
      <!-- 持久容器：只切显隐，绝不卸载（否则 app.js 的监听器与定时器会丢） -->
      <LegacyPanels v-show="isLegacyRoute" @booted="onLegacyBooted" />
      <!-- keep-alive：对应改造前"所有面板常驻 DOM、切页保留筛选状态"的行为 -->
      <RouterView v-if="!isLegacyRoute" v-slot="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>
  </div>

  <AppFooter :panel="footerPanel" />

  <AlertDetailModal />

  <div class="toast-container" id="toastContainer"></div>
</template>
