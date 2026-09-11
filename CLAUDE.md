# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概述

Service Intelligence Platform (SIP) 前端 -- 一个服务运维事件管理的静态仪表盘。应用展示 KPI 指标、可筛选的应用列表，以及跨运维域的导航（Service Ops、Business Ops、Engineering Ops 等）。

## 常用命令

项目无构建工具、包管理器或测试框架。这是一个纯静态站点，直接打开 `index.html` 即可：

```bash
# 本地启动静态服务（任选一种）
python3 -m http.server 8080          # Python 3
npx serve .                          # Node
ruby -run -e httpd . -p 8080        # Ruby
```

浏览器访问 `http://localhost:8080`（或直接双击 `index.html`）。

## 架构

```
service_intelligence_platform_frontend/
├── assets/          # 空目录，预留存放静态资源
├── css/
│   └── styles.css   # 所有样式，使用 CSS 自定义属性实现主题化
├── js/
│   └── app.js       # 所有交互逻辑，采用 IIFE + 'use strict' 模式
└── index.html        # 单页面，所有数据硬编码在 HTML 中
```

- **无框架、无路由、无状态管理、无 API 层。** 全部是原生 HTML5/CSS3/ES5 JavaScript。
- **CSS** 使用自定义属性（CSS 变量）作为设计令牌（颜色、边框、背景）。工具类命名类似 Tailwind（`.flex`、`.items-center`、`.gap-2`）。组件样式使用类似 BEM 的短横线命名（`.kpi-card`、`.filter-chip`）。
- **JS** 是一个单独的 IIFE（`'use strict'`），在 DOMContentLoaded 时启动。`init()` 中初始化的模块包括：导航切换、筛选芯片、表格排序、按钮组切换、行点击处理、实时时钟。
- **数据全部硬编码**在 HTML 表格中（19 个应用行）。筛选芯片和表格排序直接操作 DOM -- 没有数据模型。
- 父目录（`mb_aiops_platform/`）包含一个早期版本（CSS/JS 内联在 index.html 中）。`service_intelligence_platform_frontend/` 是重构版本，采用外部文件并增加了交互功能。

## JS 模块模式

新增交互功能应遵循 `js/app.js` 中的现有模式：
1. 创建一个 `init<功能名>()` 函数
2. 在主 `init()` 函数中调用它
3. 直接使用 DOM API（无虚拟 DOM，无数据绑定）



## 项目约定

开发流程、Commit 格式、Changelog 规范等约定参见 `CONTRIBUTING.md`。

## Changelog 强制规则

**每次代码修改（feat/fix/refactor/style）完成后，必须同步生成 changelog 文件，不允许遗漏。**

- changelog 文件放在 `changelogs/` 目录下
- 命名格式：`v{MAJOR}.{MINOR}.{PATCH}-{slug}.md`
- 模板和必须包含的内容见 `CONTRIBUTING.md` 第 48-90 行
- 当前版本号：`v1.21.0`
- 已有的 changelog 文件保留不动，只新增不修改历史文件
