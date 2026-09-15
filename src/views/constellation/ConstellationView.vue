<!--
  Constellation 域 —— 内嵌企业架构星座图。

  ## 为什么是内嵌而不是用 Vue 重写

  那张图是 **three.js 的 3D 力导向图**（951 节点 / 1504 边，布局由物理模拟现场跑出来），
  整个页面是另一套 Next.js 应用。用 Vue 重写等于重写整个应用 + 重新实现布局 ——
  试过，做出来不像（先排成放射状"羽毛"，再改成"烟花"，又自写力导向调参数），
  而原站的构建器根本不把坐标拷进节点，布局完全由 3d-force-graph 跑出来。

  直接把能跑的搬进来、只做必要的适配，是这里唯一合理的选择。
  失败尝试的完整记录见 `changelogs/v2.0.0-constellation-embed.md`。

  ## 其余的都在共享组件里

  资源怎么来、两条菜单栏怎么剥掉、高度链为什么断、加载检测为什么有三层 ——
  统一写在 `src/components/NextEmbed.vue` 的文件头。
-->
<script setup>
import NextEmbed from '@/components/NextEmbed.vue'
</script>

<template>
  <NextEmbed src="/constellation-app.html" title="Constellation" label="正在载入 Constellation…" />
</template>
