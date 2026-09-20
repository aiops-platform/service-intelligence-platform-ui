/**
 * SVG 流程图引擎（命令式）。
 *
 * 来源：js/app.js 的 createGraphCanvas（224 行），逐字移植算法与常量。
 *
 * ## 为什么是命令式而不是 Vue 模板
 *
 * 图内容由 `<svg>.innerHTML` 整段重写（每次 render 连 `<defs>` 里的箭头 marker 一起重画）。
 * 若用 Vue 模板渲染 SVG 子节点，Vue 的 patch 会与引擎的 innerHTML **互相覆盖**。
 * 因此 GraphCanvas.vue 的模板里 `<svg ref>` **必须留空**，一个插值子节点都不能有 ——
 * 这是硬约束，不是风格选择。
 *
 * ## 与改造前的差异
 *
 * 1. 元素不再靠 `document.getElementById` 取，改由调用方传入 ref（Vue 持有）。
 * 2. `.bs-stage` 中间层改由模板显式渲染。改造前是引擎动态创建并 `insertBefore` ——
 *    那会挪动 Vue 管理的节点、在 patch 时产生冲突。模板里写死后，原来的"异常 DOM 回退
 *    到旧行为"分支成为死代码，已删除。
 *
 * `.bs-stage` 这一层不能省：变换只施加在舞台上，`.bs-zoom` 容器保持不动充当视口/裁剪面，
 * 内容才会**按视口居中**，而不是把整块容器推偏/裁掉。
 */

const NODE_W = 150
const NODE_H = 46
const LEVEL_GAP = 110
const COL_GAP = 40
const PAD = 30

export function createGraphCanvas(opts) {
  const {
    zoomEl,
    svgEl,
    stageEl,
    hintEl,
    markerId,
    edgeCls,
    nodeCls,
    nodeStyle,
    onNodeClick,
  } = opts

  let zoom = 1
  let panX = 0
  let panY = 0
  function applyTransform() {
    if (stageEl) {
      stageEl.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`
      // 舞台模式下清掉残留的容器 transform，避免叠加
      if (zoomEl) zoomEl.style.transform = ''
    }
  }

  /** 适配画布：整图缩放到可视区域内（不大幅放大，最大 1 倍基线） */
  function fitGraph() {
    if (!zoomEl || !svgEl || !svgEl.getAttribute('viewBox')) return
    const vb = svgEl.getAttribute('viewBox').split(/\s+/).map(Number)
    const gw = vb[2]
    const gh = vb[3]
    if (!gw || !gh) return
    const cw = zoomEl.clientWidth || 600
    const ch = zoomEl.clientHeight || 420
    // 只缩不放：**不大于 1**。图小的时候放大反而把节点撑成马赛克、
    // 且一放大就必然溢出容器（fit 模式没有滚动条可退）
    zoom = Math.min(1, cw / gw, ch / gh)
    panX = (cw - gw * zoom) / 2
    panY = (ch - gh * zoom) / 2
    applyTransform()
  }

  /**
   * 渲染一张图。
   * 布局：Kahn 入度剥层 → 层为行(y)，层内节点横排(x)并居中。
   */
  function renderGraph(graph, statusMap) {
    if (!svgEl) return
    const nodes = graph && graph.nodes ? graph.nodes : []
    const edges = graph && graph.edges ? graph.edges : []
    if (hintEl) hintEl.style.display = 'none'

    if (nodes.length === 0) {
      svgEl.innerHTML = ''
      return
    }

    // 入度统计 + 邻接表 → 分层
    const byId = {}
    const indeg = {}
    const children = {}
    nodes.forEach((n) => {
      byId[n.id] = n
      indeg[n.id] = 0
      children[n.id] = []
    })
    edges.forEach((e) => {
      if (!byId[e.to]) return
      indeg[e.to] = (indeg[e.to] || 0) + 1
      children[e.from] = children[e.from] || []
      children[e.from].push(e.to)
    })

    const levels = []
    let queue = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id)
    let remaining = nodes.length
    while (queue.length > 0 && remaining > 0) {
      const layer = queue.slice()
      levels.push(layer)
      remaining -= layer.length
      const next = []
      layer.forEach((id) => {
        ;(children[id] || []).forEach((to) => {
          indeg[to] -= 1
          if (indeg[to] === 0) next.push(to)
        })
      })
      queue = next
    }

    // 防环兜底：仍有剩余节点直接追加到最后层
    const seen = {}
    levels.forEach((l) => l.forEach((id) => (seen[id] = true)))
    const leftover = nodes.filter((n) => !seen[n.id]).map((n) => n.id)
    if (leftover.length > 0) levels.push(leftover)

    let maxCols = 1
    levels.forEach((layer) => {
      if (layer.length > maxCols) maxCols = layer.length
    })
    const width = maxCols * NODE_W + (maxCols - 1) * COL_GAP + PAD * 2
    const height = levels.length * LEVEL_GAP + NODE_H + PAD
    svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`)
    // SVG 按 1:1 像素渲染，缩放/平移交给 CSS transform 控制
    svgEl.style.width = width + 'px'
    svgEl.style.height = height + 'px'

    const pos = {}
    const layerOf = {}
    levels.forEach((layer, li) => {
      const y = PAD + li * LEVEL_GAP
      const layerW = layer.length * NODE_W + (layer.length - 1) * COL_GAP
      const x0 = PAD + Math.max(0, (width - PAD * 2 - layerW) / 2)
      layer.forEach((id, ci) => {
        pos[id] = { x: x0 + ci * (NODE_W + COL_GAP), y }
        layerOf[id] = li
      })
    })

    // ── 连线锚点分配 ──
    // 同一节点的多条出/入边**平分**该边（下沿/上沿），而不是全挤在正中。
    // 不分的话多条边共用一个点、出节点就重叠成一束，看着像一根线。
    // 按对端的位置排序，保证同一张图每次渲染的锚点顺序一致（不会抖动）。
    const outs = {}
    const ins = {}
    nodes.forEach((n) => ((outs[n.id] = []), (ins[n.id] = [])))
    edges.forEach((e, i) => {
      if (!outs[e.from] || !ins[e.to]) return
      outs[e.from].push({ i, to: e.to })
      ins[e.to].push({ i, from: e.from })
    })
    const anchorX = (p, idx, total) => p.x + (NODE_W * (idx + 1)) / (total + 1)
    const outAnchor = {}
    Object.entries(outs).forEach(([nid, list]) => {
      list.sort((a, b) => (pos[a.to]?.x ?? 0) - (pos[b.to]?.x ?? 0) || a.i - b.i)
      list.forEach((e, k) => (outAnchor[e.i] = anchorX(pos[nid], k, list.length)))
    })
    const inAnchor = {}
    Object.entries(ins).forEach(([nid, list]) => {
      list.sort((a, b) => (pos[a.from]?.x ?? 0) - (pos[b.from]?.x ?? 0) || a.i - b.i)
      list.forEach((e, k) => (inAnchor[e.i] = anchorX(pos[nid], k, list.length)))
    })

    /**
     * 竖直段 `x` 在 `[y1,y2]` 上是否畅通（按**真实几何**判，不按列号）。
     *
     * ⚠️ 一开始我按"列号相同 ⇒ 同一竖线"来判，**是错的**：每层各自居中排列
     * （`x0 = PAD + (width - layerW)/2`），列号相同在不同层的 x 并不一样。
     * 结果判"畅通"的竖线实际从旁边那层的节点中间穿了过去——实测用几何检查
     * 扫出 6 处遮挡，肉眼看图是发现不了的。
     */
    function vFree(x, y1, y2) {
      const lo = Math.min(y1, y2)
      const hi = Math.max(y1, y2)
      return !nodes.some((n) => {
        const p = pos[n.id]
        if (!p) return false
        return x > p.x && x < p.x + NODE_W && lo < p.y + NODE_H && hi > p.y
      })
    }

    /**
     * 给「下行竖段」挑一条畅通的车道。
     *
     * 候选 = 目标列自身 + 各节点两侧的列间空档（`COL_GAP` 内没有节点）。
     * 按离目标越近越优先挑选，因此绝大多数边只在目标列旁平移十几像素，
     * 不会拉出横贯全图的长横线。
     */
    function pickLane(tx, yOut, yIn, sx) {
      if (vFree(tx, yOut, yIn)) return tx
      const cands = []
      nodes.forEach((n) => {
        const p = pos[n.id]
        if (p) cands.push(p.x - COL_GAP / 2, p.x + NODE_W + COL_GAP / 2)
      })
      cands.sort((a, b) => Math.abs(a - tx) - Math.abs(b - tx))
      for (const gx of cands) if (vFree(gx, yOut, yIn)) return gx
      // 兜底：画布外侧（节点最左从 PAD 起，此处必然无节点）
      return sx < width / 2 ? PAD / 2 : width - PAD / 2
    }

    /**
     * 一条边的路径。**三条规则，按优先级**：
     *
     * 1. 同列且中间层没有节点挡着 → 直上直下（一条竖线，最干净）
     * 2. 相邻层 → 「下 → 横 → 下」，横段走两层之间的**空档**（那里没有任何节点）
     * 3. 跨层 → 绕**侧边通道**：先下到本层下方的空档、横到画布外侧、
     *    竖直下降、再横回来、进目标。侧通道在所有节点之外，保证不压任何节点
     *
     * 为什么不用直线：改造前就是「源节点底部中心 → 目标节点顶部中心」的直线，
     * 跨列时是**斜线**，且节点在边之后绘制 → 线穿到节点背后被遮挡。
     */
    function edgePath(from, to, sx, sy, tx, ty) {
      const p1 = pos[from]
      const p2 = pos[to]
      const l1 = layerOf[from]
      const l2 = layerOf[to]
      const halfGap = (LEVEL_GAP - NODE_H) / 2

      if (l2 > l1) {
        const yOut = p1.y + NODE_H + halfGap   // 源节点下方那层空档
        const yIn = p2.y - halfGap             // 目标节点上方那层空档
        const gx = pickLane(tx, yOut, yIn, sx)
        if (sx === tx && gx === tx) return `M ${sx} ${sy} V ${ty}`
        return `M ${sx} ${sy} V ${yOut} H ${gx} V ${yIn} H ${tx} V ${ty}`
      }
      // 反向边（回边 / 环）：走右侧通道，避免与正向边压在一起
      const busX = width - PAD / 2
      return `M ${sx} ${sy} V ${p1.y - halfGap} H ${busX} V ${p2.y + NODE_H + halfGap} H ${tx} V ${ty}`
    }

    // innerHTML 会整段替换，故箭头 marker 的 defs 一并写入
    let html =
      '<defs>' +
      `<marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#8b8fa3"></path></marker></defs>'

    edges.forEach((e, i) => {
      const p1 = pos[e.from]
      const p2 = pos[e.to]
      if (!p1 || !p2) return
      const sx = outAnchor[i] ?? p1.x + NODE_W / 2
      const sy = p1.y + NODE_H
      const tx = inAnchor[i] ?? p2.x + NODE_W / 2
      const ty = p2.y
      html +=
        `<path class="${edgeCls}" d="${edgePath(e.from, e.to, sx, sy, tx, ty)}"` +
        ` fill="none" marker-end="url(#${markerId})"/>`
    })

    nodes.forEach((n) => {
      const p = pos[n.id]
      if (!p) return
      const st = statusMap ? statusMap[n.id] || null : null
      // 默认只显示**节点名**（= 节点 id）。不再拼 `(agent)`——那是节点详情面板的职责，
      // 画在图上只会让节点变挤、且长 agent 名会被裁掉。
      const styled = nodeStyle ? nodeStyle(n, st) : { cls: '', label: n.id }
      const cls = nodeCls + (styled.cls ? ' ' + styled.cls : '')
      html +=
        `<g class="${cls}" data-node="${escapeAttr(n.id)}" transform="translate(${p.x},${p.y})">` +
        `<rect class="${nodeCls}-rect" x="0" y="0" width="${NODE_W}" height="${NODE_H}" rx="8"/>` +
        `<text class="${nodeCls}-text" x="${NODE_W / 2}" y="${NODE_H / 2}" text-anchor="middle" dominant-baseline="central">${escapeAttr(styled.label)}</text>` +
        '</g>'
    })

    svgEl.innerHTML = html
    fitGraph()
  }

  function reset() {
    if (svgEl) svgEl.innerHTML = ''
    if (hintEl) hintEl.style.display = 'block'
    zoom = 1
    panX = 0
    panY = 0
    applyTransform()
  }

  function onClick(e) {
    const g = e.target.closest ? e.target.closest('[data-node]') : null
    if (g && g.getAttribute('data-node') && onNodeClick) onNodeClick(g.getAttribute('data-node'))
  }

  /**
   * 绑定事件（返回解绑函数，供组件 onUnmounted 调用）。
   *
   * **只保留节点点击 + 容器尺寸变化**：图固定以 fit 模式展示，不再提供
   * 缩放/平移。因此滚轮、拖拽、以及 +/−/Fit 按钮的绑定全部去掉——
   * 留着一个能改 zoom 的入口而按钮已删，就会出现"滚轮还能缩放"的幽灵行为。
   *
   * ResizeObserver 是必须的：既然只剩 fit 一种模式，容器一变宽窄就得重算，
   * 否则侧边栏折叠/窗口缩放后图会溢出或被裁。
   */
  function mount() {
    if (zoomEl) zoomEl.addEventListener('click', onClick)

    const ro =
      typeof ResizeObserver !== 'undefined' && zoomEl
        ? new ResizeObserver(() => fitGraph())
        : null
    ro?.observe(zoomEl)

    return () => {
      zoomEl?.removeEventListener('click', onClick)
      ro?.disconnect()
    }
  }

  return { render: renderGraph, reset, fit: fitGraph, mount }
}

/** 属性值转义（改造前用的是 escapeHtml，同样基于 DOM；这里只需满足属性场景） */
function escapeAttr(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
