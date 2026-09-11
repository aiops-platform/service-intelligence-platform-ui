import { createApp } from 'vue'

// 全站样式：7099 行的既有样式表原样全局引入，组件模板逐字沿用其中的 class 名。
// 不做 scoped、不重写 —— 见 docs/v2.0.0-vue-rewrite-plan.md「范围与选型」。
import '../css/styles.css'

import App from './App.vue'
import { router, installLegacyBridge } from './router'

// 接缝 S3：把旧代码的 navigateToPage 接到路由上。必须在挂载前装好 ——
// 未迁移的视图可能在首屏就触发跨页下钻。
installLegacyBridge()

createApp(App).use(router).mount('#app')
