#!/usr/bin/env node
/**
 * 自动探测部署 base，然后转交给 vite。
 *
 * ## 为什么需要它
 *
 * `base` 会被焊进 `dist/index.html` 的资源引用，所以它**必须在构建时**就定下来 ——
 * base='/' 的产物放到 `/sip/` 下，所有 assets 直接 404。但本机直跑和共享机器上的
 * 子路径部署，差别不该让操作者每次去记 `--base=/sip/` 之类的参数：
 * 命令应当只有一条，环境差异在这里吸收。
 *
 * ## 判定顺序（先命中先用）
 *
 * 1. 环境变量 `VITE_BASE`     —— 显式覆盖（CI、一次性实验、临时换个挂载点）
 * 2. 本机 nginx 里存在「把 `/sip/` 反代到**本应用**」的 location
 *    —— 说明这个机器上确实有东西把本应用挂在 `/sip/` 下，那就照它来
 * 3. `/`                       —— 默认：本机直跑
 *
 * 第 2 步刻意要求**两个条件同时成立**：location 前缀是 `/sip/`，**且**块内指向本应用的
 * preview 端口。只匹配前缀就下结论太草率 —— 那台共享机器上 `/sip/` 之外还有一堆
 * 别人的 location，光看前缀会把别人的站点认成自己。
 *
 * ## 环境变量
 *
 * - `VITE_BASE`    显式指定 base（最高优先级）
 * - `NGINX_CONF`   覆盖 nginx 主配置路径（默认 macOS/Homebrew 的 /opt/homebrew/etc/nginx/nginx.conf）
 */

import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** 本应用的 preview 端口；与 vite.config.js 的 `preview.port` 必须一致。 */
const PREVIEW_PORT = '4173'
/** 子路径部署时用的挂载前缀。 */
const SUBPATH = '/sip/'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NGINX_CONF = process.env.NGINX_CONF || '/opt/homebrew/etc/nginx/nginx.conf'

/**
 * 在 nginx 配置里找「把 SUBPATH 反代到本应用」的 location。
 *
 * 做法：定位含 SUBPATH 的 location 行，再用花括号配平取出它的块体，检查块体里
 * 是否出现本应用的 preview 端口。nginx 的 location 块可以嵌套（`location / { ... }`
 * 里套子块），所以配平要按字符数，不能按行。
 */
function nginxServesSubpath(text) {
  const re = /^[ \t]*location\s+[^\n{]*\/sip\/[^\n{]*\{/gm
  for (const m of text.matchAll(re)) {
    const open = m.index + m[0].length - 1 // 指向 '{'
    let depth = 0
    let i = open
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) break
    }
    const body = text.slice(open, i)
    if (body.includes(PREVIEW_PORT) || body.includes(`127.0.0.1:${PREVIEW_PORT}`)) {
      return true
    }
  }
  return false
}

function detectBase() {
  if (process.env.VITE_BASE) {
    return [process.env.VITE_BASE, '来自环境变量 VITE_BASE']
  }
  try {
    if (nginxServesSubpath(readFileSync(NGINX_CONF, 'utf8'))) {
      return [SUBPATH, `${NGINX_CONF} 里有指向本应用(:${PREVIEW_PORT})的 ${SUBPATH} 反代`]
    }
  } catch {
    // nginx 没装 / 没权限读 —— 都当作「本机直跑」，不是错误
  }
  return ['/', '未发现子路径反代']
}

const [base, reason] = detectBase()
const args = process.argv.slice(2)
const cmd = args[0] ? `vite ${args.join(' ')}` : 'vite'

console.log(`[sip] base=${base}  （${reason}）`)
console.log(`[sip] ${cmd}`)

const child = spawn(resolve(ROOT, 'node_modules/.bin/vite'), args, {
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE: base },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
