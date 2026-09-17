<!--
  页脚。class 与文案逐字对齐改造前的 index.html:2189-2205。
  唯一动态项是 PANEL 值（改造前由 initNavigation 写 #footerPanel.textContent）。
-->
<script setup>
defineProps({
  panel: { type: String, default: '3/8 · SERVICE OPS' },
})
</script>

<template>
  <footer>
    <span class="footer-live"><span class="live-dot-green"></span> Live · 14m fresh</span>
    <span class="footer-sep">|</span>
    <span>SNAPSHOT <span class="footer-value">2026-05-12</span></span>
    <span class="footer-sep">|</span>
    <span>SCOPE <span class="footer-value">282A · SP · 6J · 54T</span></span>
    <span class="footer-sep">|</span>
    <span>TOTAL NODES <span class="footer-value">352</span></span>
    <span class="footer-sep">|</span>
    <span>PANEL <span class="footer-panel" id="footerPanel">{{ panel }}</span></span>
    <span class="footer-sep">|</span>
    <span class="footer-right-group">
      <span class="footer-accenture"><span class="accenture-chevron">&gt;</span> accenture</span>
      <span class="footer-sep">|</span>
      <span class="footer-platform">SIP Platform</span>
    </span>
  </footer>
</template>
