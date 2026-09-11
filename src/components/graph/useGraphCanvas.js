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

const ZOOM_MIN = 0.2
const ZOOM_MAX = 6
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
    controlsEl,
    zoomInEl,
    zoomOutEl,
    zoomFitEl,
    markerId,
    edgeCls,
    nodeCls,
    controlsCls,
    nodeStyle,
    onNodeClick,
  } = opts

  let zoom = 1
  let panX = 0
  let panY = 0
  let dragging = false
  let dragStartX = 0
  let dragStartY = 0
  let dragPanX = 0
  let dragPanY = 0

  const clampZoom = (v) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v))

  function applyTransform() {
    if (stageEl) {
      stageEl.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`
      // 舞台模式下清掉残留的容器 transform，避免叠加
      if (zoomEl) zoomEl.style.transform = ''
    }
  }

  /** 以画布中心为锚点缩放（按钮用） */
  function zoomBy(factor) {
    const cx = zoomEl ? zoomEl.clientWidth / 2 : 0
    const cy = zoomEl ? zoomEl.clientHeight / 2 : 0
    const oldZoom = zoom
    const newZoom = clampZoom(oldZoom * factor)
    panX = cx - (cx - panX) * (newZoom / oldZoom)
    panY = cy - (cy - panY) * (newZoom / oldZoom)
    zoom = newZoom
    applyTransform()
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
    zoom = clampZoom(Math.min(1, Math.min(cw / gw, ch / gh)))
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
      if (controlsEl) controlsEl.style.display = 'none'
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
    levels.forEach((layer, li) => {
      const y = PAD + li * LEVEL_GAP
      const layerW = layer.length * NODE_W + (layer.length - 1) * COL_GAP
      const x0 = PAD + Math.max(0, (width - PAD * 2 - layerW) / 2)
      layer.forEach((id, ci) => {
        pos[id] = { x: x0 + ci * (NODE_W + COL_GAP), y }
      })
    })

    // innerHTML 会整段替换，故箭头 marker 的 defs 一并写入
    let html =
      '<defs>' +
      `<marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#8b8fa3"></path></marker></defs>'

    edges.forEach((e) => {
      const p1 = pos[e.from]
      const p2 = pos[e.to]
      if (!p1 || !p2) return
      const x1 = p1.x + NODE_W / 2
      const y1 = p1.y + NODE_H
      const x2 = p2.x + NODE_W / 2
      const y2 = p2.y
      html += `<line class="${edgeCls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${markerId})"/>`
    })

    nodes.forEach((n) => {
      const p = pos[n.id]
      if (!p) return
      const st = statusMap ? statusMap[n.id] || null : null
      const styled = nodeStyle
        ? nodeStyle(n, st)
        : { cls: '', label: n.id + (n.agent ? ` (${n.agent})` : '') }
      const cls = nodeCls + (styled.cls ? ' ' + styled.cls : '')
      html +=
        `<g class="${cls}" data-node="${escapeAttr(n.id)}" transform="translate(${p.x},${p.y})">` +
        `<rect class="${nodeCls}-rect" x="0" y="0" width="${NODE_W}" height="${NODE_H}" rx="8"/>` +
        `<text class="${nodeCls}-text" x="${NODE_W / 2}" y="${NODE_H / 2}" text-anchor="middle" dominant-baseline="central">${escapeAttr(styled.label)}</text>` +
        '</g>'
    })

    svgEl.innerHTML = html
    if (controlsEl) controlsEl.style.display = 'flex'
    fitGraph()
  }

  function reset() {
    if (svgEl) svgEl.innerHTML = ''
    if (hintEl) hintEl.style.display = 'block'
    if (controlsEl) controlsEl.style.display = 'none'
    zoom = 1
    panX = 0
    panY = 0
    applyTransform()
  }

  function onWheel(e) {
    e.preventDefault()
    const rect = zoomEl.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const oldZoom = zoom
    const newZoom = clampZoom(oldZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
    panX = mx - (mx - panX) * (newZoom / oldZoom)
    panY = my - (my - panY) * (newZoom / oldZoom)
    zoom = newZoom
    applyTransform()
  }

  function onMouseDown(e) {
    if (e.target.closest && controlsCls && e.target.closest('.' + controlsCls)) return
    dragging = true
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragPanX = panX
    dragPanY = panY
    zoomEl.style.cursor = 'grabbing'
  }

  function onMouseMove(e) {
    if (!dragging) return
    panX = dragPanX + (e.clientX - dragStartX)
    panY = dragPanY + (e.clientY - dragStartY)
    applyTransform()
  }

  function endDrag() {
    dragging = false
    if (zoomEl) zoomEl.style.cursor = ''
  }

  function onClick(e) {
    const g = e.target.closest ? e.target.closest('[data-node]') : null
    if (g && g.getAttribute('data-node') && onNodeClick) onNodeClick(g.getAttribute('data-node'))
  }

  const onZoomIn = () => zoomBy(1.3)
  const onZoomOut = () => zoomBy(1 / 1.3)

  /** 绑定事件（返回解绑函数，供组件 onUnmounted 调用） */
  function mount() {
    if (zoomEl) {
      zoomEl.addEventListener('wheel', onWheel, { passive: false })
      zoomEl.addEventListener('mousedown', onMouseDown)
      zoomEl.addEventListener('mousemove', onMouseMove)
      zoomEl.addEventListener('mouseup', endDrag)
      zoomEl.addEventListener('mouseleave', endDrag)
      zoomEl.addEventListener('click', onClick)
    }
    zoomInEl?.addEventListener('click', onZoomIn)
    zoomOutEl?.addEventListener('click', onZoomOut)
    zoomFitEl?.addEventListener('click', fitGraph)

    return () => {
      if (zoomEl) {
        zoomEl.removeEventListener('wheel', onWheel)
        zoomEl.removeEventListener('mousedown', onMouseDown)
        zoomEl.removeEventListener('mousemove', onMouseMove)
        zoomEl.removeEventListener('mouseup', endDrag)
        zoomEl.removeEventListener('mouseleave', endDrag)
        zoomEl.removeEventListener('click', onClick)
      }
      zoomInEl?.removeEventListener('click', onZoomIn)
      zoomOutEl?.removeEventListener('click', onZoomOut)
      zoomFitEl?.removeEventListener('click', fitGraph)
    }
  }

  return { render: renderGraph, reset, fit: fitGraph, zoomBy, mount }
}

/** 属性值转义（改造前用的是 escapeHtml，同样基于 DOM；这里只需满足属性场景） */
function escapeAttr(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
