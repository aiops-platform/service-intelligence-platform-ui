<!--
  告警详情模态（原 #alertDetailOverlay，index.html:2035-2045）。

  全局单例：被已迁移的 log-analysis 与未迁移的 metrics-analysis 共用（后者经接缝 S4
  调 JS 的 openAlertDetailGeneric → window.__SIP_OPEN_ALERT_DETAIL）。

  内容用 v-html 注入（渲染逻辑见 alert-detail/renderAnalysis.js），因此：
  - v-html **不做转义** → 渲染模块里逐处保留了 escapeHtml
  - v-html 注入的 onclick **不会被执行** → 渲染模块把 9 处内联处理器改成 data-action，
    由本组件的**单个委托监听器**分发（见 onClick）
-->
<script setup>
import { useAlertDetail } from '@/composables/useAlertDetail'
import { showToast } from '@/composables/useToast'

const { visible, title, state, html, errorMsg, close } = useAlertDetail()

/** 单个委托监听器，替代改造前的 9 处内联 onclick */
function onClick(e) {
  const el = e.target.closest('[data-action]')
  if (!el) return
  const { action, target, msg, type } = el.dataset
  const scoped = (sel) => el.closest('.ap-modal-body')?.querySelector(sel)

  switch (action) {
    case 'toast':
      showToast(msg, type || 'info')
      break

    case 'toggle-evidence': {
      // 复刻 window._toggleEvidence：切证据卡片显隐 + 按钮文案 + timeline 的 show-details
      const cards = scoped('#evidenceSubCards')
      if (!cards) return
      const isVisible = cards.classList.contains('visible')
      cards.classList.toggle('visible', !isVisible)
      el.innerHTML = isVisible
        ? '&#128194; 展开全部证据卡片 <span class="chevron">&#9662;</span>'
        : '&#128193; 收起证据卡片 <span class="chevron">&#9652;</span>'
      scoped('.timeline-wrapper')?.classList.toggle('show-details', !isVisible)
      break
    }

    case 'toggle-collapsible': {
      // 复刻 window._toggleCollapsible：aria-expanded + .expanded + content .open
      const section = el.parentElement
      const content = section?.querySelector('.collapsible-content')
      if (!content) return
      const expanded = el.getAttribute('aria-expanded') === 'true'
      el.setAttribute('aria-expanded', String(!expanded))
      el.classList.toggle('expanded', !expanded)
      content.classList.toggle('open', !expanded)
      break
    }

    case 'toggle-think-step':
      // 复刻原先的匿名 IIFE：切所在 .think-step 的 .expanded
      el.closest('.think-step')?.classList.toggle('expanded')
      break

    case 'toggle-args': {
      const args = scoped('#' + target)
      if (args) args.classList.toggle('open')
      break
    }

    case 'toggle-stack': {
      const stack = scoped('#' + target)
      if (!stack) return
      const open = stack.classList.toggle('open')
      el.textContent = open ? 'Hide Stack Trace' : 'Show Stack Trace'
      break
    }
  }
}
</script>

<template>
  <div
    class="ap-modal-overlay"
    id="alertDetailOverlay"
    :class="{ open: visible }"
    @click.self="close"
  >
    <div class="ap-modal" style="max-width: 960px;">
      <div class="ap-modal-header">
        <h3 id="alertDetailTitle">{{ title }}</h3>
        <button class="ap-modal-close" id="alertDetailClose" @click="close">&times;</button>
      </div>
      <div class="ap-modal-body" id="alertDetailContent" @click="onClick">
        <div v-if="state === 'loading'" class="alert-loading">
          <div class="alert-loading-spinner"></div>
          <div>Loading agent analysis...</div>
        </div>
        <div v-else-if="state === 'error'" class="alert-error">
          Failed to load agent analysis. {{ errorMsg }}
        </div>
        <template v-else-if="state === 'ready'">
          <!-- eslint-disable-next-line vue/no-v-html —— 内容由 renderAnalysis.js 生成，每处插值已 escapeHtml -->
          <div v-html="html"></div>
        </template>
      </div>
    </div>
  </div>
</template>
