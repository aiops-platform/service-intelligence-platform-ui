<!--
  顶部 9 个域导航。class / data-* / 内联 style 逐字对齐改造前的 index.html:11-38，
  以便继续复用 styles.css（.nav-item / .nav-dot / .nav-links / .header-right 等）。
-->
<script setup>
import { NAV } from '@/router/nav'

defineProps({
  /** 当前激活域的 key */
  activeKey: { type: String, default: '' },
})

const emit = defineEmits(['select'])
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
      <div class="status-pill"><span class="live-dot"></span> san.zhang</div>
    </div>
  </header>
</template>
