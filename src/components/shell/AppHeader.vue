<!--
  顶部 9 个域导航。class / data-* / 内联 style 逐字对齐改造前的 index.html:11-38，
  以便继续复用 styles.css（.nav-item / .nav-dot / .nav-links / .header-right 等）。

  右上角的**用户菜单**（点姓名展开）是后来加的，改造前没有对应 DOM —— 那个位置
  原本只是一个静态的 `.status-pill`。它承载不属于任何域的运维工具入口，
  目前只有 CMDB 编辑页（见 router/index.js 的 EXTRA_ROUTES）。
-->
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAV } from '@/router/nav'

defineProps({
  /** 当前激活域的 key */
  activeKey: { type: String, default: '' },
})

const emit = defineEmits(['select'])

const route = useRoute()
const router = useRouter()

const menuOpen = ref(false)
const menuRoot = ref(null)

/**
 * 菜单项。放数组而不是直接写死在模板里：加第二项时改这里就够，
 * 点击外部关闭 / Esc / 收起时机那套不用跟着动。
 */
const MENU = [
  { key: 'cmdb', label: '编辑 CMDB', hint: '实体图谱的节点与边', to: '/cmdb' },
]

function go(item) {
  menuOpen.value = false
  router.push(item.to)
}

/**
 * 点菜单外任意处关闭。
 *
 * 挂 document 而不是用 `@blur`：点的是"外面"，事件不可能从菜单内部捕获。
 * 用 `click` 而非 `mousedown`，这样拖选文字到菜单外不会误关。
 */
function onDocClick(e) {
  if (!menuOpen.value) return
  if (menuRoot.value && !menuRoot.value.contains(e.target)) menuOpen.value = false
}

function onKeydown(e) {
  if (e.key !== 'Escape' || !menuOpen.value) return
  menuOpen.value = false
  // 焦点还给触发按钮——菜单消失了而焦点悬在 body 上，键盘用户会失去位置
  menuRoot.value?.querySelector('.user-menu-trigger')?.focus()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})

/** 路由一变就收掉菜单——否则从菜单跳走后，它会挂在目标页面上 */
watch(() => route.fullPath, () => { menuOpen.value = false })
</script>

<template>
  <header class="flex items-center">
    <div class="brand-group">
      <span class="accenture-brand">
        <span class="accenture-chevron">&gt;</span>
        <span class="accenture-name">accenture</span>
      </span>
      <a class="sip-wordmark" href="#" aria-label="Home" @click.prevent="emit('select', NAV[2])">
        <span class="sip-logo">SIP</span>
        <span class="sip-tagline">Service Intelligence Platform</span>
      </a>
    </div>

    <nav class="nav-links">
      <a
        v-for="item in NAV"
        :key="item.key"
        href="#"
        class="nav-item"
        :class="{ active: item.key === activeKey }"
        :data-panel="item.panel"
        :title="item.title || undefined"
        @click.prevent="emit('select', item)"
      >
        <span class="nav-dot" :style="{ background: item.dot }"></span>{{ item.label }}
      </a>
    </nav>

    <div class="header-right">
      <div ref="menuRoot" class="user-menu">
        <button
          type="button"
          class="status-pill user-menu-trigger"
          :class="{ open: menuOpen }"
          :aria-expanded="String(menuOpen)"
          aria-haspopup="menu"
          @click="menuOpen = !menuOpen"
        >
          <span class="live-dot"></span> san.zhang
          <span class="user-menu-caret" aria-hidden="true">▾</span>
        </button>

        <div v-if="menuOpen" class="user-menu-list" role="menu">
          <button
            v-for="item in MENU"
            :key="item.key"
            type="button"
            role="menuitem"
            class="user-menu-item"
            :class="{ active: route.path === item.to }"
            @click="go(item)"
          >
            <span class="user-menu-item-label">{{ item.label }}</span>
            <span class="user-menu-item-hint">{{ item.hint }}</span>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
