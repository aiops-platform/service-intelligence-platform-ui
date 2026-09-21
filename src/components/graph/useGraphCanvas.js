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

//: 流动高亮色（与 styles.css 的 --accent-blue 一致；SVG 里 marker 的 fill 取不到 CSS 变量，故写值）
const FLOW_COLOR = '#3b82f6'
//: 高亮时给线加的类名（样式在 css/styles.css 的 .bs-edge-flow）
const FLOW_CLS = 'bs-edge-flow'

//: **入向**流动色（与 styles.css 的 --accent-orange 一致）。点击节点时，
//: "谁流到我"用这个色，与"我流向谁"的蓝分开 —— 见 highlightFlow 的说明。
const FLOW_IN_COLOR = '#f59e0b'
const FLOW_IN_CLS = 'bs-edge-flow-in'

//: fit 的**可读下限**。装不下时不再继续缩小，改为让容器滚动。
//: 节点字号 11px —— 缩到 0.4 只剩 4.4px，等于看不见（实测就是这条导致"图显示空白"）。
//: 0.8 → 8.8px，仍可读，同时保留"大图缩小一点"的收益。
//: 悬停多久才弹节点提示。太短会跟着鼠标乱闪，太长又像没反应。
const HOVER_DELAY_MS = 1500

const MIN_SCALE = 0.8

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
    tipEl,
    nodeTip,
    onNodeClick,
  } = opts

  let zoom = 1
  // 当前被高亮的节点：render 会整段重写 innerHTML，高亮必须重放（见 renderGraph 末尾）
  let flowNode = null
  let hoverTimer = null   // 1.5s 悬停计时
  let hoverNode = null    // 当前正在计时的节点（换节点要重新计时）
  let tipNode = null      // 当前**显示着**提示的节点（render 会重放，见 renderGraph 末尾）
  /**
   * 把缩放**直接写进 SVG 的 width/height**（而不是 CSS transform）。
   *
   * 为什么不用 transform：transform 只改绘制、**不改布局尺寸**，容器的可滚动区域
   * 仍按未缩放的尺寸算 —— 于是"缩小后滚动"会滚错、出现大片空白。
   * 写 width/height 后布局与视觉一致，`overflow: auto` 才能正确工作。
   *
   * SVG 自带 viewBox，改 width/height 即等比缩放内容，不需要额外变换。
   */
  function applyScale(gw, gh) {
    if (!svgEl) return
    svgEl.setAttribute('width', String(Math.round(gw * zoom)))
    svgEl.setAttribute('height', String(Math.round(gh * zoom)))
  }

  /**
   * 适配：装得下就装下，**装不下只缩到可读下限**，再小交给容器滚动。
   *
   * 为什么要有下限：本图是纵向铺开的 DAG（18 个节点实测 780×1506），
   * 硬塞进一个几百像素高的面板要缩到 0.24~0.4，节点文字只剩 3~4.5px——
   * **看起来就是一片空白**（这正是"流程图看不到"的真因）。
   * 与其缩到读不出，不如保持可读并允许滚动。
   */
  function fitGraph() {
    if (!zoomEl || !svgEl) return
    const vb = (svgEl.getAttribute('viewBox') || '').split(/\s+/).map(Number)
    const gw = vb[2]
    const gh = vb[3]
    if (!gw || !gh) return
    const cw = zoomEl.clientWidth || 600
    const ch = zoomEl.clientHeight || 420
    zoom = Math.min(1, Math.max(MIN_SCALE, Math.min(cw / gw, ch / gh)))
    applyScale(gw, gh)
  }

  /**
   * 渲染一张图。
   * 布局：Kahn 入度剥层 → 层为行(y)，层内节点横排(x)并居中。
   */
  function renderGraph(graph, statusMap) {
    if (!svgEl) return
    // ── 滚动位置：**必须在动 DOM 之前捕获** ────────────────────────
    // 宿主是**轮询驱动**的，每次数据变化都重画。中途任何让内容尺寸缩水的操作
    // （历史上是 `removeAttribute('height')`）都会把 scrollTop **夹成 0**，
    // 之后再捕获就晚了 —— 拿到的是 0，恢复等于没做。
    // 恢复在函数末尾、`fitGraph()` 之后（尺寸定下来才设得进去）。
    const keepScrollTop = zoomEl ? zoomEl.scrollTop : 0
    const keepScrollLeft = zoomEl ? zoomEl.scrollLeft : 0
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
    // 尺寸（width/height）**全部由 fitGraph 的 applyScale 设置**（每次都会覆盖），
    // 这里只定 viewBox。
    //
    // ⚠️ 别在这里 `removeAttribute('width'/'height')`「清一下再设」：
    // 那会让 SVG **塌成 0 高**（实测 scrollHeight 1205→358），父容器的 scrollTop
    // 随之被**夹成 0**，且尺寸恢复后**滚动位置不会自己回来** ——
    // 表现为"轮询一刷新，用户滑下去看的图就弹回顶部"。
    svgEl.style.maxWidth = 'none'

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

    // ── 连线合并：每个节点**只出一根主干 / 只入一根主干** ──
    //
    // 早期实现是把同一节点的多条边**均分**到该边沿（下沿/上沿各占一段），
    // 结果一个扇出 7 条的节点底部拖着 7 条线头，看着就是一束毛边。
    // 改成共享主干后：节点上/下各接**一条**线，到主干末端再分叉，线条数量骤减。
    const cxOf = (nid) => pos[nid].x + NODE_W / 2
    const hasOut = {}
    const hasIn = {}
    edges.forEach((e) => {
      if (pos[e.from] && pos[e.to]) {
        hasOut[e.from] = true
        hasIn[e.to] = true
      }
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
    function pickLane(tx, yOut, yIn, cx) {
      if (vFree(tx, yOut, yIn)) return tx
      const cands = []
      nodes.forEach((n) => {
        const p = pos[n.id]
        if (p) cands.push(p.x - COL_GAP / 2, p.x + NODE_W + COL_GAP / 2)
      })
      cands.sort((a, b) => Math.abs(a - tx) - Math.abs(b - tx))
      for (const gx of cands) if (vFree(gx, yOut, yIn)) return gx
      // 兜底：画布外侧（节点最左从 PAD 起，此处必然无节点）
      return cx < width / 2 ? PAD / 2 : width - PAD / 2
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
    function edgePath(from, to, cx, tx) {
      const p1 = pos[from]
      const p2 = pos[to]
      const l1 = layerOf[from]
      const l2 = layerOf[to]
      const halfGap = (LEVEL_GAP - NODE_H) / 2
      const yOut = p1.y + NODE_H + halfGap   // 源节点下方那层空档（主干末端）
      const yIn = p2.y - halfGap             // 目标节点上方那层空档（入主干起点）

      if (l2 > l1) {
        // 相邻层时 yOut 与 yIn 恰好相等 → 退化成一条横线（主干两端各自负责竖段）
        const gx = pickLane(tx, yOut, yIn, cx)
        if (gx === tx) return `M ${cx} ${yOut} H ${tx} V ${yIn}`
        return `M ${cx} ${yOut} H ${gx} V ${yIn} H ${tx}`
      }
      // 反向边（回边 / 环）：走右侧通道，避免与正向边压在一起
      const busX = width - PAD / 2
      return `M ${cx} ${yOut} H ${busX} V ${p2.y + NODE_H + halfGap} H ${tx} V ${yIn}`
    }

    // innerHTML 会整段替换，故箭头 marker 的 defs 一并写入
    let html =
      '<defs>' +
      `<marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#8b8fa3"></path></marker>' +
      // 高亮态箭头：与流动线同色——否则线变了色、箭头还是灰的
      `<marker id="${markerId}Flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="${FLOW_COLOR}"></path></marker>` +
      // 入向高亮箭头（琥珀）—— 只有节点的**入主干**带箭头，所以只有它用得上
      `<marker id="${markerId}In" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="${FLOW_IN_COLOR}"></path></marker></defs>`

    // 主干：每个有出/入边的节点各一根，只画一次（这就是"合并"的落点）
    nodes.forEach((n) => {
      const p = pos[n.id]
      if (!p) return
      const cx = p.x + NODE_W / 2
      const halfGap = (LEVEL_GAP - NODE_H) / 2
      if (hasOut[n.id]) {
        html += `<path class="${edgeCls}" data-out="${escapeAttr(n.id)}"` +
                ` d="M ${cx} ${p.y + NODE_H} V ${p.y + NODE_H + halfGap}" fill="none"/>`
      }
      if (hasIn[n.id]) {
        html += `<path class="${edgeCls}" data-in="${escapeAttr(n.id)}"` +
                ` d="M ${cx} ${p.y - halfGap} V ${p.y}" fill="none" marker-end="url(#${markerId})"/>`
      }
    })

    // 分支：主干末端 → 目标上方的入主干起点
    edges.forEach((e) => {
      if (!pos[e.from] || !pos[e.to]) return
      html +=
        `<path class="${edgeCls}" data-from="${escapeAttr(e.from)}" data-to="${escapeAttr(e.to)}"` +
        ` fill="none" d="${edgePath(e.from, e.to, cxOf(e.from), cxOf(e.to))}"/>`
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

    // ⚠️ 悬停提示：**不能直接 hideTip()**。
    // 宿主轮询驱动，每几秒 render 一次；鼠标不动就不会再触发 `mouseover`，
    // 直接收起的话提示会**跟着刷新节奏一闪一闪**（而且要用户动一下鼠标才回来）。
    // 正确做法与 flowNode 同款：记住节点、重建后**重放**——
    // 但必须用 `querySelector` 拿**新**的 <g>（旧的已随 innerHTML 卸载）。
    const tipToRestore = tipNode
    svgEl.innerHTML = html
    if (tipToRestore) {
      const gEl = svgEl.querySelector(`[data-node="${tipToRestore.replace(/["\\]/g, '\\$&')}"]`)
      if (gEl) showTip(tipToRestore, gEl)
      else hideTip()   // 节点没了（换了图）→ 收起
    }
    // innerHTML 整段重写会抹掉高亮。宿主（RunDetailView / BugSolveView）是**轮询驱动**的，
    // 每次数据变化都重新 render —— 不在这里重放的话，点击后的流动效果几秒后就自己没了。
    if (flowNode) highlightFlow(flowNode)
    fitGraph()
    if (zoomEl) {
      // ⚠️ 先**强制一次布局**再写 scrollTop。
      // `svgEl.innerHTML = ...` 的瞬间 SVG 内容为空、`applyScale` 又刚改过尺寸，
      // 此时浏览器的布局还是旧的（内容高度≈0）→ 直接写 scrollTop 会被**夹成 0**，
      // 恢复等于没做。读一次 scrollHeight 逼出同步布局，钳制区间才是对的。
      void zoomEl.scrollHeight
      zoomEl.scrollTop = keepScrollTop
      zoomEl.scrollLeft = keepScrollLeft
    }
  }

  function reset() {
    flowNode = null
    if (svgEl) svgEl.innerHTML = ''
    if (hintEl) hintEl.style.display = 'block'
    zoom = 1
  }


  // ── 悬停提示（1.5s）──────────────────────────────────────────────
  //
  // 为什么用「延迟弹出」而不是 hover 即显：图里节点密，鼠标滑过时立刻弹会一路闪，
  // 反而看不清。1.5s 表示"停在这里看"。
  //
  // 内容由调用方以 `nodeTip(nid) => { title, rows }` 提供（引擎只懂图的形状，
  // 不知道 run 的 status/tokens/error）。渲染一律用 **textContent**——
  // 节点 id、agent 名、error 文本都是数据，走 innerHTML 就是 XSS 口子。
  function hideTip() {
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
    hoverNode = null
    tipNode = null
    if (tipEl) tipEl.style.display = 'none'
  }

  function showTip(nid, gEl) {
    if (!tipEl || !nodeTip) return
    let tip
    try {
      tip = nodeTip(nid)
    } catch {
      return
    }
    if (!tip) return
    tipNode = nid
    tipEl.textContent = ''
    const title = document.createElement('div')
    title.className = 'bs-node-tip-title'
    title.textContent = tip.title || nid
    tipEl.appendChild(title)
    ;[['bs-node-tip-desc', tip.desc], ['bs-node-tip-desc2', tip.nodeDesc]].forEach(
      ([cls, text]) => {
        if (!text) return          // 空的不渲染，不留空白条
        const el = document.createElement('div')
        el.className = cls
        el.textContent = text
        tipEl.appendChild(el)
      },
    )
    ;(tip.rows || []).forEach(([k, v]) => {
      const row = document.createElement('div')
      row.className = 'bs-node-tip-row'
      const key = document.createElement('span')
      key.className = 'bs-node-tip-key'
      key.textContent = k
      const val = document.createElement('span')
      val.className = 'bs-node-tip-val'
      val.textContent = v === undefined || v === null || v === '' ? '—' : String(v)
      row.appendChild(key)
      row.appendChild(val)
      tipEl.appendChild(row)
    })
    tipEl.style.display = 'block'
    // 定位：用节点在**屏幕上的实际矩形**（容器缩放/滚动都自动算进去），
    // 不去手动乘 zoom —— 那是"看起来对、一缩放就偏"的做法。
    if (gEl && zoomEl) {
      const nr = gEl.getBoundingClientRect()
      const cr = zoomEl.getBoundingClientRect()
      const tw = tipEl.offsetWidth
      const th = tipEl.offsetHeight
      let left = nr.left - cr.left + nr.width + 8
      let top = nr.top - cr.top
      if (left + tw > cr.width) left = Math.max(0, nr.left - cr.left - tw - 8)  // 右边放不下 → 翻到左边
      if (top + th > cr.height) top = Math.max(0, cr.height - th)
      tipEl.style.left = left + 'px'
      tipEl.style.top = top + 'px'
    }
  }

  /** 悬停在某个节点上：换节点要**重新计时**，否则滑过几个节点会沿用前一个的计时。 */
  function onNodeHover(nid, gEl) {
    if (hoverNode === nid) return
    hideTip()
    if (!nid || !tipEl || !nodeTip) return
    hoverNode = nid
    hoverTimer = setTimeout(() => {
      hoverTimer = null
      if (hoverNode === nid) showTip(nid, gEl)
    }, HOVER_DELAY_MS)
  }

  function onClick(e) {
    const g = e.target.closest ? e.target.closest('[data-node]') : null
    if (!g) return
    const nid = g.getAttribute('data-node')
    if (!nid) return
    hideTip()   // 点击去看右侧详情了，提示别继续挡着
    highlightFlow(nid)
    if (onNodeClick) onNodeClick(nid)
  }

  /** 清掉上一次的流动高亮（出入两种色都清，含把箭头换回灰色）。 */
  function clearFlow() {
    if (!svgEl) return
    svgEl.querySelectorAll(`.${FLOW_CLS}, .${FLOW_IN_CLS}`).forEach((p) => {
      p.classList.remove(FLOW_CLS, FLOW_IN_CLS)
      const orig = p.getAttribute('data-flow-marker')
      if (orig) {
        p.setAttribute('marker-end', orig)
        p.removeAttribute('data-flow-marker')
      }
    })
  }

  /**
   * 点击节点 → 让**从这个节点出去的线**流动起来，一直到目标节点。
   *
   * 要覆盖三段才"看起来流到了目标"：
   *   1. 该节点的出主干（`data-out`）
   *   2. 该节点出发的全部分支（`data-from`）
   *   3. **各目标节点的入主干**（`data-in`）——少了这段，流动在目标上方就断了
   *
   * 分支本身只到"目标上方"，最后一截竖线是目标节点的入主干，所以第 3 段必须带上。
   *
   * 色值 / 类名与 styles.css 的 `.bs-edge-flow` 成对；改一处要改两处。
   */
  /**
   * 给一批路径上流动高亮，并把**带箭头的那些**换成对应颜色的箭头。
   *
   * 箭头必须一起换：只改线色不改箭头，会得到"蓝色的线 + 灰色的箭头"。
   * 原色记在 `data-flow-marker` 上，`clearFlow` 靠它还原。
   */
  function paintFlow(paths, cls, markerSuffix) {
    paths.forEach((p) => {
      p.classList.add(cls)
      const m = p.getAttribute('marker-end')
      if (m) {
        p.setAttribute('data-flow-marker', m)
        p.setAttribute('marker-end', `url(#${markerId}${markerSuffix})`)
      }
    })
  }

  function highlightFlow(nid) {
    flowNode = nid
    clearFlow()
    if (!svgEl) return
    const q = (attr, val) => {
      const safe = String(val).replace(/["\\]/g, '\\$&')
      return svgEl.querySelectorAll(`[data-${attr}="${safe}"]`)
    }

    // ===== 出的线（蓝）：这个节点流向谁 =====
    const targets = new Set()
    q('from', nid).forEach((p) => {
      p.classList.add(FLOW_CLS)
      const to = p.getAttribute('data-to')
      if (to) targets.add(to)
    })
    q('out', nid).forEach((p) => p.classList.add(FLOW_CLS))
    targets.forEach((t) => {
      q('in', t).forEach((p) => {
        p.classList.add(FLOW_CLS)
        const m = p.getAttribute('marker-end')
        if (m) {
          p.setAttribute('data-flow-marker', m)
          p.setAttribute('marker-end', `url(#${markerId}Flow)`)
        }
      })
    })

    // ===== 入的线（琥珀）：谁流到这个节点 =====
    //
    // 与出向是**镜像**的三段（同一张图反过来看）：
    //   1. 到这个节点的分支（`data-to`）
    //   2. 这个节点自己的入主干（`data-in`）—— 带箭头，是"流进来"的最后一段
    //   3. **各来源节点的出主干**（`data-out`）—— 少了这段，流动在来源节点下方就断了
    //
    // 单列一色而不复用蓝色：一个中间节点同时有进有出，同色的话两个方向糊在一起，
    // 分不出"哪条是喂给我的、哪条是我喂出去的"。
    const sources = new Set()
    q('to', nid).forEach((p) => {
      p.classList.add(FLOW_IN_CLS)
      const from = p.getAttribute('data-from')
      if (from) sources.add(from)
    })
    paintFlow(q('in', nid), FLOW_IN_CLS, 'In')
    sources.forEach((s) => paintFlow(q('out', s), FLOW_IN_CLS, 'In'))
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
  function onMouseOver(e) {
    const g = e.target.closest ? e.target.closest('[data-node]') : null
    onNodeHover(g ? g.getAttribute('data-node') : null, g)
  }

  function onMouseOut(e) {
    const g = e.target.closest ? e.target.closest('[data-node]') : null
    // 只有真正离开节点才收起；节点内的子元素之间移动不触发（relatedTarget 仍在同一 g 内）
    if (!g) return
    const to = e.relatedTarget
    if (to && g.contains(to)) return
    hideTip()
  }

  function mount() {
    if (zoomEl) {
      zoomEl.addEventListener('click', onClick)
      zoomEl.addEventListener('mouseover', onMouseOver)
      zoomEl.addEventListener('mouseout', onMouseOut)
    }

    const ro =
      typeof ResizeObserver !== 'undefined' && zoomEl
        ? new ResizeObserver(() => fitGraph())
        : null
    ro?.observe(zoomEl)

    return () => {
      zoomEl?.removeEventListener('click', onClick)
      zoomEl?.removeEventListener('mouseover', onMouseOver)
      zoomEl?.removeEventListener('mouseout', onMouseOut)
      hideTip()
      ro?.disconnect()
    }
  }

  return { render: renderGraph, reset, fit: fitGraph, mount, clearFlow }
}

/** 属性值转义（改造前用的是 escapeHtml，同样基于 DOM；这里只需满足属性场景） */
function escapeAttr(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
