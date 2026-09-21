/**
 * Service Intelligence Platform - Main Application
 */

(function () {
    'use strict';

    // ── Vue 共存接缝（v2.0.0）──────────────────────────────────
    // 自 v2.0.0 起本文件与 Vue 外壳（src/）在同一文档内共存。唯一不变式：
    // **同一棵 DOM 子树只能有一个所有者**。
    //   - 未迁移的 15 个视图仍归本文件；
    //   - 它们所在的宿主元素由 Vue 提供（见 src/legacy/bridge.js）。
    // 因此本文件里所有「全文档」查询都必须收进 legacyRoot()，否则会误伤 Vue 渲染的
    // 节点 —— 典型后果是 initTableSorting 直接 appendChild 重排 Vue 表格的行，
    // 导致 vdom 与真实 DOM 失步（症状随机、难复现）。
    //
    // 独立打开旧 index.html 时 __SIP_LEGACY_ROOT 未定义 → 回退 document，
    // 行为与改造前完全一致。
    function legacyRoot() {
        return window.__SIP_LEGACY_ROOT || document;
    }

    // ── Shared Utilities ──────────────────────────────────────
    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(text));
        return div.innerHTML;
    }

    function truncateText(text, maxLen) {
        if (!text) return '';
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen) + '...[truncated]';
    }

    // ── Problem Record 判定（Smart Inspection 与 Diagnosis Center 共用）─────
    // 【为什么放顶层】Smart Inspection 徽标上的数字必须**等于**点进 Diagnosis Center 后看到
    // 的行数（验收锚点是 #pcRowCount）。这个不变式只有在两侧用**同一套**判定时才成立 ——
    // 各写一份的话，今天能对上纯属巧合，后端一改就静默漂移。所以谓词共享，而不是各自
    // 塞进 initSmartInspection / initProblems 的闭包。
    //
    // 术语沿用后端（aiops-apm-anomaly-detector）：
    //   - 未解决 = state ∈ {pending, in_progress}。**白名单**而非「排除 resolved/closed/
    //     archived」—— 后端将来加状态时，白名单让两侧**一样地**不计入；黑名单会一边算
    //     一边不算。当前 5 个状态下两种写法等价，且与 Diagnosis Center 的 "Open" chip 逐字相同。
    //   - 类型由证据派生、不入库（后端 router/problems.py 的 _detection_type 也是这么算的）：
    //     metric_anomalies / log_anomalies 谁非空就是谁。**不要**改用 detection_type 等值判断
    //     —— 它的取值是 log/metric/combined/unknown，combined 记录在等值判断下两种筛选都
    //     匹配不上，而按证据判断时两列各计一次（这才是要的）。
    //   - service 可能是逗号拼接的多服务串（后端 M9 起），按**成员**匹配而非整串相等。

    function problemIsOpen(state) {
        var st = String(state || '').toLowerCase();
        return st === 'pending' || st === 'in_progress';
    }

    // 展示状态：**用户看到的那个词**由 state + resolve_reason 一起决定，返回 {cls, label}。
    //
    // 【为什么忽略要单独一档】后端两个终态是「有没有给结论」的意思，不是「谁关的」：
    //   resolved（+reason auto/manual/false_positive）= 已修复/已处理
    //   closed  （+reason ignored）                  = 人判定不做，即「忽略」
    // 行上的 Ignore 按钮走 POST /v1/problems/{id}/ignore（后端 close(reason=ignored)）。
    // 早期它打的是 /resolve + false_positive:true —— 界面上说「忽略」，库里写 resolved、
    // 顺带记一次误报（污染误报率），三处都在替用户编造结论。
    //
    // cls 用于 alert-tag 的 status-<cls>（styles.css 的色板，ignored 与 closed 同为灰）；
    // 其余状态**原样返回 state**（大小写照旧，与改造前逐字一致），颜色与文案都不变。
    // 表格与详情模态共用本函数 —— 各写一份就会出现「列里写 ignored、弹框里写 closed」。
    function problemDisplayStatus(rec) {
        var st = String((rec && rec.state) || 'pending').toLowerCase();
        var reason = String((rec && rec.resolve_reason) || '').toLowerCase();
        if (st === 'closed' && reason === 'ignored') return { cls: 'ignored', label: 'ignored' };
        return { cls: st, label: (rec && rec.state) ? rec.state : 'pending' };
    }

    function problemHasMetric(p) {
        return !!(p && p.metric_anomalies && p.metric_anomalies.length);
    }

    function problemHasLog(p) {
        return !!(p && p.log_anomalies && p.log_anomalies.length);
    }

    /** 记录点名的服务列表（逗号串拆开、trim、去空、去重） */
    function problemServiceNames(p) {
        var raw = (p && p.service) ? String(p.service) : '';
        var out = [];
        raw.split(',').forEach(function (name) {
            var s = name.trim();
            if (s && out.indexOf(s) === -1) out.push(s);
        });
        return out;
    }

    /**
     * 该记录是否属于某服务。
     *
     * 两种都要认：
     *   1. **整串相等** —— Diagnosis Center 的下拉框（#pcServiceFilter）是拿 p.service 的原始值
     *      建的 option，所以用户可能选中的就是 "gateway-service,order-service" 这一整串；
     *   2. **成员匹配** —— 徽标按单个服务名下钻时要能找到合并记录。
     *
     * 只做 (2) 会漏掉 (1)：合并记录的下拉项选中后一条都匹配不上，表格直接空 —— 这是回归。
     * 只做 (1) 则徽标与落点对不上（徽标按成员计，下钻却查不到）。所以两个都写。
     */
    function problemMatchesService(p, name) {
        if (!name) return true;                 // 空 = 不过滤
        if (!p || !p.service) return false;
        var want = String(name);
        if (String(p.service) === want) return true;
        return problemServiceNames(p).indexOf(want) !== -1;
    }

    /** type ∈ {'metric','log'}；'all' / 空 = 不过滤。combined 记录两种都匹配（有意） */
    function problemMatchesType(p, type) {
        if (!type || type === 'all') return true;
        if (type === 'metric') return problemHasMetric(p);
        if (type === 'log') return problemHasLog(p);
        return true;
    }

    /**
     * 拉问题记录列表。
     *
     * 【为什么这里自己 fetch 而不是复用 apmApi】本文件里 apmApi 已有 3 份**各自闭包内**的
     * 副本（initProblems:3756 / initMonitorTargets:6077 / initDomainConfig:6466），因为每个
     * initXxx() 自成闭包。本次不再加第 4 份 —— 谓词既然已经共享，fetch 也一并共享，顺带把
     * limit=500 钉在一处（两侧用不同 limit 会让徽标与落点悄悄对不上）。三份旧副本原样不动，
     * 将来可收敛到这里。
     *
     * base/tenant/key **在调用时**读 localStorage，不在脚本求值时读 —— 顶层 var 会把值冻结
     * 在加载那一刻，破坏运行时的 localStorage 覆盖（另三个消费者的习惯也是如此）。
     *
     * 注：默认 http://localhost:7070 是**绝对 URL**，与另外三个 APM 消费方一致（靠后端 CORS，
     * 实测 Access-Control-Allow-Origin: *）。这不是 Smart Inspection 那个「改走相对路径
     * /agentflow」决策的倒退 —— 那条只针对 agentflow(:8000)；APM 侧本来就没有 Vite proxy，
     * 改相对路径要连生产 nginx 一起动。
     *
     * 若后端记录超过 500 条，两侧读的是**同一份**截断列表，因此一样地少算 —— 不变式仍成立。
     * 要放宽就改这一处。
     */
    function fetchProblemRecords() {
        var base = localStorage.getItem('apmBaseUrl') || 'http://localhost:7070';
        var headers = { 'X-Tenant-Id': localStorage.getItem('apmTenantId') || 'default' };
        var apiKey = localStorage.getItem('apmApiKey') || '';
        if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

        return fetch(base + '/v1/problems?limit=500', { headers: headers })
            .then(function (res) {
                return res.text().then(function (text) {
                    var data = null;
                    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
                    if (!res.ok) {
                        var reason = 'HTTP ' + res.status;
                        if (data && typeof data === 'object' && data.reason) reason = data.reason;
                        var err = new Error(reason);
                        err.status = res.status;
                        err.data = data;
                        throw err;
                    }
                    return (data && data.items) ? data.items : [];
                });
            });
    }

    function navigateToPage(pageId, context) {
        // 接缝 S3：外壳归 Vue 后，跨页下钻改走 Vue Router（URL 可分享、可刷新），
        // 不再把 context 塞 sessionStorage 再靠切页时读回。
        if (window.__SIP_NAVIGATE) {
            return window.__SIP_NAVIGATE(pageId, context);
        }
        if (context) {
            sessionStorage.setItem('navContext', JSON.stringify(context));
        }
        var panelId = pageId.indexOf('page-') === 0 ? pageId : 'page-' + pageId;
        showPage(panelId);
    }

    function getNavContext() {
        var raw = sessionStorage.getItem('navContext');
        sessionStorage.removeItem('navContext');
        if (raw) {
            try { return JSON.parse(raw); } catch (e) { return {}; }
        }
        return {};
    }

    // ── Page Switching ──────────────────────────────────────────
    var _pageRefreshers = {};

    function showPage(pageId) {
        // 接缝 S1：只切 legacy 子树内的面板，不碰 Vue 渲染的视图
        legacyRoot().querySelectorAll('.page-panel').forEach(function (p) {
            p.style.display = 'none';
        });
        var target = document.getElementById(pageId);
        if (target) target.style.display = 'block';
        // 关闭 Monitor Target / Domain Config 模态框与确认弹窗（fixed 遮罩若残留会盖住其他页面）
        var apmModal = document.getElementById('apmModalOverlay');
        if (apmModal) apmModal.classList.remove('open');
        var dcModal = document.getElementById('dcModalOverlay');
        if (dcModal) dcModal.classList.remove('open');
        var confirmModal = document.getElementById('confirmModalOverlay');
        if (confirmModal) confirmModal.classList.remove('open');
        // Trigger page refresh if handler registered
        var refresh = _pageRefreshers[pageId];
        if (typeof refresh === 'function') refresh();
    }

    // 接缝 S8：把切页能力交给 Vue 外壳的路由守卫。10 处 _pageRefreshers 注册
    // 原样保留生效（切页时仍会触发对应视图的刷新闭包）。
    window.__SIP_SHOW_PAGE = showPage;

    // 详情抽屉是五个功能共用的（知识库 / Reflow / Agent / 工单 / Smart Inspection），
    // 标题必须由打开方自己设 —— 否则会串成别人的标题（Smart Inspection 的详情曾长期
    // 显示 "Knowledge Entry Detail"）。
    // **必须定义在这一层**：各 init*() 是互不相通的闭包，放进去别处就调不到
    // （曾因此让 Detail 按钮抛 ReferenceError）。
    function setDrawerTitle(title) {
        var el = document.getElementById('drawerTitle');
        if (el) el.textContent = title;
    }

    // 接缝 S9（计划稿写 8 处，实施时补的第 9 处）：
    // 5 个无侧边栏的「空壳」顶部域（Constellation / Architecture / FinOps /
    // Security Ops / Value Pool）在改造前走 initNavigation 的 else 分支 ——
    // 隐藏所有侧边栏 → showPage('page-service-ops') → 把该页标题改成域名、清空描述。
    //
    // ⚠️ 这份名单归**旧单页世界**所有（独立打开 index.html 时才走到），
    // 与 Vue 侧 NAV 是两份互不同步的实现 —— 那边 Value Pool 已于 2026-09-17 摘除，
    // 这边**保持 5 个不变**（旧入口里那个 nav-item 还在，点它仍走 else 分支）。
    // 不要为了「对齐」来改这里。
    // 后两个节点在 #page-service-ops 内，归本文件所有，所以由本文件提供受控入口，
    // 而不是让 Vue 直接改 legacy DOM。
    // 顺带修掉一个潜伏 bug：改造前用的是 document.querySelector('.page-title')，
    // 取的是**全文档首个**匹配 —— 外壳归 Vue 后会误取 Vue 渲染的标题。
    window.__SIP_SET_DOMAIN_HEADER = function (title, desc) {
        var root = legacyRoot();
        var t = root.querySelector('#page-service-ops .page-title');
        var d = root.querySelector('#page-service-ops .page-desc');
        if (t) t.textContent = title || '';
        if (d) d.textContent = desc || '';
    };

    // ── Sidebar ─────────────────────────────────────────────────
    function initSidebar() {
        var sidebars = legacyRoot().querySelectorAll('.sidebar');

        sidebars.forEach(function (sidebar) {
            // Tree expand/collapse
            sidebar.querySelectorAll('.has-children').forEach(function (item) {
                item.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var targetId = item.getAttribute('data-toggle');
                    var children = document.getElementById(targetId);
                    item.classList.toggle('expanded');
                    if (children) {
                        children.classList.toggle('collapsed');
                    }
                });
            });

            // Leaf item click - switch page
            sidebar.querySelectorAll('.sidebar-item:not(.has-children)').forEach(function (item) {
                item.addEventListener('click', function () {
                    sidebar.querySelectorAll('.sidebar-item:not(.has-children)').forEach(function (s) { return s.classList.remove('active'); });
                    item.classList.add('active');
                    var page = item.getAttribute('data-page');
                    if (page === 'knowledge-reflow-log') {
                        showPage('page-reflow-log');
                    } else if (page === 'knowledge-search') {
                        showPage('page-knowledge-search');
                        loadKnowledgeStats();
                    } else if (page === 'agent-tasks') {
                        showPage('page-agent-tasks');
                    } else if (page === 'l1-automation') {
                        showPage('page-l1-automation');
                    } else if (page === 'approval-center') {
                        showPage('page-approval-center');
                    } else if (page === 'smart-inspection') {
                        showPage('page-smart-inspection');
                    } else if (page === 'metrics-analysis') {
                        showPage('page-metrics-analysis');
                    } else if (page === 'log-analysis') {
                        showPage('page-log-analysis');
                    } else if (page === 'problems') {
                        showPage('page-problems');
                    } else if (page === 'monitor-targets') {
                        showPage('page-monitor-targets');
                    } else if (page === 'domain-config') {
                        showPage('page-domain-config');
                    } else if (page === 'agent-registry') {
                        showPage('page-agents');
                    } else if (page === 'workflow-studio') {
                        showPage('page-workflow-studio');
                    } else if (page === 'bug-solve') {
                        showPage('page-bug-solve');
                    } else if (page === 'mcp-servers') {
                        showPage('page-mcp-servers');
                    } else if (page === 'agent-config') {
                        showPage('page-agent-config');
                    }
                });
            });
        });
    }

    // ── Knowledge Search ───────────────────────────────────────
    var KB_API_BASE = 'http://localhost:8000';
    var ksStats = null;
    var ksResults = [];

    function loadKnowledgeStats() {
        // Use ingestion-log API for consistency with Reflow Log page
        fetch(KB_API_BASE + '/ingestion-log?size=1').then(function (res) { return res.json(); }).then(function (data) {
            ksStats = data;
            updateKsKpiCards();
        }).catch(function () {});
    }

    function updateKsKpiCards() {
        var stats = (ksStats && ksStats.stats) ? ksStats.stats : {};
        var totalChunks = stats.total_chunks || 0;
        var totalEntries = (ksStats && ksStats.total) ? ksStats.total : 0;
        var bySource = stats.by_source || {};

        var elChunks = document.getElementById('ksTotalChunks');
        var elEntries = document.getElementById('ksReflowEntries');
        if (elChunks) elChunks.textContent = Number(totalChunks).toLocaleString();
        if (elEntries) elEntries.textContent = String(totalEntries);

        ['jira', 'servicenow', 'confluence', 'manual'].forEach(function (src) {
            var el = document.getElementById('ksKpi' + (src === 'servicenow' ? 'ServiceNow' : src.charAt(0).toUpperCase() + src.slice(1)));
            if (el) el.textContent = String(bySource[src] || 0);
        });
    }

    function doSearch() {
        var question = document.getElementById('ksSearchInput').value.trim();
        if (!question) return;
        var sourceEl = document.getElementById('ksSourceFilter');
        var source = (sourceEl && sourceEl.value !== 'all') ? sourceEl.value : null;

        showKsLoading(true);
        fetch(KB_API_BASE + '/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: question, top_k: 10, source: source, distance_threshold: 0.7, use_llm_rerank: true })
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).then(function (data) {
            ksResults = data.results || [];
            renderKsResults();
        }).catch(function (err) {
            ksResults = [];
            renderKsError('Search failed: ' + err.message);
        });
    }

    function showKsLoading(show) {
        var c = document.getElementById('ksResultsContainer');
        if (c && show) c.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text-secondary);"><div class="si-loading-spinner" style="margin:0 auto 12px;"></div>Searching knowledge base...</div>';
    }

    function renderKsResults() {
        var c = document.getElementById('ksResultsContainer');
        var countEl = document.getElementById('ksResultCount');
        if (!c) return;

        if (!ksResults.length) {
            c.innerHTML = '<div class="table-container" style="text-align:center;padding:48px;color:var(--text-secondary);"><p style="font-size:14px;margin-bottom:8px;">No matching knowledge found.</p><p style="font-size:11px;">Try a different query or broader search terms.</p></div>';
            if (countEl) countEl.textContent = '';
            return;
        }

        if (countEl) countEl.textContent = ksResults.length + ' result' + (ksResults.length > 1 ? 's' : '') + ' found';

        var html = '<div class="ks-results-list">';
        ksResults.forEach(function (r, i) {
            var meta = r.metadata || {};
            var src = (meta.source || 'unknown').toLowerCase();
            var badgeClass, dotClass;
            if (src === 'servicenow') { badgeClass = 'sn'; dotClass = 'sn-bg'; }
            else if (src === 'jira') { badgeClass = 'jira'; dotClass = 'jira-bg'; }
            else if (src === 'confluence') { badgeClass = 'conf'; dotClass = 'conf-bg'; }
            else { badgeClass = 'manual'; dotClass = 'manual-bg'; }
            var displaySource = (meta.source || 'Unknown').charAt(0).toUpperCase() + (meta.source || 'unknown').slice(1);
            var parentId = meta.parent_id || meta.source_id || '';
            var content = r.content || '';
            var section = meta.section || '';
            var service = meta.service || '';
            var title = meta.title || meta.parent_title || parentId;
            var matchedChunks = r.matched_chunks || [];
            var uniqueSections = [];
            matchedChunks.forEach(function (mc) {
                if (mc.section && uniqueSections.indexOf(mc.section) === -1) uniqueSections.push(mc.section);
            });

            html += '<div class="ks-result-card">';
            html += '<div class="ks-result-header">';
            html += '<span class="source-badge ' + badgeClass + '"><span class="source-dot ' + dotClass + '"></span> ' + displaySource + '</span>';
            if (service) html += '<span class="ks-result-service">' + escapeHtml(service) + '</span>';
            if (uniqueSections.length) {
                uniqueSections.forEach(function (s) {
                    html += '<span class="ks-result-section">' + escapeHtml(s) + '</span>';
                });
            }
            html += '<span style="flex:1;"></span>';
            if (matchedChunks.length > 1) {
                html += '<span class="ks-chunks-badge" title="' + matchedChunks.length + ' matching chunks from this document">' + matchedChunks.length + ' chunks</span>';
            }
            if (r.llm_score != null) {
                var scoreClass = r.llm_score >= 7 ? 'ks-dist-high' : (r.llm_score >= 4 ? 'ks-dist-mid' : 'ks-dist-low');
                html += '<span class="ks-dist-badge ' + scoreClass + '" title="LLM relevance score">AI ' + r.llm_score.toFixed(1) + '</span>';
            }
            var dist = r.distance;
            var distClass = dist != null ? (dist < 0.6 ? 'ks-dist-high' : (dist < 0.8 ? 'ks-dist-mid' : 'ks-dist-low')) : '';
            var distText = dist != null ? dist.toFixed(3) : '-';
            html += '<span class="ks-dist-badge ' + distClass + '">' + distText + '</span>';
            html += '</div>';
            html += '<div class="ks-result-title">' + escapeHtml(title) + '</div>';
            html += '<div class="ks-result-content">' + escapeHtml(content.length > 400 ? content.substring(0, 400) + '...' : content) + '</div>';
            html += '<div class="ks-result-footer">';
            if (meta.tags && meta.tags.length) {
                var tags = Array.isArray(meta.tags) ? meta.tags : String(meta.tags).split(',');
                tags.forEach(function (t) {
                    t = String(t).trim();
                    if (t) html += '<span class="tag">' + escapeHtml(t) + '</span>';
                });
            }
            html += '<span style="flex:1;"></span>';
            html += '<button class="detail-btn" data-source="' + escapeHtml(meta.source || '') + '" data-id="' + escapeHtml(parentId) + '">View Detail</button>';
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';
        c.innerHTML = html;

        c.querySelectorAll('.detail-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openKsDrawer(btn.getAttribute('data-source'), btn.getAttribute('data-id'));
            });
        });
    }

    function renderKsError(msg) {
        var c = document.getElementById('ksResultsContainer');
        if (c) c.innerHTML = '<div class="table-container" style="text-align:center;padding:48px;color:var(--ef4444);"><p>' + escapeHtml(msg) + '</p></div>';
    }

    function openKsDrawer(source, sourceId) {
        var drawerContent = document.getElementById('drawerContent');
        drawerContent.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-secondary);">Loading detail...</p>';
        document.getElementById('drawerOverlay').classList.add('open');

        fetch(KB_API_BASE + '/knowledge/' + encodeURIComponent(source) + '/' + encodeURIComponent(sourceId))
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .then(function (d) {
                var srcLower = (d.source || '').toLowerCase();
                var dotClass;
                if (srcLower === 'servicenow') dotClass = 'sn-bg';
                else if (srcLower === 'jira') dotClass = 'jira-bg';
                else if (srcLower === 'confluence') dotClass = 'conf-bg';
                else dotClass = 'manual-bg';
                var displaySource = (d.source || '').charAt(0).toUpperCase() + (d.source || '').slice(1);
                var closedTime = d.closed_time ? d.closed_time.slice(0, 19).replace('T', ' ') : '-';
                var reflowTime = d.reflow_time ? d.reflow_time.slice(0, 19).replace('T', ' ') : '-';
                var tagsHtml = (d.tags || []).map(function (t) {
                    return '<span class="tag">' + escapeHtml(t) + '</span>';
                }).join(' ') || '<span class="text-secondary">-</span>';
                drawerContent.innerHTML =
                    '<div class="detail-meta">' +
                    '<span class="meta-badge"><span class="source-dot ' + dotClass + '"></span> ' + displaySource + '</span>' +
                    '<span class="meta-badge">' + escapeHtml(d.source_id) + '</span>' +
                    '<span class="meta-badge">Service: ' + escapeHtml(d.service || '-') + '</span>' +
                    '<span class="meta-badge">Closed: ' + closedTime + '</span>' +
                    '<span class="meta-badge">Reflowed: ' + reflowTime + '</span>' +
                    '</div>' +
                    '<div class="detail-block"><label>Title</label><p style="font-size:13px;color:var(--text-primary);">' + escapeHtml(d.title) + '</p></div>' +
                    '<div class="detail-block"><label>Problem Description</label><p style="font-size:12px;color:var(--text-primary);line-height:1.6;">' + escapeHtml(d.problem_summary || '-') + '</p></div>' +
                    '<div class="detail-block"><label>Solution</label><div class="code-block">' + escapeHtml(d.solution_summary || '-') + '</div></div>' +
                    '<div class="detail-block"><label>Tags</label><div>' + tagsHtml + '</div></div>' +
                    '<div class="detail-block"><label>Full Content</label><div class="code-block" style="max-height:250px;overflow-y:auto;white-space:pre-wrap;font-size:11px;">' + escapeHtml(d.full_content || '') + '</div></div>' +
                    '<div class="detail-block"><label>Vectorization Status</label><p style="font-size:12px;color:var(--accent-green);">Embedding generated, Index updated at ' + reflowTime + '</p></div>';
            }).catch(function (err) {
                drawerContent.innerHTML = '<div class="detail-block"><p style="color:var(--text-secondary);">Failed to load detail: ' + escapeHtml(err.message) + '</p></div>';
            });
    }

    function initKnowledgeSearch() {
        document.getElementById('ksSearchBtn').addEventListener('click', doSearch);
        document.getElementById('ksSearchInput').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') doSearch();
        });
        document.getElementById('ksResetBtn').addEventListener('click', function () {
            document.getElementById('ksSearchInput').value = '';
            document.getElementById('ksSourceFilter').value = 'all';
            ksResults = [];
            var c = document.getElementById('ksResultsContainer');
            if (c) c.innerHTML = '';
            var countEl = document.getElementById('ksResultCount');
            if (countEl) countEl.textContent = '';
        });
        loadKnowledgeStats();
    }

    // ── Knowledge Reflow Log ────────────────────────────────────
    function initReflowLog() {
        var reflowData = [];           // current page entries (10 per page)
        var reflowStats = null;        // stats from API response
        var currentPage = 1;           // current page (1-based)
        var pageSize = 10;             // entries per page (fixed)
        var totalCount = 0;            // total entries from API
        var totalPages = 1;            // calculated from totalCount
        var currentSource = null;      // active source filter (null = all)
        var reflowPollTimer = null;

        // ── Fetch one page from API ─────────────────────────────
        function fetchPage(page, source) {
            var url = KB_API_BASE + '/ingestion-log?size=' + pageSize + '&page=' + page;
            if (source) url += '&source=' + encodeURIComponent(source);
            return fetch(url).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (json) {
                reflowStats = json.stats || null;
                totalCount = json.total || 0;
                totalPages = Math.ceil(totalCount / pageSize) || 1;
                reflowData = (json.entries || []).map(function (e) {
                    return {
                        source: e.source,
                        sourceId: e.source_id,
                        title: e.title,
                        time: (e.timestamp || '').slice(0, 19).replace('T', ' '),
                        chunks: e.chunks,
                        action: e.action
                    };
                });
                return reflowData;
            }).catch(function (err) {
                console.warn('Failed to fetch reflow log:', err.message);
                reflowData = [];
                reflowStats = null;
                totalCount = 0;
                totalPages = 1;
                return reflowData;
            });
        }

        // ── Fetch knowledge detail (for drawer) ──────────────────
        function fetchKnowledgeDetail(source, sourceId) {
            return fetch(KB_API_BASE + '/knowledge/' + encodeURIComponent(source) + '/' + encodeURIComponent(sourceId))
                .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
                .catch(function () { return null; });
        }

        // ── Render table (reflowData = current page) ─────────────
        function renderTable() {
            var tbody = document.getElementById('reflowTableBody');
            if (!tbody) return;

            if (!reflowData.length) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-secondary);">No records found.</td></tr>';
            } else {
                tbody.innerHTML = reflowData.map(function (item) {
                    var srcLower = item.source.toLowerCase();
                    var badgeClass, dotClass;
                    if (srcLower === 'servicenow') { badgeClass = 'sn'; dotClass = 'sn-bg'; }
                    else if (srcLower === 'jira') { badgeClass = 'jira'; dotClass = 'jira-bg'; }
                    else if (srcLower === 'confluence') { badgeClass = 'conf'; dotClass = 'conf-bg'; }
                    else { badgeClass = 'manual'; dotClass = 'manual-bg'; }
                    var displaySource = item.source.charAt(0).toUpperCase() + item.source.slice(1);
                    return '<tr>' +
                        '<td><span class="source-badge ' + badgeClass + '"><span class="source-dot ' + dotClass + '"></span> ' + displaySource + '</span></td>' +
                        '<td><span class="ticket-link">' + escapeHtml(item.sourceId) + '</span></td>' +
                        '<td><span class="summary-text" title="' + escapeHtml(item.title) + '">' + escapeHtml(item.title) + '</span></td>' +
                        '<td>' + item.chunks + '</td>' +
                        '<td>' + item.time + '</td>' +
                        '<td><button class="detail-btn" data-source="' + escapeHtml(item.source) + '" data-id="' + escapeHtml(item.sourceId) + '">Detail</button></td>' +
                        '</tr>';
                }).join('');
                tbody.querySelectorAll('.detail-btn').forEach(function (btn) {
                    btn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        openDrawer(btn.getAttribute('data-source'), btn.getAttribute('data-id'));
                    });
                });
            }
            renderPagination();
        }

        // ── Pagination UI ─────────────────────────────────────────
        function renderPagination() {
            var pagDiv = document.getElementById('reflowPagination');
            if (!pagDiv) return;
            var start = (currentPage - 1) * pageSize + 1;
            var end = Math.min(currentPage * pageSize, totalCount);
            var html = '<span>' + start + '-' + end + ' of ' + totalCount + '</span>';
            for (var p = 1; p <= totalPages; p++) {
                html += '<div class="page-item' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</div>';
            }
            if (totalPages > 1) {
                html += '<div class="page-item" data-page="' + (currentPage < totalPages ? currentPage + 1 : totalPages) + '">&rsaquo;</div>';
            }
            pagDiv.innerHTML = html;
            pagDiv.querySelectorAll('.page-item').forEach(function (el) {
                el.addEventListener('click', function () {
                    var p = parseInt(el.getAttribute('data-page'), 10);
                    if (p >= 1 && p <= totalPages && p !== currentPage) {
                        currentPage = p;
                        fetchPage(currentPage, currentSource).then(function () {
                            renderTable();
                        });
                    }
                });
            });
        }

        // ── KPI cards (from API stats) ────────────────────────────
        function updateKpiCards() {
            var totalChunks = reflowStats ? reflowStats.total_chunks : 0;
            var bySource = reflowStats ? reflowStats.by_source : {};

            var elTotal = document.getElementById('kpiTotalProcessed');
            var elEntries = document.getElementById('kpiYesterday');
            if (elTotal) elTotal.textContent = Number(totalChunks).toLocaleString();
            if (elEntries) elEntries.textContent = String(totalCount);
            ['jira', 'servicenow', 'confluence', 'manual'].forEach(function (src) {
                var el = document.getElementById('kpi' + (src === 'servicenow' ? 'ServiceNow' : src.charAt(0).toUpperCase() + src.slice(1)));
                if (el) el.textContent = String(bySource[src] || 0);
            });
        }

        function updateLastExecutionTime() {
            var el = document.getElementById('lastExecutionTime');
            if (el) el.textContent = reflowData.length > 0 ? 'Last execution: ' + reflowData[0].time : 'Last execution: N/A';
        }

        // ── Drawer detail ─────────────────────────────────────────
        function openDrawer(source, sourceId) {
            document.getElementById('drawerContent').innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-secondary);">Loading detail...</p>';
            document.getElementById('drawerOverlay').classList.add('open');
            fetchKnowledgeDetail(source, sourceId).then(function (detail) {
                if (!detail) {
                    var entry = reflowData.find(function (d) { return d.source === source && d.sourceId === sourceId; });
                    renderDrawerFallback(entry || { source: source, sourceId: sourceId, title: 'N/A', time: 'N/A' });
                    return;
                }
                var srcLower = detail.source.toLowerCase();
                var dotClass;
                if (srcLower === 'servicenow') dotClass = 'sn-bg';
                else if (srcLower === 'jira') dotClass = 'jira-bg';
                else if (srcLower === 'confluence') dotClass = 'conf-bg';
                else dotClass = 'manual-bg';
                var displaySource = detail.source.charAt(0).toUpperCase() + detail.source.slice(1);
                var closedTime = detail.closed_time ? detail.closed_time.slice(0, 19).replace('T', ' ') : '-';
                var reflowTime = detail.reflow_time ? detail.reflow_time.slice(0, 19).replace('T', ' ') : '-';
                var tagsHtml = (detail.tags || []).map(function (t) {
                    return '<span class="tag">' + escapeHtml(t) + '</span>';
                }).join(' ') || '<span class="text-secondary">-</span>';
                document.getElementById('drawerContent').innerHTML =
                    '<div class="detail-meta">' +
                    '<span class="meta-badge"><span class="source-dot ' + dotClass + '"></span> ' + displaySource + '</span>' +
                    '<span class="meta-badge">' + escapeHtml(detail.source_id) + '</span>' +
                    '<span class="meta-badge">Closed: ' + closedTime + '</span>' +
                    '<span class="meta-badge">Reflowed: ' + reflowTime + '</span>' +
                    '</div>' +
                    '<div class="detail-block"><label>Problem Description</label><p style="font-size:12px;color:var(--text-primary);line-height:1.6;">' + escapeHtml(detail.problem_summary || '-') + '</p></div>' +
                    '<div class="detail-block"><label>Solution</label><div class="code-block">' + escapeHtml(detail.solution_summary || '-') + '</div></div>' +
                    '<div class="detail-block"><label>Tags</label><div>' + tagsHtml + '</div></div>' +
                    '<div class="detail-block"><label>Full Content</label><div class="code-block" style="max-height:250px;overflow-y:auto;white-space:pre-wrap;font-size:11px;">' + escapeHtml(detail.full_content || '') + '</div></div>' +
                    '<div class="detail-block"><label>Vectorization Status</label><p style="font-size:12px;color:var(--accent-green);">Embedding generated, Index updated at ' + reflowTime + '</p></div>';
            }).catch(function () {
                var entry = reflowData.find(function (d) { return d.source === source && d.sourceId === sourceId; });
                renderDrawerFallback(entry || { source: source, sourceId: sourceId, title: 'Error', time: 'N/A' });
            });
        }

        function renderDrawerFallback(item) {
            var srcLower = item.source.toLowerCase();
            var dotClass;
            if (srcLower === 'servicenow') dotClass = 'sn-bg';
            else if (srcLower === 'jira') dotClass = 'jira-bg';
            else if (srcLower === 'confluence') dotClass = 'conf-bg';
            else dotClass = 'manual-bg';
            document.getElementById('drawerContent').innerHTML =
                '<div class="detail-meta">' +
                '<span class="meta-badge"><span class="source-dot ' + dotClass + '"></span> ' + item.source + '</span>' +
                '<span class="meta-badge">' + escapeHtml(item.sourceId) + '</span>' +
                '<span class="meta-badge">Reflowed: ' + item.time + '</span>' +
                '</div>' +
                '<div class="detail-block"><p style="font-size:12px;color:var(--text-secondary);">' + escapeHtml(item.title) + '</p></div>';
        }

        function closeDrawer() {
            document.getElementById('drawerOverlay').classList.remove('open');
        }

        // ── Full refresh (reset to page 1, fetch + render) ────────
        function fullRefresh() {
            var sourceEl = document.getElementById('reflowSourceFilter');
            var srcVal = sourceEl ? sourceEl.value : 'all';
            currentSource = (srcVal === 'all' || srcVal === '') ? null : srcVal;
            currentPage = 1;
            fetchPage(1, currentSource).then(function () {
                renderTable();
                updateKpiCards();
                updateLastExecutionTime();
            });
        }

        // ── Bind events ───────────────────────────────────────────
        document.getElementById('drawerCloseBtn').addEventListener('click', closeDrawer);
        document.getElementById('drawerOverlay').addEventListener('click', function (e) { if (e.target === this) closeDrawer(); });
        document.getElementById('reflowResetBtn').addEventListener('click', function () {
            document.getElementById('reflowSourceFilter').value = 'all';
            document.getElementById('reflowSearch').value = '';
            fullRefresh();
        });
        document.getElementById('reflowSourceFilter').addEventListener('change', fullRefresh);

        // ── Initial load + 10s auto-refresh (only when visible) ───
        fullRefresh();
        if (reflowPollTimer) clearInterval(reflowPollTimer);
        reflowPollTimer = setInterval(function () {
            var page = document.getElementById('page-reflow-log');
            if (page && page.style.display !== 'none') fullRefresh();
        }, 10000);
    }

    // ── Navigation ──────────────────────────────────────────────
    function initNavigation() {
        var navItems = legacyRoot().querySelectorAll('.nav-item');
        var sidebarEngOps = document.getElementById('sidebar-eng-ops');
        var sidebarBizOps = document.getElementById('sidebar-biz-ops');
        var sidebarServiceOps = document.getElementById('sidebar-service-ops');
        var sidebarAgents = document.getElementById('sidebar-agents');
        var pageTitle = document.querySelector('.page-title');
        var pageDesc = document.querySelector('.page-desc');

        function hideAllSidebars() {
            legacyRoot().querySelectorAll('.sidebar').forEach(function (s) { return s.classList.remove('visible'); });
        }

        navItems.forEach(function (item) {
            item.addEventListener('click', function (e) {
                e.preventDefault();
                navItems.forEach(function (nav) { return nav.classList.remove('active'); });
                item.classList.add('active');

                // Update footer panel text
                var panelText = item.getAttribute('data-panel');
                var footerPanel = document.getElementById('footerPanel');
                if (footerPanel && panelText) {
                    footerPanel.textContent = panelText;
                }

                var text = item.textContent.trim();
                if (text === 'Engineering Ops') {
                    hideAllSidebars();
                    if (sidebarEngOps) sidebarEngOps.classList.add('visible');
                    var activeItem = sidebarEngOps.querySelector('.sidebar-item.active[data-page]');
                    if (activeItem) {
                        var page = activeItem.getAttribute('data-page');
                        if (page === 'knowledge-reflow-log') showPage('page-reflow-log');
                    }
                } else if (text === 'Business Ops') {
                    hideAllSidebars();
                    if (sidebarBizOps) sidebarBizOps.classList.add('visible');
                } else if (text === 'Service Ops') {
                    hideAllSidebars();
                    if (sidebarServiceOps) sidebarServiceOps.classList.add('visible');
                    var activeSvcItem = sidebarServiceOps.querySelector('.sidebar-item.active[data-page]');
                    if (activeSvcItem) {
                        var svcPage = activeSvcItem.getAttribute('data-page');
                        if (svcPage === 'l1-automation') showPage('page-l1-automation');
                        else if (svcPage === 'approval-center') showPage('page-approval-center');
                        else if (svcPage === 'smart-inspection') showPage('page-smart-inspection');
                        else if (svcPage === 'monitor-targets') showPage('page-monitor-targets');
                    }
                } else if (text === 'Agents') {
                    hideAllSidebars();
                    if (sidebarAgents) sidebarAgents.classList.add('visible');
                    var activeAgItem = sidebarAgents.querySelector('.sidebar-item.active[data-page]');
                    if (activeAgItem) {
                        var agPage = activeAgItem.getAttribute('data-page');
                        if (agPage === 'agent-registry') showPage('page-agents');
                        else if (agPage === 'workflow-studio') showPage('page-workflow-studio');
                        else if (agPage === 'bug-solve') showPage('page-bug-solve');
                        else if (agPage === 'mcp-servers') showPage('page-mcp-servers');
                        else if (agPage === 'agent-config') showPage('page-agent-config');
                    }
                } else {
                    hideAllSidebars();
                    showPage('page-service-ops');
                    if (pageTitle) pageTitle.textContent = text;
                    if (pageDesc) pageDesc.textContent = '';
                }
            });
        });
    }

    // ── Agent Tasks ─────────────────────────────────────────────
    function initAgentTasks() {
        var mockTasks = [
            { agentId: 'AT-20260707-3A7B', ticketId: 'INC001235070', title: 'GSD approval page loading timeout', service: 'GSD-Service', status: 'done', confidence: 94, risk: 'low', tokens: 2341, time: '2026-07-07 14:25:32',
                diagnosis: 'Root Cause: GSD service PostgreSQL query did not use index, causing full table scan.\nEvidence: 1) CPU 92%  2) Slow query logs  3) Historical ticket INC001235070 matched.',
                logs: [
                    { time: '14:25:33', step: 'Node 1 (Parse)', msg: 'Intent: performance, Entity: GSD-Service', status: 'done' },
                    { time: '14:25:35', step: 'Node 2 (Collect)', msg: 'Parallel MCP call: Metrics / Logs / Topology', status: 'done' },
                    { time: '14:25:38', step: 'Node 3 (Diagnose)', msg: 'LLM confidence 94%, suggest composite index', status: 'done' },
                    { time: '14:25:40', step: 'Node 4 (Risk)', msg: 'Risk LOW, auto-execute Ansible Playbook', status: 'done' },
                    { time: '14:25:42', step: 'Closed', msg: 'Ticket auto-closed, fix verified', status: 'done' }
                ]
            },
            { agentId: 'AT-20260707-1C9D', ticketId: 'INC001235071', title: 'VPN connection failure, cannot access intranet', service: 'VPN-Service', status: 'done', confidence: 100, risk: 'low', tokens: 892, time: '2026-07-07 14:10:15',
                diagnosis: 'Root Cause: VPN client service process stopped unexpectedly.\nEvidence: 1) Service status check  2) Historical ticket INC001235071 100% match.',
                logs: [
                    { time: '14:10:16', step: 'Node 1 (Parse)', msg: 'Intent: availability, Entity: VPN-Service', status: 'done' },
                    { time: '14:10:18', step: 'Node 2 (Collect)', msg: 'RAG search hit 100% similar ticket', status: 'done' },
                    { time: '14:10:20', step: 'Node 3 (Diagnose)', msg: 'Direct match: systemctl restart openvpn', status: 'done' },
                    { time: '14:10:22', step: 'Node 4 (Auto-fix)', msg: 'Execute restart, service recovered', status: 'done' },
                    { time: '14:10:23', step: 'Closed', msg: 'Ticket auto-closed', status: 'done' }
                ]
            },
            { agentId: 'AT-20260707-5F2E', ticketId: 'INC001235072', title: 'Payment gateway DB CPU spiked to 99%', service: 'Payment-Service', status: 'approval', confidence: 78, risk: 'high', tokens: 4103, time: '2026-07-07 13:55:40',
                diagnosis: 'Root Cause: Payment transaction table grew too fast without partitioning causing slow queries.\nSuggested: Create table partition by date, but requires table lock - high risk.',
                logs: [
                    { time: '13:55:41', step: 'Node 1 (Parse)', msg: 'Intent: performance, Entity: Payment-Service', status: 'done' },
                    { time: '13:55:43', step: 'Node 2 (Collect)', msg: 'Metrics anomaly: CPU 99%, DB connections maxed', status: 'done' },
                    { time: '13:55:48', step: 'Node 3 (Diagnose)', msg: 'LLM: index invalid + partition missing, confidence 78%', status: 'done' },
                    { time: '13:55:52', step: 'Node 4 (Risk)', msg: 'HIGH risk (DDL change), Change Request created', status: 'approval' },
                    { time: '13:56:00', step: 'Pending', msg: 'DBA notified, waiting for manual approval...', status: 'approval' }
                ]
            },
            { agentId: 'AT-20260707-8A3C', ticketId: 'INC001235073', title: 'File upload service intermittent timeout', service: 'Storage-Service', status: 'running', confidence: 65, risk: 'medium', tokens: 1876, time: '2026-07-07 14:30:00',
                diagnosis: 'Analysis in progress. Preliminary suspicion: NFS network jitter or connection pool exhaustion.',
                logs: [
                    { time: '14:30:01', step: 'Node 1 (Parse)', msg: 'Intent: performance, Entity: Storage-Service' },
                    { time: '14:30:04', step: 'Node 2 (Collect)', msg: 'Querying Loki logs and Prometheus metrics...' },
                    { time: '14:30:08', step: 'Node 3 (Diagnose)', msg: 'LLM reasoning in progress (60%)...' }
                ]
            },
            { agentId: 'AT-20260707-7E6F', ticketId: 'INC001235075', title: 'Logging Agent lost partial data', service: 'Logging-Agent', status: 'done', confidence: 89, risk: 'low', tokens: 1654, time: '2026-07-07 11:05:22',
                diagnosis: 'Root Cause: Agent buffer queue configured too small, dropping data under high concurrency.\nFix: Adjust buffer_size and restart agent.',
                logs: [
                    { time: '11:05:23', step: 'Node 1 (Parse)', msg: 'Intent: data_loss, Entity: Logging-Agent', status: 'done' },
                    { time: '11:05:25', step: 'Node 2 (Collect)', msg: 'RAG found similar config issue', status: 'done' },
                    { time: '11:05:30', step: 'Node 3 (Diagnose)', msg: 'Confidence 89%, located config parameter', status: 'done' },
                    { time: '11:05:35', step: 'Node 4 (Auto-fix)', msg: 'Ansible config update + restart', status: 'done' },
                    { time: '11:05:40', step: 'Closed', msg: 'Data collection recovered', status: 'done' }
                ]
            },
            { agentId: 'AT-20260707-2B4D', ticketId: 'INC001235074', title: 'Login API frequent 500 errors', service: 'Auth-Service', status: 'done', confidence: 45, risk: 'medium', tokens: 3150, time: '2026-07-07 12:20:10',
                diagnosis: 'Diagnosis failed: No clear error stack in logs, no similar historical tickets.\nManual investigation found third-party certificate expired. Certificate renewed.',
                logs: [
                    { time: '12:20:11', step: 'Node 1 (Parse)', msg: 'Intent: error, Entity: Auth-Service', status: 'done' },
                    { time: '12:20:13', step: 'Node 2 (Collect)', msg: 'No valid exception in logs, metrics normal', status: 'done' },
                    { time: '12:20:18', step: 'Node 3 (Diagnose)', msg: 'Confidence below threshold (45%), cannot determine', status: 'done' },
                    { time: '12:20:20', step: 'Fallback', msg: 'Manual ticket created, assigned to SRE', status: 'done' },
                    { time: '13:10:00', step: 'Manual Fix', msg: 'SRE found expired third-party cert, renewed', status: 'done' },
                    { time: '13:12:00', step: 'Closed', msg: 'Ticket manually closed', status: 'done' }
                ]
            }
        ];

        var currentFilter = 'all';

        function buildStatusBadge(status) {
            if (status === 'running') return '<span class="agent-status status-running"><span class="agent-spin"></span> Running</span>';
            if (status === 'approval') return '<span class="agent-status status-approval">Awaiting Approval</span>';
            return '<span class="agent-status status-done">Done</span>';
        }

        function buildRiskTag(risk) {
            return '<span class="risk-tag ' + risk + '">' + risk.toUpperCase() + '</span>';
        }

        function renderAgentTable(data) {
            var tbody = document.getElementById('agentTableBody');
            if (!tbody) return;
            tbody.innerHTML = data.map(function (t) {
                var barClass = t.confidence >= 80 ? 'high' : (t.confidence >= 60 ? 'medium' : 'low');
                return '<tr>' +
                    '<td><div class="agent-task-id">' + t.agentId + '</div><div class="agent-ticket-sub">' + t.ticketId + '</div></td>' +
                    '<td><div style="font-weight:500;">' + t.title + '</div></td>' +
                    '<td>' + buildStatusBadge(t.status) + '</td>' +
                    '<td><div class="confidence-bar"><span style="font-weight:600;font-size:12px;width:36px;">' + t.confidence + '%</span><div class="conf-bar-track"><div class="conf-bar-fill ' + barClass + '" style="width:' + t.confidence + '%;"></div></div></div></td>' +
                    '<td>' + buildRiskTag(t.risk) + '</td>' +
                    '<td><span class="token-num">' + t.tokens.toLocaleString() + '</span></td>' +
                    '<td style="font-size:11px;color:var(--text-tertiary);">' + t.time + '</td>' +
                    '<td><button class="detail-btn" data-agent="' + t.agentId + '">Detail</button></td>' +
                    '</tr>';
            }).join('');
            document.getElementById('agentRowCount').textContent = data.length;

            // Bind detail buttons
            tbody.querySelectorAll('.detail-btn').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openAgentDetail(btn.getAttribute('data-agent'));
                });
            });

            // Bind row clicks
            tbody.querySelectorAll('tr').forEach(function (row) {
                row.addEventListener('click', function () {
                    var btn = row.querySelector('.detail-btn');
                    if (btn) openAgentDetail(btn.getAttribute('data-agent'));
                });
            });
        }

        function doAgentFilter() {
            var search = document.getElementById('agentSearch').value.toLowerCase();
            var filtered = mockTasks.filter(function (t) {
                if (currentFilter !== 'all' && t.status !== currentFilter) return false;
                if (search) {
                    return t.agentId.toLowerCase().indexOf(search) !== -1 ||
                        t.ticketId.toLowerCase().indexOf(search) !== -1 ||
                        t.title.toLowerCase().indexOf(search) !== -1 ||
                        t.service.toLowerCase().indexOf(search) !== -1;
                }
                return true;
            });
            renderAgentTable(filtered);
        }

        function openAgentDetail(agentId) {
            var task = mockTasks.find(function (t) { return t.agentId === agentId; });
            if (!task) return;
            var isSN = task.ticketId.indexOf('INC') === 0;
            var dotClass = isSN ? 'sn-bg' : 'jira-bg';
            var content = '<div class="detail-meta">' +
                '<span class="meta-badge"><span class="source-dot ' + dotClass + '"></span> ' + task.ticketId + '</span>' +
                '<span class="meta-badge">' + task.service + '</span>' +
                '<span class="meta-badge">Triggered: ' + task.time + '</span>' +
                '<span class="meta-badge">Tokens: ' + task.tokens.toLocaleString() + '</span>' +
                '</div>' +
                '<div class="detail-block"><label>Task</label><p style="font-size:14px;font-weight:600;">' + task.agentId + ' — ' + task.title + '</p></div>' +
                '<div class="diagnosis-box"><div class="diag-label">Root Cause Diagnosis & Evidence</div><div class="diag-content">' + task.diagnosis + '</div></div>' +
                '<div class="log-section"><h3>Execution Timeline (Nodes)</h3>';
            task.logs.forEach(function (log) {
                var cls = log.status === 'done' ? ' done-log' : (log.status === 'approval' ? ' approval-log' : '');
                content += '<div class="log-item' + cls + '"><span class="log-time">' + log.time + '</span><span class="log-step">' + log.step + '</span> ' + log.msg + '</div>';
            });
            content += '</div>' +
                '<div class="detail-block"><label>Risk Level</label>' + buildRiskTag(task.risk) + '</div>' +
                '<div class="detail-block"><label>Confidence</label><div class="confidence-bar"><span style="font-weight:600;">' + task.confidence + '%</span><div class="conf-bar-track"><div class="conf-bar-fill ' + (task.confidence >= 80 ? 'high' : (task.confidence >= 60 ? 'medium' : 'low')) + '" style="width:' + task.confidence + '%;"></div></div></div></div>';
            document.getElementById('drawerContent').innerHTML = content;
            document.getElementById('drawerOverlay').classList.add('open');
        }

        // Bind search
        var searchInput = document.getElementById('agentSearch');
        var searchTimer;
        searchInput.addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(doAgentFilter, 200);
        });

        // Bind filter chips
        document.querySelectorAll('.agent-filter').forEach(function (chip) {
            chip.addEventListener('click', function () {
                document.querySelectorAll('.agent-filter').forEach(function (c) { return c.classList.remove('active'); });
                chip.classList.add('active');
                currentFilter = chip.getAttribute('data-filter');
                doAgentFilter();
            });
        });

        // Initial render
        renderAgentTable(mockTasks);
    }

    // ── L1 Automation ───────────────────────────────────────────
    function initL1Automation() {
        var mockTickets = [
            { id: 'INC001235080', title: 'SIP Call Setup Failure', desc: 'Outbound users report call drops, error code 503', system: 'SIP', cls: 'own', confidence: 96, status: 'escalated' },
            { id: 'INC001235081', title: 'Billing Report Export Slow', desc: 'Finance team reports monthly report timeout', system: 'Billing', cls: 'other', confidence: 94, status: 'transferred' },
            { id: 'INC001235082', title: 'Media Server CPU Spike', desc: 'Media node CPU 95%, RTP packet loss detected', system: 'SIP', cls: 'own', confidence: 72, status: 'escalated' },
            { id: 'INC001235083', title: 'CRM Sync Failure', desc: 'Sales team cannot update customer data, API 500', system: 'CRM', cls: 'other', confidence: 91, status: 'transferred' },
            { id: 'INC001235084', title: 'SIP Registration Timeout', desc: 'SIP endpoints registration fails, 408 timeout', system: 'SIP', cls: 'own', confidence: 97, status: 'escalated' },
            { id: 'INC001235085', title: 'DB Metrics Collection Failure', desc: 'Prometheus cannot scrape DB metrics, connection refused', system: 'Monitor', cls: 'other', confidence: 65, status: 'pending' },
            { id: 'INC001235086', title: 'IVR Menu Config Error', desc: 'User keypress no response, enters default flow', system: 'SIP', cls: 'own', confidence: 88, status: 'escalated' },
            { id: 'INC001235087', title: 'Email Service Queue Backlog', desc: 'Notification emails backlog >100k, SMTP slow', system: 'Email', cls: 'other', confidence: 93, status: 'transferred' }
        ];

        var currentFilter = 'all';

        function clsTag(cls) {
            if (cls === 'own') return '<span class="cls-tag own">Own System</span>';
            if (cls === 'other') return '<span class="cls-tag other">Other System</span>';
            return '<span class="cls-tag pending">Analyzing...</span>';
        }

        function statusLabel(status) {
            if (status === 'escalated') return '<span class="l1-status"><span class="st-dot amber"></span> Escalated to L2</span>';
            if (status === 'transferred') return '<span class="l1-status"><span class="st-dot green"></span> Transferred &amp; Closed</span>';
            return '<span class="l1-status"><span class="st-dot blue"></span> Pending</span>';
        }

        function actionButton(t) {
            if (t.status !== 'pending') {
                return '<span class="btn-l1 processed">' + (t.status === 'escalated' ? 'Escalated to L2' : 'Transferred & Closed') + '</span>';
            }
            return '<button class="btn-l1 l1-process-btn" data-id="' + t.id + '">Process</button>';
        }

        function renderL1Table(data) {
            var tbody = document.getElementById('l1TableBody');
            if (!tbody) return;
            tbody.innerHTML = data.map(function (t) {
                var barClass = t.confidence >= 80 ? 'high' : (t.confidence >= 60 ? 'medium' : 'low');
                return '<tr>' +
                    '<td><div style="font-weight:600;">' + t.id + '</div></td>' +
                    '<td><div style="font-weight:500;">' + t.title + '</div><div style="font-size:11px;color:var(--text-tertiary);">' + t.desc + '</div></td>' +
                    '<td><span style="font-size:12px;color:var(--text-secondary);">' + t.system + '</span></td>' +
                    '<td>' + clsTag(t.cls) + '</td>' +
                    '<td><div class="confidence-bar"><span style="font-weight:600;font-size:12px;width:36px;">' + t.confidence + '%</span><div class="conf-bar-track"><div class="conf-bar-fill ' + barClass + '" style="width:' + t.confidence + '%;"></div></div></div></td>' +
                    '<td>' + statusLabel(t.status) + '</td>' +
                    '<td>' + actionButton(t) + '</td>' +
                    '</tr>';
            }).join('');
            document.getElementById('l1RowCount').textContent = data.length;

            // Bind process buttons
            tbody.querySelectorAll('.l1-process-btn').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var id = btn.getAttribute('data-id');
                    var ticket = mockTickets.find(function (t) { return t.id === id; });
                    if (ticket) {
                        ticket.status = ticket.cls === 'own' ? 'escalated' : 'transferred';
                        doL1Filter();
                    }
                });
            });

            // Bind row clicks
            tbody.querySelectorAll('tr').forEach(function (row) {
                row.addEventListener('click', function () {
                    var cells = row.querySelectorAll('td');
                    var idEl = cells[0].querySelector('div');
                    if (idEl) openL1Detail(idEl.textContent);
                });
            });
        }

        function doL1Filter() {
            var search = document.getElementById('l1Search').value.toLowerCase();
            var filtered = mockTickets.filter(function (t) {
                if (currentFilter === 'own' && t.cls !== 'own') return false;
                if (currentFilter === 'other' && t.cls !== 'other') return false;
                if (currentFilter === 'pending' && t.status !== 'pending') return false;
                if (search) {
                    return t.id.toLowerCase().indexOf(search) !== -1 ||
                        t.title.toLowerCase().indexOf(search) !== -1 ||
                        t.system.toLowerCase().indexOf(search) !== -1;
                }
                return true;
            });
            renderL1Table(filtered);
        }

        function openL1Detail(ticketId) {
            var ticket = mockTickets.find(function (t) { return t.id === ticketId; });
            if (!ticket) return;
            var isOwn = ticket.cls === 'own';
            var content = '<div class="detail-meta">' +
                '<span class="meta-badge">' + ticket.id + '</span>' +
                '<span class="meta-badge">System: ' + ticket.system + '</span>' +
                '<span class="meta-badge">' + (ticket.status === 'pending' ? 'Pending' : (ticket.status === 'escalated' ? 'Escalated to L2' : 'Transferred & Closed')) + '</span>' +
                '</div>' +
                '<h3 style="margin:16px 0 4px;font-size:16px;">' + ticket.title + '</h3>' +
                '<p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">' + ticket.desc + '</p>' +
                '<div class="ticket-meta-grid">' +
                '<div class="meta-item"><label>Classification</label><span>' + clsTag(ticket.cls) + '</span></div>' +
                '<div class="meta-item"><label>Confidence</label><span style="font-size:16px;font-weight:600;">' + ticket.confidence + '%</span></div>' +
                '<div class="meta-item"><label>Source System</label><span>' + ticket.system + '</span></div>' +
                '<div class="meta-item"><label>L1 Decision</label><span>' + (isOwn ? 'Escalate to L2 Agent' : 'Transfer to ' + ticket.system + ' Support & Close') + '</span></div>' +
                '</div>' +
                '<div class="diagnosis-box"><div class="diag-label">Processing Log</div><div class="diag-content" style="font-family:SF Mono, monospace;font-size:12px;">' +
                (ticket.status === 'pending'
                    ? '> Awaiting L1 Agent processing...'
                    : (ticket.status === 'escalated'
                        ? '> L1 Agent classified as <strong>Own System</strong> (confidence ' + ticket.confidence + '%)<br>> Escalated to L2 Agent for deep analysis<br>> Ticket assigned to L2 queue - awaiting further diagnosis'
                        : '> L1 Agent classified as <strong>Other System</strong> (confidence ' + ticket.confidence + '%)<br>> Auto-transferred to ' + ticket.system + ' Support<br>> Original ticket closed - transfer confirmed')) +
                '</div></div>';
            document.getElementById('drawerContent').innerHTML = content;
            document.getElementById('drawerOverlay').classList.add('open');
        }

        // Bind search
        document.getElementById('l1Search').addEventListener('input', function () {
            clearTimeout(this._timer);
            this._timer = setTimeout(doL1Filter, 200);
        });

        // Bind filter chips
        document.querySelectorAll('.l1-filter').forEach(function (chip) {
            chip.addEventListener('click', function () {
                document.querySelectorAll('.l1-filter').forEach(function (c) { return c.classList.remove('active'); });
                chip.classList.add('active');
                currentFilter = chip.getAttribute('data-filter');
                doL1Filter();
            });
        });

        // Initial render
        renderL1Table(mockTickets);
    }

    // ── Approval Center ─────────────────────────────────────────
    function initApprovalCenter() {
        var mockData = [
            {
                id: 'RAG-001', ticket: 'INC001235093', title: 'SIP Call Setup Failure, Error 503',
                desc: 'Outbound calls hit 503 intermittently, check trunk config.',
                solution: 'Update carrier trunk configuration and restart SIP gateway service.',
                source: 'ServiceNow', sourceId: 'SNOW-INC-8821', confidence: 94, tokens: 4521, status: 'pending',
                chain: [
                    { step: 'L1 Classification', agent: 'L1-Classifier', status: 'done', detail: 'Identified as "SIP Service Anomaly", matched RAG strategy' },
                    { step: 'L2 RAG Search', agent: 'L2-RAG-Engine', status: 'done', detail: 'Retrieved 3 similar cases from ServiceNow' },
                    { step: 'L3 Solution Gen', agent: 'L3-Solution-Adapter', status: 'done', detail: 'Generated solution, confidence 94%' },
                    { step: 'Human Approval', agent: 'Human Reviewer', status: 'pending', detail: 'Awaiting Operation approval' }
                ],
                similarCases: [
                    { id: 'SNOW-INC-7721', title: 'SIP 503 Trunk Line Anomaly', similarity: 96, source: 'ServiceNow' },
                    { id: 'SNOW-INC-6634', title: 'Outbound Failure, Trunk Config Error', similarity: 88, source: 'ServiceNow' },
                    { id: 'JIRA-OP-221', title: 'SIP Gateway Restart 503 Recovery', similarity: 82, source: 'Jira' }
                ],
                logs: [
                    { time: '11:18:02', msg: 'INC001234 entered L1 classification queue' },
                    { time: '11:18:05', msg: 'L1 Agent: "SIP Service Anomaly", triggered RAG search' },
                    { time: '11:18:08', msg: 'L2 RAG search complete, 3 similar historical tickets found' },
                    { time: '11:18:12', msg: 'L3 Agent generated solution, confidence 94%' },
                    { time: '11:18:15', msg: 'Submitted to Approval Center, awaiting human review' }
                ]
            },
            {
                id: 'RAG-002', ticket: 'INC001235094', title: 'Media Server CPU Spike, Audio Choppy',
                desc: 'RTP stream heavy packet loss, CPU at 95%.',
                solution: 'Adjust codec params, increase CPU resource limit, and restart instance.',
                source: 'Jira', sourceId: 'JIRA-OP-332', confidence: 82, tokens: 3210, status: 'pending',
                chain: [
                    { step: 'L1 Classification', agent: 'L1-Classifier', status: 'done', detail: 'Identified as "Media Service Performance"' },
                    { step: 'L2 RAG Search', agent: 'L2-RAG-Engine', status: 'done', detail: 'Retrieved 2 similar cases from Jira' },
                    { step: 'L3 Solution Gen', agent: 'L3-Solution-Adapter', status: 'done', detail: 'Generated solution, confidence 82%' },
                    { step: 'Human Approval', agent: 'Human Reviewer', status: 'pending', detail: 'Awaiting Operation approval' }
                ],
                similarCases: [
                    { id: 'JIRA-OP-221', title: 'Media Server CPU Optimization', similarity: 91, source: 'Jira' },
                    { id: 'SNOW-INC-5123', title: 'RTP Packet Loss Resolution', similarity: 76, source: 'ServiceNow' }
                ],
                logs: [
                    { time: '11:16:30', msg: 'INC001235 entered L1 classification queue' },
                    { time: '11:16:33', msg: 'L1 Agent: "Media Service Performance", triggered RAG' },
                    { time: '11:16:37', msg: 'L2 RAG search complete, 2 similar historical tickets found' },
                    { time: '11:16:41', msg: 'L3 Agent generated solution, confidence 82%' },
                    { time: '11:16:44', msg: 'Submitted to Approval Center, awaiting human review' }
                ]
            },
            {
                id: 'RAG-003', ticket: 'INC001235095', title: 'DB Connection Pool Exhausted',
                desc: 'PostgreSQL connections maxed out, app layer timeout.',
                solution: 'Increase max_connections and optimize slow query indexes.',
                source: 'ServiceNow', sourceId: 'SNOW-INC-6734', confidence: 96, tokens: 5830, status: 'approved',
                chain: [
                    { step: 'L1 Classification', agent: 'L1-Classifier', status: 'done', detail: 'Identified as "DB Performance"' },
                    { step: 'L2 RAG Search', agent: 'L2-RAG-Engine', status: 'done', detail: 'Retrieved 4 similar cases from ServiceNow' },
                    { step: 'L3 Solution Gen', agent: 'L3-Solution-Adapter', status: 'done', detail: 'Generated solution, confidence 96%' },
                    { step: 'Human Approval', agent: 'Human Reviewer', status: 'done', detail: 'Approved, wrote back to ServiceNow and closed' }
                ],
                similarCases: [
                    { id: 'SNOW-INC-5542', title: 'PostgreSQL Connection Pool Optimization', similarity: 98, source: 'ServiceNow' },
                    { id: 'SNOW-INC-4431', title: 'Slow Query Index Optimization', similarity: 92, source: 'ServiceNow' },
                    { id: 'JIRA-OP-119', title: 'DB Timeout Resolution', similarity: 85, source: 'Jira' }
                ],
                logs: [
                    { time: '10:45:10', msg: 'INC001236 entered L1 classification queue' },
                    { time: '10:45:13', msg: 'L1 Agent: "DB Performance", triggered RAG search' },
                    { time: '10:45:17', msg: 'L2 RAG search complete, 4 similar historical tickets found' },
                    { time: '10:45:22', msg: 'L3 Agent generated solution, confidence 96%' },
                    { time: '10:45:26', msg: 'Submitted to Approval Center, awaiting human review' },
                    { time: '10:48:10', msg: 'Human approved, wrote back to ServiceNow and closed ticket' }
                ]
            },
            {
                id: 'RAG-004', ticket: 'INC001235096', title: 'CRM Sync Failure, API 500',
                desc: 'Sales team cannot update customer data, urgent fix needed.',
                solution: 'Restart CRM sync service and check token expiration.',
                source: 'Jira', sourceId: 'JIRA-OP-445', confidence: 71, tokens: 2450, status: 'rejected',
                chain: [
                    { step: 'L1 Classification', agent: 'L1-Classifier', status: 'done', detail: 'Identified as "API Service Anomaly"' },
                    { step: 'L2 RAG Search', agent: 'L2-RAG-Engine', status: 'done', detail: 'Retrieved 2 similar cases from Jira' },
                    { step: 'L3 Solution Gen', agent: 'L3-Solution-Adapter', status: 'done', detail: 'Generated solution, confidence 71% (low)' },
                    { step: 'Human Approval', agent: 'Human Reviewer', status: 'done', detail: 'Rejected, transferred to human Ops' }
                ],
                similarCases: [
                    { id: 'JIRA-OP-334', title: 'CRM Sync 500 Error Fix', similarity: 74, source: 'Jira' },
                    { id: 'SNOW-INC-2210', title: 'Token Expiry Resolution', similarity: 68, source: 'ServiceNow' }
                ],
                logs: [
                    { time: '10:30:05', msg: 'INC001237 entered L1 classification queue' },
                    { time: '10:30:08', msg: 'L1 Agent: "API Service Anomaly", triggered RAG search' },
                    { time: '10:30:12', msg: 'L2 RAG search complete, 2 similar historical tickets found' },
                    { time: '10:30:16', msg: 'L3 Agent generated solution, confidence 71% (low)' },
                    { time: '10:30:20', msg: 'Submitted to Approval Center, awaiting human review' },
                    { time: '10:35:00', msg: 'Human rejected, transferred to Operation team' }
                ]
            },
            {
                id: 'RAG-005', ticket: 'INC001235097', title: 'Log Agent Stopped Reporting',
                desc: 'Some nodes log data lost, affecting monitoring visualization.',
                solution: 'Redeploy log agent, adjust buffer size and restart.',
                source: 'ServiceNow', sourceId: 'SNOW-INC-9210', confidence: 88, tokens: 3980, status: 'escalated',
                chain: [
                    { step: 'L1 Classification', agent: 'L1-Classifier', status: 'done', detail: 'Identified as "Log Collection Failure"' },
                    { step: 'L2 RAG Search', agent: 'L2-RAG-Engine', status: 'done', detail: 'Retrieved 3 similar cases from ServiceNow' },
                    { step: 'L3 Solution Gen', agent: 'L3-Solution-Adapter', status: 'done', detail: 'Generated solution, confidence 88%' },
                    { step: 'Human Approval', agent: 'Human Reviewer', status: 'done', detail: 'Escalated L3 → human (solution has risk)' }
                ],
                similarCases: [
                    { id: 'SNOW-INC-8832', title: 'Log Agent Redeployment', similarity: 92, source: 'ServiceNow' },
                    { id: 'SNOW-INC-7723', title: 'Buffer Config Optimization', similarity: 84, source: 'ServiceNow' }
                ],
                logs: [
                    { time: '10:15:20', msg: 'INC001238 entered L1 classification queue' },
                    { time: '10:15:23', msg: 'L1 Agent: "Log Collection Failure", triggered RAG' },
                    { time: '10:15:27', msg: 'L2 RAG search complete, 3 similar historical tickets found' },
                    { time: '10:15:31', msg: 'L3 Agent generated solution, confidence 88%' },
                    { time: '10:15:35', msg: 'Submitted to Approval Center, awaiting human review' },
                    { time: '10:18:20', msg: 'Human reviewer escalated — solution has risk, L3 human handling' }
                ]
            }
        ];

        var currentFilter = 'all';

        function apStatusBadge(status) {
            var map = {
                'pending': '<span class="ap-status pending">Pending</span>',
                'approved': '<span class="ap-status approved">Approved</span>',
                'rejected': '<span class="ap-status rejected">Rejected</span>',
                'escalated': '<span class="ap-status escalated">Escalated</span>'
            };
            return map[status] || '';
        }

        function apAgentTag(item) {
            if (item.status === 'pending') return '<span class="ap-agent-tag l3">L3 Solution</span>';
            if (item.status === 'approved' || item.status === 'rejected') return '<span class="ap-agent-tag human">Human Review</span>';
            return '<span class="ap-agent-tag l3">L3 Human</span>';
        }

        function renderAPTable(data) {
            var tbody = document.getElementById('apTableBody');
            if (!tbody) return;
            tbody.innerHTML = data.map(function (t) {
                var barClass = t.confidence >= 80 ? 'high' : (t.confidence >= 60 ? 'medium' : 'low');
                return '<tr data-id="' + t.id + '">' +
                    '<td><span style="font-weight:500;">' + t.ticket + '</span></td>' +
                    '<td><div style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + t.title + '</div></td>' +
                    '<td>' + apStatusBadge(t.status) + '</td>' +
                    '<td>' + apAgentTag(t) + '</td>' +
                    '<td><div class="confidence-bar"><span style="font-weight:600;font-size:12px;width:36px;">' + t.confidence + '%</span><div class="conf-bar-track"><div class="conf-bar-fill ' + barClass + '" style="width:' + t.confidence + '%;"></div></div></div></td>' +
                    '<td><span class="token-num">' + t.tokens.toLocaleString() + '</span></td>' +
                    '<td>' + (t.status === 'pending' ? '<button class="btn-l1 ap-review-btn" data-id="' + t.id + '">Review</button>' : '<span class="btn-l1 processed">Reviewed</span>') + '</td>' +
                    '</tr>';
            }).join('');
            document.getElementById('apRowCount').textContent = data.length;

            tbody.querySelectorAll('.ap-review-btn').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openAPDrawer(btn.getAttribute('data-id'));
                });
            });

            tbody.querySelectorAll('tr').forEach(function (row) {
                row.addEventListener('click', function () {
                    var id = row.getAttribute('data-id');
                    if (id) openAPDrawer(id);
                });
            });
        }

        function doAPFilter() {
            var search = document.getElementById('apSearch').value.toLowerCase();
            var filtered = mockData.filter(function (t) {
                if (currentFilter !== 'all' && t.status !== currentFilter) return false;
                if (search) {
                    return t.ticket.toLowerCase().indexOf(search) !== -1 ||
                        t.title.toLowerCase().indexOf(search) !== -1;
                }
                return true;
            });
            renderAPTable(filtered);
        }

        function updateAPStats() {
            document.getElementById('apPendingCount').textContent = mockData.filter(function(d) { return d.status === 'pending'; }).length;
            document.getElementById('apApprovedCount').textContent = mockData.filter(function(d) { return d.status === 'approved'; }).length;
            document.getElementById('apRejectedCount').textContent = mockData.filter(function(d) { return d.status === 'rejected'; }).length;
            document.getElementById('apEscalatedCount').textContent = mockData.filter(function(d) { return d.status === 'escalated'; }).length;
            var totalTokens = mockData.reduce(function(acc, d) { return acc + d.tokens; }, 0);
            document.getElementById('apTotalTokens').textContent = totalTokens.toLocaleString();
        }

        function openAPDrawer(ragId) {
            var item = mockData.find(function(d) { return d.id === ragId; });
            if (!item) return;

            document.getElementById('apModalTitle').textContent = item.ticket + ' — ' + item.title;

            // Chain
            var chainHtml = '';
            item.chain.forEach(function(step, idx) {
                var iconCls = step.status === 'done' ? 'done' : (step.status === 'pending' ? 'waiting' : 'active');
                var icon = iconCls === 'done' ? '&#10003;' : (iconCls === 'waiting' ? '&#8987;' : '&#8635;');
                chainHtml += '<div class="chain-step"><div class="cs-icon ' + iconCls + '">' + icon + '</div><span style="font-size:12px;white-space:nowrap;">' + step.step + '</span><span style="font-size:11px;color:var(--text-tertiary);">' + step.agent + '</span></div>';
                if (idx < item.chain.length - 1) chainHtml += '<span class="chain-arrow">&rsaquo;</span>';
            });

            var content = '<div class="detail-meta">' +
                '<span class="meta-badge">' + item.ticket + '</span>' +
                '<span class="meta-badge">Confidence: ' + item.confidence + '%</span>' +
                '<span class="meta-badge">Tokens: ' + item.tokens.toLocaleString() + '</span>' +
                '</div>' +
                '<div class="detail-block"><label>Description</label><p style="color:var(--text-secondary);margin:0;">' + item.desc + '</p></div>' +
                '<div class="detail-block"><label>Suggested Solution</label><p style="font-weight:500;color:var(--text-primary);margin:0;">' + item.solution + '</p></div>' +
                '<div class="detail-block"><label>Execution Log & Decision Chain</label>' +
                '<div class="chain-steps" style="padding:0 0 10px 0;">' + chainHtml + '</div>' +
                '<div class="modal-log-panel">' +
                item.logs.map(function(l) { return '<div class="ml-entry"><span class="ml-time">' + l.time + '</span><span class="ml-msg">' + l.msg + '</span></div>'; }).join('') +
                '</div>' +
                '<div style="margin-top:10px;font-size:11px;color:var(--text-tertiary);padding:6px 0;">Similar Historical Cases (RAG Retrieved)</div>' +
                '<ul class="case-list">' +
                item.similarCases.map(function(c) { return '<li><span>' + c.id + ' — ' + c.title + '</span><span class="case-sim">' + c.similarity + '% match</span></li>'; }).join('') +
                '</ul>' +
                '</div>';

            if (item.status === 'pending') {
                content += '<div class="approval-actions">' +
                    '<button class="btn-ap approve" data-action="approve" data-id="' + item.id + '">Approve · Write Back & Close</button>' +
                    '<button class="btn-ap reject" data-action="reject" data-id="' + item.id + '">Reject · Human Ops</button>' +
                    '<button class="btn-ap escalate" data-action="escalate" data-id="' + item.id + '">Escalate · L3 Human</button>' +
                    '</div>';
            } else {
                var txt = item.status === 'approved' ? 'Approved, ticket closed' : (item.status === 'rejected' ? 'Rejected, transferred to human Ops' : 'Escalated, L3 human intervention');
                content += '<div class="approval-actions"><span style="color:var(--text-tertiary);font-size:12px;padding:6px 0;">' + txt + '</span></div>';
            }

            document.getElementById('apModalContent').innerHTML = content;

            document.getElementById('apModalContent').querySelectorAll('.btn-ap').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var action = btn.getAttribute('data-action');
                    var id = btn.getAttribute('data-id');
                    var target = mockData.find(function(d) { return d.id === id; });
                    if (!target || target.status !== 'pending') return;
                    if (action === 'approve') {
                        target.status = 'approved';
                        target.chain[3].status = 'done';
                        target.chain[3].detail = 'Approved, wrote back to ServiceNow and closed';
                        target.logs.push({ time: new Date().toLocaleTimeString('en-US', {hour12: false}), msg: 'Human approved, wrote back to ServiceNow and closed ticket' });
                    } else if (action === 'reject') {
                        target.status = 'rejected';
                        target.chain[3].status = 'done';
                        target.chain[3].detail = 'Rejected, transferred to human Ops';
                        target.logs.push({ time: new Date().toLocaleTimeString('en-US', {hour12: false}), msg: 'Human rejected, transferred to Operation team' });
                    } else if (action === 'escalate') {
                        target.status = 'escalated';
                        target.chain[3].status = 'done';
                        target.chain[3].detail = 'Escalated L3 → human (solution has risk)';
                        target.logs.push({ time: new Date().toLocaleTimeString('en-US', {hour12: false}), msg: 'Human reviewer escalated — solution has risk, L3 human handling' });
                    }
                    updateAPStats();
                    doAPFilter();
                    closeAPModal();
                });
            });

            document.getElementById('apModalOverlay').classList.add('open');
        }

        function closeAPModal() {
            document.getElementById('apModalOverlay').classList.remove('open');
        }

        document.getElementById('apModalOverlay').addEventListener('click', function(e) {
            if (e.target === this) closeAPModal();
        });
        document.getElementById('apModalClose').addEventListener('click', closeAPModal);

        // Search
        document.getElementById('apSearch').addEventListener('input', function() {
            clearTimeout(this._timer);
            this._timer = setTimeout(doAPFilter, 200);
        });

        // Filters
        document.querySelectorAll('.ap-filter').forEach(function(chip) {
            chip.addEventListener('click', function() {
                document.querySelectorAll('.ap-filter').forEach(function(c) { c.classList.remove('active'); });
                chip.classList.add('active');
                currentFilter = chip.getAttribute('data-filter');
                doAPFilter();
            });
        });

        // Initial
        renderAPTable(mockData);
    }

    // ── Smart Inspection ───────────────────────────────────────
    function initSmartInspection() {
        // 后端基址：默认走**相对路径** /agentflow（Vite dev proxy 与生产 nginx 都已配好），
        // 同源、无 CORS 预检。可用 localStorage 覆盖 —— 与已迁移页面
        // （workflowBaseUrl / bugSolveBaseUrl 等）同一习惯。
        // 注：这偏离了「未迁移视图保持硬编码绝对 URL」的约定，是有意的：该约定当初是为了
        // 让遗留页面直连 sip-aiops(:8080)，而本页现在改由 agentflow(:8000) 供数。
        var SI_BASE = localStorage.getItem('smartInspectionBaseUrl')
                   || localStorage.getItem('workflowBaseUrl')
                   || '/agentflow';
        var API_URL = SI_BASE + '/app-indicators';
        var services = [];
        var currentFilter = 'all';
        var isLoading = false;

        // ── 问题计数（Alerts / Log Anomalies 两列的数据源）──────────
        // 两列的数字来自 Diagnosis Center 的数据源（APM :7070），不再是 agentflow 的
        // alertCount —— 后者线上三个服务**全是 null**，所以两列此前实际都显示 "-"。
        //
        // problemTally: { [serviceName]: { metric: n, log: n } }，只统计**未解决**的问题。
        //   判定全部走 js/app.js 顶层的共享谓词（problemIsOpen / problemHasMetric /
        //   problemHasLog / problemServiceNames）—— 与 Diagnosis Center 的筛选同一套，
        //   这样徽标数字才等于点进去后 #pcRowCount 的行数。
        // null 表示**从未成功拉到过**（渲染成 "-"，不是 0：不知道 ≠ 没有）。
        var problemTally = null;
        var problemsLoading = false;
        var problemsTimer = null;
        var problemsDiagLogged = false;

        // ── Helpers ──────────────────────────────────────────────
        function fmt(val, suffix) {
            if (val === null || val === undefined) return '<span class="si-null-value">-</span>';
            return val + (suffix || '');
        }

        function fmtText(val, suffix) {
            if (val === null || val === undefined) return '-';
            return val + (suffix || '');
        }

        function metricClass(val) {
            if (val === null || val === undefined) return 'null-val';
            if (val >= 90) return 'critical';
            if (val >= 70) return 'warning';
            return 'normal';
        }

        /**
         * status 缺省时按 CPU/内存/磁盘推导。
         *
         * 注：`var disk = s.disk` 是**必须的** —— 下面那行原本直接引用未声明的 `disk`，
         * 在 'use strict' 下会抛 ReferenceError。因为它只在后端返回空 status 时才走到，
         * 而线上 status 恒为 "HEALTHY"，所以一直没暴露；一旦触发，异常会穿过
         * transformService → fetchServices 的 .catch，整页变成错误条。
         *
         * 这里保持原意（**存在性**检查），不要顺手改成阈值比较：s.disk 来自 item.blockIO，
         * 是形如 "8.2 MB/s" 的字符串，`disk >= 90` 没有意义。
         */
        function deriveStatus(s) {
            if (s.status) return s.status.toLowerCase();
            var cpu = s.cpu, mem = s.mem, disk = s.disk;
            if ((cpu !== null && cpu >= 90) || (mem !== null && mem >= 90)) return 'critical';
            if ((cpu !== null && cpu >= 70) || (mem !== null && mem >= 70)) return 'warning';
            if (cpu !== null || mem !== null || disk !== null) return 'healthy';
            return 'unknown';
        }

        // Squad 徽章：与状态徽章同款样式。三色对应 sales / aftersales / common
        // （取自前端既有色值，且避开 Status 已占用的绿/橙/红/灰，见 css/styles.css）。
        // 后端不校验 squad 取值，未列出的走中性灰 —— 新 squad 不该显示成 "-"。
        var SQUAD_KNOWN = ['sales', 'aftersales', 'common'];
        function squadBadge(squad) {
            if (!squad) return '<span class="si-squad unknown">-</span>';
            var key = String(squad).toLowerCase();
            var cls = SQUAD_KNOWN.indexOf(key) >= 0 ? key : 'unknown';
            return '<span class="si-squad ' + cls + '">' + fmtText(squad) + '</span>';
        }

        function statusBadge(status) {
            if (status === 'critical') return '<span class="si-status critical">Critical</span>';
            if (status === 'warning') return '<span class="si-status warning">Warning</span>';
            if (status === 'healthy') return '<span class="si-status healthy">Healthy</span>';
            if (status === 'offline') return '<span class="si-status offline">Offline</span>';
            return '<span class="si-status null-status">-</span>';
        }

        function rowClass(status) {
            if (status === 'critical') return 'row-critical';
            if (status === 'warning') return 'row-warning';
            if (status === 'offline') return 'row-offline';
            return '';
        }

        // ── Transform API Data ───────────────────────────────────
        function transformService(item) {
            var s = {
                id: item.serviceId,
                name: item.serviceName,
                // 不再映射 agentName —— Agent 列与详情里的 Agent 行已下线（2026-09-16）。
                // 后端仍返回该字段，要恢复显示把 item.agentName 接回来即可。
                type: item.serviceType,
                cpu: item.cpuUsage,
                cpuBaseline: 70,
                mem: item.memoryUsage,
                memBaseline: 70,   // 与后端 status 阈值、metricClass 的 70 对齐（原 80 是编造值）
                disk: item.blockIO,
                netIO: item.netIO,
                netIn: item.netIn,
                netOut: item.netOut,
                uptime: item.uptime,
                restartCount: item.restartCount,
                // 注：item.alertCount 仍然映射，但**两列徽标都不再用它** —— 线上三个服务全是
                // null，且它的口径（指标告警数）与本页现在要的「未解决的指标类问题数」并不是
                // 一回事。两列改由 problemTally 在 renderSITable 时注入（见文件上方说明）。
                // 保留映射是为了不丢掉后端仍在返回的字段，也方便将来对照。
                alertCount: item.alertCount,
                status: item.status,
                owner: item.owner,
                description: item.description,
                enabled: item.enabled,
                lastUpdateTime: item.lastUpdateTime
            };
            s.status = deriveStatus(s);
            return s;
        }

        // ── State UI ─────────────────────────────────────────────
        function showLoading() {
            var overlay = document.getElementById('siLoadingOverlay');
            if (overlay) overlay.classList.add('visible');
            var tbody = document.getElementById('siTableBody');
            if (tbody) tbody.innerHTML = '';
            var err = document.getElementById('siErrorBar');
            if (err) err.classList.remove('visible');
        }

        function hideLoading() {
            var overlay = document.getElementById('siLoadingOverlay');
            if (overlay) overlay.classList.remove('visible');
        }

        function showError(msg) {
            var err = document.getElementById('siErrorBar');
            var text = document.getElementById('siErrorText');
            if (err) err.classList.add('visible');
            if (text) text.textContent = msg || 'Failed to load services. Please try again.';
            hideLoading();
        }

        function hideError() {
            var err = document.getElementById('siErrorBar');
            if (err) err.classList.remove('visible');
        }

        function setRefreshSpinning(spinning) {
            var btn = document.getElementById('siRefreshBtn');
            if (!btn) return;
            if (spinning) {
                btn.classList.add('spinning');
                btn.disabled = true;
            } else {
                btn.classList.remove('spinning');
                btn.disabled = false;
            }
        }

        // ── Mock Data Fallback ───────────────────────────────────
        function useMockData() {
            services = [
                { id: 1, name: 'sip-aiops-management', agent: 'sip-aiops-management', type: 'core service',
                    cpu: 45, cpuBaseline: 70, mem: 62, memBaseline: 82, disk: '8.2 MB/s', netIO: '1.2 MB / 856 kB', netIn: '1.2 MB', netOut: '856 kB', uptime: '10d 2h', restartCount: 0, alertCount: 0,
                    status: 'healthy', owner: 'Team A', description: 'Core management service for AIOps platform', enabled: true, lastUpdateTime: '2026-07-10 10:30:00' },
                { id: 2, name: 'customer-service', agent: 'InspectAgent-1', type: 'Core App',
                    cpu: 58, cpuBaseline: 70, mem: 72, memBaseline: 82, disk: '15.3 MB/s', netIO: '3.4 MB / 2.1 MB', netIn: '3.4 MB', netOut: '2.1 MB', uptime: '14d 5h', restartCount: 0, alertCount: 0,
                    status: 'healthy', owner: null, description: null, enabled: true, lastUpdateTime: '2026-07-10 10:30:00' },
                { id: 3, name: 'payment-service', agent: 'InspectAgent-3', type: 'Core App',
                    cpu: 71, cpuBaseline: 68, mem: 74, memBaseline: 78, disk: '22.7 MB/s', netIO: '5.2 MB / 3.8 MB', netIn: '5.2 MB', netOut: '3.8 MB', uptime: '7d 0h', restartCount: 1, alertCount: 2,
                    status: 'warning', owner: 'Payment Team', description: null, enabled: true, lastUpdateTime: '2026-07-10 10:28:00' },
                { id: 4, name: 'auth-service', agent: 'InspectAgent-4', type: 'Infra',
                    cpu: 81, cpuBaseline: 72, mem: 88, memBaseline: 85, disk: '18.5 MB/s', netIO: '1.8 MB / 1.4 MB', netIn: '1.8 MB', netOut: '1.4 MB', uptime: '3d 12h', restartCount: 3, alertCount: 5,
                    status: 'critical', owner: 'Security Team', description: 'Authentication and authorization service', enabled: true, lastUpdateTime: '2026-07-10 10:25:00' },
                { id: 5, name: 'order-service', agent: 'InspectAgent-5', type: 'Core App',
                    cpu: 65, cpuBaseline: 74, mem: 70, memBaseline: 79, disk: '10.1 MB/s', netIO: '4.1 MB / 2.9 MB', netIn: '4.1 MB', netOut: '2.9 MB', uptime: '20d 0h', restartCount: 0, alertCount: 0,
                    status: 'healthy', owner: null, description: null, enabled: true, lastUpdateTime: '2026-07-10 10:30:00' },
                { id: 6, name: 'notification-service', agent: 'InspectAgent-6', type: 'Support',
                    cpu: 52, cpuBaseline: 66, mem: 63, memBaseline: 76, disk: '5.8 MB/s', netIO: '956 kB / 1.3 MB', netIn: '956 kB', netOut: '1.3 MB', uptime: '4d 0h', restartCount: 0, alertCount: 0,
                    status: 'healthy', owner: null, description: 'Push notification delivery service', enabled: true, lastUpdateTime: '2026-07-10 10:29:00' },
                { id: 7, name: 'report-service', agent: 'InspectAgent-7', type: 'Support',
                    cpu: 60, cpuBaseline: 71, mem: 75, memBaseline: 81, disk: '12.4 MB/s', netIO: '2.0 MB / 1.6 MB', netIn: '2.0 MB', netOut: '1.6 MB', uptime: '5d 0h', restartCount: 2, alertCount: 1,
                    status: 'healthy', owner: 'Data Team', description: null, enabled: false, lastUpdateTime: '2026-07-10 10:27:00' }
            ];
            updateSIStats();
            doSIFilter();
            hideLoading();
        }

        // ── 问题计数 Fetch ───────────────────────────────────────
        /**
         * 用共享谓词把问题列表汇总成 { 服务名: {metric, log} }，只计未解决的。
         *
         * 一条 combined 记录（指标+日志证据都有）在**两列各计一次** —— 这是有意的，也正是
         * Diagnosis Center 里 Metric / Log 两个 chip 都会列出它的原因，两边因此对得上。
         */
        function buildProblemTally(items) {
            var tally = {};
            (items || []).forEach(function (p) {
                if (!problemIsOpen(p.state)) return;         // 已解决的不算
                var hasM = problemHasMetric(p);
                var hasL = problemHasLog(p);
                if (!hasM && !hasL) return;                  // unknown：两列都不属于
                // 多服务合并记录（service 是逗号串）在它点名的**每个**服务下各计一次
                problemServiceNames(p).forEach(function (name) {
                    if (!tally[name]) tally[name] = { metric: 0, log: 0 };
                    if (hasM) tally[name].metric++;
                    if (hasL) tally[name].log++;
                });
            });
            return tally;
        }

        /**
         * 拉一次问题计数。
         *
         * 【独立的失败路径】绝不碰 siErrorBar / siLoadingOverlay / showError() /
         * setRefreshSpinning() —— 那些属于本页自己的数据（agentflow 的 app-indicators）。
         * APM 挂了不该让 Smart Inspection 看起来整个坏掉：这里只 console.warn 并**保留上次
         * 的计数**。problemTally 只在从未成功过时保持 null → 渲染 "-"（不知道 ≠ 没有）。
         *
         * 【独立的 in-flight 标志】不能复用 isLoading —— 那是服务列表的锁，共用会让 5s 轮询
         * 在问题请求在途时被整轮跳过。
         */
        function fetchProblemTally() {
            if (problemsLoading) return;
            problemsLoading = true;
            fetchProblemRecords()
                .then(function (items) {
                    problemsLoading = false;
                    problemTally = buildProblemTally(items);
                    doSIFilter();                // 计数变了就按当前筛选重画（它会调 renderSITable）
                    updateSIStats();             // Total Alerts 卡也读同一份计数，必须一起刷
                    logProblemsDiagOnce(items);
                })
                .catch(function (err) {
                    problemsLoading = false;
                    // 保留上次的 problemTally（可能是 null，也可能是一份旧值）
                    console.warn('[sip] Smart Inspection 拉取问题计数失败（保留上次结果）：', err);
                });
        }

        /**
         * 一次性诊断：跨后端 join 的对照。
         *
         * 服务名来自 agentflow(`serviceName`)，问题来自 APM(`service`)，是两套后端两套命名。
         * 一旦对不上，症状是**两列全 0**，看起来像逻辑 bug 而实际是数据对不上。这条日志把
         * 「页面上有几个服务 / 问题里出现几个服务名 / 哪些名字一个都没匹配上」一次打出来。
         */
        function logProblemsDiagOnce(items) {
            if (problemsDiagLogged) return;
            problemsDiagLogged = true;
            var pageNames = {};
            services.forEach(function (s) { pageNames[s.name] = true; });
            var tokens = {};
            (items || []).forEach(function (p) {
                problemServiceNames(p).forEach(function (n) { tokens[n] = true; });
            });
            var tokenList = Object.keys(tokens);
            console.info('[sip] Smart Inspection × Diagnosis Center 服务名对照：',
                '页面服务 ' + Object.keys(pageNames).length + ' 个',
                '| 问题里的服务名 ' + tokenList.length + ' 个',
                '| 两边都没匹配上的：', tokenList.filter(function (n) { return !pageNames[n]; }));
        }

        // ── API Fetch ────────────────────────────────────────────
        // 注：原先这里还有一个 refreshLogAnomalies()，单独请求 sip-aiops(:8080) 的
        // `/log-alert?size=500` 给 "Log Anomalies" 列填数。该请求已下线（2026-09-16）——
        // 日志异常改从「问题中心」查看。**2026-09-18 起**该列不再是恒 "-" 的占位：
        // 改由上面的 problemTally 按「该服务未解决的日志类问题数」填数。

        function fetchServices(silent) {
            if (isLoading) return;
            isLoading = true;
            hideError();
            if (!silent) showLoading();
            setRefreshSpinning(true);

            fetch(API_URL)
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) {
                    if (!data.success) throw new Error(data.error || '后端返回 success=false');
                    if (!data.data || !data.data.content) throw new Error('响应缺少 data.content');
                    services = data.data.content.map(transformService);
                    updateSIStats();
                    doSIFilter();
                    hideLoading();
                })
                .catch(function (err) {
                    console.warn('[Smart Inspection] 取数失败：', err.message);
                    // **默认不再静默降级到 mock**：那会让「后端挂了」看起来像「一切正常」。
                    // 需要看假数据时显式开启 —— console 里 localStorage.setItem('siMock','1')
                    if (localStorage.getItem('siMock') === '1') { useMockData(); return; }
                    showError(services.length === 0
                        ? '应用指标加载失败：' + err.message
                        : '刷新失败：' + err.message + '（保留上次数据）');
                })
                .finally(function () {
                    isLoading = false;
                    setRefreshSpinning(false);
                });
        }

        // ── Table Rendering ──────────────────────────────────────
        function renderMetricCell(val, baseline) {
            var cls = metricClass(val);
            var isNull = val === null || val === undefined;
            var barPct = isNull ? 0 : Math.min(100, val);
            return '<div class="si-metric-cell">' +
                '<span class="si-metric-val ' + cls + '">' + fmt(val, '%') + '</span>' +
                '<div class="si-metric-bar"><div class="si-metric-fill ' + (isNull ? 'null-val' : cls) + '" style="width:' + barPct + '%;"></div></div>' +
                '<span class="si-metric-baseline">BL ' + (baseline || '-') + '%</span>' +
                '</div>';
        }

        /**
         * 问题数徽标。kind ∈ {'metric','log'}，决定点击后跳到 Diagnosis Center 的哪个类型筛选。
         *
         * - count 为 null（问题数据从未成功拉到）→ 灰 "-"，**不带任何属性**，因此不可点：
         *   不能拿「不知道」冒充「没有」，也不该让一个没有内容的徽标可点。
         * - count 为 0 → 灰色 "0"，但**仍然可点**（用户要求「点任意一列」）。点进去是空列表，
         *   这本身是有用的确认信息。
         * - count > 0 → 沿用 has-alerts 红底样式。
         *
         * data-service 继续用 .replace(/"/g,'&quot;') 转义，**不要**改用 escapeHtml ——
         * 后者基于 createTextNode，转义 & < > 但**不转义引号**，放在属性位上会逸出。
         */
        function alertBadge(count, serviceName, kind) {
            if (count === null || count === undefined) return '<span class="si-alert-badge null-alert">-</span>';
            var cls = count > 0 ? 'has-alerts' : '';
            var attrs = '';
            if (serviceName) {
                attrs = ' style="cursor:pointer;"' +
                    ' data-service="' + String(serviceName).replace(/"/g, '&quot;') + '"' +
                    ' data-kind="' + kind + '"';
            }
            return '<span class="si-alert-badge ' + cls + '"' + attrs + '>' + count + '</span>';
        }

        /** 取某服务某类型的问题数；问题数据从未拉到过时返回 null（→ 渲染 "-"） */
        function problemCount(serviceName, kind) {
            if (!problemTally) return null;
            var row = problemTally[serviceName];
            if (!row) return 0;                 // 数据有了，但该服务一个问题都没有
            return kind === 'log' ? row.log : row.metric;
        }

        function renderSITable(data) {
            var tbody = document.getElementById('siTableBody');
            if (!tbody) return;
            tbody.innerHTML = data.map(function (s) {
                return '<tr class="' + rowClass(s.status) + '" data-id="' + s.id + '">' +
                    '<td><div class="si-service-cell"><span class="si-service-name">' + fmtText(s.name) + '</span></div></td>' +
                    '<td>' + squadBadge(s.type) + '</td>' +
                    '<td>' + renderMetricCell(s.cpu, s.cpuBaseline) + '</td>' +
                    '<td>' + renderMetricCell(s.mem, s.memBaseline) + '</td>' +
                    '<td><span class="si-metric-val" style="font-family:SF Mono,monospace;font-size:11px;white-space:nowrap;">' + fmtText(s.disk) + '</span></td>' +
                    // 两列都来自 problemTally（该服务未解决的指标类 / 日志类问题数），
                    // 点徽标下钻到 Diagnosis Center 的对应筛选。
                    '<td>' + alertBadge(problemCount(s.name, 'metric'), s.name, 'metric') + '</td>' +
                    '<td>' + alertBadge(problemCount(s.name, 'log'), s.name, 'log') + '</td>' +
                    '<td>' + statusBadge(s.status) + '</td>' +
                    '<td><button class="detail-btn" data-id="' + s.id + '">Detail</button></td>' +
                    '</tr>';
            }).join('');
            document.getElementById('siRowCount').textContent = data.length;

            tbody.querySelectorAll('.detail-btn').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openSIDetail(Number(btn.getAttribute('data-id')));
                });
            });

            tbody.querySelectorAll('tr').forEach(function (row) {
                row.addEventListener('click', function (e) {
                    if (e.target.closest('.si-alert-badge')) return;
                    var id = row.getAttribute('data-id');
                    if (id) openSIDetail(Number(id));
                });
            });
        }

        // ── Stats ─────────────────────────────────────────────────
        function updateSIStats() {
            var healthy = services.filter(function (s) { return s.status === 'healthy'; }).length;
            var warning = services.filter(function (s) { return s.status === 'warning'; }).length;
            var critical = services.filter(function (s) { return s.status === 'critical'; }).length;
            // Total Alerts = 两列之和（未解决的指标类 + 日志类问题），与上面几个 KPI 一样
            // 只统计**本页服务列表里**的服务（tally 里可能还含本页没有的服务名）。
            // 不再用 s.alertCount —— 那个字段线上恒为 null，于是这张卡此前一直显示 0，
            // 与表里两个徽标自相矛盾。problemTally 为空（未拉到）时保持 0：这是张汇总卡，
            // 没有「不知道」的展示形态，具体服务的未知仍由徽标上的 "-" 表达。
            var totalAlerts = services.reduce(function (sum, s) {
                return sum + (problemCount(s.name, 'metric') || 0) + (problemCount(s.name, 'log') || 0);
            }, 0);
            document.getElementById('siTotal').textContent = services.length;
            document.getElementById('siHealthy').textContent = healthy;
            document.getElementById('siWarning').textContent = warning;
            document.getElementById('siCritical').textContent = critical;
            document.getElementById('siTotalAlerts').textContent = totalAlerts;
        }

        // ── Filter ────────────────────────────────────────────────
        function doSIFilter() {
            var search = document.getElementById('siSearch').value.toLowerCase();
            var filtered = services.filter(function (s) {
                if (currentFilter !== 'all' && s.status !== currentFilter) return false;
                if (search) {
                    return (s.name || '').toLowerCase().indexOf(search) !== -1 ||
                        (s.type || '').toLowerCase().indexOf(search) !== -1;
                }
                return true;
            });
            renderSITable(filtered);
        }

        // ── Detail Drawer ────────────────────────────────────────
        function openSIDetail(serviceId) {
            var s = services.find(function (item) { return item.id === serviceId; });
            if (!s) return;
            setDrawerTitle('Service Detail');

            function metricColor(cls) {
                if (cls === 'critical') return '#ef4444';
                if (cls === 'warning') return '#f59e0b';
                if (cls === 'null-val') return 'var(--text-tertiary)';
                return '#10b981';
            }

            var cpuCls = metricClass(s.cpu);
            var memCls = metricClass(s.mem);

            var content = '<div class="detail-meta">' +
                '<span class="meta-badge">' + fmtText(s.name) + '</span>' +
                squadBadge(s.type) +
                '<span class="meta-badge">' + statusBadge(s.status) + '</span>' +
                '<span class="meta-badge">Alerts: ' + fmtText(s.alertCount, '') + '</span>' +
                '</div>' +

                '<div class="si-detail-metrics" style="grid-template-columns: repeat(6, 1fr);">' +
                '<div class="si-detail-metric" style="grid-column: span 2;"><div class="sdm-label">CPU Usage</div><div class="sdm-value" style="color:' + metricColor(cpuCls) + ';">' + fmt(s.cpu, '%') + '</div></div>' +
                '<div class="si-detail-metric" style="grid-column: span 2;"><div class="sdm-label">Memory Usage</div><div class="sdm-value" style="color:' + metricColor(memCls) + ';">' + fmt(s.mem, '%') + '</div></div>' +
                '<div class="si-detail-metric" style="grid-column: span 2;"><div class="sdm-label">Uptime</div><div class="sdm-value" style="font-size:16px;color:var(--text-primary);">' + fmtText(s.uptime) + '</div></div>' +
                '<div class="si-detail-metric" style="grid-column: span 3;"><div class="sdm-label">Disk I/O</div><div class="sdm-value" style="font-size:16px;color:var(--accent-blue);">' + fmtText(s.disk) + '</div></div>' +
                '<div class="si-detail-metric" style="grid-column: span 3;"><div class="sdm-label">Net I/O</div><div class="sdm-value" style="font-size:16px;color:var(--accent-blue);">' + fmtText(s.netIO) + '</div></div>' +
                '</div>' +

                '<div class="detail-block"><label>Service Info</label>' +
                '<div class="ticket-meta-grid">' +
                // 原为 Service ID（sip-aiops 时代的数据库主键；现由服务名哈希而来，
                // 无对外语义，故不再展示，改显示服务名本身）
                '<div class="meta-item"><label>Service Name</label><span>' + fmtText(s.name) + '</span></div>' +
                '<div class="meta-item"><label>Squad</label><span>' + fmtText(s.type) + '</span></div>' +
                '<div class="meta-item"><label>Owner</label><span>' + fmtText(s.owner) + '</span></div>' +
                '<div class="meta-item"><label>Enabled</label><span>' + (s.enabled ? 'Yes' : 'No') + '</span></div>' +
                '<div class="meta-item"><label>Status</label><span>' + statusBadge(s.status) + '</span></div>' +
                // 原先这里读 s.alertCount（线上恒为 null → 恒显示 "-"）。改成与表格两列同一份
                // 计数，否则会出现「表里写着 3、点开抽屉写着 -」。
                '<div class="meta-item"><label>Metric Problems</label><span style="font-weight:600;">' + fmtText(problemCount(s.name, 'metric'), '') + '</span></div>' +
                '<div class="meta-item"><label>Log Problems</label><span style="font-weight:600;">' + fmtText(problemCount(s.name, 'log'), '') + '</span></div>' +
                '<div class="meta-item"><label>Restart Count</label><span style="font-weight:600;">' + fmtText(s.restartCount, '') + '</span></div>' +
                '<div class="meta-item"><label>Last Updated</label><span style="font-size:11px;">' + fmtText(s.lastUpdateTime) + '</span></div>' +
                '</div></div>';

            if (s.description) {
                content += '<div class="detail-block"><label>Description</label><p style="font-size:12px;color:var(--text-primary);line-height:1.6;margin:0;">' + s.description + '</p></div>';
            }

            content += '<div class="diagnosis-box"><div class="diag-label">Metric Status Analysis</div><div class="diag-content">' +
                'CPU: ' + fmtText(s.cpu, '%') + ' | Status: ' + (cpuCls === 'null-val' ? 'No data' : cpuCls) + '\n' +
                'Memory: ' + fmtText(s.mem, '%') + ' | Status: ' + (memCls === 'null-val' ? 'No data' : memCls) + '\n' +
                'Disk I/O: ' + fmtText(s.disk) + '\n' +
                'Net I/O: ' + fmtText(s.netIO) + '\n' +
                'Overall: ' + (s.status === 'unknown' ? 'Insufficient data' : (s.status || 'unknown')) +
                '</div></div>';

            document.getElementById('drawerContent').innerHTML = content;
            document.getElementById('drawerOverlay').classList.add('open');
        }

        // ── Alert Modal ────────────────────────────────────────────
        var currentAlertService = null;
        var currentAlertPage = 0;
        var currentAlertTotal = 0;
        var currentAlertTotalPages = 0;

        function openAlertModal(serviceName, page) {
            var overlay = document.getElementById('alertModalOverlay');
            var content = document.getElementById('alertModalContent');
            var title = document.getElementById('alertModalTitle');

            if (!overlay || !content) return;

            if (page === undefined) page = 0;
            currentAlertService = serviceName;
            currentAlertPage = page;

            title.textContent = 'Alerts - ' + serviceName;
            content.innerHTML = '<div class="alert-loading">' +
                '<div class="alert-loading-spinner"></div>' +
                '<div>Loading alerts...</div>' +
                '</div>';
            overlay.classList.add('open');

            var url = 'http://localhost:8080/api/sip-aiops/app-alert?serviceName=' +
                encodeURIComponent(serviceName) + '&size=10&page=' + page;

            fetch(url)
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) {
                    if (data.success && data.data) {
                        currentAlertTotal = data.data.total || 0;
                        currentAlertTotalPages = data.data.totalPages || 0;
                        renderAlertList(content, serviceName, data.data);
                    } else {
                        throw new Error('Invalid response format');
                    }
                })
                .catch(function (err) {
                    console.warn('Alert fetch error:', err.message);
                    content.innerHTML = '<div class="alert-error">' +
                        'Failed to load alerts. Please try again. (' + err.message + ')</div>';
                });
        }

        function renderAlertList(container, serviceName, pageData) {
            var alerts = pageData.content || [];
            var page = pageData.page || 0;
            var total = pageData.total || 0;
            var totalPages = pageData.totalPages || 0;

            if (total === 0) {
                container.innerHTML = '<div class="alert-empty">No alerts found for <strong>' +
                    escapeHtml(serviceName) + '</strong>.</div>';
                return;
            }

            var html = '<div class="alert-modal-subtitle">' +
                total + ' alert(s) for <strong>' + escapeHtml(serviceName) + '</strong></div>' +
                '<div class="alert-table-wrap">' +
                '<table class="alert-table">' +
                '<thead><tr>' +
                '<th>Title</th>' +
                '<th>Type</th>' +
                '<th>Severity</th>' +
                '<th>Status</th>' +
                '<th>Summary</th>' +
                '<th>Detected At</th>' +
                '<th>Actions</th>' +
                '<th>Detail</th>' +
                '</tr></thead>' +
                '<tbody>';

            // Render data rows + pad empty rows to always show 10 rows
            for (var i = 0; i < 10; i++) {
                if (i < alerts.length) {
                    var alert = alerts[i];
                    var sev = (alert.severity || 'info').toLowerCase();
                    var st = (alert.status || '').toLowerCase();
                    var severityCls = 'severity-' + sev;
                    var statusCls = 'status-' + st;

                    var detectedStr = '';
                    if (alert.detectedAt) {
                        // Backend stores time in UTC but serializes with +08:00 offset
                        // incorrectly. Strip the timezone suffix and treat as UTC,
                        // then display in UTC+8 (Asia/Shanghai).
                        var utcTime = String(alert.detectedAt).replace(/[+-]\d{2}:\d{2}$/, '');
                        var d = new Date(utcTime + 'Z');
                        if (!isNaN(d.getTime())) {
                            detectedStr = d.toLocaleString('zh-CN', {
                                timeZone: 'Asia/Shanghai',
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                            });
                        } else {
                            detectedStr = String(alert.detectedAt);
                        }
                    }

                    var actionsHtml = '';
                    if (alert.status === 'OPEN') {
                        actionsHtml = '<button class="btn-alert-action ack" data-action="acknowledge" data-id="' + alert.id + '">Acknowledge</button> ' +
                            '<button class="btn-alert-action ignore" data-action="ignore" data-id="' + alert.id + '">Ignore</button>';
                    } else if (alert.status === 'ACKNOWLEDGED') {
                        actionsHtml = '<button class="btn-alert-action resolve" data-action="resolve" data-id="' + alert.id + '">Resolve</button>';
                    } else {
                        actionsHtml = '<span style="font-size:11px;color:var(--text-tertiary);">-</span>';
                    }

                    html += '<tr data-alert-id="' + alert.id + '">' +
                        '<td class="col-title">' + escapeHtml(alert.title || 'Untitled') + '</td>' +
                        '<td class="col-type">' + escapeHtml(alert.alertType || '-') + '</td>' +
                        '<td><span class="alert-tag ' + severityCls + '">' + (alert.severity || 'INFO') + '</span></td>' +
                        '<td><span class="alert-tag ' + statusCls + '">' + (alert.status || 'OPEN') + '</span></td>' +
                        '<td class="col-summary" title="' + escapeHtml(alert.summary || '') + '">' + escapeHtml(alert.summary || '-') + '</td>' +
                        '<td class="col-time">' + (detectedStr || '-') + '</td>' +
                        '<td class="col-actions">' + actionsHtml + '</td>' +
                        '<td class="col-detail"><button class="btn-alert-detail" data-id="' + alert.id + '">Detail</button></td>' +
                        '</tr>';
                } else {
                    html += '<tr class="alert-empty-row"><td colspan="8">&nbsp;</td></tr>';
                }
            }

            html += '</tbody></table></div>';

            // Pagination bar
            var startNum = total === 0 ? 0 : page * 10 + 1;
            var endNum = Math.min((page + 1) * 10, total);
            html += '<div class="alert-pagination">' +
                '<span class="page-info">Showing ' + startNum + '-' + endNum + ' of ' + total + '</span>' +
                '<div class="page-btns">' +
                '<button class="btn-page" data-page="0"' + (page === 0 ? ' disabled' : '') + '>First</button>' +
                '<button class="btn-page" data-page="' + (page - 1) + '"' + (page === 0 ? ' disabled' : '') + '>Prev</button>';

            for (var p = 0; p < totalPages; p++) {
                html += '<button class="btn-page' + (p === page ? ' current' : '') + '" data-page="' + p + '">' + (p + 1) + '</button>';
            }

            html += '<button class="btn-page" data-page="' + (page + 1) + '"' + (page >= totalPages - 1 ? ' disabled' : '') + '>Next</button>' +
                '<button class="btn-page" data-page="' + (totalPages - 1) + '"' + (page >= totalPages - 1 ? ' disabled' : '') + '>Last</button>' +
                '</div></div>';

            container.innerHTML = html;

            // Pagination button handlers
            container.querySelectorAll('.btn-page').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var targetPage = Number(btn.getAttribute('data-page'));
                    if (!isNaN(targetPage) && targetPage !== currentAlertPage) {
                        openAlertModal(currentAlertService, targetPage);
                    }
                });
            });

            // Action button handlers
            container.querySelectorAll('.btn-alert-action').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var id = btn.getAttribute('data-id');
                    var action = btn.getAttribute('data-action');
                    handleAlertAction(id, action);
                });
            });

            // Detail button handlers
            container.querySelectorAll('.btn-alert-detail').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var id = Number(btn.getAttribute('data-id'));
                    var alertData = alerts.find(function (a) { return a.id === id; });
                    if (alertData) openAlertDetail(alertData);
                });
            });
        }

        function handleAlertAction(alertId, action) {
            var url = 'http://localhost:8080/api/sip-aiops/app-alert/' + alertId + '/' + action;
            if (action === 'acknowledge') url += '?acknowledgedBy=admin';

            fetch(url, { method: 'PUT' })
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) {
                    if (data.success) {
                        openAlertModal(currentAlertService, currentAlertPage);
                    } else {
                        alert('Action failed: ' + (data.error || 'Unknown error'));
                    }
                })
                .catch(function (err) {
                    alert('Action failed: ' + err.message);
                });
        }

        function openAlertDetail(alert) {
            var overlay = document.getElementById('alertDetailOverlay');
            var content = document.getElementById('alertDetailContent');
            var title = document.getElementById('alertDetailTitle');

            if (!overlay || !content) return;

            title.textContent = 'Agent Analysis — ' + (alert.title || 'Untitled');
            content.innerHTML = '<div class="alert-loading">' +
                '<div class="alert-loading-spinner"></div>' +
                '<div>Loading agent analysis...</div>' +
                '</div>';
            overlay.classList.add('open');

            var url = 'http://localhost:8080/api/sip-aiops/app-alert/' + alert.id + '/analysis';

            fetch(url)
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (resp) {
                    if (!resp.success || !resp.data || !resp.data.success) {
                        throw new Error(resp.data ? (resp.data.error || 'Analysis not available') : 'Invalid response');
                    }
                    var analysis = resp.data.data;
                    renderAnalysisDetail(content, alert, analysis);
                })
                .catch(function (err) {
                    console.warn('Analysis fetch error:', err.message);
                    content.innerHTML = '<div class="alert-error">' +
                        'Failed to load agent analysis. ' + escapeHtml(err.message) + '</div>';
                });
        }

        function renderAnalysisDetail(container, alert, analysis) {
            var sev = (alert.severity || 'info').toLowerCase();
            var st = (alert.status || '').toLowerCase();

            var invocations = analysis.invocations || [];
            var firstInv = invocations[0] || {};
            var inv = firstInv.invocation || {};
            var analysisResult = firstInv.analysis_result || {};
            var thinkingChain = firstInv.thinking_chain || [];
            var metricsSnapshot = (analysisResult.metrics_snapshot || {});
            var rootCause = analysisResult.root_cause || {};
            var riskLevel = String(analysisResult.risk_level || 'medium').toLowerCase();
            var riskReason = analysisResult.risk_reason || '';
            var recommendations = analysisResult.recommendations || {};

            var html = '';

            // ── Section 1: Alert Overview ──
            html += '<div class="analysis-section">' +
                '<div class="analysis-section-title"><span class="step-dot"></span>Alert Overview</div>' +
                '<div class="detail-meta" style="margin-bottom:12px;">' +
                '<span class="alert-tag severity-' + sev + '">' + (alert.severity || 'INFO') + '</span>' +
                '<span class="alert-tag status-' + st + '">' + (alert.status || 'OPEN') + '</span>' +
                '<span class="meta-badge">' + escapeHtml(alert.alertType || 'N/A') + '</span>' +
                '<span class="meta-badge">Risk: ' + (analysisResult.risk_level || 'N/A') + '</span>' +
                '</div>';

            // Alert description
            if (alert.summary) {
                html += '<div class="detail-block"><label>Description</label>' +
                    '<p style="color:var(--text-secondary);margin:0;font-size:12px;line-height:1.6;">' + escapeHtml(alert.summary) + '</p></div>';
            }

            // Metrics snapshot
            if (Object.keys(metricsSnapshot).length > 0) {
                html += '<div class="detail-block"><label>Metrics Snapshot</label><div class="metrics-grid">';
                for (var mk in metricsSnapshot) {
                    if (metricsSnapshot.hasOwnProperty(mk)) {
                        html += '<div class="metrics-item"><div class="mk">' + escapeHtml(mk.replace(/_/g, ' ')) + '</div>' +
                            '<div class="mv">' + escapeHtml(String(metricsSnapshot[mk])) + '</div></div>';
                    }
                }
                html += '</div></div>';
            }

            html += '</div>';

            // ── Section 2: KB Match (LLM-curated best match) ──
            var kbMatch = analysisResult.kb_match;
            if (kbMatch && kbMatch.source_id) {
                html += renderKbMatchSection(kbMatch);
            }

            // ── Section 3: Agent Execution Flow ──
            html += '<div class="analysis-section">' +
                '<div class="analysis-section-title"><span class="step-dot"></span>Agent Execution Flow</div>';

            // Invocation meta
            if (inv.model_name || inv.latency_ms) {
                html += '<div class="invocation-meta">' +
                    '<div class="meta-item">Agent: <strong>' + escapeHtml(inv.agent_id || 'N/A') + '</strong></div>' +
                    '<div class="meta-item">Model: <strong>' + escapeHtml(inv.model_name || 'N/A') + '</strong></div>' +
                    '<div class="meta-item">Latency: <strong>' + (inv.latency_ms || 0) + 'ms</strong></div>';
                if (inv.token_usage) {
                    html += '<div class="meta-item">Tokens: <strong>' + (inv.token_usage.total_tokens || 0).toLocaleString() + '</strong></div>';
                }
                html += '<div class="meta-item">Status: <strong>' + escapeHtml(inv.execution_status || 'N/A') + '</strong></div>' +
                    '</div>';
            }

            // Thinking chain flow
            if (thinkingChain.length > 0) {
                html += '<div class="chain-flow">';
                thinkingChain.forEach(function (step, idx) {
                    var purpose = step.purpose || 'tool_call';
                    var pCls = purpose === 'final_response' ? 'final_response' : 'tool_call';
                    html += '<div class="chain-node">' +
                        '<div class="chain-node-circle ' + pCls + '">' + (idx + 1) + '</div>' +
                        '<div class="chain-node-label">' + escapeHtml(purpose.replace(/_/g, ' ')) + '</div>' +
                        '</div>';
                    if (idx < thinkingChain.length - 1) {
                        html += '<div class="chain-connector"></div>';
                    }
                });
                html += '</div>';

                // Tool call details
                thinkingChain.forEach(function (step, idx) {
                    if (step.purpose === 'final_response') return;
                    var toolExecs = step.tool_executions || [];
                    html += '<div class="tool-call-card">' +
                        '<div class="tool-call-header">' +
                        '<div><span class="tc-agent">Step ' + (idx + 1) + ' — Tool Calls</span>' +
                        '<span style="font-size:10px;color:var(--text-tertiary);margin-left:8px;">Model: ' + escapeHtml(step.model_name || '') + '</span></div>' +
                        '<div class="tc-tokens">in: ' + (step.input_tokens || 0) + ' / out: ' + (step.output_tokens || 0) + '</div>' +
                        '</div><div class="tool-call-body">';

                    toolExecs.forEach(function (te) {
                        var argsStr = '';
                        try {
                            argsStr = JSON.stringify(te.args || {}, null, 2);
                        } catch (e) {
                            argsStr = String(te.args || '');
                        }
                        html += '<div class="tool-exec-item">' +
                            '<div class="te-name">' + escapeHtml(te.tool_name || 'unknown') + '</div>' +
                            '<div class="te-args">Args: ' + escapeHtml(argsStr) + '</div>' +
                            '<div class="te-result">' + escapeHtml(truncateText(String(te.result || ''), 500)) + '</div>' +
                            '</div>';
                    });

                    html += '</div></div>';
                });
            }

            html += '</div>';

            // ── Section 4: Analysis Result ──
            html += '<div class="analysis-section">' +
                '<div class="analysis-section-title"><span class="step-dot"></span>Analysis Result</div>';

            // Risk
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">' +
                '<span class="risk-badge ' + riskLevel + '">' + (analysisResult.risk_level || 'MEDIUM') + ' RISK</span>' +
                '<span style="font-size:12px;color:var(--text-secondary);">' + escapeHtml(riskReason) + '</span></div>';

            // Root cause
            if (rootCause.summary) {
                html += '<div class="rc-block">' +
                    '<div class="rc-type">' + escapeHtml(rootCause.type || 'Root Cause') + '</div>' +
                    '<div class="rc-summary">' + escapeHtml(rootCause.summary) + '</div>';
                if (rootCause.evidence && rootCause.evidence.length > 0) {
                    html += '<ul class="rc-evidence">';
                    rootCause.evidence.forEach(function (e) {
                        html += '<li>' + escapeHtml(e) + '</li>';
                    });
                    html += '</ul>';
                }
                html += '</div>';
            }

            // Recommendations
            var recKeys = ['urgent', 'short_term', 'long_term'];
            recKeys.forEach(function (key) {
                var recs = recommendations[key];
                if (!recs || recs.length === 0) return;
                var label = key === 'urgent' ? 'Urgent Actions' : (key === 'short_term' ? 'Short-term Improvements' : 'Long-term Recommendations');
                html += '<div class="rec-group">' +
                    '<div class="rec-group-title ' + key + '"><span class="rec-dot"></span>' + label + '</div>' +
                    '<ul class="rec-list">';
                recs.forEach(function (r) {
                    html += '<li>' + escapeHtml(r) + '</li>';
                });
                html += '</ul></div>';
            });

            html += '</div>';

            container.innerHTML = html;
        }

        // ── KB Match Section (single LLM-curated best match) ──
        function renderKbMatchSection(kb) {
            var score = kb.llm_score != null ? kb.llm_score : null;
            var scoreLabel = score != null ? score.toFixed(1) + '/10' : '';
            var scoreClass = '';
            if (score != null) {
                if (score >= 7) scoreClass = 'kb-score-high';
                else if (score >= 4) scoreClass = 'kb-score-medium';
                else scoreClass = 'kb-score-low';
            }

            var html = '<div class="analysis-section kb-match-section">' +
                '<div class="analysis-section-title"><span class="step-dot" style="background:#10b981;"></span>Knowledge Base Match' +
                '<span class="kb-match-badge">Best Match</span></div>' +
                '<div class="kb-match-hint">Agent identified a highly similar historical incident to guide diagnosis</div>' +
                '<div class="kb-match-card">' +
                '<div class="kb-match-card-header">' +
                '<span class="kb-match-source-id">' + escapeHtml(kb.source_id || '') + '</span>' +
                '<span class="kb-match-title">' + escapeHtml(kb.title || 'Untitled') + '</span>';

            if (scoreLabel) {
                html += '<div class="kb-match-score ' + scoreClass + '">' + scoreLabel + '</div>';
            }

            html += '</div>';

            // Status indicators
            if (kb.hypothesis_used != null || kb.match_verified != null) {
                html += '<div class="kb-match-status-row">';
                if (kb.hypothesis_used != null) {
                    var clsH = kb.hypothesis_used ? 'kb-status-yes' : 'kb-status-no';
                    html += '<span class="kb-status-tag ' + clsH + '">' +
                        (kb.hypothesis_used ? '&#10003; Used as hypothesis' : '&#10007; Not used') + '</span>';
                }
                if (kb.match_verified != null) {
                    var clsM = kb.match_verified ? 'kb-status-yes' : 'kb-status-no';
                    html += '<span class="kb-status-tag ' + clsM + '">' +
                        (kb.match_verified ? '&#10003; Verified match' : '&#10007; Not verified') + '</span>';
                }
                html += '</div>';
            }

            if (kb.notes) {
                html += '<div class="kb-match-detail"><label>Agent Notes</label>' +
                    '<p>' + escapeHtml(kb.notes) + '</p></div>';
            }

            html += '</div></div>';
            return html;
        }

        function fmtUptime(seconds) {
            if (seconds === null || seconds === undefined) return '<span class="si-null-value">-</span>';
            var d = Math.floor(seconds / 86400);
            var h = Math.floor((seconds % 86400) / 3600);
            var m = Math.floor((seconds % 3600) / 60);
            if (d > 0) return d + 'd ' + h + 'h';
            if (h > 0) return h + 'h ' + m + 'm';
            return m + 'm';
        }

        // ── Event Bindings ────────────────────────────────────────
        // 问题数徽标点击 → Diagnosis Center，带上「该服务 + 该类型 + 只看未解决」的预筛选。
        // 经接缝 S3 变成 /problems?service=X&type=metric&state=open，由 Diagnosis Center 的
        // applyQueryFilters() 消费（那边的类型/状态判据与这里同一套共享谓词，所以点进去
        // 的行数 == 徽标上的数字）。
        //
        // 判据是 [data-kind] 而不是 .has-alerts：0 的徽标也要能点，而 has-alerts 只在 >0 时加。
        // 原先这里靠「行内最后一个 has-alerts 徽标」来猜是不是日志列 —— 那个推断本来就是错的
        // （combined 记录会让两个徽标都满足条件），现在由 alertBadge 直接写上 data-kind。
        var siTbody = document.getElementById('siTableBody');
        if (siTbody) {
            siTbody.addEventListener('click', function (e) {
                var badge = e.target.closest('.si-alert-badge[data-kind]');
                if (badge) {
                    e.stopPropagation();
                    var serviceName = badge.getAttribute('data-service');
                    var kind = badge.getAttribute('data-kind');
                    if (!serviceName) return;
                    navigateToPage('problems', {
                        service: serviceName,
                        type: kind,
                        state: 'open'
                    });
                }
            });
        }

        document.getElementById('siSearch').addEventListener('input', function () {
            clearTimeout(this._timer);
            this._timer = setTimeout(doSIFilter, 200);
        });

        document.querySelectorAll('.si-filter').forEach(function (chip) {
            chip.addEventListener('click', function () {
                document.querySelectorAll('.si-filter').forEach(function (c) { c.classList.remove('active'); });
                chip.classList.add('active');
                currentFilter = chip.getAttribute('data-filter');
                doSIFilter();
            });
        });

        document.getElementById('siRefreshBtn').addEventListener('click', function () {
            fetchServices();
            fetchProblemTally();   // 两列计数走的是另一个后端，手动刷新时也要跟着刷
        });

        document.getElementById('siRetryBtn').addEventListener('click', function () {
            fetchServices();
            fetchProblemTally();
        });

        // Alert modal close
        var alertOverlay = document.getElementById('alertModalOverlay');
        if (alertOverlay) {
            alertOverlay.addEventListener('click', function (e) {
                if (e.target === this) alertOverlay.classList.remove('open');
            });
        }
        var alertCloseBtn = document.getElementById('alertModalClose');
        if (alertCloseBtn) {
            alertCloseBtn.addEventListener('click', function () {
                if (alertOverlay) alertOverlay.classList.remove('open');
            });
        }

        // Alert detail modal close
        var alertDetailOverlay = document.getElementById('alertDetailOverlay');
        if (alertDetailOverlay) {
            alertDetailOverlay.addEventListener('click', function (e) {
                if (e.target === this) alertDetailOverlay.classList.remove('open');
            });
        }
        var alertDetailCloseBtn = document.getElementById('alertDetailClose');
        if (alertDetailCloseBtn) {
            alertDetailCloseBtn.addEventListener('click', function () {
                if (alertDetailOverlay) alertDetailOverlay.classList.remove('open');
            });
        }

        // ── Initial ───────────────────────────────────────────────
        var pollTimer = null;

        /** 面板可见时才动（切走后自动暂停，与改造前一致） */
        function siPageVisible() {
            var page = document.getElementById('page-smart-inspection');
            return !!(page && page.style.display !== 'none');
        }

        function startPolling() {
            stopPolling();
            pollTimer = setInterval(function () {
                if (siPageVisible()) fetchServices(true);
            }, 5000);
            // 问题计数单独一条 15s 定时器，**不**挤进上面 5s 那轮：/v1/problems?limit=500
            // 的响应很肥（单条记录带 evidence / trace_ids，实测约 4KB），每 5s 拉一次纯属浪费，
            // 而问题的状态变化本来就慢。两条定时器互斥地受可见性约束，不会叠加。
            problemsTimer = setInterval(function () {
                if (siPageVisible()) fetchProblemTally();
            }, 15000);
        }

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            if (problemsTimer) {
                clearInterval(problemsTimer);
                problemsTimer = null;
            }
        }

        fetchServices();
        fetchProblemTally();   // 与首屏服务列表并行拉，徽标不会先显示一轮 "-"
        startPolling();
    }

    // ── Filter Chips ────────────────────────────────────────────
    function initFilterChips() {
        // 【作用域】只服务 Service Ops 概览页那 12 个裸 chip（legacy-panels.html:106-118）——
        // 它们是**唯一**没有自己的 click 绑定的 .filter-chip 组。其余 8 组（si-filter /
        // pc-sev-filter / pc-state-filter / ma-* / l1-filter / ap-filter / agent-filter）
        // 都在各自的 initXxx() 里绑过了。
        //
        // 原先这里查的是全文档 `legacyRoot().querySelectorAll('.filter-chip')`，于是每组 chip
        // 都被**追加了第二个** click，且因为 init() 里 initFilterChips 排在最后（见文件末尾），
        // 它总是在持有者之后执行 —— 持有者刚 add('active')，这里立刻 toggle 掉，症状是
        // Diagnosis Center 的 severity/state chip 点完根本不亮。「All」分支更糟：它会清掉
        // **全文档**所有 .filter-chip 的 active，包括别的面板的组。
        const chips = legacyRoot().querySelectorAll('#page-service-ops .filter-chip');
        chips.forEach(function (chip) {
            chip.addEventListener('click', function () {
                // Toggle active state (single-select for tier, multi for others)
                var isTierChip = ['T1', 'T2', 'T3'].some(function (t) { return chip.textContent.trim().startsWith(t); });
                if (isTierChip) {
                    // Single-select: deactivate all tier chips
                    chips.forEach(function (c) {
                        var text = c.textContent.trim();
                        if (['T1', 'T2', 'T3'].some(function (t) { return text.startsWith(t); })) {
                            c.classList.remove('active');
                        }
                    });
                    chip.classList.add('active');
                } else if (chip.textContent.trim().startsWith('All')) {
                    // "All" clears all other filters
                    chips.forEach(function (c) { return c.classList.remove('active'); });
                    chip.classList.add('active');
                } else {
                    chip.classList.toggle('active');
                    // If any filter is active, deactivate "All"
                    // （同上层：只在本组内找，否则会去摘别的面板的 "All …" chip）
                    var allChip = legacyRoot().querySelector('#page-service-ops .filter-chip.active');
                    if (allChip && allChip.textContent.trim().startsWith('All')) {
                        allChip.classList.remove('active');
                    }
                }
            });
        });
    }

    // ── Table Sorting ───────────────────────────────────────────
    function initTableSorting() {
        var headers = legacyRoot().querySelectorAll('th');
        headers.forEach(function (th) {
            th.addEventListener('click', function () {
                var table = th.closest('table');
                var tbody = table.querySelector('tbody');
                var rows = Array.from(tbody.querySelectorAll('tr'));
                var colIndex = Array.from(th.parentElement.children).indexOf(th);
                var isAsc = th.classList.contains('sorted-asc');

                // Reset all header classes
                headers.forEach(function (h) { return h.classList.remove('sorted-asc', 'sorted-desc'); });

                // Toggle sort direction
                if (isAsc) {
                    th.classList.add('sorted-desc');
                } else {
                    th.classList.add('sorted-asc');
                }

                rows.sort(function (a, b) {
                    var aVal = a.children[colIndex].textContent.trim();
                    var bVal = b.children[colIndex].textContent.trim();

                    // Numeric sort for #, Incidents, Bot %, Risk columns
                    if ([0, 4, 5, 6].indexOf(colIndex) !== -1) {
                        var aNum = parseFloat(aVal.replace(/[,%]/g, '')) || 0;
                        var bNum = parseFloat(bVal.replace(/[,%]/g, '')) || 0;
                        return isAsc ? bNum - aNum : aNum - bNum;
                    }

                    // String sort for App, Tier, Hc
                    return isAsc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
                });

                rows.forEach(function (row) { return tbody.appendChild(row); });

                // Update row numbers
                tbody.querySelectorAll('.col-num').forEach(function (td, i) {
                    td.textContent = String(i + 1).padStart(2, '0');
                });
            });
        });
    }

    // ── Button Group Toggle ─────────────────────────────────────
    function initButtonGroup() {
        var btns = legacyRoot().querySelectorAll('.btn-group .btn');
        btns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                btns.forEach(function (b) { return b.classList.remove('active'); });
                btn.classList.add('active');
            });
        });
    }

    // ── Row Click ───────────────────────────────────────────────
    function initRowClick() {
        var rows = legacyRoot().querySelectorAll('tbody tr');
        rows.forEach(function (row) {
            row.addEventListener('click', function () {
                var appName = row.querySelector('.app-name');
                if (appName) {
                    console.log('Selected app:', appName.textContent);
                }
            });
        });
    }

    // ── Live Clock ──────────────────────────────────────────────
    function updateClock() {
        var el = document.getElementById('live-clock');
        if (el) {
            var now = new Date();
            el.textContent = now.toLocaleTimeString('en-US', { hour12: false });
        }
    }

    function initClock() {
        updateClock();
        setInterval(updateClock, 1000);
    }

    // ── Shared Alert Detail Modal (for metric/log pages) ───────
    function openAlertDetailGeneric(apiPrefix, alert) {
        // 接缝 S4：详情模态已迁 Vue。必须放在最前面 —— 早于下面的 !overlay 守卫，
        // 因为 #alertDetailOverlay 已从 legacy 树移除（迁移后全文档只剩 Vue 那一个实例），
        // 守卫会在到达 Vue 之前就 return。
        // apiPrefix 沿用旧参数化设计：'log-alert' | 'metric-alert'。
        if (window.__SIP_OPEN_ALERT_DETAIL) {
            return window.__SIP_OPEN_ALERT_DETAIL(apiPrefix, alert);
        }
        var overlay = document.getElementById('alertDetailOverlay');
        var content = document.getElementById('alertDetailContent');
        var title = document.getElementById('alertDetailTitle');
        if (!overlay || !content) return;

        title.textContent = 'Agent Analysis - ' + (alert.title || 'Untitled');
        content.innerHTML = '<div class="alert-loading">' +
            '<div class="alert-loading-spinner"></div>' +
            '<div>Loading agent analysis...</div>' +
            '</div>';
        overlay.classList.add('open');

        var url = 'http://localhost:8080/api/sip-aiops/' + apiPrefix + '/' + alert.id + '/analysis';
        fetch(url)
            .then(function(res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function(resp) {
                if (!resp.success || !resp.data || !resp.data.success) {
                    throw new Error(resp.data ? (resp.data.error || 'Analysis not available') : 'Invalid response');
                }
                var analysis = resp.data.data;
                renderAlertAnalysisContent(content, alert, analysis);
            })
            .catch(function(err) {
                content.innerHTML = '<div class="alert-error">' +
                    'Failed to load agent analysis. ' + escapeHtml(err.message) + '</div>';
            });
    }

    function renderAlertAnalysisContent(container, alert, analysis) {
        var invocations = analysis.invocations || [];
        var firstInv = invocations[0] || {};
        var inv = firstInv.invocation || {};
        var ar = firstInv.analysis_result || {};
        var thinkingChain = firstInv.thinking_chain || [];
        var rawOutput = firstInv.raw_output || null;

        var rootCause = ar.root_cause || {};
        var recommendations = ar.recommendations || {};
        var codeAnalysis = ar.code_analysis || {};
        var errorSnapshot = ar.error_snapshot || {};
        var impactAssessment = ar.impact_assessment || {};
        var diagnosisChain = ar.diagnosis_chain || [];

        var immediate = recommendations.immediate || recommendations.urgent || [];
        var shortTerm = recommendations.short_term || [];
        var longTerm = recommendations.long_term || [];

        var sev = String(alert.severity || 'info').toLowerCase();
        var sevUpper = String(alert.severity || 'INFO').toUpperCase();
        var heroClass = sev === 'critical' ? 'hero-banner' : (sev === 'warning' ? 'hero-banner hero-warning' : 'hero-banner hero-info');
        var sevBadgeClass = sev === 'critical' ? 'critical' : (sev === 'warning' ? 'warning' : 'info');

        var serviceName = alert.serviceName || alert.service_name || '';
        var detectedAt = alert.detected_at || alert.detectedAt || alert.createdAt || alert.created_at || '';
        var timeAgo = detectedAt ? formatTimeAgo(detectedAt) : '';

        var html = '';

        // ── 1. Hero Banner ──
        html += '<div class="' + heroClass + '">' +
            '<span class="hero-severity-badge ' + sevBadgeClass + '">' + escapeHtml(sevUpper) + '</span>' +
            '<div class="hero-title">' + escapeHtml(alert.title || alert.summary || 'Log Error Alert') + '</div>' +
            '<div class="hero-meta">';
        if (timeAgo) html += '<span>' + escapeHtml(timeAgo) + '</span>';
        if (serviceName) html += '<span class="hero-meta-dot"></span><span>' + escapeHtml(serviceName) + '</span>';
        html += '</div></div>';

        // ── 2. AI Summary & Root Cause ──
        html += '<div class="ai-summary-card">' +
            '<div class="card-title">AI Summary &amp; Root Cause</div>';

        var oneLiner = rootCause.summary || ar.summary || '';
        if (!oneLiner && rootCause.type) {
            oneLiner = rootCause.type + (rootCause.detail ? ': ' + String(rootCause.detail).substring(0, 200) : '');
        }
        if (oneLiner) {
            html += '<div class="one-liner">' + escapeHtml(oneLiner) + '</div>';
        }

        // Risk & Confidence badges
        html += '<div class="risk-confidence-row">';
        if (ar.risk_level) {
            var rl = String(ar.risk_level).toLowerCase();
            var riskCls = rl === 'high' || rl === 'critical' ? 'high-risk' : (rl === 'medium' ? 'medium-risk' : 'low-risk');
            html += '<span class="risk-tag ' + riskCls + '">' + String(ar.risk_level).toUpperCase() + ' RISK</span>';
        }
        if (ar.confidence) {
            var conf = String(ar.confidence).toLowerCase();
            var confLabel = String(ar.confidence).charAt(0).toUpperCase() + String(ar.confidence).slice(1);
            var confCls = conf === 'high' ? 'high' : (conf === 'medium' ? 'medium' : 'low');
            html += '<span class="confidence-tag ' + confCls + '">' + confLabel + ' Confidence';
            if (Number(ar.confidence)) html += ' &middot; ' + String(ar.confidence) + '%';
            html += '</span>';
        }
        html += '</div>';

        // Root cause location
        if (codeAnalysis.primary_file || rootCause.type) {
            html += '<div class="root-cause-loc">';
            if (codeAnalysis.primary_file) {
                html += '<span class="file-loc">' + escapeHtml(String(codeAnalysis.primary_file)) +
                    (codeAnalysis.primary_line ? ':' + codeAnalysis.primary_line : '') + '</span>';
            }
            if (codeAnalysis.primary_method) {
                html += '<span>&middot; ' + escapeHtml(String(codeAnalysis.primary_method)) + '()</span>';
            }
            if (codeAnalysis.last_commit) {
                html += '<span>&middot; Last modified by <strong>' + escapeHtml(String(codeAnalysis.last_commit).substring(0, 8)) +
                    '</strong> (' + escapeHtml(codeAnalysis.last_author || '') + ')';
                if (codeAnalysis.last_commit_date) html += ' &middot; ' + escapeHtml(String(codeAnalysis.last_commit_date));
                html += '</span>';
            }
            html += '</div>';
        }

        // KB Match
        var kb = ar.kb_match;
        if (kb && (kb.title || kb.source_id)) {
            html += '<div class="kb-match-row">' +
                'KB Match: <strong>' + escapeHtml(kb.title || kb.source_id) + '</strong>';
            if (kb.similarity_score !== undefined) {
                html += '<span class="match-pct">' + Math.round(kb.similarity_score * 100) + '% Match</span>';
            }
            html += '</div>';
        }

        html += '</div>';

        // ── 3. Impact Assessment ──
        if (impactAssessment.severity || impactAssessment.business_impact) {
            html += '<div class="impact-assessment-card">' +
                '<div class="card-title">Impact Assessment</div>' +
                '<div class="evidence-sub-grid">';
            if (impactAssessment.severity) {
                html += '<div class="evidence-kv"><span class="kv-label">Severity</span>' +
                    '<span class="kv-value highlight-red">' + escapeHtml(String(impactAssessment.severity).toUpperCase()) + '</span></div>';
            }
            if (impactAssessment.business_impact) {
                html += '<div class="evidence-kv full-width"><span class="kv-label">Business Impact</span>' +
                    '<span class="kv-value">' + escapeHtml(String(impactAssessment.business_impact)) + '</span></div>';
            }
            var risks = impactAssessment.downstream_risks || [];
            if (risks.length > 0) {
                html += '<div class="evidence-kv full-width"><span class="kv-label">Downstream Risks</span>' +
                    '<span class="kv-value">' + risks.map(function(r) { return '&bull; ' + escapeHtml(r); }).join(' ') + '</span></div>';
            }
            html += '</div></div>';
        }

        // ── 4. Recommended Actions ──
        if (immediate.length > 0 || shortTerm.length > 0 || longTerm.length > 0) {
            html += '<div class="actions-card">' +
                '<div class="card-title">Recommended Actions</div>' +
                '<div class="actions-grid">';

            if (immediate.length > 0) {
                html += '<div class="action-group immediate">' +
                    '<div class="action-group-title">Immediate Actions</div>' +
                    '<div class="action-items">';
                immediate.forEach(function(act, i) {
                    var txt = typeof act === 'string' ? act : (act.description || act.action || JSON.stringify(act));
                    if (i === 0) {
                        html += '<button class="action-btn primary" onclick="window._showToast(\'Copied: ' + escapeHtml(String(txt).substring(0, 60)) + '\',\'info\')">' + escapeHtml(txt) + '</button>';
                    } else if (i === 1) {
                        html += '<button class="action-btn" onclick="window._showToast(\'Action submitted\',\'success\')">' + escapeHtml(txt) + '</button>';
                    } else {
                        html += '<button class="action-btn" onclick="window._showToast(\'Suggestion recorded\',\'success\')">' + escapeHtml(txt) + '</button>';
                    }
                });
                html += '</div></div>';
            }

            if (shortTerm.length > 0) {
                html += '<div class="action-group short-term">' +
                    '<div class="action-group-title">Short-term Improvements</div>' +
                    '<div class="action-items">';
                shortTerm.forEach(function(act) {
                    var txt = typeof act === 'string' ? act : (act.description || act.action || JSON.stringify(act));
                    html += '<span class="action-text">' + escapeHtml(txt) + '</span>';
                });
                html += '</div></div>';
            }

            if (longTerm.length > 0) {
                html += '<div class="action-group long-term">' +
                    '<div class="action-group-title">Long-term Recommendations</div>' +
                    '<div class="action-items">';
                longTerm.forEach(function(act) {
                    var txt = typeof act === 'string' ? act : (act.description || act.action || JSON.stringify(act));
                    html += '<span class="action-text">' + escapeHtml(txt) + '</span>';
                });
                html += '</div></div>';
            }

            html += '</div></div>';
        }

        // ── 5. Diagnosis Timeline + Evidence ──
        if (diagnosisChain.length > 0) {
            html += '<div class="timeline-wrapper">' +
                '<div class="card-title">Diagnosis Timeline</div>' +
                '<div class="timeline">';

            diagnosisChain.forEach(function(dc, idx) {
                var stepTitle = dc.step || ('Step ' + (idx + 1));
                var decision = dc.decision || '';
                var finding = dc.finding || '';
                var isSkip = decision.indexOf('skip') >= 0 || decision.indexOf('SKIP') >= 0 || decision.indexOf('跳过') >= 0 || decision.indexOf('无需') >= 0;
                var isFinal = idx === diagnosisChain.length - 1;
                var stepCls = isSkip ? 'timeline-step skipped' : (isFinal ? 'timeline-step final' : 'timeline-step');

                html += '<div class="' + stepCls + '">' +
                    '<div class="timeline-step-header">' +
                    '<strong>Step ' + (idx + 1) + '</strong> &middot; ' + escapeHtml(stepTitle);
                if (isSkip) html += '<span class="step-badge skipped-badge">SKIPPED</span>';
                if (isFinal) html += '<span class="step-badge final-badge">FINAL</span>';
                html += '</div>';
                // Step body with finding and decision (shown when evidence expanded)
                if (finding || decision) {
                    html += '<div class="timeline-step-body">';
                    if (finding) {
                        html += '<div class="diag-finding">' +
                            '<span class="diag-label">FINDING</span>' +
                            '<span class="diag-text">' + escapeHtml(finding) + '</span>' +
                            '</div>';
                    }
                    if (decision) {
                        html += '<div class="diag-decision">' +
                            '<span class="diag-label diag-label-decision">DECISION</span>' +
                            '<span class="diag-text">' + escapeHtml(decision) + '</span>' +
                            '</div>';
                    }
                    html += '</div>';
                }
                html += '</div>';
            });

            html += '</div>';

            var stepsWithDetail = diagnosisChain.filter(function(dc) {
                return !!(dc.finding || dc.decision);
            });
            var hasEvidence = !!(errorSnapshot.service_name || errorSnapshot.exception_type || codeAnalysis.primary_file || stepsWithDetail.length > 0);
            if (hasEvidence) {
                html += '<button class="toggle-evidence-btn" id="toggleEvidenceBtn" onclick="window._toggleEvidence()">' +
                    'Expand Evidence Cards <span class="chevron">&#9662;</span></button>';

                html += '<div class="evidence-sub-cards" id="evidenceSubCards">';

                // Error Snapshot
                if (errorSnapshot.service_name || errorSnapshot.exception_type || errorSnapshot.error_message) {
                    html += '<div class="evidence-sub-section-label">Error Snapshot</div>' +
                        '<div class="evidence-sub-grid">';
                    var esFields = [
                        {k: 'Service', v: errorSnapshot.service_name},
                        {k: 'Exception Type', v: errorSnapshot.exception_type, red: true},
                        {k: 'Error Message', v: errorSnapshot.error_message, full: true},
                        {k: 'Error Count', v: errorSnapshot.error_count, red: true, big: true},
                        {k: 'First Seen', v: errorSnapshot.first_seen},
                        {k: 'Last Seen', v: errorSnapshot.last_seen}
                    ];
                    esFields.forEach(function(f) {
                        if (f.v !== undefined && f.v !== null && f.v !== '') {
                            var cls = f.full ? ' evidence-kv full-width' : ' evidence-kv';
                            var valCls = 'kv-value' + (f.red ? ' highlight-red' : '');
                            if (f.big) {
                                html += '<div class="' + cls + '"><span class="kv-label">' + escapeHtml(f.k) + '</span>' +
                                    '<span class="' + valCls + '" style="font-size:1.1rem;font-weight:700;color:#dc2626;">' + escapeHtml(String(f.v)) + '</span></div>';
                            } else {
                                html += '<div class="' + cls + '"><span class="kv-label">' + escapeHtml(f.k) + '</span>' +
                                    '<span class="' + valCls + '">' + escapeHtml(String(f.v)) + '</span></div>';
                            }
                        }
                    });
                    html += '</div>';
                }

                // Code Traceability
                if (codeAnalysis.primary_file || codeAnalysis.last_author || codeAnalysis.last_commit) {
                    html += '<div class="evidence-sub-section-label">Code Traceability</div>' +
                        '<div class="evidence-sub-grid">';
                    var ctFields = [
                        {k: 'Primary File', v: codeAnalysis.primary_file ? codeAnalysis.primary_file + (codeAnalysis.primary_line ? ':' + codeAnalysis.primary_line : '') : null},
                        {k: 'Method', v: codeAnalysis.primary_method},
                        {k: 'Last Author', v: codeAnalysis.last_author},
                        {k: 'Last Commit', v: codeAnalysis.last_commit},
                        {k: 'Commit Date', v: codeAnalysis.last_commit_date},
                        {k: 'Commit Message', v: codeAnalysis.last_commit_message}
                    ];
                    ctFields.forEach(function(f) {
                        if (f.v) {
                            html += '<div class="evidence-kv"><span class="kv-label">' + escapeHtml(f.k) + '</span>' +
                                '<span class="kv-value">' + escapeHtml(String(f.v)) + '</span></div>';
                        }
                    });

                    var apis = codeAnalysis.affected_apis || [];
                    if (apis.length > 0) {
                        html += '<div class="evidence-kv full-width"><span class="kv-label">Affected APIs</span>';
                        apis.forEach(function(api) {
                            html += '<span class="kv-value" style="display:inline-block;margin-right:10px;">' +
                                escapeHtml((api.method || 'GET') + ' ' + (api.path || '')) +
                                (api.description ? ' &mdash; ' + escapeHtml(api.description) : '') + '</span>';
                        });
                        html += '</div>';
                    }

                    var changes = codeAnalysis.recent_changes || [];
                    if (changes.length > 0) {
                        html += '<div class="evidence-kv full-width"><span class="kv-label">Recent Changes</span>';
                        changes.forEach(function(rc) {
                            html += '<span class="kv-value">' +
                                escapeHtml((rc.commit || '') + ' | ' + (rc.author || '') + ' | ' + (rc.date || '') + ' | ' + (rc.summary || '')) +
                                '</span>';
                        });
                        html += '</div>';
                    }

                    html += '</div>';
                }

                html += '</div>'; // close evidence-sub-cards
            }

            html += '</div>'; // close timeline-wrapper
        }

        // ── 6. Raw Alert Details (collapsible) ──
        var hasRawDetails = alert.errorMessage || alert.stackTrace || alert.sourceFile || alert.gitCommit || alert.errorFingerprint;
        if (hasRawDetails) {
            html += '<div class="collapsible-section">' +
                '<button class="collapsible-trigger" onclick="window._toggleCollapsible(this)" aria-expanded="false">' +
                'Raw Alert Details <span class="chevron">&#9662;</span></button>' +
                '<div class="collapsible-content"><div class="collapsible-inner">';

            if (alert.sourceFile || alert.gitCommit || alert.errorFingerprint) {
                html += '<div class="evidence-sub-grid" style="margin-bottom:12px;">';
                if (alert.sourceFile) {
                    html += '<div class="evidence-kv"><span class="kv-label">Source File</span>' +
                        '<span class="kv-value">' + escapeHtml(alert.sourceFile) + (alert.lineNumber ? ':' + alert.lineNumber : '') + '</span></div>';
                }
                if (alert.gitCommit) {
                    html += '<div class="evidence-kv"><span class="kv-label">Git Commit</span>' +
                        '<span class="kv-value">' + escapeHtml(String(alert.gitCommit).substring(0, 12)) + '</span></div>';
                }
                if (alert.errorFingerprint) {
                    html += '<div class="evidence-kv"><span class="kv-label">Fingerprint</span>' +
                        '<span class="kv-value">' + escapeHtml(String(alert.errorFingerprint).substring(0, 16)) + '...</span></div>';
                }
                html += '<div class="evidence-kv"><span class="kv-label">Severity</span>' +
                    '<span class="kv-value highlight-red">' + escapeHtml(String(alert.severity || 'N/A').toUpperCase()) + '</span></div>';
                html += '<div class="evidence-kv"><span class="kv-label">Status</span>' +
                    '<span class="kv-value">' + escapeHtml(String(alert.status || 'N/A').toUpperCase()) + '</span></div>';
                html += '<div class="evidence-kv"><span class="kv-label">Alert Type</span>' +
                    '<span class="kv-value">' + escapeHtml(alert.alertType || alert.alertSubType || 'N/A') + '</span></div>';
                html += '</div>';
            }

            if (alert.errorMessage) {
                html += '<div class="evidence-sub-section-label">Error Message</div>' +
                    '<div class="code-block" style="max-height:80px;">' + escapeHtml(String(alert.errorMessage).substring(0, 2000)) + '</div>';
            }

            if (alert.stackTrace) {
                html += '<div class="evidence-sub-section-label">Stack Trace</div>' +
                    '<div class="code-block" style="max-height:200px;">' + escapeHtml(String(alert.stackTrace).substring(0, 3000)) + '</div>';
            }

            html += '</div></div></div>';
        }

        // ── 7. Agent Execution Log (collapsible) ──
        html += '<div class="collapsible-section">' +
            '<button class="collapsible-trigger" onclick="window._toggleCollapsible(this)" aria-expanded="false">' +
            'Agent Execution Log <span class="chevron">&#9662;</span></button>' +
            '<div class="collapsible-content"><div class="collapsible-inner">';

        // Invocation metadata
        html += '<div class="invocation-meta">' +
            '<div class="meta-item">Agent: <strong>' + escapeHtml(inv.agent_id || 'N/A') + '</strong></div>' +
            '<div class="meta-item">Model: <strong>' + escapeHtml(inv.model_name || 'N/A') + '</strong></div>' +
            '<div class="meta-item">Latency: <strong>' + (inv.latency_ms || 0) + 'ms</strong></div>';
        if (inv.token_usage) {
            html += '<div class="meta-item">Tokens: <strong>' + (inv.token_usage.total_tokens || 0).toLocaleString() +
                '</strong> (in: ' + (inv.token_usage.input_tokens || 0).toLocaleString() +
                ' out: ' + (inv.token_usage.output_tokens || 0).toLocaleString() + ')</div>';
        }
        html += '<div class="meta-item">Status: <strong>' + escapeHtml(inv.execution_status || 'N/A') + '</strong></div>' +
            '</div>';

        // Thinking chain details
        if (thinkingChain.length > 0) {
            thinkingChain.forEach(function(step, idx) {
                var purpose = step.purpose || 'tool_call';
                var isFinal = purpose === 'final_response';
                var tools = step.tool_executions || [];
                var toolNames = tools.map(function(t) { return t.tool_name || 'unknown'; }).join(', ');
                var cardCls = isFinal ? 'think-step final-response-card' : 'think-step';

                html += '<div class="' + cardCls + '">' +
                    '<div class="think-step-header" onclick="(function(){var s=this.closest(\'.think-step\');s.classList.toggle(\'expanded\');}).call(this)">' +
                    '<span class="think-step-num">Step ' + (idx + 1) + '/' + thinkingChain.length + '</span>' +
                    '<span class="think-step-purpose ' + purpose + '">' + (isFinal ? 'Final' : 'Tool') + '</span>' +
                    '<span class="think-step-tools">' + escapeHtml(toolNames || (isFinal ? 'Analysis output' : 'No tools')) + '</span>' +
                    '<span class="think-step-tokens">' + ((step.input_tokens || 0) + (step.output_tokens || 0)).toLocaleString() + ' tok</span>' +
                    '<span class="think-step-toggle">&#9654;</span>' +
                    '</div>' +
                    '<div class="think-step-body">';

                if (tools.length > 0) {
                    tools.forEach(function(tool) {
                        html += renderToolExecution(tool);
                    });
                }

                if (isFinal) {
                    html += '<div style="font-size:11px;color:var(--text-tertiary);padding:8px 0;">' +
                        'Analysis complete. Full report rendered in the summary sections above.</div>';
                }

                html += '</div></div>';
            });
        } else if (rawOutput) {
            html += '<div class="agent-conclusion">' + escapeHtml(String(rawOutput)) + '</div>';
        } else {
            html += '<div class="no-analysis-note">No thinking chain data available for this invocation.</div>';
        }

        html += '</div></div>'; // close agent log collapsible

        container.innerHTML = html;
    }

    // ── Tool Execution Rendering ────────────────────────────
    function renderToolExecution(tool) {
        var toolName = tool.tool_name || 'unknown';
        var args = tool.args || {};
        var result = tool.result || '';
        var toolId = 'te-' + Math.random().toString(36).substr(2, 8);

        var h = '';
        h += '<div class="tool-exec">' +
            '<div class="tool-exec-hd">' +
            '<span class="tool-exec-icon">T</span>' +
            '<span class="tool-exec-name">' + escapeHtml(toolName) + '</span>';
        if (Object.keys(args).length > 0) {
            h += '<span class="tool-exec-args-toggle" onclick="(function(){var el=document.getElementById(\'' + toolId + '-args\');el.classList.toggle(\'open\');}).call(this)">Args &#9660;</span>';
        }
        h += '</div>';
        if (Object.keys(args).length > 0) {
            h += '<div class="tool-exec-args" id="' + toolId + '-args">' + escapeHtml(JSON.stringify(args, null, 2)) + '</div>';
        }
        h += '<div class="tool-exec-result">' + renderToolResult(toolName, result) + '</div>';
        h += '</div>';
        return h;
    }

    // ── Tool Result Rendering (by tool type) ────────────────
    function renderToolResult(toolName, result) {
        if (!result) {
            return '<span style="color:var(--text-tertiary);font-style:italic;">No output</span>';
        }

        var resultStr = String(result);

        // query_app_logs → parse JSON and render log entries
        if (toolName === 'query_app_logs') {
            try {
                var parsed = JSON.parse(resultStr);
                return renderLogQueryResult(parsed);
            } catch (e) {
                // Not JSON, render as text
            }
        }

        // Git tools → code block
        if (toolName.indexOf('git_') === 0 || toolName.indexOf('mcp_git_') === 0 || toolName.indexOf('mcp__') === 0) {
            var label = toolName.replace(/^(mcp_|mcp__)/, '');
            return '<div class="detail-block"><label>' + escapeHtml(label) + ' Output</label>' +
                '<div class="code-block">' + escapeHtml(resultStr) + '</div></div>';
        }

        // Try to parse as JSON for any tool
        try {
            var genericParsed = JSON.parse(resultStr);
            if (genericParsed && typeof genericParsed === 'object') {
                if (genericParsed.logs && Array.isArray(genericParsed.logs)) {
                    return renderLogQueryResult(genericParsed);
                }
                // Generic JSON display
                return '<div class="code-block">' + escapeHtml(JSON.stringify(genericParsed, null, 2)) + '</div>';
            }
        } catch (e) {
            // Not JSON, render as text
        }

        // Fallback: plain text
        var preview = resultStr.length > 2000 ? resultStr.substring(0, 2000) + '...[truncated]' : resultStr;
        return '<div class="raw-result">' + escapeHtml(preview) + '</div>';
    }

    // ── Log Query Result Rendering ──────────────────────────
    function renderLogQueryResult(data) {
        var logs = data.logs || [];
        var total = data.total_count !== undefined ? data.total_count : logs.length;
        var h = '';
        h += '<div class="log-entries-header">' +
            'Found <strong>' + logs.length + '</strong> log entries' +
            (total !== logs.length ? ' (total: ' + total + ')' : '') +
            '</div>';

        if (logs.length === 0) {
            h += '<div class="no-analysis-note">No matching log entries found.</div>';
            return h;
        }

        logs.forEach(function(entry, i) {
            var level = (entry.log_level || 'INFO').toUpperCase();
            var ts = entry.timestamp || '';
            var msg = entry.message || '';
            var stack = entry.stack_trace || '';

            h += '<div class="log-entry">' +
                '<div class="log-entry-bar">' +
                '<span class="log-level-badge ' + level + '">' + escapeHtml(level) + '</span>' +
                '<span class="log-entry-time">' + escapeHtml(ts) + '</span>';
            if (entry.thread) {
                h += '<span style="font-size:10px;color:var(--text-tertiary);">thread:' + escapeHtml(entry.thread) + '</span>';
            }
            h += '</div>' +
                '<div class="log-entry-msg">' + escapeHtml(msg) + '</div>';
            if (stack) {
                var stackId = 'ls-' + Math.random().toString(36).substr(2, 8);
                h += '<span class="log-stack-toggle" onclick="(function(){var el=document.getElementById(\'' + stackId + '\');el.classList.toggle(\'open\');this.textContent=el.classList.contains(\'open\')?\'Hide Stack Trace\':\'Show Stack Trace\';}).call(this)">Show Stack Trace</span>' +
                    '<div class="log-stack-trace" id="' + stackId + '">' + escapeHtml(stack) + '</div>';
            }
            h += '</div>';
        });

        return h;
    }

    // ── Structured Analysis Result ──────────────────────────
    function renderAnalysisResult(ar) {
        if (!ar || (typeof ar === 'object' && Object.keys(ar).length === 0)) {
            return '<div class="no-analysis-note">Agent completed but no structured analysis was produced.</div>';
        }

        var h = '';
        var rootCause = ar.root_cause || {};
        var recommendations = ar.recommendations || {};
        var codeAnalysis = ar.code_analysis || {};
        var errorSnapshot = ar.error_snapshot || {};
        var impactAssessment = ar.impact_assessment || {};
        var diagnosisChain = ar.diagnosis_chain || [];
        var riskLevel = String(ar.risk_level || '').toLowerCase();
        var confidence = String(ar.confidence || '').toLowerCase();
        var immediate = recommendations.immediate || recommendations.urgent || [];
        var shortTerm = recommendations.short_term || [];
        var longTerm = recommendations.long_term || [];
        var hasSummary = !!(ar.risk_level || rootCause.type || rootCause.summary || immediate.length > 0 || shortTerm.length > 0 || longTerm.length > 0);
        var hasEvidence = !!(diagnosisChain.length > 0 || errorSnapshot.service_name || errorSnapshot.exception_type || codeAnalysis.primary_file || codeAnalysis.last_author || impactAssessment.severity || impactAssessment.business_impact);
        var hasAnyContent = hasSummary || hasEvidence;

        // ================================================================
        // PART 1: EXECUTIVE SUMMARY — what happened and what to do
        // ================================================================
        if (hasSummary) {
            h += '<div class="exec-summary-wrapper">' +
                '<div class="exec-summary-header">' +
                '<span class="exec-summary-icon">&#9679;</span> Executive Summary' +
                '</div>' +
                '<div class="exec-summary-body">';

            // ── Risk & Confidence Banner ──
            h += '<div class="exec-banner">' +
                '<div class="exec-badges">';
            if (ar.risk_level) {
                h += '<span class="risk-badge ' + riskLevel + '">' + escapeHtml(String(ar.risk_level).toUpperCase()) + ' RISK</span>';
            }
            if (ar.confidence) {
                var confLabel = String(ar.confidence).charAt(0).toUpperCase() + String(ar.confidence).slice(1);
                h += '<span class="confidence-badge ' + confidence + '">' + confLabel + ' Confidence</span>';
            }
            h += '</div>';
            if (ar.risk_reason || ar.confidence_reason) {
                h += '<div class="exec-banner-reason">';
                if (ar.risk_reason) h += escapeHtml(ar.risk_reason);
                if (ar.confidence_reason) h += (ar.risk_reason ? ' ' : '') + escapeHtml(ar.confidence_reason);
                h += '</div>';
            }
            h += '</div>';

            // ── Root Cause Card (prominent, inside summary) ──
            if (rootCause.type || rootCause.summary) {
                h += '<div class="summary-rc-card">' +
                    '<div class="summary-rc-label">Root Cause</div>' +
                    '<div class="summary-rc-type">' + escapeHtml(rootCause.type || 'Identified Issue') + '</div>' +
                    '<div class="summary-rc-body">' + escapeHtml(rootCause.summary || '') + '</div>';
                if (rootCause.detail) {
                    h += '<div class="summary-rc-detail">' + escapeHtml(rootCause.detail) + '</div>';
                }
                if (rootCause.evidence && rootCause.evidence.length > 0) {
                    h += '<div class="summary-rc-evidence-label">Key Evidence</div><ul class="summary-rc-evidence">';
                    rootCause.evidence.forEach(function(ev) {
                        h += '<li>' + escapeHtml(typeof ev === 'string' ? ev : JSON.stringify(ev)) + '</li>';
                    });
                    h += '</ul>';
                }
                h += '</div>';
            }

            // ── Recommendations Cards ──
            if (immediate.length > 0 || shortTerm.length > 0 || longTerm.length > 0) {
                h += '<div class="summary-rec-section">' +
                    '<div class="summary-rec-label">Recommendations</div>' +
                    '<div class="summary-rec-cards">';
                if (immediate.length > 0) {
                    h += '<div class="sr-card sr-urgent">' +
                        '<div class="sr-card-header"><span class="sr-dot-urgent"></span>Immediate Actions</div>' +
                        '<ul class="sr-list">';
                    immediate.forEach(function(r) { h += '<li>' + escapeHtml(typeof r === 'string' ? r : JSON.stringify(r)) + '</li>'; });
                    h += '</ul></div>';
                }
                if (shortTerm.length > 0) {
                    h += '<div class="sr-card sr-short">' +
                        '<div class="sr-card-header"><span class="sr-dot-short"></span>Short-Term Improvements</div>' +
                        '<ul class="sr-list">';
                    shortTerm.forEach(function(r) { h += '<li>' + escapeHtml(typeof r === 'string' ? r : JSON.stringify(r)) + '</li>'; });
                    h += '</ul></div>';
                }
                if (longTerm.length > 0) {
                    h += '<div class="sr-card sr-long">' +
                        '<div class="sr-card-header"><span class="sr-dot-long"></span>Long-Term Recommendations</div>' +
                        '<ul class="sr-list">';
                    longTerm.forEach(function(r) { h += '<li>' + escapeHtml(typeof r === 'string' ? r : JSON.stringify(r)) + '</li>'; });
                    h += '</ul></div>';
                }
                h += '</div></div>';
            }

            // KB Match (compact, inside summary)
            var kb = ar.kb_match;
            if (kb) {
                h += '<div class="summary-kb">';
                if (kb.title) h += '<span class="summary-kb-title">' + escapeHtml(kb.title) + '</span>';
                if (kb.source_id) h += '<span class="summary-kb-source">' + escapeHtml(kb.source_id) + '</span>';
                if (kb.similarity_score !== undefined) h += '<span class="summary-kb-score">' + Math.round(kb.similarity_score * 100) + '% match</span>';
                h += '</div>';
            }

            h += '</div></div>'; // close exec-summary-body / exec-summary-wrapper
        }

        // ================================================================
        // PART 2: EVIDENCE & ANALYSIS — supporting details and data
        // ================================================================
        if (hasEvidence) {
            h += '<div class="evidence-wrapper">' +
                '<div class="evidence-header">' +
                '<span class="evidence-icon">&#9679;</span> Evidence &amp; Analysis' +
                '</div>' +
                '<div class="evidence-body">';

            // ── Diagnosis Chain ──
            if (diagnosisChain.length > 0) {
                h += '<div class="evidence-section">' +
                    '<div class="evidence-section-title"><span class="step-dot"></span>Diagnosis Chain</div>';
                diagnosisChain.forEach(function(dc, idx) {
                    var stepNum = (idx + 1);
                    var stepTitle = dc.step || ('Step ' + stepNum);
                    var finding = dc.finding || '';
                    var decision = dc.decision || '';
                    var isSkip = decision.indexOf('跳过') >= 0 || decision.indexOf('无需') >= 0 || decision.indexOf('不执行') >= 0;
                    var isEnd = stepNum === diagnosisChain.length;

                    h += '<div class="diag-step-card' + (isSkip ? ' diag-skip' : '') + (isEnd ? ' diag-final' : '') + '">' +
                        '<div class="diag-step-header">' +
                        '<span class="diag-step-num">' + stepNum + '</span>' +
                        '<span class="diag-step-title">' + escapeHtml(stepTitle) + '</span>' +
                        (isSkip ? '<span class="diag-skip-tag">SKIPPED</span>' : '') +
                        '</div>' +
                        '<div class="diag-step-body">' +
                        '<div class="diag-finding">' +
                        '<span class="diag-label">Finding</span>' +
                        '<span class="diag-text">' + escapeHtml(finding || 'N/A') + '</span>' +
                        '</div>' +
                        '<div class="diag-decision">' +
                        '<span class="diag-label diag-label-decision">Decision</span>' +
                        '<span class="diag-text">' + escapeHtml(decision || 'N/A') + '</span>' +
                        '</div>' +
                        '</div>' +
                        '</div>';
                });
                h += '</div>';
            }

            // ── Error Snapshot ──
            if (errorSnapshot.service_name || errorSnapshot.exception_type || errorSnapshot.error_message) {
                h += '<div class="evidence-section">' +
                    '<div class="evidence-section-title"><span class="step-dot" style="background:#ef4444;"></span>Error Snapshot</div>' +
                    '<div class="error-snapshot-grid">';
                var esFields = [
                    { k: 'Service', v: errorSnapshot.service_name },
                    { k: 'Exception Type', v: errorSnapshot.exception_type },
                    { k: 'Error Message', v: errorSnapshot.error_message, full: true },
                    { k: 'Error Count', v: errorSnapshot.error_count },
                    { k: 'First Seen', v: errorSnapshot.first_seen },
                    { k: 'Last Seen', v: errorSnapshot.last_seen }
                ];
                esFields.forEach(function(f) {
                    if (f.v !== undefined && f.v !== null && f.v !== '') {
                        var cls = f.full ? ' es-full' : '';
                        h += '<div class="es-item' + cls + '">' +
                            '<span class="es-key">' + escapeHtml(f.k) + '</span>' +
                            '<span class="es-val">' + escapeHtml(String(f.v)) + '</span>' +
                            '</div>';
                    }
                });
                var affectedReqs = errorSnapshot.affected_requests || [];
                if (affectedReqs.length > 0) {
                    h += '<div class="es-item es-full">' +
                        '<span class="es-key">Affected Requests</span>' +
                        '<span class="es-val">' + affectedReqs.map(function(r) { return escapeHtml(r); }).join(', ') + '</span>' +
                        '</div>';
                }
                h += '</div></div>';
            }

            // ── Code Traceability ──
            if (codeAnalysis.primary_file || codeAnalysis.last_author || codeAnalysis.last_commit) {
                h += '<div class="evidence-section">' +
                    '<div class="evidence-section-title"><span class="step-dot" style="background:#7c3aed;"></span>Code Traceability</div>' +
                    '<div class="code-trace-grid">';
                var ctFields = [
                    { k: 'Primary File', v: codeAnalysis.primary_file ? codeAnalysis.primary_file + (codeAnalysis.primary_line ? ':' + codeAnalysis.primary_line : '') : null },
                    { k: 'Primary Method', v: codeAnalysis.primary_method },
                    { k: 'Last Author', v: codeAnalysis.last_author },
                    { k: 'Last Commit', v: codeAnalysis.last_commit },
                    { k: 'Commit Date', v: codeAnalysis.last_commit_date },
                    { k: 'Commit Message', v: codeAnalysis.last_commit_message }
                ];
                ctFields.forEach(function(f) {
                    if (f.v) {
                        h += '<div class="ct-item">' +
                            '<span class="ct-key">' + escapeHtml(f.k) + '</span>' +
                            '<span class="ct-val">' + escapeHtml(String(f.v)) + '</span>' +
                            '</div>';
                    }
                });
                h += '</div>';

                var affectedApis = codeAnalysis.affected_apis || [];
                if (affectedApis.length > 0) {
                    h += '<div class="ct-subsection"><label>Affected APIs</label><div class="affected-apis-list">';
                    affectedApis.forEach(function(api) {
                        h += '<div class="api-item">' +
                            '<span class="api-method ' + (api.method || 'GET').toLowerCase() + '">' + escapeHtml(api.method || 'GET') + '</span>' +
                            '<span class="api-path">' + escapeHtml(api.path || '') + '</span>' +
                            (api.description ? '<span class="api-desc">' + escapeHtml(api.description) + '</span>' : '') +
                            '</div>';
                    });
                    h += '</div></div>';
                }

                var recentChanges = codeAnalysis.recent_changes || [];
                if (recentChanges.length > 0) {
                    h += '<div class="ct-subsection"><label>Recent Changes</label>';
                    recentChanges.forEach(function(rc) {
                        h += '<div class="recent-change-item">' +
                            '<span class="rc-commit">' + escapeHtml(rc.commit || '') + '</span>' +
                            '<span class="rc-meta">' + escapeHtml(rc.author || '') + ' &middot; ' + escapeHtml(rc.date || '') + '</span>' +
                            '<span class="rc-summary-text">' + escapeHtml(rc.summary || '') + '</span>' +
                            '</div>';
                    });
                    h += '</div>';
                }

                h += '</div>';
            }

            // ── Impact Assessment ──
            if (impactAssessment.severity || impactAssessment.business_impact) {
                h += '<div class="evidence-section">' +
                    '<div class="evidence-section-title"><span class="step-dot" style="background:#ef4444;"></span>Impact Assessment</div>' +
                    '<div class="impact-grid">';
                if (impactAssessment.severity) {
                    var impSev = impactAssessment.severity.toLowerCase();
                    h += '<div class="impact-item"><span class="impact-key">Severity</span>' +
                        '<span class="impact-sev-tag ' + impSev + '">' + escapeHtml(impactAssessment.severity.toUpperCase()) + '</span></div>';
                }
                if (impactAssessment.business_impact) {
                    h += '<div class="impact-item impact-full"><span class="impact-key">Business Impact</span>' +
                        '<span class="impact-val">' + escapeHtml(impactAssessment.business_impact) + '</span></div>';
                }
                var downstreamRisks = impactAssessment.downstream_risks || [];
                if (downstreamRisks.length > 0) {
                    h += '<div class="impact-item impact-full"><span class="impact-key">Downstream Risks</span>' +
                        '<ul class="impact-risks">';
                    downstreamRisks.forEach(function(dr) {
                        h += '<li>' + escapeHtml(dr) + '</li>';
                    });
                    h += '</ul></div>';
                }
                h += '</div></div>';
            }

            h += '</div></div>'; // close evidence-body / evidence-wrapper
        }

        // ── Fallback: render raw if no known structured content ──
        if (!hasAnyContent) {
            h += '<div class="code-block">' + escapeHtml(JSON.stringify(ar, null, 2)) + '</div>';
        }

        return h;
    }

    // ── Investigation Summary ────────────────────────────────
    function buildInvestigationSummary(thinkingChain) {
        var rows = [];
        thinkingChain.forEach(function(step) {
            var tools = step.tool_executions || [];
            if (tools.length === 0) return;
            tools.forEach(function(tool) {
                var toolName = tool.tool_name || 'unknown';
                var args = tool.args || {};
                var result = tool.result || '';
                var summary = summarizeToolResult(toolName, args, result);
                rows.push({
                    step: step.call_index || '?',
                    tool: toolName,
                    target: extractTarget(args, toolName),
                    summary: summary
                });
            });
        });

        if (rows.length === 0) return '';

        var h = '<div class="investigation-summary">' +
            '<div class="investigation-title">Investigation Summary</div>' +
            '<table class="investigation-table">' +
            '<thead><tr><th>#</th><th>Tool</th><th>Target</th><th>Result</th></tr></thead><tbody>';

        rows.forEach(function(r) {
            h += '<tr>' +
                '<td class="inv-step">' + r.step + '</td>' +
                '<td class="inv-tool">' + escapeHtml(r.tool) + '</td>' +
                '<td class="inv-target">' + escapeHtml(r.target) + '</td>' +
                '<td class="inv-result">' + r.summary + '</td>' +
                '</tr>';
        });

        h += '</tbody></table></div>';
        return h;
    }

    function extractTarget(args, toolName) {
        if (args.service_name) return args.service_name;
        if (args.file_path) return args.file_path;
        if (args.query) return truncateText(String(args.query), 40);
        return '-';
    }

    function summarizeToolResult(toolName, args, result) {
        if (!result) return '<span class="inv-empty">No output</span>';

        // query_app_logs
        if (toolName === 'query_app_logs') {
            try {
                var parsed = JSON.parse(String(result));
                var logCount = (parsed.logs || []).length;
                var total = parsed.total_count || parsed.total || logCount;
                if (logCount === 0) return '<span class="inv-empty">0 logs found</span>';
                return '<span class="inv-count">' + logCount + '</span> log entries' +
                    (total !== logCount ? ' (total: ' + total + ')' : '');
            } catch (e) {
                return '<span class="inv-text">' + escapeHtml(truncateText(String(result), 60)) + '</span>';
            }
        }

        // search_knowledge_base
        if (toolName === 'search_knowledge_base') {
            try {
                var kbParsed = JSON.parse(String(result));
                var kbResults = kbParsed.results || [];
                if (kbResults.length === 0) return '<span class="inv-empty">No matches</span>';
                var top = kbResults[0];
                return '<span class="inv-count">' + kbResults.length + '</span> results. Top: ' +
                    escapeHtml(truncateText(top.title || '', 50)) +
                    ' (score: ' + (top.distance ? Number(top.distance).toFixed(2) : 'N/A') + ')';
            } catch (e) {
                return '<span class="inv-text">' + escapeHtml(truncateText(String(result), 60)) + '</span>';
            }
        }

        // analyze_diagnostics
        if (toolName === 'analyze_diagnostics') {
            try {
                var diag = JSON.parse(String(result));
                var snapCount = (diag.snapshots || []).length;
                var topClass = diag.heap_top10 ? diag.heap_top10[0] : null;
                var detail = topClass ? ' top: ' + escapeHtml(topClass.class_name || '') + ' ' + (topClass.total_bytes ? (topClass.total_bytes / 1024 / 1024).toFixed(1) + 'MB' : '') : '';
                return '<span class="inv-count">' + snapCount + '</span> snapshots' + detail;
            } catch (e) {
                return '<span class="inv-text">' + escapeHtml(truncateText(String(result), 60)) + '</span>';
            }
        }

        // query_jvm_metrics
        if (toolName === 'query_jvm_metrics') {
            try {
                var jvm = JSON.parse(String(result));
                var metricCount = (jvm.metrics || []).length;
                var lastMetric = metricCount > 0 ? jvm.metrics[metricCount - 1] : null;
                var heapInfo = lastMetric ? ' heap: ' + (lastMetric.heap_used_bytes / 1024 / 1024).toFixed(0) + 'MB' : '';
                return '<span class="inv-count">' + metricCount + '</span> data points' + heapInfo;
            } catch (e) {
                return '<span class="inv-text">' + escapeHtml(truncateText(String(result), 60)) + '</span>';
            }
        }

        // query_gc_events
        if (toolName === 'query_gc_events') {
            try {
                var gc = JSON.parse(String(result));
                var gcCount = gc.gc_count || (gc.events || []).length;
                return '<span class="inv-count">' + gcCount + '</span> GC events';
            } catch (e) {
                return '<span class="inv-text">' + escapeHtml(truncateText(String(result), 60)) + '</span>';
            }
        }

        // Git tools
        if (toolName.indexOf('git_') === 0 || toolName.indexOf('mcp_git_') === 0) {
            var text = String(result);
            if (text.length < 100) return '<span class="inv-text">' + escapeHtml(text) + '</span>';
            return '<span class="inv-text">' + escapeHtml(truncateText(text, 80)) + '</span>';
        }

        // Generic: show result size or preview
        var str = String(result);
        if (str.length > 100) return '<span class="inv-text">' + escapeHtml(truncateText(str, 60)) + '</span>';
        try {
            var p = JSON.parse(str);
            return '<span class="inv-text">JSON with ' + Object.keys(p).length + ' keys</span>';
        } catch (e) {
            return '<span class="inv-text">' + escapeHtml(truncateText(str, 60)) + '</span>';
        }
    }

    // ── Metrics Analysis Page ───────────────────────────────────
    function initMetricsAnalysis() {
        var API_BASE = 'http://localhost:8080/api/sip-aiops';
        var currentPage = 0;
        var currentService = '';
        var currentType = 'all';
        var currentSeverity = 'all';
        var currentStatus = 'all';
        var allAlerts = [];

        var ctx = getNavContext();
        if (ctx.serviceName) {
            currentService = ctx.serviceName;
            var label = document.getElementById('maServiceLabel');
            if (label) label.textContent = 'Filtered: ' + ctx.serviceName;
        }

        function loadServiceFilter() {
            fetch(API_BASE + '/app-indicator/services')
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    var sel = document.getElementById('maServiceFilter');
                    if (!sel) return;
                    var services = (data && data.data) ? data.data : [];
                    services.forEach(function(svc) {
                        var opt = document.createElement('option');
                        opt.value = svc;
                        opt.textContent = svc;
                        if (svc === currentService) opt.selected = true;
                        sel.appendChild(opt);
                    });
                })
                .catch(function(err) {
                    console.warn('MA: Failed to load services:', err.message);
                });
        }

        function fetchAndRender() {
            var overlay = document.getElementById('maLoadingOverlay');
            if (overlay) overlay.classList.add('visible');

            var params = 'page=' + currentPage + '&size=10';
            if (currentService) params += '&serviceName=' + encodeURIComponent(currentService);
            if (currentType !== 'all') params += '&alertSubType=' + encodeURIComponent(currentType);
            if (currentSeverity !== 'all') params += '&severity=' + encodeURIComponent(currentSeverity);
            if (currentStatus !== 'all') params += '&status=' + encodeURIComponent(currentStatus);

            fetch(API_BASE + '/metric-alert?' + params)
                .then(function(res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function(data) {
                    if (overlay) overlay.classList.remove('visible');
                    if (data.success && data.data) {
                        renderTable(data.data);
                    }
                })
                .catch(function(err) {
                    if (overlay) overlay.classList.remove('visible');
                    console.warn('MA fetch error:', err.message);
                });

            // Update KPI cards
            fetch(API_BASE + '/alert-summary' + (currentService ? '?serviceName=' + encodeURIComponent(currentService) : ''))
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    if (data.success && data.data && data.data.metric) {
                        var m = data.data.metric;
                        var elTotal = document.getElementById('maTotal');
                        var elCpu = document.getElementById('maCpu');
                        var elMemory = document.getElementById('maMemory');
                        var elCritical = document.getElementById('maCritical');
                        var elOpen = document.getElementById('maOpen');
                        if (elTotal) elTotal.textContent = m.total || 0;
                        if (elCpu) elCpu.textContent = m.cpu || 0;
                        if (elMemory) elMemory.textContent = m.memory || 0;
                        if (elCritical) elCritical.textContent = m.critical || 0;
                        if (elOpen) elOpen.textContent = m.open || 0;
                    }
                })
                .catch(function() {});
        }

        function formatTime(detectedAt) {
            if (!detectedAt) return '-';
            var utcTime = String(detectedAt).replace(/[+-]\d{2}:\d{2}$/, '');
            var d = new Date(utcTime + 'Z');
            if (!isNaN(d.getTime())) {
                return d.toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false
                });
            }
            return String(detectedAt);
        }

        function renderTable(pageData) {
            var alerts = pageData.content || [];
            allAlerts = alerts;
            var total = pageData.total || 0;
            var tbody = document.getElementById('maTableBody');
            if (!tbody) return;

            var html = '';
            for (var i = 0; i < 10; i++) {
                if (i < alerts.length) {
                    var a = alerts[i];
                    var sev = (a.severity || 'INFO').toLowerCase();
                    var st = (a.status || 'OPEN').toLowerCase();
                    var detectedStr = formatTime(a.detectedAt);
                    var typeLabel = a.alertSubType || '-';

                    html += '<tr>' +
                        '<td class="col-title">' + escapeHtml(a.title || 'Untitled') + '</td>' +
                        '<td>' + escapeHtml(a.serviceName || '-') + '</td>' +
                        '<td><span class="alert-tag">' + escapeHtml(typeLabel) + '</span></td>' +
                        '<td><span class="alert-tag severity-' + sev + '">' + (a.severity || 'INFO') + '</span></td>' +
                        '<td><span class="alert-tag status-' + st + '">' + (a.status || 'OPEN') + '</span></td>' +
                        '<td class="col-summary" title="' + escapeHtml(a.summary || '') + '">' + escapeHtml(truncateText(a.summary, 60)) + '</td>' +
                        '<td class="col-time">' + (detectedStr || '-') + '</td>' +
                        '<td><button class="btn-alert-detail" data-id="' + a.id + '">Detail</button></td>' +
                        '</tr>';
                } else {
                    html += '<tr class="alert-empty-row"><td colspan="8">&nbsp;</td></tr>';
                }
            }
            tbody.innerHTML = html;

            var rc = document.getElementById('maRowCount');
            if (rc) rc.textContent = total;

            tbody.querySelectorAll('.btn-alert-detail').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var id = Number(btn.getAttribute('data-id'));
                    var alertData = allAlerts.find(function(a) { return a.id === id; });
                    if (alertData) openAlertDetailGeneric('metric-alert', alertData);
                });
            });
        }

        // Filter bindings
        document.getElementById('maServiceFilter').addEventListener('change', function() {
            currentService = this.value;
            currentPage = 0;
            var label = document.getElementById('maServiceLabel');
            if (label) label.textContent = currentService ? 'Filtered: ' + currentService : '';
            fetchAndRender();
        });

        document.querySelectorAll('.ma-filter').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.ma-filter').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentType = this.getAttribute('data-filter');
                currentPage = 0;
                fetchAndRender();
            });
        });

        document.querySelectorAll('.ma-sev-filter').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.ma-sev-filter').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentSeverity = this.getAttribute('data-filter');
                currentPage = 0;
                fetchAndRender();
            });
        });

        document.querySelectorAll('.ma-status-filter').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.ma-status-filter').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentStatus = this.getAttribute('data-filter');
                currentPage = 0;
                fetchAndRender();
            });
        });

        var maRefreshBtn = document.getElementById('maRefreshBtn');
        if (maRefreshBtn) maRefreshBtn.addEventListener('click', fetchAndRender);

        loadServiceFilter();
        fetchAndRender();

        // Register page refresh handler for badge-click navigation
        _pageRefreshers['page-metrics-analysis'] = function () {
            var ctx = getNavContext();
            if (ctx.serviceName) {
                currentService = ctx.serviceName;
                document.getElementById('maServiceFilter').value = currentService;
                var label = document.getElementById('maServiceLabel');
                if (label) label.textContent = 'Filtered: ' + currentService;
                currentPage = 0;
                fetchAndRender();
            }
        };
    }

    // ── Log Analysis Page ───────────────────────────────────────
    function initLogAnalysis() {
        var API_BASE = 'http://localhost:8080/api/sip-aiops';
        var currentPage = 0;
        var currentService = '';
        var currentSeverity = 'all';
        var currentStatus = 'all';
        var allAlerts = [];

        var ctx = getNavContext();
        if (ctx.serviceName) {
            currentService = ctx.serviceName;
            var label = document.getElementById('laServiceLabel');
            if (label) label.textContent = 'Filtered: ' + ctx.serviceName;
        }

        function loadServiceFilter() {
            fetch(API_BASE + '/app-indicator/services')
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    var sel = document.getElementById('laServiceFilter');
                    if (!sel) return;
                    var services = (data && data.data) ? data.data : [];
                    services.forEach(function(svc) {
                        var opt = document.createElement('option');
                        opt.value = svc;
                        opt.textContent = svc;
                        if (svc === currentService) opt.selected = true;
                        sel.appendChild(opt);
                    });
                })
                .catch(function(err) {
                    console.warn('LA: Failed to load services:', err.message);
                });
        }

        function fetchAndRender() {
            var overlay = document.getElementById('laLoadingOverlay');
            if (overlay) overlay.classList.add('visible');

            var params = 'page=' + currentPage + '&size=10';
            if (currentService) params += '&serviceName=' + encodeURIComponent(currentService);
            if (currentSeverity !== 'all') params += '&severity=' + encodeURIComponent(currentSeverity);
            if (currentStatus !== 'all') params += '&status=' + encodeURIComponent(currentStatus);

            fetch(API_BASE + '/log-alert?' + params)
                .then(function(res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function(data) {
                    if (overlay) overlay.classList.remove('visible');
                    if (data.success && data.data) {
                        renderTable(data.data);
                    }
                })
                .catch(function(err) {
                    if (overlay) overlay.classList.remove('visible');
                    console.warn('LA fetch error:', err.message);
                });

            // Update KPI cards
            fetch(API_BASE + '/alert-summary' + (currentService ? '?serviceName=' + encodeURIComponent(currentService) : ''))
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    if (data.success && data.data && data.data.log) {
                        var l = data.data.log;
                        var elTotal = document.getElementById('laTotal');
                        var elServices = document.getElementById('laServices');
                        var elCritical = document.getElementById('laCritical');
                        var elOpen = document.getElementById('laOpen');
                        var elResolved = document.getElementById('laResolved');
                        if (elTotal) elTotal.textContent = l.total || 0;
                        if (elServices) elServices.textContent = l.uniqueServices || 0;
                        if (elCritical) elCritical.textContent = l.critical || 0;
                        if (elOpen) elOpen.textContent = l.open || 0;
                        if (elResolved) elResolved.textContent = l.resolved || 0;
                    }
                })
                .catch(function() {});
        }

        function formatTime(detectedAt) {
            if (!detectedAt) return '-';
            var utcTime = String(detectedAt).replace(/[+-]\d{2}:\d{2}$/, '');
            var d = new Date(utcTime + 'Z');
            if (!isNaN(d.getTime())) {
                return d.toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false
                });
            }
            return String(detectedAt);
        }

        function renderTable(pageData) {
            var alerts = pageData.content || [];
            allAlerts = alerts;
            var total = pageData.total || 0;
            var tbody = document.getElementById('laTableBody');
            if (!tbody) return;

            var html = '';
            for (var i = 0; i < 10; i++) {
                if (i < alerts.length) {
                    var a = alerts[i];
                    var sev = (a.severity || 'INFO').toLowerCase();
                    var st = (a.status || 'OPEN').toLowerCase();
                    var detectedStr = formatTime(a.detectedAt);

                    html += '<tr>' +
                        '<td class="col-title">' + escapeHtml(a.title || 'Untitled') + '</td>' +
                        '<td>' + escapeHtml(a.serviceName || '-') + '</td>' +
                        '<td><span class="alert-tag severity-' + sev + '">' + (a.severity || 'INFO') + '</span></td>' +
                        '<td><span class="alert-tag status-' + st + '">' + (a.status || 'OPEN') + '</span></td>' +
                        '<td class="col-summary" title="' + escapeHtml(a.summary || '') + '">' + escapeHtml(truncateText(a.summary, 60)) + '</td>' +
                        '<td class="col-time">' + (detectedStr || '-') + '</td>' +
                        '<td><button class="btn-alert-detail" data-id="' + a.id + '">Detail</button></td>' +
                        '</tr>';
                } else {
                    html += '<tr class="alert-empty-row"><td colspan="7">&nbsp;</td></tr>';
                }
            }
            tbody.innerHTML = html;

            var rc = document.getElementById('laRowCount');
            if (rc) rc.textContent = total;

            tbody.querySelectorAll('.btn-alert-detail').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var id = Number(btn.getAttribute('data-id'));
                    var alertData = allAlerts.find(function(a) { return a.id === id; });
                    if (alertData) openAlertDetailGeneric('log-alert', alertData);
                });
            });
        }

        // Filter bindings
        document.getElementById('laServiceFilter').addEventListener('change', function() {
            currentService = this.value;
            currentPage = 0;
            var label = document.getElementById('laServiceLabel');
            if (label) label.textContent = currentService ? 'Filtered: ' + currentService : '';
            fetchAndRender();
        });

        document.querySelectorAll('.la-sev-filter').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.la-sev-filter').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentSeverity = this.getAttribute('data-filter');
                currentPage = 0;
                fetchAndRender();
            });
        });

        document.querySelectorAll('.la-status-filter').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.la-status-filter').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentStatus = this.getAttribute('data-filter');
                currentPage = 0;
                fetchAndRender();
            });
        });

        var laRefreshBtn = document.getElementById('laRefreshBtn');
        if (laRefreshBtn) laRefreshBtn.addEventListener('click', fetchAndRender);

        loadServiceFilter();
        fetchAndRender();

        // Register page refresh handler for badge-click navigation
        _pageRefreshers['page-log-analysis'] = function () {
            var ctx = getNavContext();
            if (ctx.serviceName) {
                currentService = ctx.serviceName;
                document.getElementById('laServiceFilter').value = currentService;
                var label = document.getElementById('laServiceLabel');
                if (label) label.textContent = 'Filtered: ' + currentService;
                currentPage = 0;
                fetchAndRender();
            }
        };
    }

    // ── Diagnosis Center Page ──────────────────────────────────
    // ── agentflow 控制面：base + 租户头（**唯一出处**）────────────────────
    //
    // ⚠️ **不带 `X-Tenant-ID` 时后端会走 dev 缺省租户 `local`** —— 那里没有本租户的
    // workflow / MCP 绑定 / agent 配置。表现极具误导性：列表里**看着有东西**，
    // 因为 otr 与 local 的 workflow **同名不同 id**，标题一模一样，点开才发现是旧副本。
    // 实测：Workflow Studio 一直看不到新加的节点，就是这么来的。
    //
    // 基址优先级与 Bug Solve 页一致（bugSolveBaseUrl > workflowBaseUrl > 默认 8000）；
    // 租户取 `agentflowTenantId`（与 Vue 侧 `src/api/config.js` 的 resolveTenant 同一个 key）。
    var AGENTFLOW_BASE = localStorage.getItem('bugSolveBaseUrl')
        || localStorage.getItem('workflowBaseUrl') || 'http://localhost:8000';
    var AGENTFLOW_TENANT = localStorage.getItem('agentflowTenantId') || 'otr';

    /**
     * 访问 agentflow 控制面。`path` 以 `/` 开头，`options.body` 传**对象**（自动 JSON）。
     *
     * 所有 agentflow 调用都必须经这里 —— 直接 `fetch(base + path)` 会漏掉租户头，
     * 落到 `local` 租户，症状是"读到了别的租户的数据"，不报错、不 404。
     */
    function agentflowFetch(path, options) {
        var opts = options || {};
        var headers = { 'X-Tenant-ID': AGENTFLOW_TENANT };
        if (opts.headers) {
            for (var k in opts.headers) { if (opts.headers.hasOwnProperty(k)) headers[k] = opts.headers[k]; }
        }
        if (opts.body) headers['Content-Type'] = 'application/json';
        return fetch(AGENTFLOW_BASE + path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined
        });
    }

    function initProblems() {
        // 后端地址（同 Monitor Targets）：默认 http://localhost:7070，localStorage 可覆盖。
        var APM_BASE_URL = localStorage.getItem('apmBaseUrl') || 'http://localhost:7070';
        var TENANT_ID = localStorage.getItem('apmTenantId') || 'default';
        var API_KEY = localStorage.getItem('apmApiKey') || '';

        var PAGE_SIZE = 10;
        var currentPage = 0;
        var currentService = '';
        var currentSeverity = 'all';
        var currentState = 'all';
        // 证据类型：'all' | 'metric' | 'log'。由 Smart Inspection 的徽标下钻带入
        // （/problems?type=metric），也可由本页新增的 chip 手动切换。
        var currentType = 'all';
        // URL query 的白名单：只接受确实有对应 chip 的值，否则 applyQueryFilters 一律忽略
        // （手敲的 URL 不该能把页面卡在一个没有任何控件能清掉的状态上）。
        var TYPE_FILTERS = ['all', 'metric', 'log'];
        // ⚠️ 这里每加一个值，`legacy-panels.html` 的 chip 行必须同步加一枚
        // （否则能筛、但没有任何控件能切到它），CSS 也要补一条 `.alert-tag.status-<值>`。
        var STATE_FILTERS = ['all', 'open', 'in_progress', 'resolved', 'closed', 'escalated'];
        var allProblems = [];
        var pcPollTimer = null;    // 5s 自动刷新定时器
        var pcRefreshing = false;  // 请求在途标志：避免轮询堆叠

        // agentflow 的 base / 租户 / fetch **不在这里声明**了 —— 已上提到模块级
        // （见本文件里 `AGENTFLOW_BASE` 那一段）。当初的起因是「本页此前的 agentflow 调用
        // 全都不带租户头，run 会落到 dev 缺省租户 local，而那里没有任何 MCP 绑定 → agent
        // 拿不到工具」；同一个坑后来在 Workflow Studio 又踩了一次（它读的是 local 的旧
        // workflow），所以收口到**一处**，不再按页各写一份。
        // 「Analyze」固定用这条日志诊断流程（按 name 解析 id；名字要与 seed 脚本一致）
        var LOG_DIAGNOSE_WF_NAME = 'problem-log-diagnose';
        var pcLogWfId = '';       // 解析后的 workflow id 缓存
        var pcLogWfBusy = false;  // 解析在途（防并发重复拉取）

        // 解析日志诊断 workflow 的 id（按 name 查 agentflow /workflows）。
        // 找不到时给**可执行**的提示——这条流程是 seed 出来的，库里没有它「Analyze」必然失败。
        function resolveLogDiagnoseWorkflowId() {
            if (pcLogWfId) return Promise.resolve(pcLogWfId);
            if (pcLogWfBusy) return Promise.reject(new Error('workflow lookup already in progress, please retry'));
            pcLogWfBusy = true;
            return agentflowFetch('/workflows')
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (list) {
                    var workflows = Array.isArray(list) ? list : [];
                    for (var i = 0; i < workflows.length; i++) {
                        if (workflows[i].name === LOG_DIAGNOSE_WF_NAME) {
                            pcLogWfId = workflows[i].id;
                            pcLogWfBusy = false;
                            return pcLogWfId;
                        }
                    }
                    pcLogWfBusy = false;
                    throw new Error('workflow ' + LOG_DIAGNOSE_WF_NAME + ' not found' +
                        ' (seed it first: run scripts/seed_problem_log_diagnose.py in multi-agent-workflow' +
                        ' with --tenant ' + AGENTFLOW_TENANT + ')');
                }, function (err) {
                    pcLogWfBusy = false;
                    throw err;
                });
        }

        function getEl(id) { return document.getElementById(id); }

        // ── API 封装（统一 X-Tenant-Id / 可选 Bearer）────
        function apmApi(path, options) {
            var opts = options || {};
            var headers = {};
            headers['X-Tenant-Id'] = TENANT_ID;
            if (API_KEY) headers['Authorization'] = 'Bearer ' + API_KEY;
            if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
            return fetch(APM_BASE_URL + path, {
                method: opts.method || 'GET',
                headers: headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
            }).then(function (res) {
                return res.text().then(function (text) {
                    var data = null;
                    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
                    if (!res.ok) {
                        var reason = 'HTTP ' + res.status;
                        if (data && typeof data === 'object' && data.reason) reason = data.reason;
                        var err = new Error(reason);
                        err.status = res.status;
                        err.data = data;
                        throw err;
                    }
                    return data;
                });
            });
        }

        // ── Confirm dialog（复用全局确认弹窗）──
        var _confirmCb = null;
        function confirmDialog(message, onConfirm) {
            _confirmCb = onConfirm || null;
            getEl('confirmModalMsg').textContent = message;
            getEl('confirmModalOverlay').classList.add('open');
        }
        function closeConfirm() {
            _confirmCb = null;
            getEl('confirmModalOverlay').classList.remove('open');
        }
        function runConfirm() {
            var cb = _confirmCb;
            closeConfirm();
            if (typeof cb === 'function') cb();
        }

        function formatTime(detectedAt) {
            if (!detectedAt) return '-';
            var utcTime = String(detectedAt).replace(/[+-]\d{2}:\d{2}$/, '');
            var d = new Date(utcTime + 'Z');
            if (!isNaN(d.getTime())) {
                return d.toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false
                });
            }
            return String(detectedAt);
        }

        function loadServiceFilter() {
            var sel = getEl('pcServiceFilter');
            if (!sel) return;
            sel.innerHTML = '<option value="">All Services</option>'; // 每次重建，避免静默刷新时 option 累积重复
            var seen = {};
            allProblems.forEach(function (p) {
                if (p.service && !seen[p.service]) {
                    seen[p.service] = true;
                    var opt = document.createElement('option');
                    opt.value = p.service;
                    opt.textContent = p.service;
                    sel.appendChild(opt);
                }
            });
            // currentService 有值但数据里没有同名 option 时**补一个** —— 否则控件在说谎：
            // 从 Smart Inspection 点「0」徽标下钻过来时，该服务在 allProblems 里一条都没有，
            // 下拉框会回落显示 "All Services"，而表格其实正按该服务过滤着。
            if (currentService && !seen[currentService]) {
                var extra = document.createElement('option');
                extra.value = currentService;
                extra.textContent = currentService;
                sel.appendChild(extra);
            }
            if (currentService) sel.value = currentService;
        }

        /**
         * URL query → 本页筛选（下钻入口）。
         *
         * 谁写的 URL：Smart Inspection 的徽标走 navigateToPage('problems', {...})，
         * 经接缝 S3（src/router/index.js 的 __SIP_NAVIGATE）转成
         * /problems?service=X&type=metric&state=open。
         *
         * 【为什么读 location.search 而不是扩 __SIP_SHOW_PAGE 接缝】那条接缝只把
         * to.meta.panelId 递过来，query 被丢掉。而 __SIP_NAVIGATE 的注释里本来就承诺了
         * 「可分享、可刷新、可前进后退」—— 只是接收端从来没人兑现。读 location.search
         * 把这个已文档化的机制补完，改动全部落在本文件；改接缝则要连 CLAUDE.md 里登记的
         * 签名、showPage、路由三处一起动。
         *
         * queryArg 可选（默认取 location.search）—— 将来若有第二个 legacy 页面需要上下文，
         * 改成 showPage(pageId, query) → _pageRefreshers[pageId](query) 递进来即可，
         * 现有 10 个零参 refresher 不受影响。
         *
         * 三个参数**任一存在才生效**；都不在时完全不动（保持用户当前筛选，包括手动切过的 chip）。
         * 取值先对着 chip 白名单校验，不认识的一律忽略 —— 免得手敲的 URL 把状态卡在一个
         * 没有任何 chip 能清掉的值上。
         */
        function applyQueryFilters(queryArg) {
            var qs = (queryArg === undefined || queryArg === null) ? location.search : String(queryArg);
            if (!qs) return;
            var q;
            try { q = new URLSearchParams(qs); } catch (e) { return; }

            var svc = q.get('service');
            var type = q.get('type');
            var state = q.get('state');
            if (!svc && !type && !state) return;

            if (svc) {
                currentService = svc;
                var sel = getEl('pcServiceFilter');
                if (sel) sel.value = svc;              // loadServiceFilter 会补缺失的 option
                var label = getEl('pcServiceLabel');
                if (label) label.textContent = 'Filtered: ' + svc;
            }
            if (type && TYPE_FILTERS.indexOf(type) !== -1) {
                currentType = type;
                syncChipRow('.pc-type-filter', type);
            }
            if (state && STATE_FILTERS.indexOf(state) !== -1) {
                currentState = state;
                syncChipRow('.pc-state-filter', state);
            }
            currentPage = 0;
        }

        /** 把某一组 chip 的高亮同步到指定值（不动语义，只改 .active） */
        function syncChipRow(selector, value) {
            legacyRoot().querySelectorAll(selector).forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-filter') === value);
            });
        }

        function renderKpi() {
            var total = allProblems.length;
            var services = {};
            var critical = 0, open = 0, resolved = 0;
            allProblems.forEach(function (p) {
                if (p.service) services[p.service] = true;
                if ((p.severity || '').toLowerCase() === 'critical') critical++;
                var st = (p.state || '').toLowerCase();
                if (st === 'pending' || st === 'in_progress') open++;
                if (st === 'resolved') resolved++;
            });
            getEl('pcTotal').textContent = total;
            getEl('pcServices').textContent = Object.keys(services).length;
            getEl('pcCritical').textContent = critical;
            getEl('pcOpen').textContent = open;
            getEl('pcResolved').textContent = resolved;
        }

        function filteredProblems() {
            return allProblems.filter(function (p) {
                // 服务：按**成员**匹配而非整串相等（problemMatchesService）—— 后端的 service
                // 可能是逗号拼接的多服务串，旧的 `p.service !== currentService` 会让这类记录
                // 在它点名的任何一个服务下都查不到，而 Smart Inspection 的徽标是按成员计的，
                // 两边不一致。下拉框里那串完整值仍然选得中（整串相等是成员匹配的子集）。
                if (!problemMatchesService(p, currentService)) return false;
                if (currentSeverity !== 'all' && (p.severity || '').toLowerCase() !== currentSeverity) return false;
                if (!problemMatchesType(p, currentType)) return false;
                if (currentState !== 'all') {
                    var st = (p.state || '').toLowerCase();
                    if (currentState === 'open') {
                        // 与共享的 problemIsOpen 同一口径（白名单 pending|in_progress）
                        if (!problemIsOpen(st)) return false;
                    } else if (currentState === 'closed') {
                        if (st !== 'closed' && st !== 'archived') return false;
                    } else if (st !== currentState) {
                        return false;
                    }
                }
                return true;
            });
        }

        // 列表标题：日志问题取签名冒号后的 message（去掉堆栈帧）；指标问题取 metric = value；兜底用 summary
        function problemTitle(p) {
            if (p.log_anomalies && p.log_anomalies.length) {
                var sig = p.log_anomalies[0].signature || p.log_anomalies[0].pattern || '';
                if (sig) {
                    var firstLine = sig.split('|')[0];          // 去掉 | 之后的堆栈帧
                    var idx = firstLine.indexOf(':');
                    if (idx >= 0) {
                        var msg = firstLine.slice(idx + 1).trim();
                        if (msg) return msg;                     // ExceptionType: message → message
                    }
                    return firstLine;                            // 无冒号（无堆栈时签名即 message）
                }
            }
            if (p.metric_anomalies && p.metric_anomalies.length) {
                var m = p.metric_anomalies[0];
                if (m.metric) return m.metric + ' = ' + m.value;
            }
            return (p.symptom && p.symptom.summary) ? p.symptom.summary : (p.record_id || 'Untitled');
        }

        function renderTable() {
            var filtered = filteredProblems();
            var total = filtered.length;
            var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            if (currentPage >= totalPages) currentPage = totalPages - 1;
            var start = currentPage * PAGE_SIZE;
            var rows = filtered.slice(start, start + PAGE_SIZE);

            var tbody = getEl('pcTableBody');
            var html = '';
            if (total === 0) {
                html = '<tr class="alert-empty-row"><td colspan="8" class="pc-empty-state">No problems match the current filters.</td></tr>';
            } else {
            for (var i = 0; i < PAGE_SIZE; i++) {
                if (i < rows.length) {
                    var p = rows[i];
                    var title = problemTitle(p);
                    var sev = (p.severity || 'warning').toLowerCase();
                    var st = (p.state || 'pending').toLowerCase();
                    var disp = problemDisplayStatus(p);   // 状态列：忽略 →「ignored」（见该函数说明）
                    // 「已发起分析」= 有 agent_run（新路径：Analyze 走 agentflow run）
                    // 或 diagnose_session（老记录：直连 spike）。两者都能进 View diagnosis——
                    // 后端 GET /{id}/diagnose 已按绑定分派引擎，返回同一形状，前端不必分支。
                    var diag = findAgentRun(p) || findDiagnoseSession(p);
                    html += '<tr>' +
                        '<td class="col-title" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</td>' +
                        '<td>' + escapeHtml(p.service || '-') + '</td>' +
                        '<td>' + escapeHtml(p.domain || '-') + '</td>' +
                        '<td><span class="alert-tag severity-' + sev + '">' + escapeHtml(p.severity || 'warning') + '</span></td>' +
                        '<td><span class="alert-tag status-' + disp.cls + '">' + escapeHtml(disp.label) + '</span></td>' +
                        '<td>' + (p.occurrence_count || 1) + '</td>' +
                        '<td class="col-time">' + formatTime(p.detected_at || p.first_seen_at) + '</td>' +
                        '<td class="pc-actions">' +
                        '<button class="btn-alert-detail" data-id="' + escapeHtml(p.record_id) + '" data-act="detail">Detail</button>' +
                        ((st === 'pending' || st === 'in_progress') && !diag ? '<button class="btn-alert-detail pc-diag-btn" data-id="' + escapeHtml(p.record_id) + '" data-act="diagnose">Analyze</button>' : '') +
                        (diag ? '<button class="btn-alert-detail pc-viewdiag-btn" data-id="' + escapeHtml(p.record_id) + '" data-act="view-diagnosis">View diagnosis</button>' : '') +
                        ((st === 'pending' || st === 'in_progress') ? '<button class="btn-alert-detail pc-ignore-btn" data-id="' + escapeHtml(p.record_id) + '" data-act="ignore">Ignore</button>' : '') +
                        '</td>' +
                        '</tr>';
                } else {
                    html += '<tr class="alert-empty-row"><td colspan="8">&nbsp;</td></tr>';
                }
            }
            }
            tbody.innerHTML = html;

            // 客户端分页控件
            var pg = getEl('pcPagination');
            pg.innerHTML =
                '<span>Total <span id="pcRowCount">' + total + '</span> problems</span>' +
                '<span class="pc-pager">' +
                '<button class="btn-page" data-pg="prev"' + (currentPage === 0 ? ' disabled' : '') + '>&lsaquo; Prev</button>' +
                '<span class="pc-page-info">Page ' + (currentPage + 1) + ' / ' + totalPages + '</span>' +
                '<button class="btn-page" data-pg="next"' + (currentPage >= totalPages - 1 ? ' disabled' : '') + '>Next &rsaquo;</button>' +
                '</span>';

            pg.querySelectorAll('.btn-page').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    if (btn.getAttribute('data-pg') === 'prev') {
                        if (currentPage > 0) { currentPage--; renderTable(); }
                    } else {
                        if (currentPage < totalPages - 1) { currentPage++; renderTable(); }
                    }
                });
            });

            tbody.querySelectorAll('.btn-alert-detail').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var id = btn.getAttribute('data-id');
                    var act = btn.getAttribute('data-act');
                    var rec = allProblems.find(function (p) { return p.record_id === id; });
                    if (!rec) return;
                    if (act === 'detail') openProblemDetail(rec);
                    else if (act === 'ignore') confirmIgnore(rec);
                    else if (act === 'diagnose') startDiagnose(rec);
                    // View diagnosis 回到**结论版面**（.dgx-*）：先看根因/方案/审批，
                    // 执行过程退到弹窗底部「历次执行」区按需查看（见 dgxExecutions）。
                    else if (act === 'view-diagnosis') openDiagnosisView(rec);
                });
            });
        }

        function detailRow(label, value) {
            if (value === undefined || value === null || value === '') return '';
            return '<tr><td class="pd-label">' + escapeHtml(label) + '</td><td>' + escapeHtml(String(value)) + '</td></tr>';
        }

        // 日志签名完整展开：按 | 拆成「异常/消息首行 + 每帧堆栈」，各自独占一行，不截断
        function logSignatureHtml(sig) {
            var parts = (sig || '').split('|');
            var html = '';
            for (var i = 0; i < parts.length; i++) {
                var part = parts[i];
                if (!part) continue;
                html += (i === 0 ? '<div class="pd-msg">' : '<div class="pd-frame">') +
                    escapeHtml(part) + '</div>';
            }
            return html || escapeHtml(sig || '-');
        }

        function buildDetailHtml(rec) {
            var html = '';
            var sev = (rec.severity || 'warning').toLowerCase();
            var disp = problemDisplayStatus(rec);   // 与表格同一份判据（忽略 →「ignored」）
            html += '<div class="pd-header">' +
                '<span class="alert-tag severity-' + sev + '">' + escapeHtml(rec.severity || 'warning') + '</span> ' +
                '<span class="alert-tag status-' + disp.cls + '">' + escapeHtml(disp.label) + '</span>' +
                '<span class="pd-occur">Occurrences: ' + (rec.occurrence_count || 1) + '</span>' +
                '</div>';
            var summary = (rec.symptom && rec.symptom.summary) ? rec.symptom.summary : '';
            if (summary) html += '<div class="pd-summary">' + escapeHtml(summary) + '</div>';

            html += '<h4 class="pd-section">Meta</h4>';
            html += '<table class="pd-meta"><tbody>' +
                detailRow('Record ID', rec.record_id) +
                detailRow('Service', rec.service) +
                detailRow('Domain', rec.domain) +
                detailRow('Detected At', formatTime(rec.detected_at)) +
                detailRow('First Seen', formatTime(rec.first_seen_at)) +
                detailRow('Last Seen', formatTime(rec.last_seen_at)) +
                detailRow('Resolved At', formatTime(rec.resolved_at)) +
                detailRow('Resolve Reason', rec.resolve_reason) +
                detailRow('Change Related', rec.change_related ? 'yes' : 'no') +
                detailRow('Trace ID', rec.trace_id) +
                '</tbody></table>';

            if (rec.metric_anomalies && rec.metric_anomalies.length) {
                html += '<h4 class="pd-section">Metric Anomalies (' + rec.metric_anomalies.length + ')</h4>';
                html += '<table class="pd-anoms"><tbody>';
                rec.metric_anomalies.forEach(function (a) {
                    html += '<tr><td>' + escapeHtml(a.metric || '-') + '</td>' +
                        '<td>value=' + (a.value !== undefined ? a.value : '-') + '</td>' +
                        '<td>baseline=' + (a.baseline !== undefined ? a.baseline : '-') + '</td></tr>';
                });
                html += '</tbody></table>';
            }

            if (rec.log_anomalies && rec.log_anomalies.length) {
                html += '<h4 class="pd-section">Log Anomalies (' + rec.log_anomalies.length + ')</h4>';
                html += '<div class="pd-sig-list">';
                rec.log_anomalies.forEach(function (a) {
                    html += '<div class="pd-sig" title="' + escapeHtml(a.signature || '') + '">' +
                        logSignatureHtml(a.signature || a.pattern || '-') + '</div>';
                });
                html += '</div>';
            }

            var corr = rec.correlation || {};
            html += '<h4 class="pd-section">Correlation</h4>';
            html += '<table class="pd-meta"><tbody>' +
                detailRow('Related', corr.related === true ? 'yes' : 'no') +
                detailRow('Reason', corr.reason) +
                '</tbody></table>';

            var ver = rec.verification || {};
            html += '<h4 class="pd-section">Verification</h4>';
            html += '<table class="pd-meta"><tbody>' +
                detailRow('Persistence OK', ver.persistence_ok === true ? 'yes' : 'no') +
                detailRow('False Positive Rate', ver.false_positive_rate !== undefined ? ver.false_positive_rate : '') +
                detailRow('Final Severity', ver.final_severity) +
                '</tbody></table>';

            if (rec.evidence && rec.evidence.length) {
                html += '<h4 class="pd-section">Evidence (' + rec.evidence.length + ')</h4>';
                html += '<div class="pd-evidence">';
                rec.evidence.forEach(function (ev) {
                    var evHtml = '';
                    if (ev.target_ids && ev.target_ids.length) {
                        evHtml += '<div class="pd-ev-line"><span class="pd-ev-label">targets</span><span class="pd-ev-ids">' +
                            ev.target_ids.map(function (t) { return escapeHtml(String(t)); }).join(', ') + '</span></div>';
                    }
                    if (ev.trace_ids && ev.trace_ids.length) {
                        evHtml += '<div class="pd-ev-line"><span class="pd-ev-label">traces</span><span class="pd-ev-ids">' +
                            ev.trace_ids.map(function (t) { return escapeHtml(String(t)); }).join(', ') + '</span></div>';
                    }
                    if (!evHtml) evHtml = '<div class="pd-ev-line"><span class="pd-ev-ids">' + escapeHtml(JSON.stringify(ev)) + '</span></div>';
                    html += '<div class="pd-ev-item">' +
                        '<div class="pd-ev-head">' +
                        '<span class="pd-ev-type">' + escapeHtml(ev.type || 'unknown') + '</span>' +
                        (ev.round_id ? '<span class="pd-ev-round" title="detection round id (= trace_id)">round ' + escapeHtml(ev.round_id) + '</span>' : '') +
                        (ev.count !== undefined ? '<span class="pd-ev-count">count ' + ev.count + '</span>' : '') +
                        '</div>' +
                        evHtml +
                        '</div>';
                });
                html += '</div>';
            }

            return html;
        }

        function openProblemDetail(rec) {
            // 专用宽模态框 pcDetailOverlay（1200px，对齐 Monitor Target 的 Test/net 弹窗）
            var overlay = getEl('pcDetailOverlay');
            var content = getEl('pcDetailContent');
            var title = getEl('pcDetailTitle');
            if (!overlay || !content) return;
            title.textContent = 'Problem Detail - ' + (rec.record_id || '');
            content.innerHTML = buildDetailHtml(rec);
            overlay.classList.add('open');
        }

        function closeProblemDetail() {
            var overlay = getEl('pcDetailOverlay');
            if (overlay) overlay.classList.remove('open');
        }

        // 忽略（列表行上的 Ignore）→ POST /v1/problems/{id}/ignore → 后端 close(reason=ignored)，
        // 状态列随即显示 ignored。
        //
        // 【为什么不打 /resolve】旧实现是 `/resolve` + `{false_positive:true}`，两个后果都是错的：
        //   ① 后端 /resolve 无条件写 state=resolved —— 用户点的是「忽略」，库里却记「已修复」，
        //      状态列照实回显 resolved，等于替用户编造结论；
        //   ② 同一个请求还顺带把这条单记成一次**误报**（fpr_table + 误报率 Gauge）。
        //      忽略 ≠ 误报：忽略是「先搁置不看」，误报是「这次检测报错了」，后者是 L3 误报率
        //      闸门的输入。混在一起会让误报率被搁置的单污染。
        // 【弹框文案只写用户会看到的结果】别在这里补「（不算误报）」之类的澄清 —— 点忽略的人
        // 脑子里没有「误报」这个概念，只有读过旧文案的人才需要这层对比，对其他人就是读不懂的
        // 括号。误报有自己的入口与文案：诊断弹框里的「误报」按钮（标记为误报？将记入误报率…）。
        // 诊断弹框里的「忽略」走 /diagnose/decision（会额外 /dismiss 收尾诊断会话）；本按钮
        // 服务的是**列表行**，对没绑过诊断的单同样可用，故只用这个轻量端点。
        function confirmIgnore(rec) {
            confirmDialog('Ignore problem ' + rec.record_id + '? It will be marked as ignored.', function () {
                apmApi('/v1/problems/' + encodeURIComponent(rec.record_id) + '/ignore', { method: 'POST' })
                    .then(function () {
                        window._showToast('Ignored ' + rec.record_id, 'success');
                        refresh();
                    })
                    .catch(function (err) {
                        window._showToast('Ignore failed: ' + err.message, 'error');
                    });
            });
        }

        // ── Analyze：问题单 → POST /v1/problems/{id}/diagnose（后端按记录拼装 /diagnose/logs，
        //    session_id 绑进 evidence；绑定后 Analyze 隐藏，出现「View diagnosis」）──────
        // 内容视图：本页轮询 GET /v1/problems/{id}/diagnose（后端同源代理诊断服务 /status），
        // 直到终态（completed/failed/approved/closed_manual）停轮。
        var diagBusy = {};        // record_id -> true（请求在途，防双击）
        var pcDiagRec = null;     // 正在查看诊断的问题记录
        var pcDiagTimer = null;   // 2s 轮询 timer（关弹框必清）
        var pcDiagLastSnap = null;// 最近一次渲染的快照（重渲染/交互置灰用）
        var PC_DIAG_TERMINAL = { completed: 1, failed: 1, approved: 1, closed_manual: 1, dismissed: 1 };
        // 状态胶囊一律中文标签（**绝不把原始枚举印给用户**，与 dgxTaskView 同纪律）。
        // CSS 类仍用原始 dgx-status--<en>（着色不受影响），兜底 || st。
        var DGX_STATUS_LABEL = {
            analyzing: '分析中', completed: '已完成', failed: '失败',
            approved: '已通过', closed_manual: '需人工处理', dismissed: '已忽略'
        };
        // 修复步骤的类别（agentflow 的 fix-planner 输出 type；老 spike 快照没有这个字段）
        var DGX_STEP_TYPE = {
            code_fix: '代码修复',
            infra_action: '基础设施动作',
            config_change: '配置变更'
        };
        var dgxOptSel = 0;        // 当前选中的修复方案下标（互斥多方案分页签）
        var dgxChainOpen = false; // 「分析链路」折叠区开合（默认关闭；轮询重渲染后保持）
        var dgxFbOpen = false;    // 拒绝反馈框开合
        var dgxFbText = '';       // 拒绝反馈文本（轮询重渲染回填，不丢输入）
        var dgxDeciding = false;  // 决策 POST 在途（按钮 disabled）
        var dgxRerunPending = false; // 拒绝后抑制旧 completed 快照重新渲染出审批条
        var dgxRerunCount = 0;    // 拒绝时的 reanalyze_count（重跑起跳观测点）
        var pcDiagHistory = { items: [], rev: 0 }; // 历史计划（真源 = APM evidence）；rev = 已拉取时的 reanalyze_count

        // 取记录里最新一条 diagnose_session evidence（record_id → session_id 的桥）
        function findDiagnoseSession(rec) {
            var ev = (rec && rec.evidence) || [];
            var last = null;
            for (var i = 0; i < ev.length; i++) {
                var e = ev[i];
                if (e && e.type === 'diagnose_session' && e.session_id) last = e;
            }
            return last;
        }

        // 「Analyze」= 由 APM 组 inputs（包装的 bug_report + 时间窗）并起一次 agentflow run，
        // 再把 run_id 绑回问题单；随后前端**直连 agentflow** 轮询进度/提交审批（复用
        // 「View analysis」那套 run 渲染器）。起 run 之所以仍走 APM：绑定与起 run 是**原子的一步**
        // （浏览器直连 /run 再补绑定，中间失败会留下"起了 run 但没绑定"的孤儿 run——列表上看不见、
        // 也打不开）。tenant 桥接（APM 租户 default ↔ agentflow 租户 otr）也在 APM 内部完成。
        function startDiagnose(rec) {
            if (!rec || diagBusy[rec.record_id]) return;
            diagBusy[rec.record_id] = true;
            var recordId = rec.record_id;
            resolveLogDiagnoseWorkflowId()
                .then(function (wfId) {
                    // rerun: true —— 打回后重跑（同一条记录再起一轮）；引擎没有"重跑同一个 run"的语义
                    return apmApi('/v1/problems/' + encodeURIComponent(recordId) + '/analyze', {
                        method: 'POST', body: { workflow_id: wfId, rerun: true }
                    });
                })
                .then(function (data) {
                    delete diagBusy[recordId];
                    var rid = data && data.run_id ? data.run_id : '';
                    window._showToast('Analyze started' + (rid ? ' · ' + rid : ''), 'success');
                    if (rid) openProblemRun(rec, rid); // 直接打开运行视图（不必等 evidence 回读）
                    refresh(); // 非乐观：以后端 evidence 为准 → Analyze 隐藏 + 出现 View diagnosis
                })
                .catch(function (err) {
                    delete diagBusy[recordId];
                    window._showToast('Analyze failed: ' + (err && err.message ? err.message : 'network error'), 'error');
                });
        }

        function stopDiagPolling() {
            if (pcDiagTimer) { clearInterval(pcDiagTimer); pcDiagTimer = null; }
        }

        // 重启 2s 轮询（打开弹框与拒绝成功后共用；先停再起，避免叠加多个 timer）
        function ensureDiagPolling() {
            stopDiagPolling();
            pcDiagTimer = setInterval(pollDiagnosis, 2000);
        }

        function openDiagnosisView(rec) {
            // 两种绑定都能进：agent_run（新路径，走 agentflow 工作流）
            // 或 diagnose_session（老记录，直连 spike）。
            // 后端 GET /{id}/diagnose 会按绑定分派引擎并返回同一形状，前端不需要分支。
            if (!findAgentRun(rec) && !findDiagnoseSession(rec)) {
                window._showToast('No diagnosis bound to ' + (rec && rec.record_id ? rec.record_id : 'record'), 'error');
                return;
            }
            pcDiagRec = rec;
            // 换记录 → 复位全部交互状态（审批条/反馈框/历史/分页签/链路）
            dgxOptSel = 0;
            dgxChainOpen = false;
            dgxFbOpen = false;
            dgxFbText = '';
            dgxDeciding = false;
            dgxRerunPending = false;
            dgxRerunCount = 0;
            pcDiagLastSnap = null;
            pcDiagHistory = { items: [], rev: 0 };
            var title = getEl('pcDiagnoseTitle');
            if (title) title.textContent = 'Diagnosis · ' + rec.record_id;
            var bodyEl = getEl('pcDiagnoseBody');
            if (bodyEl) bodyEl.innerHTML = '<div class="pc-diag-loading">Loading diagnosis…</div>';
            var overlay = getEl('pcDiagnoseOverlay');
            if (overlay) overlay.classList.add('open');
            pollDiagnosis();
            loadDiagnoseDecisions(rec.record_id); // 历史计划（真源 = APM evidence）
            ensureDiagPolling();
        }

        function closeDiagnosisView() {
            stopDiagPolling();
            pcDiagRec = null;
            pcDiagLastSnap = null;
            var overlay = getEl('pcDiagnoseOverlay');
            if (overlay) overlay.classList.remove('open');
        }

        function pollDiagnosis() {
            if (!pcDiagRec) return;
            var recordId = pcDiagRec.record_id;
            apmApi('/v1/problems/' + encodeURIComponent(recordId) + '/diagnose')
                .then(function (snap) {
                    // 拒绝后抑制窗口：重跑已起跳（analyzing）或已产出新一版（reanalyze_count 增长）→ 解除。
                    // 响应里的 session_status 是旧值（_schedule_run 不同步置 analyzing），不能靠它判断。
                    if (dgxRerunPending && snap) {
                        if (snap.status === 'analyzing' ||
                            (typeof snap.reanalyze_count === 'number' && snap.reanalyze_count > dgxRerunCount)) {
                            dgxRerunPending = false;
                        }
                    }
                    renderDiagnosis(snap);
                    if (snap && PC_DIAG_TERMINAL[snap.status] && !dgxRerunPending) stopDiagPolling();
                    // 历史可能被别的操作者追加 → 版本号变了就重拉。
                    // 老路径（spike）用 reanalyze_count；新路径（agentflow）没有这个字段，
                    // 改用 executions 的轮次数——每起一轮 run 就多一条，等价于"诊断又推进了一轮"。
                    var rev = (snap && typeof snap.reanalyze_count === 'number')
                        ? snap.reanalyze_count
                        : ((snap && snap.executions ? snap.executions.length : 0));
                    if (rev !== pcDiagHistory.rev) {
                        pcDiagHistory.rev = rev;
                        loadDiagnoseDecisions(recordId);
                    }
                })
                .catch(function (err) {
                    stopDiagPolling();
                    var bodyEl = getEl('pcDiagnoseBody');
                    if (bodyEl) bodyEl.innerHTML = '<div class="pc-diag-error">' + escapeHtml('Load failed: ' + err.message) + '</div>';
                });
        }

        // ── 历史计划（真源 = APM evidence 的 diagnose_decision）：spike 的 remediation 单值，
        //    每次重跑即清空，故历史只能落 APM；这里走独立只读端点，不污染 /diagnose 的逐字回传。
        // ⚠️ 后端 decision 枚举里还有 `false_positive`（M7 的误报回写链路仍在用），
        // 只是处理模块不再出那个按钮——历史里仍可能出现，所以这张表不能删它。
        // 漏登记的 decision 会被 `dgxPlanHistory` **原样印给用户**、chip 兜底成灰色。
        var DGX_DECISION_LABEL = { reject: '已拒绝', ignore: '已忽略', escalate: '已升级', false_positive: '已误报' };
        var DGX_DECISION_CLS = { reject: 'reject', ignore: 'ignore', escalate: 'escalate', false_positive: 'fp' };

        function loadDiagnoseDecisions(recordId) {
            return apmApi('/v1/problems/' + encodeURIComponent(recordId) + '/diagnose/decisions')
                .then(function (data) {
                    if (!pcDiagRec || pcDiagRec.record_id !== recordId) return; // 已切记录 → 丢弃
                    pcDiagHistory.items = (data && data.items) || [];
                    if (pcDiagLastSnap) renderDiagnosis(pcDiagLastSnap);
                })
                .catch(function () { /* 历史拉取失败不阻断主视图 */ });
        }

        // 渲染小工具（dgx = diaGnosis eXperience）
        function dgxEsc(s) { return escapeHtml(s === null || s === undefined ? '' : String(s)); }
        function dgxShort(s) { var v = String(s || ''); return v.length > 10 ? v.slice(0, 10) : v; }
        function dgxClock(ts) {
            var t = dgxTsMs(ts);
            if (isNaN(t)) return '';
            // 与 formatTime 同口径：按 UTC 解析、以 Asia/Shanghai 显示
            return new Date(t).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
        }
        // 时间戳归一 → epoch 毫秒。**两条后端路径给的形状不同**：spike 历史是 epoch 秒
        // （`aidiag/diag/session.py` 的 `created_at: float`），agentflow 是 ISO 字符串
        // （`viewmodel.py` 契约写的就是 ISO8601）。下面两个 helper 原先只认数字，
        // 「Analyze」切到 agentflow 后：dgxElapsed 拿字符串做减法 → 渲染出「耗时 NaNm NaNs」，
        // dgxClock 的 `ts * 1000` → isNaN → 返回空串，把「更新」**静默吞掉**。
        // 这里两种都吃，不再依赖上游用哪种形状。
        function dgxTsMs(v) {
            if (v === null || v === undefined || v === '') return NaN;
            if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v).trim())) {
                var n = Number(v);
                // epoch 秒 vs 毫秒：1e11 秒 ≈ 公元 5138 年，真实时间戳到不了，可安全区分
                return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
            }
            // 后端给的是无时区的 UTC 串（实测 '2026-09-18 06:58:06' 对应本地 14:58）。
            // 空格分隔 Safari 不认 → 换 T；无时区后缀则补 Z，与 formatTime 的口径一致。
            var s = String(v).trim().replace(' ', 'T');
            if (!/([Zz]|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
            var t = Date.parse(s);
            return isNaN(t) ? NaN : t;
        }
        function dgxElapsed(a, b) {
            var ta = dgxTsMs(a), tb = dgxTsMs(b);
            if (isNaN(ta) || isNaN(tb) || tb < ta) return '';
            var s = Math.round((tb - ta) / 1000);
            if (s < 60) return s + 's';
            return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        }
        // score 可选：上游 rca.confidence 是 0~1 的小数（实测 0.86），后端压成
        // high/medium/low 档位后**原值会丢**，故另带一个 0~100 的整百分数
        // （conclusion.confidence_score，与档位同源）。有分值时显示「置信度 高 · 86%」；
        // 没有的（如 spike 历史快照只有档位）退回原来的「置信度 高 · high」。
        function dgxConfChip(c, score) {
            var v = (c || 'medium').toLowerCase();
            var zh = v === 'high' ? '高' : (v === 'low' ? '低' : '中');
            var tail = (typeof score === 'number' && isFinite(score)) ? (score + '%') : dgxEsc(v);
            return '<span class="dgx-conf dgx-conf--' + dgxEsc(v) + '">置信度 ' + dgxEsc(zh) +
                ' · ' + tail + '</span>';
        }
        function dgxShaChip(label, sha) {
            if (!sha) return '';
            return '<span class="dgx-chip dgx-sha"><span class="dgx-sha-k">' + dgxEsc(label) + '</span>' +
                '<span class="dgx-mono" title="' + dgxEsc(sha) + '">' + dgxEsc(dgxShort(sha)) + '</span></span>';
        }
        // 工具名解析：mcp__{server}__{tool} → 拆出 server（用于「用了哪些 MCP server」聚合）
        function dgxToolParts(name) {
            var n = String(name || '');
            if (n.indexOf('mcp__') === 0) {
                var rest = n.slice(5);
                var i = rest.indexOf('__');
                if (i > 0) return { kind: 'mcp', server: rest.slice(0, i), tool: rest.slice(i + 2) };
            }
            return { kind: 'fn', server: 'builtin', tool: n };
        }
        function dgxArgs(a) {
            if (!a || typeof a !== 'object') return '';
            var keys = Object.keys(a);
            if (!keys.length) return '';
            return keys.map(function (k) {
                var v = a[k];
                var s = (typeof v === 'string') ? v : JSON.stringify(v);
                s = (s === null || s === undefined) ? '' : String(s);
                if (s.length > 80) s = s.slice(0, 80) + '…';
                return dgxEsc(k) + '=' + dgxEsc(s);
            }).join(' · ');
        }
        function dgxMcpServers(calls) {
            var seen = {}, order = [];
            for (var i = 0; i < (calls || []).length; i++) {
                var p = dgxToolParts(calls[i] && calls[i].tool);
                if (p.kind !== 'mcp') continue;
                if (!seen[p.server]) { seen[p.server] = 0; order.push(p.server); }
                seen[p.server]++;
            }
            return order.map(function (s) { return { server: s, count: seen[s] }; });
        }

        // 修复方案：单方案直接铺开；互斥多方案 → 分页签（默认选中模型推荐/方案1）
        function dgxOptionBody(o) {
            o = o || {};
            var html = '';
            // 标题可选：历史计划里标题已在 summary 展示，此处只铺 steps（不再重复标题头）
            if (o.title || o.recommended) {
                html += '<div class="dgx-opt-head">' + dgxEsc(o.title || '(未命名方案)') +
                    (o.recommended ? '<span class="dgx-rec">模型推荐</span>' : '') + '</div>';
            }
            if (o.applies_when) html += '<div class="dgx-kv"><span class="dgx-k">适用前提</span><span class="dgx-v">' + dgxEsc(o.applies_when) + '</span></div>';
            if (o.reason) html += '<div class="dgx-kv"><span class="dgx-k">推荐理由</span><span class="dgx-v">' + dgxEsc(o.reason) + '</span></div>';
            var steps = o.steps || [];
            if (!steps.length) return html + '<div class="dgx-muted">无步骤。</div>';
            html += '<ol class="dgx-steps">';
            for (var i = 0; i < steps.length; i++) {
                var s = steps[i] || {};
                html += '<li class="dgx-step"><div class="dgx-step-head">' +
                    '<span class="dgx-step-no">' + (i + 1) + '</span>' +
                    '<span class="dgx-tag">' + dgxEsc(s.action || '') + '</span>' +
                    // 步骤类别（agentflow 的 fix-planner 给 code_fix/infra_action/config_change）
                    (s.type ? '<span class="dgx-tag">' + dgxEsc(DGX_STEP_TYPE[s.type] || s.type) + '</span>' : '') +
                    (s.target ? '<span class="dgx-mono dgx-step-target">' + dgxEsc(s.target) + '</span>' : '') +
                    (s.risk ? '<span class="dgx-risk dgx-risk--' + dgxEsc(s.risk) + '">risk ' + dgxEsc(s.risk) + '</span>' : '') +
                    '</div>' +
                    (s.change ? '<div class="dgx-step-change">' + dgxEsc(s.change) + '</div>' : '') +
                    (s.expected_effect ? '<div class="dgx-kv"><span class="dgx-k">预期效果</span><span class="dgx-v">' + dgxEsc(s.expected_effect) + '</span></div>' : '') +
                    (s.verification ? '<div class="dgx-kv"><span class="dgx-k">验证方式</span><span class="dgx-v">' + dgxEsc(s.verification) + '</span></div>' : '') +
                    (s.rollback ? '<div class="dgx-kv"><span class="dgx-k">回滚</span><span class="dgx-v">' + dgxEsc(s.rollback) + '</span></div>' : '') +
                    (s.suggested_diff ? '<pre class="dgx-code">' + dgxEsc(s.suggested_diff) + '</pre>' : '') +
                    '</li>';
            }
            return html + '</ol>';
        }

        // 结论区（根因 + 总结）——live 与历史快照共用：保证"历史里回看的"与"当时看到的"是同一套渲染。
        function dgxConclusion(c) {
            if (!c) return '';
            // 1) 根因 + 置信度/commit 元信息（同屏给出「结论 + 可信度」，先看结论再决定读多深）
            var html = '<section class="dgx-card dgx-verdict"><div class="dgx-label">根因 · ROOT CAUSE</div>' +
                '<p class="dgx-verdict-text">' + dgxEsc(c.root_cause || '—') + '</p>' +
                '<div class="dgx-verdict-meta">' + dgxConfChip(c.confidence, c.confidence_score) +
                dgxShaChip('deployed', c.deployed_commit) +
                dgxShaChip('base', c.base_commit) +
                dgxShaChip('已修复于', c.already_fixed_by) + '</div>' +
                (c.base_note ? '<p class="dgx-note">' + dgxEsc(c.base_note) + '</p>' : '') +
                '</section>';
            // 2) 总结
            if (c.summary) {
                html += '<section class="dgx-card"><div class="dgx-label">总结 · SUMMARY</div>' +
                    '<p class="dgx-body-text">' + dgxEsc(c.summary) + '</p></section>';
            }
            return html;
        }

        // opts_ = { flat: true, highlight: N } → 历史快照专用「平铺模式」：不渲染分页签，所有方案依次铺开。
        // 理由：互斥关系在"当时"已由用户裁决，历史里再把 2 选 1 藏进分页签就看不出被拒的是哪一版。
        // highlight（1-based）那个方案标「本轮被拒」。live 路径不传 opts_ → 行为零变化。
        function dgxFixOptions(opts, opts_) {
            opts_ = opts_ || {};
            if (!opts.length) {
                return '<section class="dgx-card"><div class="dgx-label">修复方案 · FIX OPTIONS</div>' +
                    '<div class="dgx-muted">本次诊断未给出修复方案。</div></section>';
            }
            if (opts_.flat) {
                var flat = '<section class="dgx-card"><div class="dgx-label">修复方案 · FIX OPTIONS' +
                    (opts.length > 1 ? '（互斥 ' + opts.length + ' 选 1）' : '') + '</div>';
                for (var f = 0; f < opts.length; f++) {
                    var fo = opts[f] || {};
                    var rejected = opts_.highlight === (f + 1);
                    flat += '<div class="dgx-opt-flat' + (rejected ? ' is-rejected' : '') + '">' +
                        '<div class="dgx-opt-head">方案' + (f + 1) + ' · ' + dgxEsc(fo.title || '(未命名方案)') +
                        (fo.recommended ? '<span class="dgx-rec">模型推荐</span>' : '') +
                        (rejected ? '<span class="dgx-hist-reject">本轮被拒</span>' : '') + '</div>' +
                        // 标题已在本函数头部渲染 → 只把正文交给 dgxOptionBody（不重复标题头）
                        dgxOptionBody({ applies_when: fo.applies_when, reason: fo.reason, steps: fo.steps || [] }) +
                        '</div>';
                }
                return flat + '</section>';
            }
            if (dgxOptSel >= opts.length) dgxOptSel = 0;
            var html = '<section class="dgx-card"><div class="dgx-label">修复方案 · FIX OPTIONS' +
                (opts.length > 1 ? '（互斥 ' + opts.length + ' 选 1）' : '') + '</div>';
            if (opts.length > 1) {
                html += '<div class="dgx-tabs" role="tablist">';
                for (var i = 0; i < opts.length; i++) {
                    html += '<button type="button" role="tab" class="dgx-tab' + (i === dgxOptSel ? ' is-active' : '') +
                        '" data-opt="' + i + '" aria-selected="' + (i === dgxOptSel ? 'true' : 'false') + '">方案' + (i + 1) +
                        (opts[i] && opts[i].recommended ? '<span class="dgx-star" title="模型推荐">★</span>' : '') + '</button>';
                }
                html += '</div>';
            }
            html += '<div class="dgx-panels">';
            for (var j = 0; j < opts.length; j++) {
                html += '<div class="dgx-panel' + (j === dgxOptSel ? ' is-active' : '') + '" data-opt="' + j + '">' +
                    dgxOptionBody(opts[j]) + '</div>';
            }
            return html + '</div></section>';
        }

        // 处理条：仅当「问题单可动」且「诊断已到可裁定的终态」且「未在重跑窗口」时出现。
        // 已 resolved/closed 的记录 / analyzing / dismissed / approved 都不显示 → 不会出现点了报 409 的死按钮。
        // 唯一的例外是 `escalated`：那条不返回空串，而是返回**结果卡**（见下）——人升级完要看到单号。
        function dgxApproval(snap) {
            var recState = String((pcDiagRec && pcDiagRec.state) || 'pending').toLowerCase();
            // 已升级：处理卡换成**结果卡**（不是简单消失）——人点完要看到"派到哪去了"。
            // 单号取自历史里最后一条升级裁定（真源 = 后端 evidence），不是本地记的临时值：
            // 重开弹窗、换台机器看到的都一样。历史是异步拉的，所以首次渲染可能先无号、
            // 拉完由 loadDiagnoseDecisions 里的 renderDiagnosis 补上。
            if (recState === 'escalated') {
                var hist = (pcDiagHistory && pcDiagHistory.items) || [];
                var esc = null;
                for (var k = hist.length - 1; k >= 0; k--) {
                    if (hist[k] && hist[k].decision === 'escalate') { esc = hist[k]; break; }
                }
                var no = (esc && esc.ticket_number) || '';
                return '<section class="dgx-card dgx-approve"><div class="dgx-label">处理 · DECISION</div>' +
                    '<div class="dgx-approve-hint">已升级——本次诊断已转成一张修复工单' +
                    (no ? '，工单号 <span class="dgx-mono">' + dgxEsc(no) + '</span>' : '') +
                    '。</div></section>';
            }
            if (recState !== 'pending' && recState !== 'in_progress') return '';
            var st = snap.status;
            if (st !== 'completed' && st !== 'failed' && st !== 'closed_manual') return '';
            if (dgxRerunPending) return '';

            var opts = (snap.conclusion && snap.conclusion.recommended_fix) || [];
            var sel = opts[dgxOptSel] || null;
            var hasSteps = !!(sel && sel.steps && sel.steps.length);
            // 拒绝要求结论已完成且选中方案有 steps——后端会把选中的那份方案快照进历史，
            // 没有 steps 就没东西可留。后端按引擎分派：新路径驳回 agentflow 审批节点并起新一轮 run，
            // 老路径走 spike /remediate。failed/closed_manual 只能忽略。
            var canReject = (st === 'completed') && hasSteps;
            // 升级 = 认可诊断 → 平台在 agentflow 建一张修复工单，工单号绑回这条问题单，
            // 问题单转 escalated 终态。**判据是"诊断给出了方案"，不是"选中那份方案完整"**：
            // 要派的是整份诊断，与用户当前翻到哪个分页签无关。没有方案就没有可派的活，
            // 这也正好与下面那句 hint 逐字对齐。
            var canEscalate = (st === 'completed') && opts.length > 0;
            var hint = sel
                ? ('当前待处理：方案' + (dgxOptSel + 1) + '「' + sel.title + '」' +
                   (opts.length > 1 ? '（可切换上方分页签）' : ''))
                : '本次诊断未给出可执行方案，仅可忽略。';

            var html = '<section class="dgx-card dgx-approve"><div class="dgx-label">处理 · DECISION</div>' +
                '<div class="dgx-approve-hint">' + dgxEsc(hint) + '</div>';

            if (dgxFbOpen) {
                html += '<div class="dgx-fb">' +
                    '<textarea class="dgx-fb-input" rows="3" placeholder="请给出要修改的地方，诊断将带着这条建议重新分析…">' +
                    dgxEsc(dgxFbText) + '</textarea>' +
                    '<div class="dgx-fb-actions">' +
                    '<button type="button" class="dgx-btn dgx-btn--reject dgx-act" data-act="reject-submit"' +
                    (dgxDeciding ? ' disabled' : '') + '>提交拒绝并重新分析</button>' +
                    '<button type="button" class="dgx-btn dgx-btn--ghost dgx-act" data-act="reject-cancel"' +
                    (dgxDeciding ? ' disabled' : '') + '>取消</button>' +
                    '</div></div>';
            } else {
                html += '<div class="dgx-approve-actions">' +
                    (canReject
                        ? '<button type="button" class="dgx-btn dgx-btn--reject dgx-act" data-act="reject"' +
                          (dgxDeciding ? ' disabled' : '') + '>拒绝 · 重新分析</button>'
                        : '') +
                    '<button type="button" class="dgx-btn dgx-btn--ignore dgx-act" data-act="ignore"' +
                    (dgxDeciding ? ' disabled' : '') + '>忽略</button>' +
                    // 升级**顶掉的就是原来「误报」的位置**（最右），不是新插一档：
                    // 布局不变、人的肌肉记忆不用重学。
                    (canEscalate
                        ? '<button type="button" class="dgx-btn dgx-btn--escalate dgx-act" data-act="escalate"' +
                          (dgxDeciding ? ' disabled' : '') + '>升级 · 生成工单</button>'
                        : '') +
                    '</div>';
            }
            return html + '</section>';
        }

        // 提交决策。三条出口，形状各不相同：
        //   reject   → 重跑（重启轮询 + 抑制旧快照），**弹窗留着**看新一轮
        //   escalate → 生成工单（**弹窗也留着**：处理卡消失、换成工单结果，人当场看到单号）
        //   ignore / false_positive → 关单（关弹框 + 刷新列表）
        // apmApi 已把后端 {code,reason} 的 reason 提成 err.message → 409/400 的中文原因直接展示。
        function submitDiagnosisDecision(decision) {
            if (!pcDiagRec || dgxDeciding) return;
            if (decision === 'reject' && !dgxFbText.trim()) {
                window._showToast('请先填写修改建议', 'error');
                return;
            }
            var recordId = pcDiagRec.record_id;
            dgxDeciding = true;
            renderDiagnosis(pcDiagLastSnap); // 立刻置灰，防双击
            apmApi('/v1/problems/' + encodeURIComponent(recordId) + '/diagnose/decision', {
                method: 'POST',
                body: {
                    decision: decision,
                    feedback: decision === 'reject' ? dgxFbText : '',
                    option_index: dgxOptSel + 1 // 1-based：当前选中的分页签 = 要处理的那个方案
                }
            })
                .then(function (resp) {
                    dgxDeciding = false;
                    if (decision === 'reject') {
                        var cnt = resp && resp.reanalyze_count != null ? resp.reanalyze_count : 0;
                        var max = resp && resp.max_reanalyze != null ? resp.max_reanalyze : '';
                        var capped = !!(resp && resp.remediation_status === 'closed_manual');
                        window._showToast(
                            capped ? ('驳回已达上限 ' + cnt + '/' + max + '，需人工处理')
                                   : ('已驳回，正在重新分析（' + cnt + '/' + max + '）'),
                            capped ? 'error' : 'success');
                        dgxFbOpen = false;
                        dgxFbText = '';
                        // 达上限时没有重跑（closed_manual 是终态）→ 不进入抑制窗口，直接渲染新快照
                        dgxRerunCount = cnt;
                        dgxRerunPending = !capped;
                        loadDiagnoseDecisions(recordId); // 历史已有这一版（带旧步骤与拒因）
                        pollDiagnosis();                 // 立即拉一次并重启 2s 轮询
                        ensureDiagPolling();
                    } else if (decision === 'escalate') {
                        var num = (resp && resp.ticket_number) || '';
                        window._showToast(
                            num ? ('已升级，工单 ' + num + ' 已生成') : '已升级，工单已生成', 'success');
                        // ⚠️ **必须就地翻本地 state**：处理卡的显隐读的是 `pcDiagRec.state`
                        // （dgxApproval 开头），而 `pollDiagnosis` 只重拉诊断快照、**不重拉 record**
                        // （pcDiagRec 只在 openDiagnosisView 里赋值），`refresh()` 也不回写它。
                        // 不翻的话升级后那张卡照旧显示、三个按钮全是活的，再点「忽略」撞上后端
                        // 的 escalated 终态守卫拿 409 —— 一个不该存在的死按钮。
                        pcDiagRec.state = 'escalated';
                        // 工单号从**历史**读（`loadDiagnoseDecisions` → evidence），不是从这个响应读：
                        // 响应只在这一次点击里存在，重开弹窗时只能靠历史。所以这两步缺一不可。
                        // ⚠️ 也不能指望 `pollDiagnosis` 里的自动重拉——它只在 `rev` 变化时才拉历史，
                        // 而 escalate 不新增 run（rev = executions.length）→ rev 不变 → 不会重拉。
                        loadDiagnoseDecisions(recordId);
                        pollDiagnosis();                 // 重渲染：处理卡消失、工单结果出现
                        refresh();                       // 列表状态列转 escalated
                    } else {
                        window._showToast(
                            decision === 'false_positive' ? '已标记误报并关闭问题单' : '已忽略并关闭问题单',
                            'success');
                        closeDiagnosisView();
                        refresh(); // 问题单已关，列表以后端为准
                    }
                })
                .catch(function (err) {
                    dgxDeciding = false;
                    window._showToast('操作失败: ' + err.message, 'error');
                    renderDiagnosis(pcDiagLastSnap); // 保持弹窗，可改建议重试
                });
        }

        // 任务状态：枚举 → 中文标签 + CSS 修饰类。**绝不把原始枚举印给用户**。
        // tasks 是模型自报账本（只有 complete_task 会写 done），收尾步骤常残留 todo；服务端已
        // 在落终态时做确定性归一（completed→done+derived、failed→cancelled），此处再兜一层显示派生。
        var DGX_TASK_LABEL = {
            todo: '待办', in_progress: '进行中', done: '已完成', failed: '失败', cancelled: '已中止'
        };
        var DGX_TASK_CLS = {
            todo: 'todo', in_progress: 'running', done: 'done', failed: 'failed', cancelled: 'cancelled'
        };

        function dgxTaskView(snap, t) {
            var st = (t && t.status) || 'todo';
            var derived = !!(t && t.derived);
            var label = DGX_TASK_LABEL[st] || st;
            var cls = DGX_TASK_CLS[st] || 'todo';
            var stt = snap && snap.status;
            // 兜底派生：会话已到终态却仍留 todo/in_progress（服务端未归一，或旧会话）时，不能把
            // 原始枚举/「待办」印给用户 —— 终态意味着这段计划已有交代：
            //   有结论（completed/approved）→ 「随结论完成」（done + derived，灰显）；
            //   无结论（failed/closed_manual）→ 「已中止」（cancelled，灰 + 删除线），**绝不显示完成**。
            if ((st === 'todo' || st === 'in_progress') && PC_DIAG_TERMINAL[stt]) {
                if (stt === 'failed' || stt === 'closed_manual') {
                    cls = 'cancelled';
                    label = '已中止';
                } else {
                    cls = 'done';
                    label = '随结论完成';
                    derived = true;
                }
            }
            return { cls: cls, label: label, derived: derived };
        }

        // 「分析链路」——默认关闭：调研计划 / 用到的 MCP server / 工具调用时间线 / 证据链 / 原始 JSON
        // openFlag：显式开合（缺省沿用全局 dgxChainOpen，让 live 轮询重渲染不塌）；
        // hist：历史快照实例 → 加 .dgx-chain--hist（弱化，且开合不污染 live 的 dgxChainOpen）。
        function dgxChain(snap, openFlag, hist) {
            if (openFlag === undefined) openFlag = dgxChainOpen;
            var calls = snap.tool_calls || [];
            var tasks = snap.tasks || [];
            var evs = (snap.conclusion && snap.conclusion.evidence) || [];
            var servers = dgxMcpServers(calls);
            var meta = [];
            if (tasks.length) meta.push('调研计划 ' + tasks.length);
            meta.push('工具调用 ' + calls.length);
            if (servers.length) meta.push('MCP server ' + servers.length);
            if (evs.length) meta.push('证据 ' + evs.length);

            var html = '<details class="dgx-chain' + (hist ? ' dgx-chain--hist' : '') + '"' + (openFlag ? ' open' : '') + '>' +
                '<summary class="dgx-chain-sum"><span class="dgx-caret"></span>分析链路 · INVESTIGATION' +
                '<span class="dgx-chain-meta">' + dgxEsc(meta.join(' · ')) + '</span></summary>' +
                '<div class="dgx-chain-body">';

            if (tasks.length) {
                html += '<h5 class="dgx-h5">调研计划</h5><ol class="dgx-tasks">';
                for (var i = 0; i < tasks.length; i++) {
                    var t = tasks[i] || {};
                    var tv = dgxTaskView(snap, t);
                    // derived = 未显式 complete_task，随终态一并收口（灰显 + title 说明）
                    html += '<li class="dgx-task dgx-task--' + tv.cls + (tv.derived ? ' is-derived' : '') + '">' +
                        '<span class="dgx-task-dot"></span><span class="dgx-task-title">' + dgxEsc(t.title || '') + '</span>' +
                        '<span class="dgx-task-st"' + (tv.derived ? ' title="未显式标记完成，随结论一并收口"' : '') + '>' +
                        dgxEsc(tv.label) + '</span></li>';
                }
                html += '</ol>';
            }
            if (servers.length) {
                html += '<h5 class="dgx-h5">使用的 MCP Server</h5><div class="dgx-mcps">';
                for (var m = 0; m < servers.length; m++) {
                    html += '<span class="dgx-mcp">' + dgxEsc(servers[m].server) +
                        '<span class="dgx-mcp-n" title="调用次数">' + servers[m].count + '</span></span>';
                }
                html += '</div>';
            }
            if (calls.length) {
                html += '<h5 class="dgx-h5">工具调用时间线</h5><ol class="dgx-tl">';
                for (var k = 0; k < calls.length; k++) {
                    var ev = calls[k] || {};
                    var p = dgxToolParts(ev.tool);
                    var stCls = ev.status === 'ok' ? 'ok' : (ev.status === 'error' ? 'err' : 'run');
                    var args = dgxArgs(ev.args);
                    html += '<li class="dgx-tl-item dgx-tl--' + stCls + '">' +
                        '<span class="dgx-tl-no">' + (k + 1) + '</span>' +
                        '<div class="dgx-tl-main"><div class="dgx-tl-head">' +
                        '<span class="dgx-tag dgx-tag--' + (p.kind === 'mcp' ? 'mcp' : 'fn') + '">' + (p.kind === 'mcp' ? 'MCP' : 'tool') + '</span>' +
                        '<span class="dgx-mono dgx-tl-name">' + dgxEsc(p.kind === 'mcp' ? p.server + ' / ' + p.tool : p.tool) + '</span>' +
                        '<span class="dgx-tl-st">' + dgxEsc(ev.status || '') + '</span>' +
                        '</div>' +
                        (args ? '<div class="dgx-mono dgx-tl-args">' + args + '</div>' : '') +
                        (ev.result_summary ? '<div class="dgx-tl-res">' + dgxEsc(ev.result_summary) + '</div>' : '') +
                        '</div></li>';
                }
                html += '</ol>';
            }
            if (!tasks.length && !calls.length && !evs.length) {
                html += '<div class="dgx-muted">暂无过程记录。</div>';
            }
            if (evs.length) {
                html += '<h5 class="dgx-h5">证据链 (' + evs.length + ')</h5><div class="dgx-evs">';
                for (var e = 0; e < evs.length; e++) {
                    var it = evs[e] || {};
                    html += '<div class="dgx-ev"><div class="dgx-ev-head">' +
                        '<span class="dgx-tag">' + dgxEsc(it.source || 'evidence') + '</span>' +
                        (it.commit ? '<span class="dgx-mono dgx-ev-commit" title="' + dgxEsc(it.commit) + '">@' + dgxEsc(dgxShort(it.commit)) + '</span>' : '') +
                        '</div>' +
                        (it.query ? '<div class="dgx-kv"><span class="dgx-k">查询</span><span class="dgx-v dgx-mono">' + dgxEsc(it.query) + '</span></div>' : '') +
                        (it.finding ? '<div class="dgx-kv"><span class="dgx-k">结论</span><span class="dgx-v">' + dgxEsc(it.finding) + '</span></div>' : '') +
                        (it.supporting_text ? '<details class="dgx-sub"><summary>原文</summary><pre class="dgx-code">' + dgxEsc(it.supporting_text) + '</pre></details>' : '') +
                        '</div>';
                }
                html += '</div>';
            }
            html += '<details class="dgx-sub"><summary>原始 JSON</summary><pre class="dgx-code">' +
                dgxEsc(JSON.stringify(snap, null, 2)) + '</pre></details>';
            return html + '</div></details>';
        }

        // 历史条目里的「整轮」渲染 = 状态头 + 结论（根因/总结）+ **全部**方案（被拒那版高亮）+ 分析链路（收起）。
        // 数据源是 APM evidence 里决策那一刻抓的 /status 快照——spike 重跑会清空 conclusion，
        // 事后取不到第一轮，所以快照必须是决策前抓的（见 APM problems.py 的 _fetch_snapshot）。
        function dgxHistSnapshot(snap, rejectIdx) {
            var st = snap.status || 'unknown';
            var c = snap.conclusion;
            var html = '<div class="dgx-hist-snap">' +
                '<div class="dgx-head"><div class="dgx-head-top">' +
                '<span class="dgx-status dgx-status--' + dgxEsc(st) + '">' + dgxEsc(DGX_STATUS_LABEL[st] || st) + '</span>' +
                (snap.trigger ? '<span class="dgx-chip">来源 ' + dgxEsc(snap.trigger) + '</span>' : '') +
                // 轮次标识：老记录是 spike 的 session_id，新记录是 agentflow 的 run_id。
                // 两者都落在 ref 上（历史快照没有 ref，回落 session_id），ref_kind 只影响提示文案。
                ((snap.ref || snap.session_id)
                    ? '<span class="dgx-chip dgx-mono" title="' + dgxEsc(snap.ref_kind === 'run' ? 'run_id' : 'session_id') + '">' +
                      dgxEsc(snap.ref || snap.session_id) + '</span>'
                    : '') +
                (dgxElapsed(snap.created_at, snap.updated_at) ? '<span class="dgx-chip">耗时 ' + dgxEsc(dgxElapsed(snap.created_at, snap.updated_at)) + '</span>' : '') +
                '</div>' +
                (snap.issue_title ? '<h2 class="dgx-issue">' + dgxEsc(snap.issue_title) + '</h2>' : '') +
                '</div>';
            if (snap.error) html += '<div class="pc-diag-error">' + dgxEsc(snap.error) + '</div>';
            if (c) {
                html += dgxConclusion(c);
                html += dgxFixOptions(c.recommended_fix || [], { flat: true, highlight: rejectIdx });
            } else {
                html += '<div class="dgx-card"><div class="dgx-muted">该轮无结构化结论。</div></div>';
            }
            html += dgxChain(snap, false, true);
            return html + '</div>';
        }

        // 历史计划（详情最下边）：每条一个 <details>——决策胶囊 + 拒因 + **那一整轮**（快照）+ 驳回次数。
        // 快照缺失（会话已过期，抓不到）才降级回 steps——它是"被拒那一版方案"的权威来源，也是降级路径的唯一来源。
        // ── 历次执行（弹窗最下方）────────────────────────────────────────────────
        // 执行过程不再占据 View diagnosis 的主位（主位是结论：根因/方案/审批），但也不能丢——
        // 按需从这里下钻到 #pcRunOverlay（复用「View analysis」那套 run 查看器与节点级审批）。
        // 数据来自后端视图模型的 executions[]：每轮 run 一条，带实时状态。
        var DGX_EXEC_STATE = {
            analyzing: '进行中', completed: '已完成', failed: '失败',
            approved: '已通过', closed_manual: '已中止', dismissed: '已忽略'
        };

        function dgxExecShort(id) {
            var s = String(id || '');
            return s.length > 14 ? s.slice(0, 8) + '…' + s.slice(-4) : s;
        }

        // 「历次执行」里的**最后一次**（= 当前轮）。判定只写这一份，按钮与下钻都用它。
        //
        // 后端 fetch_executions 按 evidence 写入顺序返回，**最后一条**打 is_current
        // （重跑追加在尾部），故这里的优先级是 is_current → 数组末条。
        // ⚠️ 不能拿「列表里最后一个」当最后一次：dgxExecutions 渲染时把「进行中」置顶，
        // 渲染顺序与数组顺序不同（最后一次正在跑时，它反而排在第一条）。
        function dgxLastExecution(snap) {
            var items = (snap && snap.executions) || [];
            if (!items.length) return null;
            for (var i = 0; i < items.length; i++) {
                if (items[i] && items[i].is_current) return items[i];
            }
            return items[items.length - 1];
        }

        // 概要条右端的 Flow Diagram 入口：打开**最后一次执行**的执行流程图（= 下钻到 run 的
        // Flow Diagram 二级弹框）。
        // 判据收在 dgxLastRunId 一处，按钮的显隐与点击处理器共用它 —— 各写一份的话，
        // 「按钮在、点了没反应」这种死按钮就是这么来的（例如 evidence 缺 run_id 的轮次）。
        // 没有可开的 run（老 spike 记录没有 agentflow run、或这条单还没 Analyze 过）→
        // **不渲染按钮**，而不是渲染一个点了报错的死按钮。
        function dgxLastRunId(snap) {
            var last = dgxLastExecution(snap);
            return (last && last.run_id) ? String(last.run_id) : '';
        }

        function dgxFlowBtn(snap) {
            if (!dgxLastRunId(snap)) return '';
            return '<button type="button" class="dgx-btn dgx-flowbtn dgx-act" data-act="flow-last"' +
                ' title="Open the flow diagram of the latest run">Flow Diagram</button>';
        }

        function dgxExecutions(snap) {
            var items = (snap && snap.executions) || [];
            if (!items.length) return '';
            // 进行中置顶：用户最关心"现在跑到哪了"，历史轮次是回看用的
            var sorted = items.slice().sort(function (a, b) {
                var ra = (a && a.vm_status === 'analyzing') ? 0 : 1;
                var rb = (b && b.vm_status === 'analyzing') ? 0 : 1;
                return ra - rb;
            });
            var html = '<section class="dgx-card dgx-exec">' +
                '<div class="dgx-label">历次执行 · EXECUTIONS</div>';
            for (var i = 0; i < sorted.length; i++) {
                var it = sorted[i] || {};
                var st = it.vm_status || '';
                var label = DGX_EXEC_STATE[st] || st || '未知';
                var when = it.started_at ? formatTime(it.started_at) : '';
                html += '<button type="button" class="dgx-exec-row dgx-exec--' + dgxEsc(st) + '"' +
                    ' data-exec-run="' + dgxEsc(it.run_id || '') + '">' +
                    '<span class="dgx-exec-id dgx-mono">' + dgxEsc(dgxExecShort(it.run_id)) + '</span>' +
                    '<span class="dgx-exec-state">' + dgxEsc(label) + '</span>' +
                    (it.is_current ? '<span class="dgx-exec-cur">当前</span>' : '') +
                    (when ? '<span class="dgx-exec-time">' + dgxEsc(when) + '</span>' : '') +
                    '<span class="dgx-exec-go">查看执行流程 ›</span>' +
                    '</button>';
            }
            return html + '</section>';
        }

        function dgxPlanHistory() {
            var items = (pcDiagHistory && pcDiagHistory.items) || [];
            if (!items.length) return '';
            var html = '<section class="dgx-card dgx-history"><div class="dgx-label">历史计划 · PLAN HISTORY</div>';
            for (var i = 0; i < items.length; i++) {
                var it = items[i] || {};
                var dec = it.decision || '';
                var label = DGX_DECISION_LABEL[dec] || dec;
                var cls = DGX_DECISION_CLS[dec] || 'ignore';
                var when = it.decided_at ? formatTime(it.decided_at) : '';
                var head = '#' + (i + 1);
                if (it.option_index) {
                    head += ' 方案' + it.option_index + ' · ' + (it.option_title || '(未命名方案)');
                }
                html += '<details class="dgx-hist"><summary class="dgx-hist-sum">' +
                    '<span class="dgx-hist-title">' + dgxEsc(head) + '</span>' +
                    '<span class="dgx-hist-chip dgx-hist-chip--' + dgxEsc(cls) + '">' + dgxEsc(label) + '</span>' +
                    (when ? '<span class="dgx-hist-time">' + dgxEsc(when) + '</span>' : '') +
                    '</summary><div class="dgx-hist-body">';
                if (it.feedback) {
                    html += '<div class="dgx-kv"><span class="dgx-k">拒因</span><span class="dgx-v">' +
                        dgxEsc(it.feedback) + '</span></div>';
                }
                // 升级那一条带工单号——「这条问题单派到哪去了」的唯一线索。
                // 与处理结果卡、Problem Detail 的 Resolve Reason 行同源（后端把号也写进了 resolve_reason）。
                if (it.ticket_number) {
                    html += '<div class="dgx-kv"><span class="dgx-k">工单</span>' +
                        '<span class="dgx-v dgx-mono">' + dgxEsc(it.ticket_number) + '</span></div>';
                }
                if (it.snapshot && typeof it.snapshot === 'object') {
                    html += dgxHistSnapshot(it.snapshot, it.option_index);
                } else {
                    // 降级：决策时诊断会话已过期，快照抓不到。steps 是"被拒那一版方案"的唯一留存，仍渲染。
                    if (it.steps && it.steps.length) {
                        html += dgxOptionBody({ steps: it.steps });
                    }
                    html += '<div class="dgx-muted">该轮快照不可用（诊断会话已过期）。</div>';
                }
                if (it.reanalyze_count != null) {
                    html += '<div class="dgx-muted">驳回次数 ' + dgxEsc(String(it.reanalyze_count)) +
                        (it.max_reanalyze != null ? ('/' + dgxEsc(String(it.max_reanalyze))) : '') +
                        (it.remediation_status === 'closed_manual' ? ' · 已达驳回上限，需人工处理' : '') +
                        '</div>';
                }
                html += '</div></details>';
            }
            return html + '</section>';
        }

        function renderDiagnosis(snap) {
            var bodyEl = getEl('pcDiagnoseBody');
            if (!bodyEl) return;
            if (!snap || typeof snap !== 'object') {
                bodyEl.innerHTML = '<div class="pc-diag-error">Empty diagnosis response.</div>';
                return;
            }
            pcDiagLastSnap = snap;
            var st = snap.status || 'unknown';
            var terminal = !!PC_DIAG_TERMINAL[st];
            var c = snap.conclusion;
            var html = '<div class="dgx">';

            // 头部：状态 + 来源/会话/耗时（滚动时吸顶）
            // 注意：用 <div> 不用 <header> —— 全局 `header{height:52px;position:fixed;…}` 是顶部菜单栏样式，
            // 会把本块高度锁死 52px 导致标题溢出压到根因卡片上。
            html += '<div class="dgx-head"><div class="dgx-head-top">' +
                '<span class="dgx-status dgx-status--' + dgxEsc(st) + '">' + dgxEsc(DGX_STATUS_LABEL[st] || st) + '</span>' +
                (snap.trigger ? '<span class="dgx-chip">来源 ' + dgxEsc(snap.trigger) + '</span>' : '') +
                // 轮次标识：老记录是 spike 的 session_id，新记录是 agentflow 的 run_id。
                // 两者都落在 ref 上（历史快照没有 ref，回落 session_id），ref_kind 只影响提示文案。
                ((snap.ref || snap.session_id)
                    ? '<span class="dgx-chip dgx-mono" title="' + dgxEsc(snap.ref_kind === 'run' ? 'run_id' : 'session_id') + '">' +
                      dgxEsc(snap.ref || snap.session_id) + '</span>'
                    : '') +
                (dgxElapsed(snap.created_at, snap.updated_at) ? '<span class="dgx-chip">耗时 ' + dgxEsc(dgxElapsed(snap.created_at, snap.updated_at)) + '</span>' : '') +
                // 状态行右端：Flow Diagram 入口 + 更新时间（两者互换过位置，按用户要求：
                // 按钮在左、时间贴最右）。两者同处一个右对齐簇 —— margin-left:auto 挂在外层
                // .dgx-head-right 上，而不是各处一个（两个 auto 会平分空白，把「更新」挤到中间去）。
                '<span class="dgx-head-right">' +
                dgxFlowBtn(snap) +
                (snap.updated_at ? '<span class="dgx-updated">更新 ' + dgxEsc(dgxClock(snap.updated_at)) + '</span>' : '') +
                '</span>' +
                '</div>' +
                (snap.issue_title ? '<h2 class="dgx-issue">' + dgxEsc(snap.issue_title) + '</h2>' : '') +
                '</div>';

            if (snap.error) html += '<div class="pc-diag-error">' + dgxEsc(snap.error) + '</div>';

            if (dgxRerunPending) {
                // 拒绝后抑制旧快照：只留状态头 + 重跑提示，绝不渲染旧结论/审批条（否则拒绝按钮二次可用）
                html += '<div class="dgx-live dgx-rerun"><span class="dgx-spinner"></span>已提交修改建议，正在重新分析…</div>';
            } else {
                if (!terminal) {
                    html += '<div class="dgx-live"><span class="dgx-spinner"></span>分析中… 已完成 ' +
                        ((snap.tool_calls || []).length) + ' 次工具调用</div>';
                }

                if (c) {
                    // 1) 根因 + 2) 总结（抽成 dgxConclusion，历史快照复用同一套渲染）
                    html += dgxConclusion(c);
                    // 3) 修复方案
                    html += dgxFixOptions(c.recommended_fix || []);
                } else if (terminal) {
                    html += '<div class="dgx-card"><div class="dgx-muted">本次诊断无结构化结论。</div></div>';
                }

                // 5) 处理（拒绝/忽略/误报）——放在结论之后、分析链路之前
                html += dgxApproval(snap);

                // 6) 分析链路（默认关闭）
                html += dgxChain(snap);
            }

            // 7) 历次执行（最下边；下钻到该轮的执行流程）
            html += dgxExecutions(snap);
            // 8) 历史计划（重跑窗口内也展示，方便对着上一版建议）
            html += dgxPlanHistory();
            html += '</div>';
            bodyEl.innerHTML = html;
        }

        // ── View analysis：in_progress 问题 → 查看其 agentflow run 实时分析过程 ──────
        // run_id 来源：该问题行 evidence 里 mark_in_progress 追加的 agent_run 条目
        //（record_id → run_id 的桥即 evidence，无需后端新接口；过程详情 GET {agentflow}/runs/{run_id} 轮询）。
        var pcRunRec = null;     // 正在查看的问题记录
        var pcRunId = null;      // 当前轮询的 run_id
        var pcRunSilent = false; // true = 只开了 Flow Diagram 二级弹框，**没开** run 查看器（见 openProblemRun 的 opts.silent）
        var pcRunTimer = null;   // 2s 轮询 timer（关弹框必清）
        var pcRunSel = null;          // 手动选中的节点
        var pcRunData = null;         // 节点数据 {nid:{status,tokens,cost,params,output}}
        var pcRunGraph = null;        // 最近一次成功的 DAG 结构（轮询缺 graph 时沿用，避免画布清空）
        var pcRunAuto = true;         // 自动跟随 running 节点；用户点选节点后停止
        var pcRunDetailNode = null;   // 当前右栏展示详情的节点（切换节点时分区开合状态复位）
        var pcRunSecOpen = null;      // 当前节点右栏分区开合状态 {input,output,mcp,reasoning,evidence,raw}
        var pcRunTraces = {};         // 节点级 trace 缓存 nid -> {items:[...], ts, error}（MCP/思维链/证据链数据源）
        var pcRunTraceReq = {};       // 在途 trace 请求 nid -> true（防并发重复请求）

        // 节点状态 → 着色类（与 Bug Solve statusClass 同映射，作用域限定在本页）
        function pcRunStatusClass(st) {
            var map = {
                'done': 'bs-node-status-done',
                'running': 'bs-node-status-running',
                'pending': 'bs-node-status-pending',
                'failed': 'bs-node-status-failed',
                'cancelled': 'bs-node-status-cancelled',
                'rejected': 'bs-node-status-rejected',
                'waiting_approval': 'bs-node-status-waiting',
                'skipped': 'bs-node-status-skipped'
            };
            return map[st] || 'bs-node-status-pending';
        }

        // 第三个 canvas 实例：复用 createGraphCanvas（app.js:5680，id 全参数化），DOM 常驻、只实例化一次。
        // 主弹框不内嵌画布：pcRunGraph* 画布放在 Flow Diagram 二级弹框（#pcRunGraphOverlay）里，图弹框打开时才渲染。
        var pcRunCanvas = createGraphCanvas({
            hintId: 'pcRunHint', zoomId: 'pcRunZoom', svgId: 'pcRunGraph',
            controlsId: 'pcRunZoomControls', controlsCls: 'bs-zoom-controls',
            zoomInId: 'pcRunZoomIn', zoomOutId: 'pcRunZoomOut', zoomFitId: 'pcRunZoomFit',
            markerId: 'pcRunArrow', nodeCls: 'bs-node', edgeCls: 'bs-edge',
            nodeStyle: function (n, st) {
                var cls = pcRunStatusClass(st);
                if (n.kind === 'approval') cls += ' bs-node-approval';
                return { cls: cls, label: n.id + (n.agent ? ' (' + n.agent + ')' : '') };
            },
            onNodeClick: function (nid) { pcSelectNode(nid); }
        });

        function setPcRunText(id, val) { var el = getEl(id); if (el) el.textContent = String(val); }

        // 取问题记录里最新一条 agent_run 证据（record_id → run_id 的桥）
        function findAgentRun(rec) {
            var ev = (rec && rec.evidence) || [];
            var runs = [];
            for (var i = 0; i < ev.length; i++) {
                var e = ev[i];
                if (e && e.type === 'agent_run' && e.run_id) runs.push(e);
            }
            return runs.length ? runs[runs.length - 1] : null;
        }

        // explicitRunId：刚发起的那次 run（此刻 evidence 可能还没回读到列表里，调用方直接传）
        // opts.silent —— **只备数据、不亮 run 查看器**：给诊断弹框概要条的 Flow Diagram 用。
        // 用户要的是那张图，不是又叠一层「Analysis Process」在下面；图弹框由调用方自己 openRunGraph()。
        // 两者共用本轮所有管道（pcRunId / 2s 轮询 / pcRunGraph），故只差"主弹框亮不亮"这一件事 ——
        // 收摊的差异见 closeRunGraph()（静默模式下关图即停轮询，否则 2s 轮询会在后台一直跑）。
        function openProblemRun(rec, explicitRunId, opts) {
            stopRunPolling();
            var ar = findAgentRun(rec);
            var runId = explicitRunId || (ar && ar.run_id);
            if (!runId) {
                window._showToast('No agent analysis run found for ' + (rec && rec.record_id ? rec.record_id : 'record'), 'error');
                return;
            }
            // 先按**上一个**会话的静默标志收摊（closeRunGraph 在静默模式下会停轮询 + 清 pcRun* 状态），
            // 再设本轮状态。**顺序不能反**：反了的话下面刚赋的 pcRunSilent 会被这次收摊当成"上一轮"
            // 清掉（closeProblemRun 还会把 pcRunId 清成 null）→ 静默失效、run 查看器照开，
            // 而且 fetchRunNow 因 pcRunId 为 null 直接空转，图永远停在 Loading。踩过一次。
            closeRunGraph(); // 若上次残留 Flow Diagram 二级弹框，先收起
            pcRunRec = rec;
            pcRunId = runId;
            pcRunSilent = !!(opts && opts.silent);
            pcRunData = null;
            pcRunGraph = null;
            pcRunSel = null;
            pcRunAuto = true;
            pcRunDetailNode = null;
            pcRunSecOpen = null;
            pcRunTraces = {};
            pcRunTraceReq = {};
            var title = getEl('pcRunTitle');
            if (title) title.textContent = 'Analysis Process - ' + (rec && rec.record_id ? rec.record_id : '');
            setPcRunText('pcRunId', runId);
            setPcRunText('pcRunStep', '—');
            setPcRunText('pcRunTokens', '0');
            setPcRunText('pcRunCost', '0.0');
            pcSetFlowBtnState(''); // 复位概要条 Flow 按钮圆点
            var statusEl = getEl('pcRunStatus');
            if (statusEl) { statusEl.textContent = '—'; statusEl.className = 'bs-badge'; }
            var sec = getEl('pcRunApprovalSection');
            if (sec) sec.style.display = 'none';
            renderRunDetail(null);
            if (!pcRunSilent) {
                var overlay = getEl('pcRunOverlay');
                if (overlay) overlay.classList.add('open'); // 先 .open 再拉数据，fit 才能取到尺寸
            }
            pcRunCanvas.reset(); // 清掉上一轮的图并亮出 "Loading flow diagram…"（静默模式下这就是图弹框的占位）
            renderRunSteps(); // 清空并显示 "Waiting for run data…" 占位
            fetchRunNow();
            startRunPolling();
        }

        function startRunPolling() {
            if (pcRunTimer) clearInterval(pcRunTimer);
            pcRunTimer = setInterval(fetchRunNow, 2000);
        }

        function stopRunPolling() {
            if (pcRunTimer) { clearInterval(pcRunTimer); pcRunTimer = null; }
        }

        function fetchRunNow() {
            var rid = pcRunId;
            if (!rid) return;
            agentflowFetch('/runs/' + encodeURIComponent(rid))
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) { applyRunView(data); })
                .catch(function (err) {
                    // 首拉失败明确提示；后续轮询失败静默（状态条还占着旧值时只静默，避免 toast 刷屏）
                    var statusEl = getEl('pcRunStatus');
                    var isFresh = !statusEl || statusEl.textContent === '—';
                    if (isFresh) {
                        window._showToast('Failed to load run: ' + (err && err.message ? err.message : 'network error'), 'error');
                    }
                });
        }

        function applyRunView(data) {
            if (!pcRunId || !data || data.run_id !== pcRunId) return;
            var status = data.status || '';
            // run 顶层状态 → badge 类（success 归 done 绿）
            var badgeMap = {
                'success': 'bs-badge-done', 'done': 'bs-badge-done',
                'running': 'bs-badge-running', 'failed': 'bs-badge-failed',
                'cancelled': 'bs-badge-cancelled', 'rejected': 'bs-badge-rejected',
                'waiting_approval': 'bs-badge-waiting_approval',
                'pending': 'bs-badge-pending', 'skipped': 'bs-badge-skipped'
            };
            var statusEl = getEl('pcRunStatus');
            if (statusEl) {
                statusEl.textContent = status || '—';
                statusEl.className = 'bs-badge ' + (badgeMap[status] || 'bs-badge-pending');
            }
            pcSetFlowBtnState(status); // 概要条 Flow 按钮执行态圆点随 run 状态翻色
            setPcRunText('pcRunTokens', data.total_tokens || 0);
            setPcRunText('pcRunCost', typeof data.total_cost === 'number' ? data.total_cost.toFixed(4) : '0.0');

            pcRunData = data.nodes || {};
            if (data.graph) pcRunGraph = data.graph; // 沿用最近一次 graph；轮询缺 graph 时不清空画布
            var graph = data.graph || pcRunGraph;
            var statusMap = pcRunStatusMap();
            // 当前执行节点（并行 running 取第一个）→ step 行
            var runNid = Object.keys(statusMap).filter(function (nid) { return statusMap[nid] === 'running'; })[0] || null;
            if (runNid) {
                var agent = '';
                if (graph && graph.nodes) {
                    for (var i = 0; i < graph.nodes.length; i++) {
                        if (graph.nodes[i].id === runNid && graph.nodes[i].agent) { agent = ' (' + graph.nodes[i].agent + ')'; break; }
                    }
                }
                setPcRunText('pcRunStep', runNid + agent);
            } else if (status === 'waiting_approval') {
                setPcRunText('pcRunStep', 'Waiting approval');
            } else {
                setPcRunText('pcRunStep', '—');
            }
            if (pcRunAuto && runNid) pcRunSel = runNid;
            if (pcRunSel && pcRunData[pcRunSel]) {
                renderRunDetail(pcRunSel);
            } else if (pcRunSel) {
                pcRunSel = null;
                renderRunDetail(null);
            }
            renderRunApprovals(data.pending_approvals || []);
            // 画布只在 Flow Diagram 二级弹框打开时渲染（隐藏时跳过，避免 display:none 下 fit 取 0 尺寸）
            if (pcRunGraphIsOpen()) {
                pcRunCanvas.render(graph, statusMap); // renderGraph 整段重建 innerHTML，其后按 pcRunSel 叠加选中环
                pcMarkGraphSel();
            }
            renderRunSteps();
            var terminal = { success: 1, failed: 1, cancelled: 1 };
            if (terminal[status]) stopRunPolling();
        }

        // ── 右栏节点详情（通用、可复用）：Input/Output 渲染成 key-value 表，另拉节点 trace
        //    展示 MCP/Tool 调用、思维链(Reasoning)、证据链(执行时间线)。换节点时 Input/Output 默认展开，
        //    MCP/Reasoning/Evidence/Raw 默认折叠（标题带数量）。无 trace 的节点（approval/mock）自动降级。

        // 图节点元信息（agent / kind）→ 头部标签
        function pcRunNodeMeta(nid) {
            var g = pcRunGraph;
            if (g && g.nodes) {
                for (var i = 0; i < g.nodes.length; i++) {
                    if (g.nodes[i].id === nid) return g.nodes[i];
                }
            }
            return {};
        }

        // trace 缓存 → 分组视图（node 汇总 / llm 思维链 / tool 调用 / denied / 全序 timeline）
        function pcRunTraceParts(nid) {
            var cached = pcRunTraces[nid];
            var items = (cached && cached.items) || null;
            var out = {
                items: items,
                loaded: !!cached,
                error: (cached && cached.error) || null,
                node: null, llm: [], tools: [], denied: [], timeline: []
            };
            if (!items) return out;
            for (var i = 0; i < items.length; i++) {
                var t = items[i], k = t.kind;
                if (k === 'node') out.node = t;
                else {
                    if (k === 'llm_call') out.llm.push(t);
                    else if (k === 'tool_call') out.tools.push(t);
                    else if (k === 'denied') out.denied.push(t);
                    out.timeline.push(t);
                }
            }
            return out;
        }

        // 拉该节点 trace（有节流缓存）：终态拉一次即缓存；running 时约每 2.5s 刷新以见新增 MCP/思维链
        function pcRunTraceEnsure(nid, st) {
            if (!nid || !pcRunId) return;
            if (pcRunTraceReq[nid]) return;
            var running = (st === 'running' || st === 'pending' || st === 'waiting_approval');
            var c = pcRunTraces[nid];
            var now = Date.now();
            if (c && c.items && !running) return;               // 终态已缓存 → 不再重复请求
            if (c && running && now - c.ts < 2500) return;      // 运行中 → 节流
            pcRunTraceReq[nid] = true;
            agentflowFetch('/runs/' + encodeURIComponent(pcRunId) + '/traces?node_id=' + encodeURIComponent(nid) + '&limit=500')
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (list) {
                    pcRunTraceReq[nid] = false;
                    pcRunTraces[nid] = { items: list || [], ts: Date.now(), error: null };
                    if (pcRunSel === nid && pcRunData && pcRunData[nid]) renderRunDetail(nid);
                })
                .catch(function (err) {
                    pcRunTraceReq[nid] = false;
                    pcRunTraces[nid] = { items: null, ts: Date.now(), error: (err && err.message) || 'error' };
                    if (pcRunSel === nid) renderRunDetail(nid);
                });
        }

        // 折叠分区壳：标题 + 可选数量徽标 + 内容；开合由 pcRunSecOpen 持久（轮询重渲染保持一致）
        function pcRunSec(title, key, countHtml, bodyHtml) {
            var open = pcRunSecOpen ? !!pcRunSecOpen[key] : false;
            return '<section class="nd-sec' + (open ? ' open' : '') + '" data-sec="' + key + '">' +
                '<button type="button" class="nd-sec-trigger" aria-expanded="' + open + '">' +
                    '<span class="nd-sec-chev"></span>' +
                    '<span class="nd-sec-title">' + escapeHtml(title) + '</span>' +
                    (countHtml ? '<span class="nd-sec-count">' + countHtml + '</span>' : '') +
                '</button>' +
                '<div class="nd-sec-body">' + bodyHtml + '</div>' +
            '</section>';
        }

        // 长文本块：超长/多行 → 预格式 + 可裁剪（Show more/less）；短文本 → 行内
        function pcRunBlk(text, max) {
            var esc = escapeHtml(String(text));
            var long = String(text).length > max;
            return '<div class="nd-blk' + (long ? ' has-more' : '') + '">' +
                '<pre class="nd-pre' + (long ? ' clipped' : '') + '">' + esc + '</pre>' +
                (long ? '<button type="button" class="nd-blk-btn">Show more <span class="nd-blk-caret">&#9660;</span></button>' : '') +
            '</div>';
        }

        function pcRunScalar(x) {
            var t = typeof x;
            return x === null || x === undefined || t === 'string' || t === 'number' || t === 'boolean';
        }

        // 通用 key-value 树：任意 JSON 值 → 人读的表格/列表（新节点类型零成本复用）
        function pcRunValHtml(v) {
            var t = typeof v;
            if (v === null || v === undefined) return '<span class="nd-null">&#8709;</span>';
            if (t === 'string') {
                var s = String(v).trim();
                if ((s.charAt(0) === '{' || s.charAt(0) === '[') && s.length > 1) { // 字符串是 JSON → 解析后递归
                    try {
                        var parsed = JSON.parse(s);
                        if (parsed !== null && typeof parsed === 'object') return pcRunValHtml(parsed);
                    } catch (e) {}
                }
                if (String(v).length > 180 || /\n/.test(String(v))) return pcRunBlk(v, 240);
                return '<span class="nd-str">' + escapeHtml(String(v)) + '</span>';
            }
            if (t === 'number' || t === 'boolean') return '<span class="nd-prim">' + escapeHtml(String(v)) + '</span>';
            if (Array.isArray(v)) return pcRunArrHtml(v);
            if (t === 'object') return pcRunObjHtml(v);
            return escapeHtml(String(v));
        }

        function pcRunObjHtml(obj) {
            var keys = Object.keys(obj);
            if (!keys.length) return '<span class="nd-empty">&#123;&#125;</span>';
            var rows = '';
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                rows += '<div class="nd-row"><span class="nd-key">' + escapeHtml(k) + '</span>' +
                    '<span class="nd-cell">' + pcRunValHtml(obj[k]) + '</span></div>';
            }
            return '<div class="nd-obj">' + rows + '</div>';
        }

        function pcRunArrHtml(arr) {
            if (!arr.length) return '<span class="nd-empty">&#91;&#93;</span>';
            var allScalar = true;
            for (var i = 0; i < arr.length; i++) { if (!pcRunScalar(arr[i])) { allScalar = false; break; } }
            if (allScalar) {
                var lis = '';
                for (var j = 0; j < arr.length; j++) { lis += '<li class="nd-arr-li">' + pcRunValHtml(arr[j]) + '</li>'; }
                return '<ul class="nd-arr">' + lis + '</ul>';
            }
            var cards = '';
            for (var m = 0; m < arr.length; m++) { cards += '<div class="nd-card">' + pcRunObjHtml(arr[m]) + '</div>'; }
            return '<div class="nd-arr-obj">' + cards + '</div>';
        }

        // tool result：统一转文本块展示（裁剪 + Show more），避免大结果撑爆面板
        function pcRunResultHtml(v) {
            if (v === null || v === undefined) return '<span class="nd-null">&#8709;</span>';
            if (typeof v === 'string') return pcRunBlk(v, 240);
            return pcRunBlk(JSON.stringify(v, null, 2), 240);
        }

        // trace name 'mcp__{server}__{tool}' → {server, tool}
        function pcRunToolName(t) {
            var name = t.name || 'tool';
            var p = t.payload || {};
            var server = p.server || null;
            var tool = name;
            if (server) {
                var parts = name.split('__');
                if (parts.length >= 3) tool = parts.slice(2).join('__');
                else if (p.tool) tool = p.tool;
            } else if (p.tool) tool = p.tool;
            return { server: server, tool: tool };
        }

        function pcRunToolKindLabel(t) {
            var isM = !!(t.payload && t.payload.is_mcp);
            return '<span class="nd-k ' + (isM ? 'nd-k-mcp' : 'nd-k-tool') + '">' + (isM ? 'MCP' : 'tool') + '</span>';
        }

        // 一次 MCP/工具调用卡片
        function pcRunToolCard(t) {
            var p = t.payload || {};
            var nm = pcRunToolName(t);
            var chips = '';
            if (p.read_only) chips += '<span class="nd-chip nd-chip-ro">read-only</span>';
            var rs = p.result_state || '';
            chips += rs ? '<span class="nd-chip nd-state nd-state-' + escapeHtml(rs) + '">' + escapeHtml(rs) + '</span>' : '';
            var head = pcRunToolKindLabel(t) +
                '<span class="nd-call-name">' + escapeHtml(nm.server ? (nm.server + ' / ' + nm.tool) : nm.tool) + '</span>' + chips;
            var body = '';
            if (p.input !== undefined && p.input !== null) {
                body += '<div class="nd-kv-row"><span class="nd-kv-k">args</span><span class="nd-kv-v">' + pcRunValHtml(p.input) + '</span></div>';
            }
            if (p.result !== undefined && p.result !== null) {
                body += '<div class="nd-kv-row"><span class="nd-kv-k">result</span><span class="nd-kv-v">' + pcRunResultHtml(p.result) + '</span></div>';
            }
            return '<div class="nd-call"><div class="nd-call-head">' + head + '</div>' +
                (body ? '<div class="nd-call-body">' + body + '</div>' : '') + '</div>';
        }

        // 被 DENY 的工具
        function pcRunDeniedCard(t) {
            var p = t.payload || {};
            var nm = p.tool || t.name || 'tool';
            var body = '';
            if (p.reason) {
                body += '<div class="nd-kv-row"><span class="nd-kv-k">reason</span><span class="nd-kv-v nd-cell-plain">' +
                    escapeHtml(p.reason) + '</span></div>';
            }
            return '<div class="nd-call nd-call-denied"><div class="nd-call-head">' +
                '<span class="nd-k nd-k-denied">denied</span>' +
                '<span class="nd-call-name">' + escapeHtml(nm) + '</span></div>' +
                (body ? '<div class="nd-call-body">' + body + '</div>' : '') + '</div>';
        }

        // 一次模型调用（含思维链 reasoning）
        function pcRunReasoningItem(t) {
            var p = t.payload || {};
            var u = p.usage || {};
            var meta = '';
            if (u.input_tokens) meta += 'in ' + u.input_tokens + ' · ';
            if (u.output_tokens) meta += 'out ' + u.output_tokens + ' tok';
            var head = '<span class="nd-k nd-k-llm">LLM</span>' +
                '<span class="nd-call-name">' + escapeHtml(t.name || 'model') + '</span>' +
                (meta ? '<span class="nd-chip nd-chip-meta">' + meta + '</span>' : '');
            var body = '';
            var reason = p.reasoning;
            if (reason) {
                var txt = typeof reason === 'string' ? reason : JSON.stringify(reason, null, 2);
                body += '<div class="nd-reason-title">Reasoning</div>' + pcRunBlk(txt, 400);
            }
            return '<div class="nd-call nd-call-llm"><div class="nd-call-head">' + head + '</div>' +
                (body ? '<div class="nd-call-body">' + body + '</div>' : '') + '</div>';
        }

        // 证据链：执行时间线（llm → tool → … 按 seq 全序）
        function pcRunTimelineHtml(parts) {
            var html = '<div class="tl">';
            for (var i = 0; i < parts.timeline.length; i++) {
                var t = parts.timeline[i];
                var k = t.kind;
                var cls = k === 'llm_call' ? 'tl-llm' : (k === 'tool_call' ? 'tl-tool' : 'tl-denied');
                var p = t.payload || {};
                var head = '';
                var body = '';
                if (k === 'llm_call') {
                    var u = p.usage || {};
                    var usg = '';
                    if (u.input_tokens) usg += (usg ? ' · ' : '') + 'in ' + u.input_tokens;
                    if (u.output_tokens) usg += (usg ? ' · ' : '') + 'out ' + u.output_tokens;
                    if (usg) usg += ' tok';
                    head = '<span class="tl-badge tl-b-llm">LLM</span>' +
                        '<span class="tl-title">' + escapeHtml(t.name || 'model') + '</span>' +
                        (usg ? '<span class="tl-sub">' + usg + '</span>' : '');
                    var reason = p.reasoning;
                    if (reason) {
                        var rt = typeof reason === 'string' ? reason : JSON.stringify(reason, null, 2);
                        body = '<div class="tl-reason">' + pcRunBlk(rt, 360) + '</div>';
                    }
                } else {
                    var nm = pcRunToolName(t);
                    var title = nm.server ? (nm.server + ' / ' + nm.tool) : nm.tool;
                    var subs = [];
                    if (k === 'tool_call' && p.read_only) subs.push('read-only');
                    if (p.result_state) subs.push(p.result_state);
                    head = '<span class="tl-badge ' + (k === 'denied' ? 'tl-b-denied' : (p.is_mcp ? 'tl-b-mcp' : 'tl-b-tool')) + '">' +
                        (k === 'denied' ? 'denied' : (p.is_mcp ? 'MCP' : 'tool')) + '</span>' +
                        '<span class="tl-title">' + escapeHtml(title) + '</span>' +
                        (subs.length ? '<span class="tl-sub">' + subs.map(escapeHtml).join(' · ') + '</span>' : '');
                    var r = p.result;
                    if (k === 'denied') {
                        if (p.reason) body = '<div class="nd-cell-plain">' + escapeHtml(p.reason) + '</div>';
                    } else if (r !== undefined && r !== null) {
                        body = '<div class="tl-result">' + pcRunResultHtml(r) + '</div>';
                    }
                }
                html += '<div class="tl-event ' + cls + '"><div class="tl-head"><span class="tl-seq">#' + (i + 1) + '</span>' +
                    head + '</div>' + (body ? '<div class="tl-body">' + body + '</div>' : '') + '</div>';
            }
            html += '</div>';
            return html;
        }

        function renderRunDetail(nid) {
            var detail = getEl('pcRunDetail');
            if (!detail) return;
            if (!nid || !pcRunData || !pcRunData[nid]) {
                pcRunDetailNode = null;
                pcRunSecOpen = null;
                detail.innerHTML = '<div class="bs-detail-empty">Select a step to view its input / output, MCP tool calls and reasoning.</div>';
                return;
            }
            var n = pcRunData[nid];
            var st = n.status || 'pending';
            // 换节点 → 分区开合复位（Input/Output 开，其余折叠）
            if (nid !== pcRunDetailNode) {
                pcRunDetailNode = nid;
                pcRunSecOpen = { input: true, output: true, mcp: false, reasoning: false, evidence: false, raw: false };
            }
            // 需要 trace（MCP/思维链/证据链）→ 按需拉取（终态一次 / running 节流）
            pcRunTraceEnsure(nid, st);

            var badge = '<span class="bs-badge bs-badge-' + escapeHtml(st) + '">' + escapeHtml(st) + '</span>';
            var gn = pcRunNodeMeta(nid);
            var headChips = '';
            if (gn.agent) headChips += '<span class="nd-chip nd-chip-agent">' + escapeHtml(gn.agent) + '</span>';
            if (gn.kind && gn.kind !== 'task') headChips += '<span class="nd-chip nd-chip-kind">' + escapeHtml(gn.kind) + '</span>';
            var tokens = n.tokens || 0;
            var cost = typeof n.cost === 'number' ? n.cost.toFixed(4) : '0.0';
            var metaTxt = 'tokens ' + tokens + ' · cost ' + cost;

            var params = n.params || {};
            var output = n.output;
            var hasParams = Object.keys(params).length > 0;
            var hasOutput = output !== undefined && output !== null;

            var inputHtml = hasParams ? pcRunValHtml(params) : '<div class="bs-detail-empty">(no params)</div>';
            var outputHtml;
            if (!hasOutput) outputHtml = st === 'running'
                ? '<div class="bs-detail-empty">(running…)</div>'
                : '<div class="bs-detail-empty">(no output)</div>';
            else outputHtml = pcRunValHtml(output);

            var parts = pcRunTraceParts(nid);
            var body = '';

            body += pcRunSec('Input', 'input', '', inputHtml);
            body += pcRunSec('Output', 'output', '', outputHtml);

            if (parts.tools.length || parts.denied.length) {
                var toolCards = '';
                for (var ti = 0; ti < parts.tools.length; ti++) toolCards += pcRunToolCard(parts.tools[ti]);
                for (var di = 0; di < parts.denied.length; di++) toolCards += pcRunDeniedCard(parts.denied[di]);
                body += pcRunSec('Tools & MCP Calls', 'mcp', String(parts.tools.length + parts.denied.length), toolCards);
            }
            if (parts.llm.length) {
                var llmHtml = '';
                for (var li = 0; li < parts.llm.length; li++) llmHtml += pcRunReasoningItem(parts.llm[li]);
                body += pcRunSec('Reasoning', 'reasoning', String(parts.llm.length), llmHtml);
            }
            if (parts.timeline.length) {
                body += pcRunSec('Evidence Trail', 'evidence', String(parts.timeline.length), pcRunTimelineHtml(parts));
            }

            // trace 状态提示（执行中等待 / 加载中 / 无明细 / 拉取失败）；有 trace 内容的节点不必提示
            var hasTraceContent = parts.timeline.length > 0;
            var isRunning = (st === 'running' || st === 'pending' || st === 'waiting_approval');
            var note = '';
            if (!hasTraceContent) {
                if (parts.error) {
                    note = '<div class="bs-detail-empty">Step trace unavailable: ' + escapeHtml(parts.error) + '</div>';
                } else if (isRunning) {
                    note = '<div class="bs-detail-empty">Awaiting step detail…</div>';
                } else if (parts.loaded) {
                    note = '<div class="bs-detail-empty">No per-step trace (MCP / reasoning) recorded for this node.</div>';
                } else if (!pcRunTraceReq[nid]) {
                    note = '<div class="bs-detail-empty">Loading step detail…</div>';
                }
            }
            if (note) body += note;

            // 兜底 Raw JSON（可查原文；通用渲染器处理不了的原始形态可在此查看）
            var rawObj = { status: st, params: params, output: output, tokens: tokens, cost: cost };
            body += pcRunSec('Raw JSON', 'raw', '', pcRunBlk(JSON.stringify(rawObj, null, 2), 300));

            detail.innerHTML =
                '<div class="nd-head">' +
                    '<span class="bs-detail-node">' + escapeHtml(nid) + '</span>' + badge + headChips +
                    '<span class="bs-detail-meta">' + metaTxt + '</span>' +
                '</div>' +
                '<div class="nd-body">' + body + '</div>';
        }

        function renderRunApprovals(approvals) {
            var wrap = getEl('pcRunApprovals');
            var sec = getEl('pcRunApprovalSection');
            if (!wrap) return;
            var list = approvals || [];
            if (!list.length) {
                wrap.innerHTML = '<div class="bs-list-empty">No pending approvals.</div>';
                if (sec) sec.style.display = 'none';
                return;
            }
            var html = '';
            list.forEach(function (p) {
                var trigger = p.trigger ? escapeHtml(p.trigger) : null;
                var triggerHtml = trigger
                    ? '<span class="bs-trigger">' + trigger + '</span>'
                    : '<span class="bs-trigger bs-trigger-plain">Manual approval</span>';
                var upstreamHtml = '';
                if (p.upstream) {
                    Object.keys(p.upstream).forEach(function (u) {
                        var out = p.upstream[u];
                        upstreamHtml += '<div class="bs-upstream"><div class="bs-upstream-label">' + escapeHtml(u) + '</div><pre>' +
                            escapeHtml(JSON.stringify(out, null, 2)) + '</pre></div>';
                    });
                }
                html += '<div class="bs-approval-card" data-node="' + escapeHtml(p.node_id) + '">' +
                    '<div class="bs-approval-head"><span class="bs-approval-node">' + escapeHtml(p.node_id) + '</span>' + triggerHtml + '</div>' +
                    (upstreamHtml ? '<div class="bs-upstreams">' + upstreamHtml + '</div>' : '') +
                    '<div class="bs-approval-actions">' +
                        '<button class="btn btn-sm bs-approve-btn" data-action="approve" data-node="' + escapeHtml(p.node_id) + '">Approve</button>' +
                        '<button class="btn btn-sm bs-reject-btn" data-action="reject" data-node="' + escapeHtml(p.node_id) + '">Reject</button>' +
                    '</div>' +
                '</div>';
            });
            wrap.innerHTML = html;
            if (sec) sec.style.display = 'block';
        }

        function runApproval(action, nodeId) {
            if (!pcRunId || !nodeId) return;
            // by：审批人身份。dev 模式由 body 传入；租户一旦在管理库配了 approvers 白名单，
            // 名字不在这里就会 403（JWT 模式下则由 token 的 sub 决定，body 被忽略）。
            var by = localStorage.getItem('agentflowApprover') || 'lead-engineer';
            agentflowFetch('/runs/' + encodeURIComponent(pcRunId) + '/' + action, {
                method: 'POST',
                body: {
                    node_id: nodeId,
                    by: by,
                    comment: action === 'reject' ? 'rejected from Diagnosis Center' : ''
                }
            }).then(function (res) {
                if (!res.ok) return res.json().then(function (d) { throw new Error((d && d.detail) || ('HTTP ' + res.status)); });
                return res.json();
            }).then(function () {
                // 审批结论**记录**回问题单（只落 evidence，不执行任何修复动作）。
                // 记录失败不影响审批本身的结果，故静默降级。
                if (pcRunRec && pcRunRec.record_id) {
                    apmApi('/v1/problems/' + encodeURIComponent(pcRunRec.record_id) + '/run-decision', {
                        method: 'POST',
                        body: {
                            run_id: pcRunId, node_id: nodeId,
                            approved: action === 'approve', by: by
                        }
                    }).catch(function () { /* 记录失败：不打断审批流程 */ });
                }
                fetchRunNow(); // 立即刷一次，让被审批节点状态落图
            }).catch(function (err) {
                window._showToast((action === 'approve' ? 'Approve' : 'Reject') + ' failed: ' + (err && err.message ? err.message : 'network error'), 'error');
            });
        }

        // 步骤状态 → 左栏序号圆点着色类（状态集同 pcRunStatusClass，维度更粗）
        function pcStepStateClass(st) {
            var m = {
                'done': 'st-done',
                'running': 'st-running',
                'failed': 'st-failed',
                'cancelled': 'st-cancelled',
                'rejected': 'st-rejected',
                'waiting_approval': 'st-waiting',
                'skipped': 'st-skipped'
            };
            return m[st] || 'st-pending';
        }

        // 节点数据 → {nid:status} 映射（画布渲染与步骤列表共用）
        function pcRunStatusMap() {
            var m = {};
            if (pcRunData) {
                Object.keys(pcRunData).forEach(function (nid) {
                    m[nid] = pcRunData[nid].status;
                });
            }
            return m;
        }

        // 图内"当前选中"环：renderGraph 每次整段重建 innerHTML，需在其后按 pcRunSel 重新加类
        function pcMarkGraphSel() {
            var svg = getEl('pcRunGraph');
            if (!svg) return;
            var groups = svg.querySelectorAll('g[data-node]');
            for (var i = 0; i < groups.length; i++) {
                var g = groups[i];
                var on = !!pcRunSel && g.getAttribute('data-node') === pcRunSel;
                if (on) g.classList.add('bs-node-selected');
                else g.classList.remove('bs-node-selected');
            }
        }

        // 选中节点（图点击 / 左栏步骤点击共用）：停 autoFollow、标选中环、刷详情与步骤列表
        function pcSelectNode(nid) {
            if (nid) pcRunAuto = false;
            pcRunSel = nid;
            pcMarkGraphSel();
            renderRunDetail(nid);
            renderRunSteps();
        }

        // 左栏步骤排序：与 Flow Diagram 画布同算法（Kahn 拓扑分层）取执行顺序，保证列表与流程图一致。
        // 不可直接用 graph.nodes 原始顺序——那是 YAML 定义顺序，与依赖/执行顺序常不一致
        // （如 run_4c9a4dc444 把 approve-root 排在依赖它的 git-search/root-cause 前），列表看着"乱"。
        function pcRunTopoOrder(graph) {
            var nodes = (graph && graph.nodes) ? graph.nodes : [];
            var edges = (graph && graph.edges) ? graph.edges : [];
            if (!nodes.length) return [];
            var indeg = {}, child = {}, has = {};
            nodes.forEach(function (n) { indeg[n.id] = 0; child[n.id] = []; has[n.id] = true; });
            edges.forEach(function (e) {
                if (!has[e.from] || !has[e.to] || e.from === e.to) return;
                if (child[e.from].indexOf(e.to) === -1) { child[e.from].push(e.to); indeg[e.to] += 1; }
            });
            var queue = [];
            nodes.forEach(function (n) { if (indeg[n.id] === 0) queue.push(n.id); });
            var ordered = [];
            while (queue.length) {
                var layer = queue.slice();
                queue = [];
                layer.forEach(function (id) {
                    ordered.push(id);
                    child[id].forEach(function (to) {
                        indeg[to] -= 1;
                        if (indeg[to] === 0) queue.push(to);
                    });
                });
            }
            var done = {};
            ordered.forEach(function (id) { done[id] = true; });
            nodes.forEach(function (n) { if (!done[n.id]) ordered.push(n.id); }); // 防环兜底
            return ordered;
        }

        // 左栏"执行流程"步骤列表：按拓扑执行顺序列出每个节点（含并行/审批/终态），
        // 行 = 序号 + 节点(agent) + tokens + 状态徽章；running/选中高亮；点行 = 选中该节点
        function renderRunSteps() {
            var wrap = getEl('pcRunSteps');
            if (!wrap) return;
            var graph = pcRunGraph;
            var nodes = (graph && graph.nodes) ? graph.nodes : [];
            var ordered = [];
            if (nodes.length) {
                ordered = pcRunTopoOrder(graph); // 与画布同拓扑分层：按依赖/执行顺序，而非 YAML 定义顺序
            } else if (pcRunData) {
                ordered = Object.keys(pcRunData);
            }
            var countEl = getEl('pcRunStepCount');
            if (countEl) countEl.textContent = ordered.length ? String(ordered.length) + ' steps' : '';
            if (!ordered.length) {
                wrap.innerHTML = '<div class="pcrun-steps-empty">Waiting for run data…</div>';
                return;
            }
            var byId = {};
            nodes.forEach(function (n) { byId[n.id] = n; });
            var html = '';
            for (var i = 0; i < ordered.length; i++) {
                var nid = ordered[i];
                var n = byId[nid] || {};
                var nd = pcRunData ? (pcRunData[nid] || {}) : {};
                var st = nd.status || 'pending';
                var sel = (nid === pcRunSel) ? ' pcrun-sel' : '';
                var label = nid + (n.agent ? ' (' + n.agent + ')' : '');
                var tok = (typeof nd.tokens === 'number') ? String(nd.tokens) + ' tok' : '';
                html += '<button type="button" class="pcrun-step ' + pcStepStateClass(st) + sel + '" data-nid="' + escapeHtml(nid) + '" title="' + escapeHtml(label) + '">' +
                    '<span class="pcrun-step-idx">' + (i + 1) + '</span>' +
                    '<span class="pcrun-step-main"><span class="pcrun-step-name">' + escapeHtml(label) + '</span></span>' +
                    (tok ? '<span class="pcrun-step-tok">' + tok + '</span>' : '') +
                    '<span class="bs-badge bs-badge-' + escapeHtml(st) + '">' + escapeHtml(st) + '</span>' +
                '</button>';
            }
            wrap.innerHTML = html;
        }

        // Flow Diagram 二级弹框当前是否打开（主弹框画布已抽离，仅在此时渲染，避免隐藏 DOM fit 取 0）
        function pcRunGraphIsOpen() {
            var o = getEl('pcRunGraphOverlay');
            return !!(o && o.classList.contains('open'));
        }

        // 概要条 Flow Diagram 按钮：执行态圆点随 run 状态翻色（running/waiting 呼吸，终态定格）
        function pcSetFlowBtnState(status) {
            var btn = getEl('pcRunFlowBtn');
            if (!btn) return;
            var dot = btn.querySelector('.pcrun-flowdot');
            if (!dot) return;
            var map = {
                'running': 'is-running',
                'waiting_approval': 'is-waiting',
                'success': 'is-done',
                'done': 'is-done',
                'failed': 'is-failed',
                'cancelled': 'is-cancelled',
                'pending': 'is-pending'
            };
            dot.className = 'pcrun-flowdot ' + (map[status] || 'is-idle');
            btn.setAttribute('data-state', status || '');
            btn.title = status
                ? ('Run status: ' + status + ' — click to open the flow diagram')
                : 'Open the execution flow diagram';
        }

        // 打开 Flow Diagram 二级弹框：先 .open 再画（display:none 时 fit 取 0 尺寸）
        function openRunGraph() {
            var o = getEl('pcRunGraphOverlay');
            if (!o) return;
            var title = getEl('pcRunGraphTitle');
            if (title) title.textContent = 'Flow Diagram' + (pcRunRec && pcRunRec.record_id ? ' - ' + pcRunRec.record_id : '');
            o.classList.add('open');
            renderRunGraphNow();
        }

        // 打开时立即按当前数据画一次；尚无数据则保持 hint（Loading flow diagram…）
        function renderRunGraphNow() {
            if (!pcRunGraphIsOpen()) return;
            if (pcRunGraph) pcRunCanvas.render(pcRunGraph, pcRunStatusMap());
            pcMarkGraphSel();
        }

        function closeRunGraph() {
            var o = getEl('pcRunGraphOverlay');
            if (o) o.classList.remove('open');
            // 静默模式（只开了图、没开 run 查看器）：关图即收摊。
            // 停轮询原本挂在「关 run 查看器」上（closeProblemRun），而这条路径根本没开过它 ——
            // 不补这一步，关掉图之后那个 2s 轮询会一直在后台跑。
            if (pcRunSilent) {
                pcRunSilent = false; // 先清标志：closeProblemRun 内部会再调 closeRunGraph，避免自递归
                closeProblemRun();
            }
        }

        function closeProblemRun() {
            stopRunPolling(); // 关弹框必清 timer，否则后台持续轮询
            closeRunGraph(); // 若 Flow Diagram 二级弹框开着，一并收起
            pcSetFlowBtnState(''); // 复位概要条 Flow 按钮圆点
            pcRunRec = null;
            pcRunId = null;
            pcRunData = null;
            pcRunGraph = null;
            pcRunSel = null;
            pcRunAuto = true;
            pcRunDetailNode = null;
            pcRunSecOpen = null;
            pcRunTraces = {};
            pcRunTraceReq = {};
            var stepsEl = getEl('pcRunSteps');
            if (stepsEl) stepsEl.innerHTML = '';
            var overlay = getEl('pcRunOverlay');
            if (overlay) overlay.classList.remove('open');
        }

        function refresh(opts) {
            // silent=true 用于 5s 自动轮询：不闪 loading、不打断当前分页、失败不弹错（保留旧数据）
            var silent = !!(opts && opts.silent);
            if (pcRefreshing) return; // 已有请求在途（手动刷新/切页/轮询），跳过本次，避免并发堆叠
            pcRefreshing = true;
            var overlay = getEl('pcLoadingOverlay');
            if (!silent) {
                if (overlay) overlay.classList.add('visible');
                allProblems = [];
            }
            apmApi('/v1/problems?limit=500')
                .then(function (data) {
                    pcRefreshing = false;
                    allProblems = (data && data.items) ? data.items : [];
                    if (!silent) {
                        if (overlay) overlay.classList.remove('visible');
                        currentPage = 0;
                    }
                    loadServiceFilter();
                    renderKpi();
                    renderTable();
                })
                .catch(function (err) {
                    pcRefreshing = false;
                    if (silent) return; // 轮询失败静默忽略，保留旧数据
                    if (overlay) overlay.classList.remove('visible');
                    window._showToast('Load problems failed: ' + err.message, 'error');
                    renderKpi();
                    renderTable();
                });
        }

        // Filter bindings
        var svcFilter = getEl('pcServiceFilter');
        if (svcFilter) svcFilter.addEventListener('change', function () {
            currentService = this.value;
            currentPage = 0;
            var label = getEl('pcServiceLabel');
            if (label) label.textContent = currentService ? 'Filtered: ' + currentService : '';
            renderTable();
        });

        document.querySelectorAll('.pc-sev-filter').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.pc-sev-filter').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentSeverity = this.getAttribute('data-filter');
                currentPage = 0;
                renderTable();
            });
        });

        document.querySelectorAll('.pc-state-filter').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.pc-state-filter').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentState = this.getAttribute('data-filter');
                currentPage = 0;
                renderTable();
            });
        });

        // 证据类型 chip（All Types / Metric / Log）。查询收进 legacyRoot() —— CLAUDE.md 要求
        // 本文件所有全文档查询都要收进它。紧邻的两个 chip 组用的是裸 document.querySelectorAll，
        // 属既有写法；本次不顺手改它们，避免把 diff 铺开。
        legacyRoot().querySelectorAll('.pc-type-filter').forEach(function (btn) {
            btn.addEventListener('click', function () {
                legacyRoot().querySelectorAll('.pc-type-filter').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentType = this.getAttribute('data-filter');
                currentPage = 0;
                renderTable();
            });
        });

        /**
         * 一键清空四组筛选（服务下拉 + 严重度 + 状态 + 证据类型），并重新拉数据。
         *
         * ⚠️ 必须连 **URL 里的下钻参数** 一起清（`?service=&type=&state=`）。那些参数是
         * Smart Inspection 点徽标下钻带进来的，而本页每次被切回来都会经
         * `_pageRefreshers['page-problems']`（本文件内，搜这个名字）跑一次
         * `applyQueryFilters()` —— 只清 UI 不动 URL 的话，切走再回来，刚重置掉的筛选会被
         * URL 原样装回来。（这里不写行号：本文件一改行号就漂，先前那版就写歪了。）
         *
         * 清 URL 的方式分两种，不能混用：
         *   - 嵌在 Vue 应用里 → 走接缝 S3（`__SIP_NAVIGATE`），由 Vue Router 改地址；
         *     直接 history.replaceState 会**抹掉 vue-router 存在 history.state 里的状态**，
         *     影响它后续的前进/后退还原。
         *   - 单独打开旧 index.html → 没有路由，那一步才退化成直接改地址栏。
         */
        var pcResetBtn = getEl('pcResetBtn');
        if (pcResetBtn) pcResetBtn.addEventListener('click', function () {
            currentService = '';
            currentSeverity = 'all';
            currentState = 'all';
            currentType = 'all';
            currentPage = 0;

            // UI 同步：下拉框 / 服务标签 / 三组 chip（用现成的 syncChipRow，只改高亮不动语义）
            var resetSel = getEl('pcServiceFilter');
            if (resetSel) resetSel.value = '';
            var resetLabel = getEl('pcServiceLabel');
            if (resetLabel) resetLabel.textContent = '';
            syncChipRow('.pc-sev-filter', 'all');
            syncChipRow('.pc-state-filter', 'all');
            syncChipRow('.pc-type-filter', 'all');

            if (location.search) {
                if (window.__SIP_NAVIGATE) {
                    // 这次切页会经 _pageRefreshers 自动 refresh，这里就**不能**再调一次 ——
                    // 两个 refresh 之间只有 pcRefreshing 这个"在途"标志去重，而后端不可达时
                    // 第一个请求瞬间就失败返回、标志已经落下，第二次会真的再发出去
                    // （实测：连着两次切回本页、间隔 50ms → 2 个请求）。
                    window.__SIP_NAVIGATE('problems', {});
                    return;
                }
                history.replaceState(null, '', location.pathname);   // 单独打开旧页：没有路由
            }
            refresh();
        });

        var pcRefreshBtn = getEl('pcRefreshBtn');
        if (pcRefreshBtn) pcRefreshBtn.addEventListener('click', refresh);

        // Confirm 弹窗按钮（同 initDomainConfig 的通用确认弹窗绑定）
        getEl('confirmModalOk').addEventListener('click', runConfirm);
        getEl('confirmModalCancel').addEventListener('click', closeConfirm);
        getEl('confirmModalClose').addEventListener('click', closeConfirm);
        getEl('confirmModalOverlay').addEventListener('click', function (e) {
            if (e.target === this) closeConfirm();
        });

        // 详情弹窗关闭（宽模态 pcDetailOverlay）
        var pcDetailClose = getEl('pcDetailClose');
        if (pcDetailClose) pcDetailClose.addEventListener('click', closeProblemDetail);
        var pcDetailOverlay = getEl('pcDetailOverlay');
        if (pcDetailOverlay) pcDetailOverlay.addEventListener('click', function (e) {
            if (e.target === this) closeProblemDetail();
        });

        // 诊断内容弹窗生命周期（pcDiagnoseOverlay）：关闭 / 点遮罩 / Escape
        var pcDiagnoseClose = getEl('pcDiagnoseClose');
        if (pcDiagnoseClose) pcDiagnoseClose.addEventListener('click', closeDiagnosisView);
        var pcDiagnoseOverlay = getEl('pcDiagnoseOverlay');
        if (pcDiagnoseOverlay) pcDiagnoseOverlay.addEventListener('click', function (e) {
            if (e.target === this) closeDiagnosisView();
        });
        // 诊断内容交互：审批动作（.dgx-act）/ 修复方案分页签（写回 dgxOptSel，轮询重渲染仍保持）/
        // 分析链路开合（<details> 的 toggle 不冒泡 → 用 capture 捕获，仅认 .dgx-chain）。
        var pcDiagBodyEl = getEl('pcDiagnoseBody');
        if (pcDiagBodyEl) {
            pcDiagBodyEl.addEventListener('click', function (e) {
                var t = e.target;
                var actBtn = t && t.closest ? t.closest('.dgx-act') : null;
                if (actBtn) {
                    var act = actBtn.getAttribute('data-act');
                    if (act === 'reject') { dgxFbOpen = true; renderDiagnosis(pcDiagLastSnap); }
                    else if (act === 'reject-cancel') { dgxFbOpen = false; renderDiagnosis(pcDiagLastSnap); }
                    else if (act === 'reject-submit') submitDiagnosisDecision('reject');
                    else if (act === 'ignore') {
                        confirmDialog('忽略该诊断并关闭这条问题单？', function () { submitDiagnosisDecision('ignore'); });
                    } else if (act === 'escalate') {
                        // 二次确认与「忽略」同款：这一步会把问题单转成终态、且**会真的建出一张工单**
                        // （不可逆的动作在派单侧），误点的代价比忽略高。
                        confirmDialog(
                            '升级该诊断？将生成一张修复工单并把这条问题单置为 escalated。',
                            function () { submitDiagnosisDecision('escalate'); });
                    } else if (act === 'flow-last') {
                        // 概要条 Flow Diagram：直接看**最后一次执行**的流程图，**只开这一张图**
                        //（silent：不亮下面的 run 查看器，关掉图就回诊断弹框）。
                        // 顺序不能反：openProblemRun 会先 closeRunGraph()（清上一轮残留），
                        // 它同时负责建 pcRunId/轮询与数据管道，openRunGraph 才有东西可画。
                        // 数据未到时图弹框先显示 Loading，applyRunView 拿到 run 后补画。
                        var lastRid = dgxLastRunId(pcDiagLastSnap);
                        if (lastRid && pcDiagRec) {
                            openProblemRun(pcDiagRec, lastRid, { silent: true });
                            openRunGraph();
                        }
                    }
                    return;
                }
                // 历次执行 → 下钻到该轮的 run 执行流程（复用 View analysis 的查看器）
                var execRow = t && t.closest ? t.closest('.dgx-exec-row') : null;
                if (execRow) {
                    var rid = execRow.getAttribute('data-exec-run');
                    if (rid && pcDiagRec) openProblemRun(pcDiagRec, rid);
                    return;
                }
                var tab = t && t.closest ? t.closest('.dgx-tab') : null;
                if (!tab) return;
                var idx = parseInt(tab.getAttribute('data-opt'), 10);
                if (isNaN(idx)) return;
                dgxOptSel = idx;
                var tabs = pcDiagBodyEl.querySelectorAll('.dgx-tab');
                for (var i = 0; i < tabs.length; i++) {
                    var on = (i === idx);
                    if (on) tabs[i].classList.add('is-active'); else tabs[i].classList.remove('is-active');
                    tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
                }
                var panels = pcDiagBodyEl.querySelectorAll('.dgx-panel');
                for (var j = 0; j < panels.length; j++) {
                    if (j === idx) panels[j].classList.add('is-active'); else panels[j].classList.remove('is-active');
                }
            });
            // 拒绝反馈输入：写回 dgxFbText，轮询重渲染时不丢已输入内容
            pcDiagBodyEl.addEventListener('input', function (e) {
                var t = e.target;
                if (t && t.classList && t.classList.contains('dgx-fb-input')) dgxFbText = t.value;
            });
            pcDiagBodyEl.addEventListener('toggle', function (e) {
                var t = e.target;
                if (!t || !t.classList || !t.classList.contains('dgx-chain')) return;
                // 历史条目的链路开合是"看回历史"，不能在下一个 5s 轮询里把 live 链路也一起展开
                if (t.classList.contains('dgx-chain--hist')) return;
                dgxChainOpen = !!t.open;
            }, true);
        }

        // Run Viewer 生命周期：主弹框（pcRunOverlay：关闭/遮罩/步骤/详情 tab/审批）+ Flow Diagram 二级弹框
        //（pcRunGraphOverlay：概要条右上按钮/关闭/遮罩）。Escape 先关图弹框，再关主弹框。
        var pcRunClose = getEl('pcRunClose');
        if (pcRunClose) pcRunClose.addEventListener('click', closeProblemRun);
        var pcRunOverlay = getEl('pcRunOverlay');
        if (pcRunOverlay) pcRunOverlay.addEventListener('click', function (e) {
            if (e.target === this) closeProblemRun();
        });
        // 右栏详情：折叠分区标题点击开合（状态写回 pcRunSecOpen，轮询重渲染保持一致）；长文本 Show more/less
        var pcRunDetailEl = getEl('pcRunDetail');
        if (pcRunDetailEl) pcRunDetailEl.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.getAttribute) return;
            if (t.classList && t.classList.contains('nd-sec-trigger')) {
                var key = t.getAttribute('data-sec');
                var sec = t.closest ? t.closest('.nd-sec') : null;
                if (!key || !sec) return;
                var open = !sec.classList.contains('open');
                if (open) sec.classList.add('open'); else sec.classList.remove('open');
                t.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (pcRunSecOpen) pcRunSecOpen[key] = open;
                return;
            }
            var btn = t.closest ? t.closest('.nd-blk-btn') : null;
            if (btn) {
                var blk = btn.closest('.nd-blk');
                if (blk) {
                    var ex = blk.classList.toggle('expanded');
                    btn.innerHTML = ex ? 'Show less <span class="nd-blk-caret">&#9650;</span>' : 'Show more <span class="nd-blk-caret">&#9660;</span>';
                }
            }
        });
        var pcRunApprovalsEl = getEl('pcRunApprovals');
        if (pcRunApprovalsEl) pcRunApprovalsEl.addEventListener('click', function (e) {
            var btn = e.target && e.target.getAttribute ? e.target : null;
            var action = btn && btn.getAttribute ? btn.getAttribute('data-action') : null;
            if (!action) return;
            var nodeId = btn.getAttribute('data-node');
            // 驳回是**终态**（审批 CAS 不可逆），走一次确认；通过保持一键（可随时看历史）
            if (action === 'reject') {
                confirmDialog('驳回该修复计划？驳回后本次 run 走复盘分支收尾，记录上会留下审批痕迹。', function () {
                    runApproval('reject', nodeId);
                });
                return;
            }
            runApproval(action, nodeId);
        });
        var pcRunStepsEl = getEl('pcRunSteps');
        if (pcRunStepsEl) pcRunStepsEl.addEventListener('click', function (e) {
            var t = e.target;
            var btn = t && t.closest ? t.closest('[data-nid]') : null;
            if (btn) pcSelectNode(btn.getAttribute('data-nid'));
        });
        // Flow Diagram 二级弹框：概要条右上按钮打开；关闭按钮 / 点遮罩收起
        var pcRunFlowBtn = getEl('pcRunFlowBtn');
        if (pcRunFlowBtn) pcRunFlowBtn.addEventListener('click', openRunGraph);
        var pcRunGraphClose = getEl('pcRunGraphClose');
        if (pcRunGraphClose) pcRunGraphClose.addEventListener('click', closeRunGraph);
        var pcRunGraphOverlay = getEl('pcRunGraphOverlay');
        if (pcRunGraphOverlay) pcRunGraphOverlay.addEventListener('click', function (e) {
            if (e.target === this) closeRunGraph();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (getEl('pcRunGraphOverlay') && getEl('pcRunGraphOverlay').classList.contains('open')) closeRunGraph();
            else if (getEl('pcRunOverlay') && getEl('pcRunOverlay').classList.contains('open')) closeProblemRun();
            else if (getEl('pcDiagnoseOverlay') && getEl('pcDiagnoseOverlay').classList.contains('open')) closeDiagnosisView();
            else if (getEl('pcDetailOverlay') && getEl('pcDetailOverlay').classList.contains('open')) closeProblemDetail();
        });

        // 切回本页时自动刷新
        // 切回本页时自动刷新。先吃 URL query（下钻带的筛选）再拉数据 —— 顺序不能反：
        // refresh() 内部会调 loadServiceFilter()，它依赖已经设好的 currentService 才能
        // 把下拉框选到正确的服务上。
        _pageRefreshers['page-problems'] = function () { applyQueryFilters(); refresh(); };

        // ── 初始加载 + 5s 自动刷新（仅当页面可见时静默轮询，切换走后自动暂停）──
        refresh();
        if (pcPollTimer) clearInterval(pcPollTimer);
        pcPollTimer = setInterval(function () {
            var page = document.getElementById('page-problems');
            if (page && page.style.display !== 'none') refresh({ silent: true });
        }, 5000);
    }

    // ── Helper: format time ago ──────────────────────────────
    function formatTimeAgo(dateStr) {
        if (!dateStr) return '';
        try {
            var now = new Date();
            var then = new Date(dateStr);
            if (isNaN(then.getTime())) return dateStr;
            var diffMs = now - then;
            if (diffMs < 0) return dateStr;
            var diffSec = Math.floor(diffMs / 1000);
            var diffMin = Math.floor(diffSec / 60);
            var diffHour = Math.floor(diffMin / 60);
            var diffDay = Math.floor(diffHour / 24);
            if (diffMin < 1) return '刚刚';
            if (diffMin < 60) return diffMin + '分钟前';
            if (diffHour < 24) return diffHour + '小时前';
            if (diffDay < 30) return diffDay + '天前';
            return then.toLocaleDateString('zh-CN');
        } catch (e) {
            return dateStr;
        }
    }

    // ── Helper: toggle collapsible section ────────────────────
    window._toggleCollapsible = function(trigger) {
        if (!trigger) return;
        var section = trigger.parentElement;
        if (!section) return;
        var content = section.querySelector('.collapsible-content');
        if (!content) return;
        var isExpanded = trigger.getAttribute('aria-expanded') === 'true';
        if (isExpanded) {
            trigger.setAttribute('aria-expanded', 'false');
            trigger.classList.remove('expanded');
            content.classList.remove('open');
        } else {
            trigger.setAttribute('aria-expanded', 'true');
            trigger.classList.add('expanded');
            content.classList.add('open');
        }
    };

    // ── Helper: toggle evidence sub-cards ─────────────────────
    window._toggleEvidence = function() {
        var cards = document.getElementById('evidenceSubCards');
        var btn = document.getElementById('toggleEvidenceBtn');
        if (!cards || !btn) return;
        var isVisible = cards.classList.contains('visible');
        if (isVisible) {
            cards.classList.remove('visible');
            btn.innerHTML = '&#128194; 展开全部证据卡片 <span class="chevron">&#9662;</span>';
        } else {
            cards.classList.add('visible');
            btn.innerHTML = '&#128193; 收起证据卡片 <span class="chevron">&#9652;</span>';
        }
        // Also toggle timeline step bodies
        var timelineWrapper = document.querySelector('.timeline-wrapper');
        if (timelineWrapper) {
            if (isVisible) {
                timelineWrapper.classList.remove('show-details');
            } else {
                timelineWrapper.classList.add('show-details');
            }
        }
    };

    // ── Helper: show toast notification ───────────────────────
    window._showToast = function(message, type) {
        var container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            container.id = 'toastContainer';
            document.body.appendChild(container);
        }
        var toast = document.createElement('div');
        toast.className = 'toast-msg' + (type ? ' toast-' + type : '');
        toast.textContent = message || '';
        container.appendChild(toast);
        setTimeout(function() {
            toast.classList.add('fade-out');
            setTimeout(function() {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 2500);
    };

    // ── Monitor Targets (APM) ─────────────────────────────────
    function initMonitorTargets() {
        // 后端地址（可配置）：默认 http://localhost:7070（后端 .env APM_PORT=7070）。
        // 可用 localStorage 覆盖：apmBaseUrl / apmTenantId / apmApiKey。
        var APM_BASE_URL = localStorage.getItem('apmBaseUrl') || 'http://localhost:7070';
        var TENANT_ID = localStorage.getItem('apmTenantId') || 'default';
        var API_KEY = localStorage.getItem('apmApiKey') || '';

        var targets = [];
        var currentTarget = null;   // 编辑中的端点 {target_id, ...}；null = New
        var currentSignalFilter = '';
        var currentSearch = '';

        // ── API 封装（统一 X-Tenant-Id / 可选 Bearer）────
        function apmApi(path, options) {
            var opts = options || {};
            var headers = {};
            headers['X-Tenant-Id'] = TENANT_ID;
            if (API_KEY) headers['Authorization'] = 'Bearer ' + API_KEY;
            if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
            return fetch(APM_BASE_URL + path, {
                method: opts.method || 'GET',
                headers: headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
            }).then(function (res) {
                return res.text().then(function (text) {
                    var data = null;
                    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
                    if (!res.ok) {
                        var reason = 'HTTP ' + res.status;
                        if (data && typeof data === 'object' && data.reason) reason = data.reason;
                        var err = new Error(reason);
                        err.status = res.status;
                        err.data = data;
                        throw err;
                    }
                    return data;
                });
            });
        }

        function getEl(id) { return document.getElementById(id); }

        // ── Modal open / close ──
        function openModal() {
            getEl('apmModalOverlay').classList.add('open');
        }
        function closeModal() {
            getEl('apmModalOverlay').classList.remove('open');
        }

        // ── Confirm dialog（通用确认弹窗，适配 SIP 风格）──
        var _confirmCb = null;
        function confirmDialog(message, onConfirm) {
            _confirmCb = onConfirm || null;
            getEl('confirmModalMsg').textContent = message;
            getEl('confirmModalOverlay').classList.add('open');
        }
        function closeConfirm() {
            _confirmCb = null;
            getEl('confirmModalOverlay').classList.remove('open');
        }
        function runConfirm() {
            var cb = _confirmCb;
            closeConfirm();
            if (typeof cb === 'function') cb();
        }

        function parseJson(id, isRequired) {
            var raw = getEl(id).value.trim();
            if (!raw) {
                if (isRequired) throw new Error('Required JSON is empty');
                return {};
            }
            try { return JSON.parse(raw); } catch (e) { throw new Error('Invalid JSON in ' + id + ': ' + e.message); }
        }

        // ── Form read / write ──
        function readForm() {
            var signalType = getEl('apmSignalType').value;
            var service = getEl('apmService').value.trim();
            var url = getEl('apmUrl').value.trim();

            if (!service) throw new Error('Service is required');
            if (!url) throw new Error('Source URL is required');
            if (!/^https?:\/\//i.test(url)) throw new Error('Source URL must start with http:// or https://');

            var needsMapping = signalType === 'metric' || signalType === 'log';
            var fm = parseJson('apmFieldMapping', needsMapping);
            var headers = parseJson('apmHeaders', false);
            var params = parseJson('apmParams', false);
            var timeParams = parseJson('apmTimeParams', false);

            var sc = { url: url };
            var rowsPath = getEl('apmRowsPath').value.trim();
            if (rowsPath) sc.rows_path = rowsPath;
            if (signalType === 'log') {
                var sigFrames = parseInt(getEl('apmSignatureFrames').value, 10);
                if (!isNaN(sigFrames)) sc.signature_frames = sigFrames;
            }
            var windowSec = parseInt(getEl('apmWindowSec').value, 10);
            if (!isNaN(windowSec) && windowSec > 0) sc.window_sec = windowSec;
            var timezone = getEl('apmTimezone').value.trim();
            if (timezone) sc.timezone = timezone;
            if (Object.keys(fm).length) sc.field_mapping = fm;
            if (Object.keys(headers).length) sc.headers = headers;
            if (Object.keys(params).length) sc.params = params;
            if (Object.keys(timeParams).length) sc.time_params = timeParams;

            return {
                service: service,
                signal_type: signalType,
                source_type: getEl('apmSourceType').value,
                domain: getEl('apmDomain').value.trim() || 'application',
                enabled: getEl('apmEnabled').checked,
                schedule: { interval_sec: parseInt(getEl('apmInterval').value, 10) || 60 },
                source_config: sc
            };
        }

        function fillForm(target) {
            var sc = target.source_config || {};
            var sched = target.schedule || {};
            getEl('apmService').value = target.service || '';
            getEl('apmSignalType').value = target.signal_type || 'metric';
            getEl('apmSourceType').value = target.source_type || 'prometheus';
            getEl('apmDomain').value = target.domain || 'application';
            getEl('apmEnabled').checked = !!target.enabled;
            getEl('apmInterval').value = sched.interval_sec || 60;
            getEl('apmUrl').value = sc.url || '';
            getEl('apmRowsPath').value = sc.rows_path || 'data.result';
            getEl('apmSignatureFrames').value = sc.signature_frames || 3;
            getEl('apmWindowSec').value = sc.window_sec || '';
            getEl('apmFieldMapping').value = sc.field_mapping ? JSON.stringify(sc.field_mapping, null, 2) : '';
            getEl('apmHeaders').value = sc.headers && Object.keys(sc.headers).length ? JSON.stringify(sc.headers, null, 2) : '';
            getEl('apmParams').value = sc.params && Object.keys(sc.params).length ? JSON.stringify(sc.params, null, 2) : '';
            getEl('apmTimeParams').value = sc.time_params && Object.keys(sc.time_params).length ? JSON.stringify(sc.time_params, null, 2) : '';
            getEl('apmTimezone').value = sc.timezone || '';
            getEl('apmFieldTemplate').value = '';
            currentTarget = target;
            setFormState(target.target_id);
        }

        function resetForm(silent) {
            if (currentTarget) {
                // 编辑态：Reset 恢复该条记录已保存的内容（丢弃未保存的修改）
                fillForm(currentTarget);
                if (!silent) window._showToast('Form reset to saved values', 'info');
                return;
            }
            currentTarget = null;
            getEl('apmService').value = '';
            getEl('apmSignalType').value = 'metric';
            getEl('apmSourceType').value = 'prometheus';
            getEl('apmDomain').value = 'application';
            getEl('apmEnabled').checked = true;
            getEl('apmInterval').value = 60;
            getEl('apmUrl').value = '';
            getEl('apmRowsPath').value = 'data.result';
            getEl('apmSignatureFrames').value = 3;
            getEl('apmWindowSec').value = '';
            getEl('apmFieldMapping').value = '';
            getEl('apmHeaders').value = '';
            getEl('apmParams').value = '';
            getEl('apmTimeParams').value = '';
            getEl('apmTimezone').value = '';
            getEl('apmFieldTemplate').value = '';
            setFormState(null);
            if (!silent) window._showToast('Form reset to New', 'info');
        }

        function setFormState(targetId) {
            getEl('apmFormHint').textContent = targetId ? 'Editing ' + targetId : 'New Target';
        }

        // ── Actions ──
        function saveTarget() {
            var body;
            try { body = readForm(); } catch (e) { window._showToast(e.message, 'error'); return; }
            var isEdit = !!currentTarget;
            var path = isEdit ? '/v1/monitors/' + encodeURIComponent(currentTarget.target_id) : '/v1/monitors';
            apmApi(path, { method: isEdit ? 'PUT' : 'POST', body: body })
                .then(function (data) {
                    var savedId = (data && data.target_id) || (isEdit && currentTarget ? currentTarget.target_id : '');
                    window._showToast(isEdit ? 'Updated ' + savedId : 'Created ' + savedId, 'success');
                    closeModal();
                    refreshList();
                })
                .catch(function (err) {
                    window._showToast('Save failed: ' + err.message, 'error');
                });
        }

        function requireLoaded() {
            if (!currentTarget || !currentTarget.target_id) {
                window._showToast('Save the target first, then run Test / Run', 'info');
                return false;
            }
            return true;
        }

        function renderSignal(s) {
            if (s.kind === 'log') {
                return '<div class="apm-signal-row">' +
                    '<span class="apm-signal-svc">' + escapeHtml(s.service) + '</span>' +
                    '<span class="apm-signal-kind">log</span>' +
                    '<span class="apm-signal-msg">[' + escapeHtml(s.level || '') + '] ' + escapeHtml(s.message || '') + '</span>' +
                    '<span class="apm-signal-ts">' + escapeHtml(String(s.timestamp || '')) + '</span>' +
                    '</div>';
            }
            return '<div class="apm-signal-row">' +
                '<span class="apm-signal-svc">' + escapeHtml(s.service) + '</span>' +
                '<span class="apm-signal-kind">metric</span>' +
                '<span class="apm-signal-msg">' + escapeHtml(s.metric || '') + ' = ' + escapeHtml(String(s.value)) + '</span>' +
                '<span class="apm-signal-ts">' + escapeHtml(String(s.timestamp || '')) + '</span>' +
                '</div>';
        }

        function setResult(html) {
            getEl('apmResultBody').innerHTML = html;
            getEl('apmResult').open = true;
        }

        function connectivityTest() {
            if (!requireLoaded()) return;
            setResult('<div class="si-loading-spinner" style="display:inline-block;"></div> Testing connectivity...');
            apmApi('/v1/monitors/' + encodeURIComponent(currentTarget.target_id) + '/test', { method: 'POST' })
                .then(function (data) {
                    if (!data) throw new Error('empty response');
                    if (data.status === 'error') {
                        setResult('<div class="apm-result-error">Test failed: ' + escapeHtml(String(data.reason || 'unknown')) + '</div>');
                        return;
                    }
                    var html = '<div class="apm-result-ok">status: <strong>ok</strong> · signal_count: <strong>' + data.signal_count + '</strong></div>';
                    if (data.signals && data.signals.length) {
                        html += '<div class="apm-signal-list">' + data.signals.map(renderSignal).join('') + '</div>';
                    }
                    setResult(html);
                })
                .catch(function (err) {
                    setResult('<div class="apm-result-error">' + escapeHtml(err.message) + '</div>');
                });
        }

        // ── List ──
        function loadOverlay(show) {
            var ov = getEl('apmLoadingOverlay');
            if (ov) ov.classList.toggle('visible', !!show);
        }

        function refreshList() {
            loadOverlay(true);
            apmApi('/v1/monitors', {})
                .then(function (data) {
                    // 后端 /v1/monitors 已按 created_at DESC 排序（新创建的排最前），前端直接按序渲染
                    targets = (data && data.items) || [];
                    renderList();
                })
                .catch(function (err) {
                    window._showToast('Load targets failed: ' + err.message, 'error');
                })
                .finally(function () { loadOverlay(false); });
        }

        function renderList() {
            var tbody = getEl('apmTableBody');
            if (!tbody) return;
            var filtered = targets.filter(function (t) {
                if (currentSignalFilter && t.signal_type !== currentSignalFilter) return false;
                if (currentSearch) {
                    var svc = (t.service || '').toLowerCase();
                    var tid = (t.target_id || '').toLowerCase();
                    return svc.indexOf(currentSearch) !== -1 || tid.indexOf(currentSearch) !== -1;
                }
                return true;
            });
            tbody.innerHTML = filtered.map(function (t) {
                var sched = t.schedule || {};
                return '<tr data-id="' + escapeHtml(t.target_id) + '">' +
                    '<td class="apm-tid">' + escapeHtml(t.target_id) + '</td>' +
                    '<td>' + escapeHtml(t.service) + '</td>' +
                    '<td>' + escapeHtml(t.signal_type) + '</td>' +
                    '<td>' + escapeHtml(t.source_type) + '</td>' +
                    '<td>' + escapeHtml(t.domain) + '</td>' +
                    '<td>' + (sched.interval_sec || '-') + 's</td>' +
                    '<td>' + (t.enabled ? '<span class="apm-badge apm-badge-on">enabled</span>' : '<span class="apm-badge apm-badge-off">disabled</span>') + '</td>' +
                    '<td class="apm-actions">' +
                        '<button class="btn btn-outline apm-row-btn" data-act="edit" data-id="' + escapeHtml(t.target_id) + '">Edit</button>' +
                        '<button class="btn btn-outline apm-row-btn" data-act="test" data-id="' + escapeHtml(t.target_id) + '">Test</button>' +
                        '<button class="btn apm-row-btn apm-row-del" data-act="del" data-id="' + escapeHtml(t.target_id) + '">Delete</button>' +
                    '</td>' +
                    '</tr>';
            }).join('');
            getEl('apmRowCount').textContent = filtered.length;
        }

        function findTarget(id) {
            for (var i = 0; i < targets.length; i++) { if (targets[i].target_id === id) return targets[i]; }
            return null;
        }

        function onListAction(e) {
            var btn = e.target.closest('.apm-row-btn');
            if (!btn) return;
            e.stopPropagation();
            var id = btn.getAttribute('data-id');
            var act = btn.getAttribute('data-act');
            var t = findTarget(id);
            if (!t) return;
            if (act === 'edit') {
                openModal();
                fillForm(t);
            } else if (act === 'test') {
                openModal();
                fillForm(t);
                connectivityTest();
            } else if (act === 'del') {
                confirmDialog('Delete monitor target ' + id + '?', function () {
                    apmApi('/v1/monitors/' + encodeURIComponent(id), { method: 'DELETE' })
                        .then(function () {
                            window._showToast('Deleted ' + id, 'success');
                            refreshList();
                        })
                        .catch(function (err) {
                            window._showToast('Delete failed: ' + err.message, 'error');
                        });
                });
            }
        }

        // ── Template dropdown ──
        function applyTemplate() {
            var v = getEl('apmFieldTemplate').value;
            var tmpl = {
                prometheus: { metric: 'metric.__name__', value: 'value[1]', timestamp: 'value[0]', service: 'service' },
                flat: { metric: 'metric', value: 'value', timestamp: 'timestamp', service: 'service' },
                elk: { level: '_source.level', message: '_source.message', stack_trace: '_source.stack_trace', timestamp: '_source.@timestamp' }
            };
            if (tmpl[v]) getEl('apmFieldMapping').value = JSON.stringify(tmpl[v], null, 2);
        }

        // ── Wire events ──
        getEl('apmSaveBtn').addEventListener('click', saveTarget);
        getEl('apmTestBtn').addEventListener('click', connectivityTest);
        getEl('apmResetBtn').addEventListener('click', function () { resetForm(); });
        getEl('apmNewBtn').addEventListener('click', function () {
            resetForm(true);
            openModal();
        });
        getEl('apmFieldTemplate').addEventListener('change', applyTemplate);
        getEl('apmSearch').addEventListener('input', function () {
            var self = this;
            clearTimeout(self._timer);
            self._timer = setTimeout(function () {
                currentSearch = self.value.trim().toLowerCase();
                renderList();
            }, 200);
        });
        getEl('apmSignalFilter').addEventListener('change', function () {
            currentSignalFilter = this.value;
            renderList();
        });
        getEl('apmTableBody').addEventListener('click', onListAction);
        getEl('apmModalClose').addEventListener('click', closeModal);
        getEl('apmModalOverlay').addEventListener('click', function (e) {
            if (e.target === this) closeModal();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && getEl('apmModalOverlay').classList.contains('open')) closeModal();
        });
        // ── Confirm dialog 事件 ──
        getEl('confirmModalOk').addEventListener('click', runConfirm);
        getEl('confirmModalCancel').addEventListener('click', closeConfirm);
        getEl('confirmModalClose').addEventListener('click', closeConfirm);
        getEl('confirmModalOverlay').addEventListener('click', function (e) {
            if (e.target === this) closeConfirm();
        });

        // 切回本页时自动刷新列表
        _pageRefreshers['page-monitor-targets'] = function () { refreshList(); };

        // 初始化加载
        refreshList();
    }

    // ── Domain Rules ────────────────────────────────────────────
    function initDomainConfig() {
        // 后端地址（可配置）：默认 http://localhost:7070（后端 .env APM_PORT=7070）。
        // 可用 localStorage 覆盖：apmBaseUrl / apmTenantId / apmApiKey。
        var APM_BASE_URL = localStorage.getItem('apmBaseUrl') || 'http://localhost:7070';
        var TENANT_ID = localStorage.getItem('apmTenantId') || 'default';
        var API_KEY = localStorage.getItem('apmApiKey') || '';

        var domains = [];
        var currentDomain = '';        // 编辑中的域；'' = New Domain
        var currentDomainData = null;  // currentDomain 已保存的完整 config（Reset 用）
        var currentSearch = '';
        var pluginDetectors = [];    // GET /v1/plugins 的 detector 名（后端返回单数键）
        var pluginSuppressors = [];  // GET /v1/plugins 的 suppressor 名

        var SEVERITIES = ['warning', 'high', 'critical'];

        // ── API 封装（同 initMonitorTargets）──
        function apmApi(path, options) {
            var opts = options || {};
            var headers = {};
            headers['X-Tenant-Id'] = TENANT_ID;
            if (API_KEY) headers['Authorization'] = 'Bearer ' + API_KEY;
            if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
            return fetch(APM_BASE_URL + path, {
                method: opts.method || 'GET',
                headers: headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
            }).then(function (res) {
                return res.text().then(function (text) {
                    var data = null;
                    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
                    if (!res.ok) {
                        var reason = 'HTTP ' + res.status;
                        if (data && typeof data === 'object' && data.reason) reason = data.reason;
                        var err = new Error(reason);
                        err.status = res.status;
                        err.data = data;
                        throw err;
                    }
                    return data;
                });
            });
        }

        function getEl(id) { return document.getElementById(id); }

        function openDcModal() { getEl('dcModalOverlay').classList.add('open'); }
        function closeDcModal() { getEl('dcModalOverlay').classList.remove('open'); }
        function loadOverlay(show) {
            var ov = getEl('dcLoadingOverlay');
            if (ov) ov.classList.toggle('visible', !!show);
        }
        function loadPlugins() {
            return apmApi('/v1/plugins').then(function (data) {
                pluginDetectors = (data && data.detector) || [];
                pluginSuppressors = (data && data.suppressor) || [];
            }).catch(function () {
                // 插件列表拉取失败 → 回退文本输入，不阻塞编辑
                pluginDetectors = [];
                pluginSuppressors = [];
            });
        }

        // ── Confirm dialog（同 initMonitorTargets 的通用确认弹窗）──
        // 两模块共用 confirmModalOverlay，靠各自闭包 _confirmCb null 守卫互不干扰。
        var _confirmCb = null;
        function confirmDialog(message, onConfirm) {
            _confirmCb = onConfirm || null;
            getEl('confirmModalMsg').textContent = message;
            getEl('confirmModalOverlay').classList.add('open');
        }
        function closeConfirm() {
            _confirmCb = null;
            getEl('confirmModalOverlay').classList.remove('open');
        }
        function runConfirm() {
            var cb = _confirmCb;
            closeConfirm();
            if (typeof cb === 'function') cb();
        }

        // ── 键值对行 ──
        function addParamRow(rowsEl, key, value) {
            var row = document.createElement('div');
            row.className = 'kv-row';
            row.innerHTML =
                '<input type="text" class="kv-key" placeholder="param name" value="' + escapeHtml(key || '') + '">' +
                '<span class="kv-eq">=</span>' +
                '<input type="text" class="kv-value" placeholder="value (JSON)" value="' + escapeHtml(value !== undefined && value !== null ? String(value) : '') + '">' +
                '<button type="button" class="kv-del" title="Remove param">&times;</button>';
            rowsEl.appendChild(row);
        }

        function kvHtmlFromParams(params) {
            var keys = Object.keys(params || {});
            if (!keys.length) return '';
            return keys.map(function (k) {
                var v = params[k];
                return '<div class="kv-row">' +
                    '<input type="text" class="kv-key" placeholder="param name" value="' + escapeHtml(k) + '">' +
                    '<span class="kv-eq">=</span>' +
                    '<input type="text" class="kv-value" placeholder="value (JSON)" value="' + escapeHtml(v !== null && v !== undefined ? String(v) : '') + '">' +
                    '<button type="button" class="kv-del" title="Remove param">&times;</button></div>';
            }).join('');
        }

        function parseParamValue(raw) {
            var trimmed = (raw || '').trim();
            if (trimmed === '') return '';
            try { return JSON.parse(trimmed); } catch (e) { return raw; }
        }

        function collectParams(card) {
            var params = {};
            var rows = card.querySelectorAll('.kv-row');
            for (var i = 0; i < rows.length; i++) {
                var key = rows[i].querySelector('.kv-key').value.trim();
                if (!key) continue;
                params[key] = parseParamValue(rows[i].querySelector('.kv-value').value);
            }
            return params;
        }

        function severityOptions(selected) {
            return SEVERITIES.map(function (s) {
                return '<option value="' + s + '"' + (s === selected ? ' selected' : '') + '>' + s + '</option>';
            }).join('');
        }

        // 插件下拉：plugins 拉取成功用下拉，失败回退文本输入（不阻塞编辑）
        function pluginSelect(cls, options, value) {
            if (options.length) {
                return '<select class="' + cls + '">' + options.map(function (p) {
                    return '<option value="' + escapeHtml(p) + '"' + (p === value ? ' selected' : '') + '>' + escapeHtml(p) + '</option>';
                }).join('') + '</select>';
            }
            return '<input type="text" class="' + cls + '" value="' + escapeHtml(value || '') + '" placeholder="plugin name">';
        }

        function renderDetectors(list) {
            var container = getEl('dcDetectors');
            container.innerHTML = '';
            (list || []).forEach(function (d, i) {
                var signal = typeof d.signal === 'string' ? d.signal : (d.signal ? JSON.stringify(d.signal) : '');
                var card = document.createElement('div');
                card.className = 'rule-card';
                card.innerHTML =
                    '<div class="rule-card-head">' +
                        '<span class="rule-card-title">Detector ' + (i + 1) + '</span>' +
                        '<button type="button" class="btn apm-row-btn apm-row-del rule-del">Delete</button>' +
                    '</div>' +
                    '<div class="rule-card-fields">' +
                        '<label class="rule-field">Signal <input type="text" class="dc-signal" placeholder="cpu_usage or JSON matcher" value="' + escapeHtml(signal) + '"></label>' +
                        '<label class="rule-field">Plugin ' + pluginSelect('dc-plugin', pluginDetectors, d.plugin) + '</label>' +
                        '<label class="rule-field">Severity <select class="dc-severity">' + severityOptions(d.severity || 'warning') + '</select></label>' +
                    '</div>' +
                    '<div class="rule-params">' +
                        '<div class="rule-params-title">Params:</div>' +
                        '<div class="kv-rows">' + (kvHtmlFromParams(d.params) || '<div class="kv-empty">No params</div>') + '</div>' +
                        '<button type="button" class="btn btn-outline kv-add">+ Add Param</button>' +
                    '</div>';
                container.appendChild(card);
            });
        }

        function renderSuppressors(list) {
            var container = getEl('dcSuppressors');
            container.innerHTML = '';
            (list || []).forEach(function (s, i) {
                var card = document.createElement('div');
                card.className = 'rule-card';
                // 内置抑制器（blacklist/maintenance_window）不消费 params，条目在独立表，故卡片无需 Params
                card.innerHTML =
                    '<div class="rule-card-head">' +
                        '<span class="rule-card-title">Suppressor ' + (i + 1) + '</span>' +
                        '<button type="button" class="btn apm-row-btn apm-row-del rule-del">Delete</button>' +
                    '</div>' +
                    '<div class="rule-card-fields">' +
                        '<label class="rule-field">Name ' + pluginSelect('dc-name', pluginSuppressors, s.name) + '</label>' +
                    '</div>';
                container.appendChild(card);
            });
        }

        function addEmptyCard(containerId, isDetector) {
            var container = getEl(containerId);
            var card = document.createElement('div');
            card.className = 'rule-card';
            var n = container.querySelectorAll('.rule-card').length + 1;
            card.innerHTML =
                '<div class="rule-card-head">' +
                    '<span class="rule-card-title">' + (isDetector ? 'Detector' : 'Suppressor') + ' ' + n + '</span>' +
                    '<button type="button" class="btn apm-row-btn apm-row-del rule-del">Delete</button>' +
                '</div>' +
                '<div class="rule-card-fields">' +
                    (isDetector
                        ? '<label class="rule-field">Signal <input type="text" class="dc-signal" placeholder="cpu_usage or JSON matcher"></label>' +
                          '<label class="rule-field">Plugin ' + pluginSelect('dc-plugin', pluginDetectors, '') + '</label>' +
                          '<label class="rule-field">Severity <select class="dc-severity">' + severityOptions('warning') + '</select></label>'
                        : '<label class="rule-field">Name ' + pluginSelect('dc-name', pluginSuppressors, '') + '</label>') +
                '</div>' +
                // 只有 Detector 需要 Params；Suppressor 的 params 内置插件不消费，不渲染
                (isDetector
                    ? '<div class="rule-params">' +
                        '<div class="rule-params-title">Params:</div>' +
                        '<div class="kv-rows"><div class="kv-empty">No params</div></div>' +
                        '<button type="button" class="btn btn-outline kv-add">+ Add Param</button>' +
                      '</div>'
                    : '');
            container.appendChild(card);
            renumberCards();
        }

        function renumberCards() {
            ['dcDetectors', 'dcSuppressors'].forEach(function (id) {
                var container = getEl(id);
                var label = id === 'dcDetectors' ? 'Detector' : 'Suppressor';
                var cards = container.querySelectorAll('.rule-card');
                for (var i = 0; i < cards.length; i++) {
                    var title = cards[i].querySelector('.rule-card-title');
                    if (title) title.textContent = label + ' ' + (i + 1);
                }
            });
        }

        // ── 卡片内交互（事件委托）──
        function wireCardContainer(id) {
            getEl(id).addEventListener('click', function (e) {
                var t = e.target;
                if (t.classList.contains('rule-del')) {
                    var card = t.closest('.rule-card');
                    var what = card.querySelector('.rule-card-title').textContent;
                    confirmDialog('Delete ' + what + '?', function () {
                        card.remove();
                        renumberCards();
                    });
                } else if (t.classList.contains('kv-add')) {
                    addParamRow(t.closest('.rule-card').querySelector('.kv-rows'), '', '');
                } else if (t.classList.contains('kv-del')) {
                    t.closest('.kv-row').remove();
                }
            });
        }

        // ── Collect → DomainConfig ──
        function collectDetectors() {
            var out = [];
            var cards = getEl('dcDetectors').querySelectorAll('.rule-card');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var signalRaw = card.querySelector('.dc-signal').value.trim();
                if (!signalRaw) continue;
                var signal = signalRaw;
                if (signalRaw.charAt(0) === '{') {
                    try { signal = JSON.parse(signalRaw); } catch (e) { signal = signalRaw; }
                }
                var d = {
                    signal: signal,
                    plugin: card.querySelector('.dc-plugin').value.trim(),
                    severity: card.querySelector('.dc-severity').value
                };
                var params = collectParams(card);
                if (Object.keys(params).length) d.params = params;
                out.push(d);
            }
            return out;
        }

        function collectSuppressors() {
            var out = [];
            var cards = getEl('dcSuppressors').querySelectorAll('.rule-card');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var name = card.querySelector('.dc-name').value.trim();
                if (!name) continue;
                // 抑制器只提交插件名；params 不消费（条目在 blacklist/maintenance_window 表）
                out.push({ name: name });
            }
            return out;
        }

        function collect() {
            // 按漏斗顺序组装：L0 suppressors → L1 detectors → L2 correlation → L3 verify
            return {
                suppressors: collectSuppressors(),
                detectors: collectDetectors(),
                correlation: {
                    metric_log_window_sec: parseInt(getEl('dcMetricLogWindow').value, 10) || 300,
                    change_window_sec: parseInt(getEl('dcChangeWindow').value, 10) || 300
                },
                verify: {
                    persistence_rounds: parseInt(getEl('dcPersistenceRounds').value, 10) || 2,
                    false_positive_threshold: parseFloat(getEl('dcFpThreshold').value) || 0.6,
                    min_samples: parseInt(getEl('dcMinSamples').value, 10) || 20
                }
            };
        }

        // ── Load / Save ──
        function fillStatic(config) {
            var corr = config.correlation || {};
            var ver = config.verify || {};
            getEl('dcMetricLogWindow').value = corr.metric_log_window_sec != null ? corr.metric_log_window_sec : 300;
            getEl('dcChangeWindow').value = corr.change_window_sec != null ? corr.change_window_sec : 300;
            getEl('dcPersistenceRounds').value = ver.persistence_rounds != null ? ver.persistence_rounds : 2;
            getEl('dcFpThreshold').value = ver.false_positive_threshold != null ? ver.false_positive_threshold : 0.6;
            getEl('dcMinSamples').value = ver.min_samples != null ? ver.min_samples : 20;
        }

        // ── New / Edit ──
        function newDomain() {
            currentDomain = '';
            currentDomainData = null;
            getEl('dcDomainName').value = '';
            getEl('dcDomainName').readOnly = false;
            getEl('dcFormHint').textContent = 'New Domain';
            getEl('dcDetectors').innerHTML = '';
            getEl('dcSuppressors').innerHTML = '';
            fillStatic({});
            openDcModal();
            loadPlugins(); // 预热插件下拉（失败回退文本输入）
        }

        function editDomain(domain) {
            currentDomain = domain;
            currentDomainData = null;
            getEl('dcDomainName').value = domain;
            getEl('dcDomainName').readOnly = true;  // 编辑态锁定域名
            getEl('dcFormHint').textContent = 'Editing ' + domain;
            Promise.all([
                apmApi('/v1/config/' + encodeURIComponent(domain)),
                loadPlugins()
            ]).then(function (results) {
                var data = results[0];
                var config = data.config || {};
                currentDomainData = config;
                renderDetectors(config.detectors || []);
                renderSuppressors(config.suppressors || []);
                fillStatic(config);
            }).catch(function (err) {
                window._showToast('Load failed: ' + err.message, 'error');
                closeDcModal();
            });
        }

        // ── List ──
        function renderList() {
            var tbody = getEl('dcTableBody');
            if (!tbody) return;
            var filtered = domains.filter(function (d) {
                if (!currentSearch) return true;
                return (d.domain || '').toLowerCase().indexOf(currentSearch) !== -1;
            });
            if (!filtered.length) {
                tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-tertiary);text-align:center;padding:24px;">No domains configured. Click "New Domain" to create one.</td></tr>';
                getEl('dcRowCount').textContent = 0;
                return;
            }
            tbody.innerHTML = filtered.map(function (d) {
                return '<tr data-id="' + escapeHtml(d.domain) + '">' +
                    '<td>' + escapeHtml(d.domain) + '</td>' +
                    '<td>' + (d.enabled ? '<span class="apm-badge apm-badge-on">enabled</span>' : '<span class="apm-badge apm-badge-off">disabled</span>') + '</td>' +
                    '<td>' + (d.version != null ? d.version : '-') + '</td>' +
                    '<td class="apm-actions">' +
                        '<button class="btn btn-outline apm-row-btn" data-act="edit" data-id="' + escapeHtml(d.domain) + '">Edit</button>' +
                        '<button class="btn apm-row-btn apm-row-del" data-act="del" data-id="' + escapeHtml(d.domain) + '">Delete</button>' +
                    '</td>' +
                    '</tr>';
            }).join('');
            getEl('dcRowCount').textContent = filtered.length;
        }

        function refresh() {
            loadOverlay(true);
            apmApi('/v1/config').then(function (data) {
                domains = (data && data.items) || [];
                renderList();
            }).catch(function (err) {
                window._showToast('Failed to list domains: ' + err.message, 'error');
            }).finally(function () { loadOverlay(false); });
        }

        function onListAction(e) {
            var btn = e.target.closest('.apm-row-btn');
            if (!btn) return;
            var domain = btn.getAttribute('data-id');
            if (!domain) return;
            if (btn.getAttribute('data-act') === 'edit') {
                openDcModal();
                editDomain(domain);
            } else if (btn.getAttribute('data-act') === 'del') {
                confirmDialog('Delete domain config "' + domain + '"?', function () {
                    deleteDomain(domain);
                });
            }
        }

        // ── Save / Delete / Reset ──
        function save() {
            var name = getEl('dcDomainName').value.trim();
            if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
                window._showToast('Domain name: a-z 0-9 _ - only, ≤32 chars', 'error');
                return;
            }
            if (currentDomain && name !== currentDomain) {
                // readOnly 已锁，双保险防编辑态域名被篡改
                window._showToast('Domain name is locked while editing', 'error');
                return;
            }
            var body = collect();
            apmApi('/v1/config/' + encodeURIComponent(name), { method: 'PUT', body: body })
                .then(function (data) {
                    window._showToast('Saved ' + name + ' v' + data.version, 'success');
                    closeDcModal();
                    refresh(); // 保存成功后刷新列表（新域 / version+1 可见）
                })
                .catch(function (err) {
                    // 未配置 APM_API_KEYS 时 PUT 返回 401/403，展示后端 reason 引导配置
                    window._showToast('Save failed: ' + err.message, 'error');
                });
        }

        function deleteDomain(domain) {
            apmApi('/v1/config/' + encodeURIComponent(domain), { method: 'DELETE' })
                .then(function () {
                    window._showToast('Deleted domain ' + domain, 'success');
                    refresh();
                })
                .catch(function (err) {
                    // 400（被引用）/ 404 展示后端 reason
                    window._showToast('Delete failed: ' + err.message, 'error');
                });
        }

        function resetForm() {
            if (currentDomainData) {
                // Edit 态：恢复已保存内容（丢弃未保存的修改）
                renderDetectors(currentDomainData.detectors || []);
                renderSuppressors(currentDomainData.suppressors || []);
                fillStatic(currentDomainData);
                window._showToast('Form reset to saved values', 'info');
                return;
            }
            // New 态：清空
            getEl('dcDomainName').value = '';
            getEl('dcDetectors').innerHTML = '';
            getEl('dcSuppressors').innerHTML = '';
            fillStatic({});
        }

        // ── Wire events ──
        getEl('dcNewBtn').addEventListener('click', newDomain);
        getEl('dcSaveBtn').addEventListener('click', save);
        getEl('dcResetBtn').addEventListener('click', function () { resetForm(); });
        getEl('dcModalClose').addEventListener('click', closeDcModal);
        getEl('dcModalOverlay').addEventListener('click', function (e) {
            if (e.target === this) closeDcModal();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && getEl('dcModalOverlay').classList.contains('open')) closeDcModal();
        });
        getEl('dcAddDetector').addEventListener('click', function () { addEmptyCard('dcDetectors', true); });
        getEl('dcAddSuppressor').addEventListener('click', function () { addEmptyCard('dcSuppressors', false); });
        wireCardContainer('dcDetectors');
        wireCardContainer('dcSuppressors');
        getEl('dcTableBody').addEventListener('click', onListAction);
        getEl('dcSearch').addEventListener('input', function () {
            var self = this;
            clearTimeout(self._timer);
            self._timer = setTimeout(function () {
                currentSearch = self.value.trim().toLowerCase();
                renderList();
            }, 200);
        });
        getEl('confirmModalOk').addEventListener('click', runConfirm);
        getEl('confirmModalCancel').addEventListener('click', closeConfirm);
        getEl('confirmModalClose').addEventListener('click', closeConfirm);
        getEl('confirmModalOverlay').addEventListener('click', function (e) {
            if (e.target === this) closeConfirm();
        });

        // 切回本页时自动刷新域列表
        _pageRefreshers['page-domain-config'] = function () { refresh(); };

        // 初始化加载
        refresh();
    }

    // ── Agent Registry（Agent Fleet）────────────────────────────
    function initAgentRegistry() {
        // 后端地址（可配置）：默认 http://localhost:8000。可用 localStorage 覆盖：agentsBaseUrl。
        var AGENT_API_BASE = localStorage.getItem('agentsBaseUrl') || 'http://localhost:8000';

        // 流水线阶段分组配置：key 对应后端 /agents 返回的 stage 字段
        // （detect/diagnose/fix/verify/deliver/learn），按后端下发数据驱动分组。
        var AGENT_GROUPS = {
            detect:   { key: 'detect',   label: 'DETECT',   name: '检测', color: '#3b82f6' },
            diagnose: { key: 'diagnose', label: 'DIAGNOSE', name: '诊断', color: '#8b5cf6' },
            fix:      { key: 'fix',      label: 'FIX',      name: '修复', color: '#f59e0b' },
            verify:   { key: 'verify',   label: 'VERIFY',   name: '验证', color: '#10b981' },
            deliver:  { key: 'deliver',  label: 'DELIVER',  name: '发布', color: '#14b8a6' },
            learn:    { key: 'learn',    label: 'LEARN',    name: '复盘', color: '#ec4899' }
        };
        var GROUP_ORDER = ['detect', 'diagnose', 'fix', 'verify', 'deliver', 'learn'];
        var OTHER_GROUP = { key: 'other', label: 'OTHER', name: '未分组', color: '#6b7280' };

        var agents = [];
        var currentSearch = '';

        function getEl(id) { return document.getElementById(id); }
        function setText(id, val) {
            var el = getEl(id);
            if (el) el.textContent = String(val);
        }

        // 取 name 各连字符段首字母，最多 2 个（root-cause → RC）
        function avatarInitials(name) {
            var parts = String(name || '').split('-').filter(Boolean);
            var initials = parts.slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('');
            return initials || '?';
        }

        function groupOf(agent) {
            // 分组完全由后端下发的 stage 字段决定；未知/缺失 stage 归 OTHER 兜底
            var g = AGENT_GROUPS[agent.stage];
            return g ? g : OTHER_GROUP;
        }

        function loadAgents() {
            var overlay = getEl('agLoadingOverlay');
            var errorBar = getEl('agErrorBar');
            if (overlay) overlay.classList.add('visible');
            if (errorBar) errorBar.classList.remove('visible');
            fetch(AGENT_API_BASE + '/agents').then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (data) {
                agents = Array.isArray(data) ? data : [];
                renderFleet();
                if (overlay) overlay.classList.remove('visible');
            }).catch(function (err) {
                if (overlay) overlay.classList.remove('visible');
                if (errorBar) {
                    setText('agErrorText', 'Failed to load agents: ' + (err && err.message ? err.message : 'network error'));
                    errorBar.classList.add('visible');
                }
            });
        }

        function filteredAgents() {
            var query = currentSearch.trim().toLowerCase();
            return agents.filter(function (a) {
                if (query) {
                    var hay = (a.name || '').toLowerCase() + ' ' + (a.description || '').toLowerCase();
                    if (hay.indexOf(query) === -1) return false;
                }
                return true;
            });
        }

        function renderKpis(list) {
            var toolCount = 0;
            var distinct = {};
            list.forEach(function (a) {
                var tools = a.tools || [];
                toolCount += tools.length;
                tools.forEach(function (t) { distinct[t] = true; });
            });
            var stages = {};
            list.forEach(function (a) { stages[groupOf(a).key] = true; });
            var ready = list.filter(function (a) { return (a.tools || []).length > 0; }).length;
            setText('agTotalAgents', list.length);
            setText('agTotalTools', toolCount);
            setText('agDistinctTools', Object.keys(distinct).length);
            setText('agStages', Object.keys(stages).length);
            setText('agReady', ready);
        }

        function renderAgentCard(a, g) {
            var tools = a.tools || [];
            var toolsHtml = tools.length > 0
                ? tools.map(function (t) { return '<span class="agent-tool-badge">' + escapeHtml(t) + '</span>'; }).join('')
                : '<span class="agent-tools-empty">no tools</span>';
            return '<div class="agent-card">' +
                '<div class="agent-card-head">' +
                    '<span class="agent-avatar" style="background:' + g.color + ';">' + escapeHtml(avatarInitials(a.name)) + '</span>' +
                    '<span class="agent-card-name">' + escapeHtml(a.name) + '</span>' +
                    '<span class="agent-tool-count">' + tools.length + (tools.length === 1 ? ' tool' : ' tools') + '</span>' +
                '</div>' +
                '<div class="agent-card-desc">' + escapeHtml(a.description || '') + '</div>' +
                '<div class="agent-tools">' + toolsHtml + '</div>' +
            '</div>';
        }

        function renderFleet() {
            var list = filteredAgents();
            var container = getEl('agFleet');
            var empty = getEl('agEmptyState');
            if (!container) return;
            renderKpis(list);
            if (list.length === 0) {
                container.innerHTML = '';
                if (empty) empty.style.display = 'block';
                return;
            }
            if (empty) empty.style.display = 'none';

            // 分组（按 GROUP_ORDER 阶段顺序，未知 stage 归 OTHER）
            var sections = GROUP_ORDER.map(function (key) { return { group: AGENT_GROUPS[key], items: [] }; });
            sections.push({ group: OTHER_GROUP, items: [] });
            list.forEach(function (a) {
                var g = groupOf(a);
                var sec = null;
                for (var i = 0; i < sections.length; i++) {
                    if (sections[i].group.key === g.key) { sec = sections[i]; break; }
                }
                if (!sec) sec = sections[sections.length - 1];
                sec.items.push(a);
            });

            var html = '';
            sections.forEach(function (sec) {
                if (sec.items.length === 0) return;
                var g = sec.group;
                html += '<div class="agent-group-section">';
                html += '<div class="agent-group-title" style="border-left-color:' + g.color + ';">' + g.label + ' · ' + g.name +
                    ' <span class="agent-group-count">' + sec.items.length + (sec.items.length === 1 ? ' agent' : ' agents') + '</span></div>';
                html += '<div class="agent-fleet-grid">';
                sec.items.forEach(function (a) { html += renderAgentCard(a, g); });
                html += '</div></div>';
            });
            container.innerHTML = html;
        }

        function bindEvents() {
            var search = getEl('agSearch');
            if (search) search.addEventListener('input', function () {
                currentSearch = search.value;
                renderFleet();
            });
            var reset = getEl('agResetBtn');
            if (reset) reset.addEventListener('click', function () {
                currentSearch = '';
                if (search) search.value = '';
                renderFleet();
            });
            var refreshBtn = getEl('agRefreshBtn');
            if (refreshBtn) refreshBtn.addEventListener('click', function () {
                var self = this;
                self.classList.add('spinning');
                self.disabled = true;
                loadAgents();
                setTimeout(function () { self.classList.remove('spinning'); self.disabled = false; }, 600);
            });
            var retry = getEl('agRetryBtn');
            if (retry) retry.addEventListener('click', loadAgents);
        }

        // 切回本页时自动刷新
        _pageRefreshers['page-agents'] = function () { loadAgents(); };

        bindEvents();
        loadAgents();
    }

    // ── Workflow Studio（流程配置：YAML 编辑 / 预览节点图 / 保存 / 编辑 / 删除）──
    // ── 共享图 canvas（SVG Kahn 分层布局 + CSS transform 缩放/平移）──
    // Workflow Studio 与 Bug Solve 共用。opts：元素 ID（hint/zoom/svg/controls/zoomIn/Out/Fit）、
    // markerId、nodeCls/edgeCls（基础类名）、nodeStyle(n, status) -> {cls, label}、onNodeClick(nid)。
    function createGraphCanvas(opts) {
        var zoom = 1, panX = 0, panY = 0;
        var ZOOM_MIN = 0.2, ZOOM_MAX = 6;
        var dragging = false, dragStartX = 0, dragStartY = 0, dragPanX = 0, dragPanY = 0;
        var NODE_W = 150, NODE_H = 46, LEVEL_GAP = 110, COL_GAP = 40, PAD = 30;

        function getEl(id) { return document.getElementById(id); }

        function clampZoom(v) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)); }

        // 舞台层：把 SVG 包进一个内层 div，translate/scale 只施加在舞台上，
        // .zoom 容器保持固定不动充当视口/裁剪面 → 内容按视口居中，而不会把整块容器推偏/裁掉。
        // svg 非 .zoom 直接子元素时（异常 DOM）回退到旧行为：变换直接作用在 .zoom 上。
        var zoomEl = getEl(opts.zoomId);
        var baseSvg = getEl(opts.svgId);
        var stageEl = null;
        if (zoomEl && baseSvg && baseSvg.parentNode === zoomEl) {
            stageEl = document.createElement('div');
            stageEl.className = 'bs-stage';
            zoomEl.insertBefore(stageEl, baseSvg);
            stageEl.appendChild(baseSvg);
        }

        function applyTransform() {
            if (stageEl) {
                stageEl.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
                if (zoomEl) zoomEl.style.transform = ''; // 舞台模式下清掉残留的容器 transform，避免叠加
            } else if (zoomEl) {
                zoomEl.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
            }
        }

        // 以画布中心为锚点缩放（按钮用）
        function zoomBy(factor) {
            var zEl = getEl(opts.zoomId);
            var cx = zEl ? zEl.clientWidth / 2 : 0;
            var cy = zEl ? zEl.clientHeight / 2 : 0;
            var oldZoom = zoom;
            var newZoom = clampZoom(oldZoom * factor);
            panX = cx - (cx - panX) * (newZoom / oldZoom);
            panY = cy - (cy - panY) * (newZoom / oldZoom);
            zoom = newZoom;
            applyTransform();
        }

        // 适配画布：整图缩放到可视区域内（不大幅放大，最大 1 倍基线）
        function fitGraph() {
            var zEl = getEl(opts.zoomId);
            var svg = getEl(opts.svgId);
            if (!zEl || !svg || !svg.getAttribute('viewBox')) return;
            var vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
            var gw = vb[2], gh = vb[3];
            if (!gw || !gh) return;
            var cw = zEl.clientWidth || 600;
            var ch = zEl.clientHeight || 420;
            zoom = clampZoom(Math.min(1, Math.min(cw / gw, ch / gh)));
            panX = (cw - gw * zoom) / 2;
            panY = (ch - gh * zoom) / 2;
            applyTransform();
        }

        // SVG 拓扑分层布局：Kahn 入度剥层 → 层为行(y)，层内节点横排(x)
        function renderGraph(graph, statusMap) {
            var svg = getEl(opts.svgId);
            var hint = getEl(opts.hintId);
            if (!svg) return;
            var nodes = (graph && graph.nodes) ? graph.nodes : [];
            var edges = (graph && graph.edges) ? graph.edges : [];
            if (hint) hint.style.display = 'none';
            if (nodes.length === 0) {
                svg.innerHTML = '';
                var emptyCtrl = getEl(opts.controlsId);
                if (emptyCtrl) emptyCtrl.style.display = 'none';
                return;
            }

            // 入度统计 + 邻接表 → BFS 分层
            var byId = {}, indeg = {}, children = {};
            nodes.forEach(function (n) {
                byId[n.id] = n;
                indeg[n.id] = 0;
                children[n.id] = [];
            });
            edges.forEach(function (e) {
                if (!byId[e.to]) return;
                indeg[e.to] = (indeg[e.to] || 0) + 1;
                children[e.from] = children[e.from] || [];
                children[e.from].push(e.to);
            });

            var levels = [];
            var queue = nodes.filter(function (n) { return indeg[n.id] === 0; }).map(function (n) { return n.id; });
            var remaining = nodes.length;
            while (queue.length > 0 && remaining > 0) {
                var layer = queue.slice();
                levels.push(layer);
                remaining -= layer.length;
                var next = [];
                layer.forEach(function (id) {
                    (children[id] || []).forEach(function (to) {
                        indeg[to] -= 1;
                        if (indeg[to] === 0) next.push(to);
                    });
                });
                queue = next;
            }
            // 防环兜底：仍有剩余节点直接追加到最后层
            var seen = {};
            levels.forEach(function (l) { l.forEach(function (id) { seen[id] = true; }); });
            var leftover = nodes.filter(function (n) { return !seen[n.id]; }).map(function (n) { return n.id; });
            if (leftover.length > 0) levels.push(leftover);

            var maxCols = 1;
            levels.forEach(function (layer) { if (layer.length > maxCols) maxCols = layer.length; });
            var width = maxCols * NODE_W + (maxCols - 1) * COL_GAP + PAD * 2;
            var height = levels.length * LEVEL_GAP + NODE_H + PAD;
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            // SVG 按 1:1 像素渲染，缩放/平移交给 .ws-zoom/.bs-zoom 的 CSS transform 控制
            svg.style.width = width + 'px';
            svg.style.height = height + 'px';

            var pos = {};
            levels.forEach(function (layer, li) {
                var y = PAD + li * LEVEL_GAP;
                var layerW = layer.length * NODE_W + (layer.length - 1) * COL_GAP;
                var x0 = PAD + Math.max(0, (width - PAD * 2 - layerW) / 2);
                layer.forEach(function (id, ci) {
                    pos[id] = { x: x0 + ci * (NODE_W + COL_GAP), y: y };
                });
            });

            // SVG 内容（含箭头 marker defs；innerHTML 会整段替换，故 defs 一并写入）
            var html = '<defs>' +
                '<marker id="' + opts.markerId + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
                '<path d="M 0 0 L 10 5 L 0 10 z" fill="#8b8fa3"></path></marker></defs>';
            edges.forEach(function (e) {
                var p1 = pos[e.from], p2 = pos[e.to];
                if (!p1 || !p2) return;
                var x1 = p1.x + NODE_W / 2, y1 = p1.y + NODE_H;
                var x2 = p2.x + NODE_W / 2, y2 = p2.y;
                html += '<line class="' + opts.edgeCls + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" marker-end="url(#' + opts.markerId + ')"/>';
            });
            nodes.forEach(function (n) {
                var p = pos[n.id];
                if (!p) return;
                var st = statusMap ? (statusMap[n.id] || null) : null;
                var styled = opts.nodeStyle ? opts.nodeStyle(n, st) : { cls: '', label: n.id + (n.agent ? ' (' + n.agent + ')' : '') };
                var cls = opts.nodeCls + (styled.cls ? ' ' + styled.cls : '');
                html += '<g class="' + cls + '" data-node="' + escapeHtml(n.id) + '" transform="translate(' + p.x + ',' + p.y + ')">' +
                    '<rect class="' + opts.nodeCls + '-rect" x="0" y="0" width="' + NODE_W + '" height="' + NODE_H + '" rx="8"/>' +
                    '<text class="' + opts.nodeCls + '-text" x="' + (NODE_W / 2) + '" y="' + (NODE_H / 2) + '" text-anchor="middle" dominant-baseline="central">' + escapeHtml(styled.label) + '</text>' +
                '</g>';
            });
            svg.innerHTML = html;
            var ctrl = getEl(opts.controlsId);
            if (ctrl) ctrl.style.display = 'flex';
            fitGraph();
        }

        function reset() {
            var svg = getEl(opts.svgId);
            var hint = getEl(opts.hintId);
            if (svg) svg.innerHTML = '';
            if (hint) hint.style.display = 'block';
            var ctrl = getEl(opts.controlsId);
            if (ctrl) ctrl.style.display = 'none';
            zoom = 1; panX = 0; panY = 0;
            applyTransform();
        }

        function bindZoomEvents() {
            var zEl = getEl(opts.zoomId);
            if (!zEl) return;
            // 滚轮缩放（以光标为锚点）
            zEl.addEventListener('wheel', function (e) {
                e.preventDefault();
                var rect = zEl.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                var oldZoom = zoom;
                var newZoom = clampZoom(oldZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
                panX = mx - (mx - panX) * (newZoom / oldZoom);
                panY = my - (my - panY) * (newZoom / oldZoom);
                zoom = newZoom;
                applyTransform();
            }, { passive: false });

            // 拖拽平移
            zEl.addEventListener('mousedown', function (e) {
                if (e.target.closest && e.target.closest('.' + opts.controlsCls)) return;
                dragging = true;
                dragStartX = e.clientX; dragStartY = e.clientY;
                dragPanX = panX; dragPanY = panY;
                zEl.style.cursor = 'grabbing';
            });
            zEl.addEventListener('mousemove', function (e) {
                if (!dragging) return;
                panX = dragPanX + (e.clientX - dragStartX);
                panY = dragPanY + (e.clientY - dragStartY);
                applyTransform();
            });
            zEl.addEventListener('mouseup', function () { dragging = false; zEl.style.cursor = ''; });
            zEl.addEventListener('mouseleave', function () { dragging = false; zEl.style.cursor = ''; });

            // 点节点（事件委托）
            if (opts.onNodeClick) {
                zEl.addEventListener('click', function (e) {
                    var g = e.target.closest ? e.target.closest('[data-node]') : null;
                    if (g && g.getAttribute('data-node')) opts.onNodeClick(g.getAttribute('data-node'));
                });
            }

            // 缩放按钮：+/−（以中心为锚点）、Fit（适配画布）
            var zin = getEl(opts.zoomInId);
            if (zin) zin.addEventListener('click', function () { zoomBy(1.3); });
            var zout = getEl(opts.zoomOutId);
            if (zout) zout.addEventListener('click', function () { zoomBy(1 / 1.3); });
            var zfit = getEl(opts.zoomFitId);
            if (zfit) zfit.addEventListener('click', fitGraph);
        }

        bindZoomEvents();
        return { render: renderGraph, reset: reset };
    }

    function initWorkflowStudio() {
        // 后端地址与**租户头**都走模块级那份（`AGENTFLOW_BASE` / `agentflowFetch`）。
        // 这里原先自己声明 `WS_API_BASE` 并用裸 fetch —— **不带 `X-Tenant-ID`**，
        // 于是整个 Studio 读的是 dev 缺省租户 `local` 的 workflow：与 otr 的**同名不同 id**，
        // 列表标题一模一样，点开才发现是旧副本（实测：新加的节点在这儿一直看不到）。

        var workflows = [];
        var editingId = null;

        function getEl(id) { return document.getElementById(id); }
        function setText(id, val) {
            var el = getEl(id);
            if (el) el.textContent = String(val);
        }
        function showError(msg) {
            var err = getEl('wsError');
            if (!err) return;
            err.textContent = msg;
            err.style.display = 'block';
        }
        function clearError() {
            var err = getEl('wsError');
            if (err) err.style.display = 'none';
        }

        // 共享图 canvas：SVG Kahn 分层布局 + 缩放/平移（Workflow Studio 与 Bug Solve 复用）
        var canvas = createGraphCanvas({
            hintId: 'wsHint', zoomId: 'wsZoom', svgId: 'wsGraph',
            controlsId: 'wsZoomControls', controlsCls: 'ws-zoom-controls',
            zoomInId: 'wsZoomIn', zoomOutId: 'wsZoomOut', zoomFitId: 'wsZoomFit',
            markerId: 'wsArrow', nodeCls: 'ws-node', edgeCls: 'ws-edge',
            nodeStyle: function (n) {
                return { cls: (n.kind === 'approval' ? 'ws-node-approval' : ''), label: n.id + (n.agent ? ' (' + n.agent + ')' : '') };
            }
        });

        function loadWorkflows() {
            agentflowFetch('/workflows').then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (data) {
                workflows = Array.isArray(data) ? data : [];
                renderList();
            }).catch(function (err) {
                showError('Failed to load workflows: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function renderList() {
            var listEl = getEl('wsList');
            if (!listEl) return;
            if (workflows.length === 0) {
                listEl.innerHTML = '<div class="ws-list-empty">No saved workflows yet.</div>';
                return;
            }
            var html = '';
            workflows.forEach(function (w) {
                var created = (w.created_at || '').replace('T', ' ').slice(0, 19);
                html += '<div class="ws-list-item" data-wid="' + escapeHtml(w.id) + '">' +
                    '<span class="ws-list-name" title="' + escapeHtml(w.name) + '">' + escapeHtml(w.name) + '</span>' +
                    '<span class="ws-list-meta">' + escapeHtml(created) + '</span>' +
                    '<span class="ws-list-actions">' +
                        '<button class="btn btn-outline ws-btn" data-action="edit">Edit</button>' +
                        '<button class="btn btn-outline ws-btn ws-btn-danger" data-action="delete">Delete</button>' +
                    '</span>' +
                '</div>';
            });
            listEl.innerHTML = html;
        }

        function preview() {
            var yamlEl = getEl('wsYaml');
            if (!yamlEl || !yamlEl.value.trim()) { showError('请先粘贴 workflow YAML'); return; }
            clearError();
            // body 传对象，helper 里统一 JSON.stringify（也统一补租户头）
            agentflowFetch('/workflows/preview', {
                method: 'POST',
                body: { yaml: yamlEl.value }
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) {
                        showError('解析失败: ' + (data.detail || res.status));
                        throw new Error('preview failed');
                    }
                    canvas.render(data.graph);
                });
            }).catch(function (err) {
                if (err && err.message === 'preview failed') return;
                showError('预览失败: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function save() {
            var nameEl = getEl('wsName');
            var yamlEl = getEl('wsYaml');
            var name = (nameEl && nameEl.value || '').trim();
            var yamlText = yamlEl ? yamlEl.value : '';
            if (!name) { showError('请填写 workflow 名称'); if (nameEl) nameEl.focus(); return; }
            if (!yamlText.trim()) { showError('请粘贴 workflow YAML'); if (yamlEl) yamlEl.focus(); return; }
            clearError();
            var path = '/workflows' + (editingId ? '/' + editingId : '');
            var method = editingId ? 'PUT' : 'POST';
            agentflowFetch(path, {
                method: method,
                body: { name: name, yaml: yamlText }
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) {
                        showError('保存失败: ' + (data.detail || res.status));
                        throw new Error('save failed');
                    }
                    editingId = data.id;
                    setText('wsSaveBtn', 'Save Workflow');
                    loadWorkflows();
                    canvas.render(data.graph);
                });
            }).catch(function (err) {
                if (err && err.message === 'save failed') return;
                showError('保存失败: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function edit(wid) {
            clearError();
            agentflowFetch('/workflows/' + wid).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (data) {
                editingId = data.id;
                getEl('wsName').value = data.name || '';
                getEl('wsYaml').value = data.yaml || '';
                setText('wsSaveBtn', 'Update Workflow');
                canvas.render(data.graph);
            }).catch(function (err) {
                showError('加载失败: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function remove(wid) {
            var label = wid;
            workflows.forEach(function (w) { if (w.id === wid) label = w.name; });
            if (!window.confirm('确认删除 workflow「' + label + '」？')) return;
            clearError();
            agentflowFetch('/workflows/' + wid, { method: 'DELETE' }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function () {
                if (editingId === wid) resetForm();
                loadWorkflows();
            }).catch(function (err) {
                showError('删除失败: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function resetForm() {
            editingId = null;
            var nameEl = getEl('wsName');
            var yamlEl = getEl('wsYaml');
            if (nameEl) nameEl.value = '';
            if (yamlEl) yamlEl.value = '';
            setText('wsSaveBtn', 'Save Workflow');
            clearError();
            canvas.reset();
        }

        function bindEvents() {
            var previewBtn = getEl('wsPreviewBtn');
            if (previewBtn) previewBtn.addEventListener('click', preview);
            var newBtn = getEl('wsNewBtn');
            if (newBtn) newBtn.addEventListener('click', resetForm);
            var saveBtn = getEl('wsSaveBtn');
            if (saveBtn) saveBtn.addEventListener('click', save);
            var refreshBtn = getEl('wsRefreshBtn');
            if (refreshBtn) refreshBtn.addEventListener('click', function () {
                var self = this;
                self.classList.add('spinning');
                self.disabled = true;
                loadWorkflows();
                setTimeout(function () { self.classList.remove('spinning'); self.disabled = false; }, 600);
            });
            var listEl = getEl('wsList');
            if (listEl) listEl.addEventListener('click', function (e) {
                var btn = e.target;
                if (!btn || btn.tagName !== 'BUTTON') return;
                var item = btn.closest('.ws-list-item');
                if (!item) return;
                var wid = item.getAttribute('data-wid');
                if (btn.getAttribute('data-action') === 'edit') edit(wid);
                else if (btn.getAttribute('data-action') === 'delete') remove(wid);
            });
            // 缩放/平移事件由 createGraphCanvas 统一绑定（滚轮、拖拽、+/−/Fit）
        }

        // 切回本页时自动刷新已保存列表
        _pageRefreshers['page-workflow-studio'] = function () { loadWorkflows(); };

        bindEvents();
        loadWorkflows();
    }

    // ── Bug Solve（选流程 → 贴 Ticket → 跑 run → 轮询 → 审批 → 节点详情）──
    function initBugSolve() {
        var BS_API_BASE = localStorage.getItem('bugSolveBaseUrl') || localStorage.getItem('workflowBaseUrl') || 'http://localhost:8000';

        var workflows = [];
        var workflowId = null;
        var runId = null;
        var runStatus = null;
        var running = false;
        var timer = null;
        var pendingApprovals = [];
        var selectedNode = null;
        var currentNodeData = null;
        var currentGraph = null;
        var detailTab = 'output';
        var autoFollow = true;  // 自动跟随当前执行节点进右侧详情；用户点选后停止

        function getEl(id) { return document.getElementById(id); }
        function setText(id, val) {
            var el = getEl(id);
            if (el) el.textContent = String(val);
        }
        function showError(msg) {
            var err = getEl('bsError');
            if (!err) return;
            err.textContent = msg;
            err.style.display = 'block';
        }
        function clearError() {
            var err = getEl('bsError');
            if (err) err.style.display = 'none';
        }

        // 左侧「当前节点」：running 节点（并行取第一个）→ "id (agent)"；否则按 run 状态给提示
        function updateStep(runNid, graph, status) {
            var el = getEl('bsStep');
            if (!el) return;
            if (runNid) {
                var agent = '';
                if (graph && graph.nodes) {
                    for (var i = 0; i < graph.nodes.length; i++) {
                        if (graph.nodes[i].id === runNid && graph.nodes[i].agent) {
                            agent = ' (' + graph.nodes[i].agent + ')';
                            break;
                        }
                    }
                }
                el.textContent = runNid + agent;
            } else if (status === 'waiting_approval') {
                el.textContent = '待审批';
            } else if (status === 'success' || status === 'failed' || status === 'cancelled') {
                el.textContent = '—';
            } else {
                el.textContent = '排队中…';
            }
        }

        // 节点状态 → 着色类名
        function statusClass(st) {
            var map = {
                'done': 'bs-node-status-done',
                'running': 'bs-node-status-running',
                'pending': 'bs-node-status-pending',
                'failed': 'bs-node-status-failed',
                'cancelled': 'bs-node-status-cancelled',
                'rejected': 'bs-node-status-rejected',
                'waiting_approval': 'bs-node-status-waiting',
                'skipped': 'bs-node-status-skipped'
            };
            return map[st] || 'bs-node-status-pending';
        }

        var canvas = createGraphCanvas({
            hintId: 'bsHint', zoomId: 'bsZoom', svgId: 'bsGraph',
            controlsId: 'bsZoomControls', controlsCls: 'bs-zoom-controls',
            zoomInId: 'bsZoomIn', zoomOutId: 'bsZoomOut', zoomFitId: 'bsZoomFit',
            markerId: 'bsArrow', nodeCls: 'bs-node', edgeCls: 'bs-edge',
            nodeStyle: function (n, st) {
                var cls = statusClass(st);
                if (n.kind === 'approval') cls += ' bs-node-approval';
                return { cls: cls, label: n.id + (n.agent ? ' (' + n.agent + ')' : '') };
            },
            onNodeClick: function (nid) { selectNode(nid); }
        });

        function loadWorkflows() {
            fetch(BS_API_BASE + '/workflows').then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (data) {
                workflows = Array.isArray(data) ? data : [];
                if (workflowId) {
                    var exists = workflows.some(function (w) { return w.id === workflowId; });
                    if (!exists) workflowId = null;
                }
                renderWorkflowOptions();
            }).catch(function (err) {
                showError('加载流程失败: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function renderWorkflowOptions() {
            var sel = getEl('bsWorkflow');
            if (!sel) return;
            var html = '<option value="">-- 选择已保存流程 --</option>';
            workflows.forEach(function (w) {
                var selAttr = (w.id === workflowId) ? ' selected' : '';
                html += '<option value="' + escapeHtml(w.id) + '"' + selAttr + '>' + escapeHtml(w.name) + '</option>';
            });
            sel.innerHTML = html;
        }

        function onWorkflowChange() {
            var sel = getEl('bsWorkflow');
            workflowId = sel ? sel.value : null;
            resetRun();
            if (!workflowId) { canvas.reset(); return; }
            fetch(BS_API_BASE + '/workflows/' + workflowId).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (data) {
                if (data.graph) canvas.render(data.graph, {});
            }).catch(function (err) {
                showError('加载流程详情失败: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function parseTicket() {
            var ta = getEl('bsTicket');
            var text = ta ? (ta.value || '').trim() : '';
            if (!text) return {};
            try {
                var obj = JSON.parse(text);
                if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('需为 JSON 对象');
                return obj;
            } catch (e) {
                showError('Ticket JSON 解析失败: ' + e.message);
                return null;
            }
        }

        function start() {
            clearError();
            if (!workflowId) { showError('请先选择已保存流程'); return; }
            var ticket = parseTicket();
            if (ticket === null) return;
            if (running) return;
            running = true;
            autoFollow = true;  // 新 run 重新自动跟随当前执行节点
            var startBtn = getEl('bsStartBtn');
            if (startBtn) startBtn.disabled = true;
            var stopBtn = getEl('bsStopBtn');
            if (stopBtn) stopBtn.style.display = '';
            setText('bsStatus', 'started');
            setText('bsStep', '排队中…');
            var stats = getEl('bsStats');
            if (stats) stats.style.display = 'flex';
            fetch(BS_API_BASE + '/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow_id: workflowId, ticket: ticket })
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
                    runId = data.run_id;
                    setText('bsRunId', runId);
                    poll();
                });
            }).catch(function (err) {
                showError('启动失败: ' + (err && err.message ? err.message : 'network error'));
                running = false;
                if (startBtn) startBtn.disabled = false;
                if (stopBtn) stopBtn.style.display = 'none';
            });
        }

        function poll() {
            if (!running || !runId) return;
            if (timer) clearInterval(timer);
            timer = setInterval(function () {
                fetch(BS_API_BASE + '/runs/' + runId).then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                }).then(function (data) {
                    applyRun(data);
                }).catch(function (err) {
                    var errEl = getEl('bsError');
                    if (errEl) {
                        errEl.textContent = '轮询失败: ' + (err && err.message ? err.message : 'network error');
                        errEl.style.display = 'block';
                    }
                });
            }, 2000);
        }

        function applyRun(data) {
            if (!runId || data.run_id !== runId) return;
            runStatus = data.status;
            setText('bsStatus', data.status);
            setText('bsTokens', data.total_tokens || 0);
            setText('bsCost', typeof data.total_cost === 'number' ? data.total_cost.toFixed(4) : '0.0');
            pendingApprovals = data.pending_approvals || [];
            currentNodeData = data.nodes || {};
            if (data.graph) currentGraph = data.graph;

            var statusMap = {};
            Object.keys(currentNodeData).forEach(function (nid) {
                statusMap[nid] = currentNodeData[nid].status;
            });
            // 当前执行节点（并行 running 取第一个）→ 左侧「当前节点」提示
            var runNid = Object.keys(statusMap).filter(function (nid) { return statusMap[nid] === 'running'; })[0] || null;
            updateStep(runNid, data.graph || currentGraph, data.status);
            canvas.render(data.graph || currentGraph, statusMap);
            renderApprovals();
            // 自动跟随：运行中把右侧详情切到正在跑的节点（output 尚 null → renderDetail 显示执行中）
            if (autoFollow && runNid) selectedNode = runNid;
            if (selectedNode && currentNodeData[selectedNode]) {
                renderDetail(selectedNode);
            } else if (selectedNode) {
                selectedNode = null;
                renderDetail(null);
            }

            var terminal = { success: 1, failed: 1, cancelled: 1 };
            if (terminal[data.status]) {
                running = false;
                if (timer) { clearInterval(timer); timer = null; }
                var startBtn = getEl('bsStartBtn');
                if (startBtn) startBtn.disabled = false;
                var stopBtn = getEl('bsStopBtn');
                if (stopBtn) stopBtn.style.display = 'none';
            }
        }

        function stop() {
            clearError();
            if (!runId) return;
            if (timer) { clearInterval(timer); timer = null; }
            fetch(BS_API_BASE + '/runs/' + runId + '/stop', { method: 'POST' }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function () {
                running = false;
                var startBtn = getEl('bsStartBtn');
                if (startBtn) startBtn.disabled = false;
                var stopBtn = getEl('bsStopBtn');
                if (stopBtn) stopBtn.style.display = 'none';
                setText('bsStatus', 'cancelled');
                // 停止后拉一次最终状态，刷新节点着色（cancelled 落图）
                return fetch(BS_API_BASE + '/runs/' + runId).then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                }).then(function (data) {
                    applyRun(data);
                });
            }).catch(function (err) {
                showError('停止失败: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function approve(nodeId) {
            if (!runId || !nodeId) return;
            fetch(BS_API_BASE + '/runs/' + runId + '/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: nodeId })
            }).then(function (res) {
                if (!res.ok) return res.json().then(function (d) { throw new Error(d.detail || ('HTTP ' + res.status)); });
                return res.json();
            }).then(function () {
                pendingApprovals = pendingApprovals.filter(function (p) { return p.node_id !== nodeId; });
                renderApprovals();
            }).catch(function (err) {
                showError('审批失败: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function reject(nodeId) {
            if (!runId || !nodeId) return;
            fetch(BS_API_BASE + '/runs/' + runId + '/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: nodeId })
            }).then(function (res) {
                if (!res.ok) return res.json().then(function (d) { throw new Error(d.detail || ('HTTP ' + res.status)); });
                return res.json();
            }).then(function () {
                pendingApprovals = pendingApprovals.filter(function (p) { return p.node_id !== nodeId; });
                renderApprovals();
            }).catch(function (err) {
                showError('驳回失败: ' + (err && err.message ? err.message : 'network error'));
            });
        }

        function renderApprovals() {
            var wrap = getEl('bsApprovals');
            if (!wrap) return;
            if (!pendingApprovals || pendingApprovals.length === 0) {
                wrap.innerHTML = '<div class="bs-list-empty">暂无待审批项。</div>';
                return;
            }
            var html = '';
            pendingApprovals.forEach(function (p) {
                var trigger = p.trigger ? escapeHtml(p.trigger) : null;
                var triggerHtml = trigger
                    ? '<span class="bs-trigger">' + trigger + '</span>'
                    : '<span class="bs-trigger bs-trigger-plain">人工审批</span>';
                var upstreamHtml = '';
                if (p.upstream) {
                    Object.keys(p.upstream).forEach(function (u) {
                        var out = p.upstream[u];
                        upstreamHtml += '<div class="bs-upstream"><div class="bs-upstream-label">' + escapeHtml(u) + '</div><pre>' +
                            escapeHtml(JSON.stringify(out, null, 2)) + '</pre></div>';
                    });
                }
                html += '<div class="bs-approval-card" data-node="' + escapeHtml(p.node_id) + '">' +
                    '<div class="bs-approval-head"><span class="bs-approval-node">' + escapeHtml(p.node_id) + '</span>' + triggerHtml + '</div>' +
                    (upstreamHtml ? '<div class="bs-upstreams">' + upstreamHtml + '</div>' : '') +
                    '<div class="bs-approval-actions">' +
                        '<button class="btn btn-sm bs-approve-btn" data-action="approve" data-node="' + escapeHtml(p.node_id) + '">通过</button>' +
                        '<button class="btn btn-sm bs-reject-btn" data-action="reject" data-node="' + escapeHtml(p.node_id) + '">驳回</button>' +
                    '</div>' +
                '</div>';
            });
            wrap.innerHTML = html;
        }

        function selectNode(nid) {
            autoFollow = false;  // 用户手动点选 → 停止自动跟随当前执行节点
            selectedNode = nid;
            renderDetail(nid);
        }

        function renderDetail(nid) {
            var detail = getEl('bsDetail');
            if (!detail) return;
            if (!nid || !currentNodeData || !currentNodeData[nid]) {
                detail.innerHTML = '<div class="bs-detail-empty">点击图中节点查看详情。</div>';
                return;
            }
            var n = currentNodeData[nid];
            var st = n.status || 'pending';
            var badge = '<span class="bs-badge bs-badge-' + st + '">' + escapeHtml(st) + '</span>';
            var tokens = n.tokens || 0;
            var cost = typeof n.cost === 'number' ? n.cost.toFixed(4) : '0.0';
            var params = n.params || {};
            var output = n.output;
            var outputHtml = st === 'running'
                ? '(执行中…)'  // running 节点 output 尚未产出，实时自动跟随时给「正在执行」反馈
                : (output !== undefined && output !== null) ? JSON.stringify(output, null, 2) : '(无输出)';
            var promptHtml = JSON.stringify(params, null, 2);

            var tabActive = detailTab || 'output';
            var outputActive = tabActive === 'output' ? 'active' : '';
            var promptActive = tabActive === 'prompt' ? 'active' : '';

            detail.innerHTML =
                '<div class="bs-detail-head">' +
                    '<span class="bs-detail-node">' + escapeHtml(nid) + '</span>' + badge +
                    '<span class="bs-detail-meta">tokens ' + tokens + ' · cost ' + cost + '</span>' +
                '</div>' +
                '<div class="bs-tabs">' +
                    '<button class="bs-tab ' + outputActive + '" data-tab="output">输出 Output</button>' +
                    '<button class="bs-tab ' + promptActive + '" data-tab="prompt">输入 Prompt</button>' +
                '</div>' +
                '<div class="bs-content">' +
                    (tabActive === 'output'
                        ? '<pre>' + escapeHtml(outputHtml) + '</pre>'
                        : '<pre>' + escapeHtml(promptHtml) + '</pre>') +
                '</div>';
        }

        function resetRun() {
            if (timer) { clearInterval(timer); timer = null; }
            running = false;
            autoFollow = true;
            runId = null;
            runStatus = null;
            pendingApprovals = [];
            selectedNode = null;
            currentNodeData = null;
            currentGraph = null;
            detailTab = 'output';
            var startBtn = getEl('bsStartBtn');
            if (startBtn) startBtn.disabled = false;
            var stopBtn = getEl('bsStopBtn');
            if (stopBtn) stopBtn.style.display = 'none';
            var stats = getEl('bsStats');
            if (stats) stats.style.display = 'none';
            setText('bsRunId', '—');
            setText('bsStatus', '—');
            setText('bsStep', '—');
            setText('bsTokens', '0');
            setText('bsCost', '0.0');
            renderApprovals();
            renderDetail(null);
        }

        function bindEvents() {
            var sel = getEl('bsWorkflow');
            if (sel) sel.addEventListener('change', onWorkflowChange);
            var startBtn = getEl('bsStartBtn');
            if (startBtn) startBtn.addEventListener('click', start);
            var stopBtn = getEl('bsStopBtn');
            if (stopBtn) stopBtn.addEventListener('click', stop);
            var refreshBtn = getEl('bsRefreshBtn');
            if (refreshBtn) refreshBtn.addEventListener('click', function () {
                var self = this;
                self.classList.add('spinning');
                self.disabled = true;
                loadWorkflows();
                setTimeout(function () { self.classList.remove('spinning'); self.disabled = false; }, 600);
            });
            var approvals = getEl('bsApprovals');
            if (approvals) approvals.addEventListener('click', function (e) {
                var btn = e.target;
                if (!btn || btn.tagName !== 'BUTTON') return;
                var nodeId = btn.getAttribute('data-node');
                var action = btn.getAttribute('data-action');
                if (action === 'approve') approve(nodeId);
                else if (action === 'reject') reject(nodeId);
            });
            var detail = getEl('bsDetail');
            if (detail) detail.addEventListener('click', function (e) {
                var tab = e.target;
                if (!tab || tab.tagName !== 'BUTTON' || !tab.classList.contains('bs-tab')) return;
                detailTab = tab.getAttribute('data-tab');
                renderDetail(selectedNode);
            });
        }

        // 切回本页时自动刷新已保存流程列表
        _pageRefreshers['page-bug-solve'] = function () { loadWorkflows(); };

        bindEvents();
        loadWorkflows();
    }

    // ── MCP Server 配置（配置通用 MCP server → 绑 agent → 测试连接 / 工具列表）──
    function initMcpServers() {
        // 后端地址（可配置）：默认 http://localhost:8000。可用 localStorage 覆盖：mcpBaseUrl（否则沿用 workflowBaseUrl）。
        var MCP_API_BASE = localStorage.getItem('mcpBaseUrl') || localStorage.getItem('workflowBaseUrl') || 'http://localhost:8000';

        var servers = [];
        var editingId = null;     // 当前编辑的 server id；null = New
        var currentTools = null;  // 本次模态框会话最近一次「测试连接」成功探测的工具；保存时随 body 提交 → 落 tools 快照列
        var currentSearch = '';
        var saving = false;       // Save 提交进行中，防止重复点击
        var tested = false;       // 当前表单配置是否已通过一次成功的「测试连接」——Save 唯一解锁条件
        var testing = false;      // 「测试连接」请求进行中
        var dirtyWhileTesting = false;  // 测试期间表单被改动 → 该次结果作废，需重测

        function getEl(id) { return document.getElementById(id); }
        function setText(id, val) {
            var el = getEl(id);
            if (el) el.textContent = String(val);
        }
        function showError(msg) {
            var err = getEl('mcpError');
            if (!err) return;
            err.textContent = msg;
            err.style.display = 'block';
        }
        function clearError() {
            var err = getEl('mcpError');
            if (err) err.style.display = 'none';
        }
        function transport() { return (getEl('mcpTransport') || {}).value || 'stdio'; }
        function stateful() { return transport() === 'stdio' ? true : !!getEl('mcpHttpStateful').checked; }

        // 逗号/空格/换行（args 按行）切分为数组，去空去重
        function splitList(raw, byNewline) {
            if (!raw) return [];
            var sep = byNewline ? /\n/ : /[\s,，\n]+/;
            var out = [], seen = {};
            String(raw).split(sep).forEach(function (t) {
                t = (t || '').trim();
                if (t && !seen[t]) { seen[t] = true; out.push(t); }
            });
            return out;
        }

        // 按 transport 从表单读 config JSON
        function readConfig() {
            if (transport() === 'stdio') {
                var cfg = { command: (getEl('mcpStdioCommand').value || '').trim() };
                var args = splitList(getEl('mcpStdioArgs').value, true);
                if (args.length) cfg.args = args;
                var cwd = (getEl('mcpStdioCwd').value || '').trim();
                if (cwd) cfg.cwd = cwd;
                return cfg;
            }
            var hcfg = { url: (getEl('mcpHttpUrl').value || '').trim() };
            var headersRaw = (getEl('mcpHttpHeaders').value || '').trim();
            if (headersRaw) {
                try { hcfg.headers = JSON.parse(headersRaw); }
                catch (e) { throw new Error('HTTP Headers 不是合法 JSON：' + e.message); }
            }
            return hcfg;
        }

        function toolLists() {
            return {
                enable: splitList(getEl('mcpEnableTools').value, false),
                disable: splitList(getEl('mcpDisableTools').value, false)
            };
        }

        // 表单 → 完整 row（POST/PUT）。刻意不带 agents：本页不再以 server 为主表做 agent 绑定
        // （后续将以 agent 为主表），后端 _to_row 缺省 agents=[]。
        function buildBody() {
            var cfg;
            try { cfg = readConfig(); } catch (e) { showError(e.message); return null; }
            var name = (getEl('mcpName').value || '').trim();
            if (!name) { showError('请填写 server 名称'); getEl('mcpName').focus(); return null; }
            if (transport() === 'stdio' && !cfg.command) { showError('stdio 配置需提供 command'); getEl('mcpStdioCommand').focus(); return null; }
            if (transport() === 'http' && !cfg.url) { showError('http 配置需提供 url'); getEl('mcpHttpUrl').focus(); return null; }
            var tl = toolLists();
            return {
                name: name,
                transport: transport(),
                config: cfg,
                is_stateful: stateful(),
                enable_tools: tl.enable.length ? tl.enable : null,
                disable_tools: tl.disable.length ? tl.disable : null,
                tools: currentTools,  // 测试成功 → 随保存落快照；null → create 自动拉 / update 保留已存
                enabled: !!getEl('mcpEnabled').checked
            };
        }

        // 「测试连接」请求体（不落库）
        function buildTestBody() {
            var cfg;
            try { cfg = readConfig(); } catch (e) { showError(e.message); return null; }
            if (transport() === 'stdio' && !cfg.command) { showError('stdio 配置需提供 command'); return null; }
            if (transport() === 'http' && !cfg.url) { showError('http 配置需提供 url'); return null; }
            var tl = toolLists();
            var name = (getEl('mcpName').value || '').trim();
            var body = {
                transport: transport(),
                config: cfg,
                is_stateful: stateful(),
                enable_tools: tl.enable.length ? tl.enable : null,
                disable_tools: tl.disable.length ? tl.disable : null
            };
            // 带上已填的 server 名 → 探测出的工具 LLM 名(mcp__{name}__…)与实际保存后一致
            if (name) body.name = name;
            return body;
        }

        // 切换 transport 字段可见性（stdio/http 两组 config 卡片）
        function setTransportUi() {
            var t = transport();
            var stdio = getEl('mcpFieldsStdio');
            var http = getEl('mcpFieldsHttp');
            if (stdio) stdio.style.display = t === 'stdio' ? '' : 'none';
            if (http) http.style.display = t === 'http' ? '' : 'none';
        }

        // ── Modal open / close ──
        function openModal() {
            getEl('mcpModalOverlay').classList.add('open');
        }
        function closeModal() {
            getEl('mcpModalOverlay').classList.remove('open');
        }
        function setFormHint() {
            var hint = getEl('mcpFormHint');
            if (!hint) return;
            if (editingId) {
                var nm = (getEl('mcpName').value || '').trim();
                hint.textContent = nm ? 'Editing ' + nm : 'Editing ' + editingId;
            } else {
                hint.textContent = 'New Server';
            }
        }

        // ── 测试/工具结果渲染（POST /test 与 GET /{mid}/tools 同形状 {ok,transport,tools,error?}）──
        function toolItemHtml(t) {
            var ro = t.read_only ? '只读 · 自动 ALLOW' : '非只读 · 需 allow 规则';
            var roCls = t.read_only ? 'mcp-ro-allow' : 'mcp-ro-deny';
            return '<div class="mcp-tool-item">' +
                '<div class="mcp-tool-head"><span class="mcp-tool-name">' + escapeHtml(t.name) + '</span>' +
                '<span class="mcp-ro-badge ' + roCls + '">' + ro + '</span></div>' +
                '<div class="mcp-tool-llm">' + escapeHtml(t.llm_name || '') + '</div>' +
                (t.description ? '<div class="mcp-tool-desc">' + escapeHtml(t.description) + '</div>' : '') +
                '</div>';
        }

        function writeResultEmpty() {
            var bodyEl = getEl('mcpResultBody');
            var meta = getEl('mcpResultMeta');
            if (bodyEl) bodyEl.innerHTML = '<span class="text-secondary">填写配置后点「测试连接」探测工具。只读工具自动 ALLOW；非只读工具需在 agent 侧配置 allow 规则。</span>';
            if (meta) meta.textContent = '';
        }

        // capture=true（默认）：成功时把工具记入 currentTools，供随后的「保存」落 tools 快照列
        function renderTools(data, capture) {
            var bodyEl = getEl('mcpResultBody');
            var meta = getEl('mcpResultMeta');
            if (!bodyEl) return;
            if (!data || data.ok !== true) {
                currentTools = null;
                if (meta) meta.textContent = '';
                bodyEl.innerHTML = '<div class="mcp-result-error">连接失败：' + escapeHtml((data && data.error) ? data.error : '未知错误') + '</div>';
                return;
            }
            var tools = data.tools || [];
            if (capture !== false) currentTools = tools;
            if (meta) meta.textContent = 'transport=' + String(data.transport || '') + ' · ' + tools.length + ' tools';
            if (tools.length === 0) {
                bodyEl.innerHTML = '<span class="text-secondary">连接成功，但该 server 未暴露任何工具。</span>';
                return;
            }
            bodyEl.innerHTML = '<div class="mcp-tools">' + tools.map(toolItemHtml).join('') + '</div>';
        }

        // 展示一条 server 已存 tools 快照（从 DB 读，非 live；Edit 打开时离线可见）
        function renderCachedTools(s) {
            var bodyEl = getEl('mcpResultBody');
            var meta = getEl('mcpResultMeta');
            if (!bodyEl) return;
            currentTools = null;  // 快照不当作本次会话的 live 探测结果
            var tools = Array.isArray(s.tools) ? s.tools : [];
            if (meta) meta.textContent = '工具快照（已存缓存）· ' + tools.length + ' tools · 需要最新请点「测试连接」';
            if (tools.length === 0) {
                bodyEl.innerHTML = '<span class="text-secondary">该 server 暂无已存工具快照（点「测试连接」实时拉取并落库）。</span>';
                return;
            }
            bodyEl.innerHTML = '<div class="mcp-tools">' + tools.map(toolItemHtml).join('') + '</div>';
        }

        // ── 列表（table）──
        function loadOverlay(show) {
            var ov = getEl('mcpLoadingOverlay');
            if (ov) ov.classList.toggle('visible', !!show);
        }

        function loadServers() {
            clearError();
            loadOverlay(true);
            fetch(MCP_API_BASE + '/mcp-servers').then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (data) {
                servers = Array.isArray(data) ? data : [];
                renderList();
            }).catch(function (err) {
                window._showToast('加载 MCP server 列表失败: ' + (err && err.message ? err.message : 'network error'), 'error');
            }).finally(function () { loadOverlay(false); });
        }

        function findServer(mid) {
            for (var i = 0; i < servers.length; i++) { if (servers[i].id === mid) return servers[i]; }
            return null;
        }

        function transportLabel(s) {
            if (s.transport === 'stdio') return 'stdio';
            return s.is_stateful ? 'http (stateful)' : 'http';
        }

        // ISO 时间戳 → 'YYYY-MM-DD HH:MM'（本地展示用；缺省返回 ''）
        function fmtTs(iso) {
            if (!iso) return '';
            var s = String(iso).replace('T', ' ');
            return s.indexOf('.') !== -1 ? s.slice(0, 19) : s;
        }

        function renderList() {
            var tbody = getEl('mcpTableBody');
            if (!tbody) return;
            var filtered = servers.filter(function (s) {
                if (!currentSearch) return true;
                var name = (s.name || '').toLowerCase();
                var tr = transportLabel(s).toLowerCase();
                return name.indexOf(currentSearch) !== -1 || tr.indexOf(currentSearch) !== -1;
            });
            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="mcp-table-empty">' +
                    (servers.length ? 'No MCP servers match your search.' : 'No saved MCP servers yet. Click "New" in the top-right to create one.') +
                    '</td></tr>';
                setText('mcpRowCount', '0');
                return;
            }
            tbody.innerHTML = filtered.map(function (s) {
                var created = fmtTs(s.created_at);
                var toolsHtml;
                if (Array.isArray(s.tools)) {
                    toolsHtml = s.tools.length
                        ? '<span class="apm-badge apm-badge-on">' + s.tools.length + ' tools</span>'
                        : '<span class="text-secondary">0 tools</span>';
                } else {
                    // tools=null → 从未成功探测（或最近一次失败）：置灰 + 显示最近更新时间（updated_at）
                    var lastUpd = fmtTs(s.updated_at);
                    toolsHtml = '<span class="mcp-unprobed">not probed / failed</span>' +
                        (lastUpd ? '<div class="mcp-list-hint">' + escapeHtml(lastUpd) + '</div>' : '');
                }
                var enabledHtml = s.enabled
                    ? '<span class="apm-badge apm-badge-on">enabled</span>'
                    : '<span class="apm-badge apm-badge-off">disabled</span>';
                // Tool Names 列：展示存储快照里所有工具名（逗号分隔，超宽 …截断，hover 看全）
                var toolNames = (Array.isArray(s.tools) ? s.tools : [])
                    .map(function (t) { return t && t.name ? t.name : ''; })
                    .filter(Boolean);
                var joinedNames = toolNames.join(', ');
                var namesCell = toolNames.length
                    ? '<td class="mcp-tools-names" title="' + escapeHtml(joinedNames) + '">' + escapeHtml(joinedNames) + '</td>'
                    : '<td class="mcp-tools-names"><span class="text-secondary">\u2014</span></td>';
                return '<tr data-id="' + escapeHtml(s.id) + '">' +
                    '<td class="mcp-server-name">' + escapeHtml(s.name) + '</td>' +
                    '<td>' + escapeHtml(transportLabel(s)) + '</td>' +
                    '<td>' + toolsHtml + '</td>' +
                    '<td>' + enabledHtml + '</td>' +
                    '<td>' + escapeHtml(created) + '</td>' +
                    namesCell +
                    '<td class="apm-actions">' +
                        '<button class="btn btn-outline apm-row-btn" data-act="edit">Edit</button>' +
                        '<button class="btn btn-outline apm-row-btn" data-act="test">Test</button>' +
                        '<button class="btn apm-row-btn apm-row-del" data-act="del">Delete</button>' +
                    '</td>' +
                    '</tr>';
            }).join('');
            setText('mcpRowCount', String(filtered.length));
        }

        // ── 表单填充 / 清空 ──
        function fillForm(s) {
            editingId = s.id;
            getEl('mcpName').value = s.name || '';
            getEl('mcpTransport').value = s.transport || 'stdio';
            setTransportUi();
            var cfg = s.config || {};
            if (s.transport === 'stdio') {
                getEl('mcpStdioCommand').value = cfg.command || '';
                getEl('mcpStdioArgs').value = Array.isArray(cfg.args) ? cfg.args.join('\n') : (cfg.args ? String(cfg.args) : '');
                getEl('mcpStdioCwd').value = cfg.cwd || '';
            } else {
                getEl('mcpHttpUrl').value = cfg.url || '';
                getEl('mcpHttpHeaders').value = cfg.headers ? JSON.stringify(cfg.headers, null, 2) : '';
                getEl('mcpHttpStateful').checked = !!s.is_stateful;
            }
            getEl('mcpEnabled').checked = s.enabled !== false;
            getEl('mcpEnableTools').value = Array.isArray(s.enable_tools) ? s.enable_tools.join(', ') : '';
            getEl('mcpDisableTools').value = Array.isArray(s.disable_tools) ? s.disable_tools.join(', ') : '';
            currentTools = null;
            renderCachedTools(s);  // 打开即先展示已存快照（非 live）
            setFormHint();
            clearError();
            // Edit：先展示缓存快照；无论是否改动，未重新测试成功前 Save 均不可用
            tested = false;
            setSaveHint('lock', '已展示缓存快照。请点「测试连接」验证当前配置，测试成功后才能保存。');
            syncSaveBtn();
        }

        function resetForm() {
            editingId = null;
            getEl('mcpName').value = '';
            getEl('mcpTransport').value = 'stdio';
            setTransportUi();
            getEl('mcpStdioCommand').value = '';
            getEl('mcpStdioArgs').value = '';
            getEl('mcpStdioCwd').value = '';
            getEl('mcpHttpUrl').value = '';
            getEl('mcpHttpHeaders').value = '';
            getEl('mcpHttpStateful').checked = false;
            getEl('mcpEnabled').checked = true;
            getEl('mcpEnableTools').value = '';
            getEl('mcpDisableTools').value = '';
            currentTools = null;
            writeResultEmpty();
            setFormHint();
            clearError();
            // New：未测试前 Save 不可用
            tested = false;
            setSaveHint('lock', '请填写配置并点「测试连接」，测试成功后才能保存。');
            syncSaveBtn();
        }

        // ── Save 门控（必须「测试连接」成功才能保存）──

        // 需触发「重测」的字段：任一被改动 → tested=false、Save 锁回、结果区清空。
        // mcpTransport 走 <select> 的 change，也会经冒泡到这里统一处理。
        var MCP_FIELD_IDS = ['mcpName', 'mcpTransport', 'mcpStdioCommand', 'mcpStdioArgs', 'mcpStdioCwd',
            'mcpHttpUrl', 'mcpHttpHeaders', 'mcpHttpStateful', 'mcpEnabled', 'mcpEnableTools', 'mcpDisableTools'];

        // Save 按钮唯一解锁条件：!saving && !testing && tested
        function syncSaveBtn() {
            var btn = getEl('mcpSaveBtn');
            if (!btn) return;
            btn.disabled = !!(saving || testing || !tested);
        }

        // 按钮下方提示条。kind: lock(默认灰) / ok(绿) / fail(红) / running(琥珀)
        function setSaveHint(kind, msg) {
            var hint = getEl('mcpSaveHint');
            if (!hint) return;
            hint.textContent = msg || '';
            hint.className = 'mcp-save-hint' + (kind ? ' mcp-save-hint-' + kind : '');
        }

        // 任一配置字段被改动 → 上次测试结果不再可信：锁回 Save、清空结果区、提示重测
        function invalidateTest() {
            tested = false;
            currentTools = null;
            writeResultEmpty();
            if (testing) {
                dirtyWhileTesting = true;
                setSaveHint('running', '配置在测试期间已变更，本次结果将作废，请等测试结束后重新点「测试连接」。');
            } else {
                setSaveHint('lock', '配置有改动，请重新点「测试连接」，测试成功后才能保存。');
            }
            syncSaveBtn();
        }

        // ── Actions ──
        function testConnection() {
            if (testing) return;
            var body = buildTestBody();
            if (!body) return;
            clearError();
            testing = true;
            dirtyWhileTesting = false;
            var testBtn = getEl('mcpTestBtn');
            if (testBtn) { testBtn.disabled = true; testBtn.textContent = 'testing…'; }
            setSaveHint('running', '正在测试连接…');
            syncSaveBtn();
            fetch(MCP_API_BASE + '/mcp-servers/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) return { ok: false, error: data.detail || ('HTTP ' + res.status) };
                    return data;
                });
            }).then(function (data) {
                if (dirtyWhileTesting) {
                    // 测试期间字段被改动：该次结果作废，锁回 Save 提示重测
                    tested = false;
                    setSaveHint('lock', '配置在测试期间已变更，本次结果作废，请重新点「测试连接」。');
                    return;
                }
                if (data && data.ok === true) {
                    tested = true;
                    renderTools(data);   // capture=true → currentTools=tools，随保存落快照
                    setSaveHint('ok', '测试连接成功（' + String(data.transport || '') + ' · ' + (data.tools || []).length + ' tools），可以保存了。');
                } else {
                    tested = false;
                    renderTools({ ok: false, error: (data && data.error) || '未知错误' });
                    setSaveHint('fail', '测试连接失败，无法保存。请修正配置后重新测试。');
                }
            }).catch(function (err) {
                if (!err) return;
                tested = false;
                renderTools({ ok: false, error: err && err.message ? err.message : 'network error' });
                setSaveHint('fail', '测试连接失败（网络或服务错误），无法保存。');
            }).finally(function () {
                testing = false;
                dirtyWhileTesting = false;
                if (testBtn) { testBtn.disabled = false; testBtn.textContent = '测试连接'; }
                syncSaveBtn();
            });
        }

        function save() {
            // 门控：只有当前表单配置通过一次成功的「测试连接」（tested=true）才能保存。
            // 任一字段被改动都会 invalidateTest() 把 tested 置回 false，Save 随之禁用 → 必须重测。
            // currentTools 已在测试成功时捕获（renderTools capture=true）→ tools 随保存落快照；
            // 若 create 时后端自动探测、update 保留旧快照的旧语义由后端 tools=null 兜底。
            if (saving || !tested) return;
            var btn = getEl('mcpSaveBtn');
            var body = buildBody();
            if (!body) return;
            clearError();
            saving = true;
            if (btn) btn.textContent = 'Saving…';
            syncSaveBtn();
            var url = MCP_API_BASE + '/mcp-servers' + (editingId ? '/' + encodeURIComponent(editingId) : '');
            fetch(url, {
                method: editingId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) throw { raw: data.detail || res.status };
                    return data;
                });
            }).then(function (data) {
                var savedId = (data && data.id) || editingId || '';
                window._showToast(editingId ? 'Updated ' + savedId : 'Created ' + savedId, 'success');
                closeModal();
                loadServers();
            }).catch(function (err) {
                if (!err) return;
                var raw = (err.raw !== undefined) ? err.raw : (err.message || 'network error');
                showError('保存失败：' + raw);
            }).finally(function () {
                saving = false;
                if (btn) btn.textContent = 'Save Server';
                syncSaveBtn();
            });
        }

        // 已存行实时探测（GET /{mid}/tools 成功后回写 tools 列并刷新列表徽标）
        function liveProbe(mid) {
            var meta = getEl('mcpResultMeta');
            if (meta) meta.textContent = '拉取中…';
            fetch(MCP_API_BASE + '/mcp-servers/' + encodeURIComponent(mid) + '/tools').then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) {
                        renderTools({ ok: false, error: (data.detail || ('HTTP ' + res.status)) }, false);
                        throw new Error('probe failed');
                    }
                    renderTools(data, false);  // capture=false：live 结果已由后端回写，不当作「待保存」状态
                    loadServers();  // 刷新列表里 tools 数徽标
                });
            }).catch(function (err) {
                if (err && err.message === 'probe failed') return;
                renderTools({ ok: false, error: err && err.message ? err.message : 'network error' }, false);
            });
        }

        function remove(mid) {
            var label = mid;
            servers.forEach(function (s) { if (s.id === mid) label = s.name; });
            if (!window.confirm('确认删除 MCP server「' + label + '」？')) return;
            clearError();
            fetch(MCP_API_BASE + '/mcp-servers/' + encodeURIComponent(mid), { method: 'DELETE' }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function () {
                if (editingId === mid) closeModal();
                window._showToast('Deleted ' + label, 'success');
                loadServers();
            }).catch(function (err) {
                window._showToast('删除失败: ' + (err && err.message ? err.message : 'network error'), 'error');
            });
        }

        // 「全部刷新」：对每个已保存 server 实时 GET /{mid}/tools（成功由后端回写快照；失败保留旧快照），
        // 全部结束后刷新列表 + toast 汇总（X ok / Y failed）。
        function probeAll() {
            if (!servers.length) { window._showToast('No saved servers to probe', 'error'); return; }
            var btn = getEl('mcpProbeAllBtn');
            if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
            var okCount = 0, failCount = 0;
            Promise.all(servers.map(function (s) {
                return fetch(MCP_API_BASE + '/mcp-servers/' + encodeURIComponent(s.id) + '/tools')
                    .then(function (res) {
                        return res.json().then(function (data) {
                            if (!res.ok) { failCount++; return; }
                            if (data && data.ok === true) okCount++;
                            else failCount++;
                        });
                    }).catch(function () { failCount++; });
            })).then(function () {
                loadServers();
                window._showToast('Probe All done: ' + okCount + ' ok / ' + failCount + ' failed',
                    okCount && !failCount ? 'success' : 'error');
            }).finally(function () {
                if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
            });
        }

        function openNew() {
            resetForm();
            openModal();
        }

        function openEdit(mid, probe) {
            var s = findServer(mid);
            if (!s) { loadServers(); return; }
            clearError();
            fillForm(s);
            openModal();
            if (probe) liveProbe(mid);
        }

        // ── Wire events ──
        function bindEvents() {
            var transSel = getEl('mcpTransport');
            if (transSel) transSel.addEventListener('change', function () {
                setTransportUi();
                // 字段变更统一由下方模态框委托处理（invalidateTest：清结果 + 锁回 Save + 提示重测）
            });
            var saveBtn = getEl('mcpSaveBtn');
            if (saveBtn) saveBtn.addEventListener('click', save);
            var testBtn = getEl('mcpTestBtn');
            if (testBtn) testBtn.addEventListener('click', testConnection);
            var resetBtn = getEl('mcpResetBtn');
            if (resetBtn) resetBtn.addEventListener('click', function () { resetForm(); });
            var newBtn = getEl('mcpNewBtn');
            if (newBtn) newBtn.addEventListener('click', openNew);
            var probeAllBtn = getEl('mcpProbeAllBtn');
            if (probeAllBtn) probeAllBtn.addEventListener('click', probeAll);
            var refreshBtn = getEl('mcpRefreshBtn');
            if (refreshBtn) refreshBtn.addEventListener('click', function () {
                var self = this;
                self.classList.add('spinning');
                self.disabled = true;
                loadServers();
                setTimeout(function () { self.classList.remove('spinning'); self.disabled = false; }, 600);
            });
            var tbody = getEl('mcpTableBody');
            if (tbody) tbody.addEventListener('click', function (e) {
                var btn = e.target.closest('button[data-act]');
                if (!btn) return;
                var tr = btn.closest('tr[data-id]');
                if (!tr) return;
                var mid = tr.getAttribute('data-id');
                var act = btn.getAttribute('data-act');
                if (act === 'edit') openEdit(mid, false);
                else if (act === 'test') openEdit(mid, true);
                else if (act === 'del') remove(mid);
            });
            var searchEl = getEl('mcpSearch');
            if (searchEl) searchEl.addEventListener('input', function () {
                var self = this;
                clearTimeout(self._timer);
                self._timer = setTimeout(function () {
                    currentSearch = self.value.trim().toLowerCase();
                    renderList();
                }, 200);
            });
            var closeBtn = getEl('mcpModalClose');
            if (closeBtn) closeBtn.addEventListener('click', closeModal);
            var overlay = getEl('mcpModalOverlay');
            if (overlay) overlay.addEventListener('click', function (e) {
                if (e.target === this) closeModal();
            });
            // 任一配置字段被改动（input/change）→ 上次测试作废：Save 锁回，需重测
            if (overlay) ['input', 'change'].forEach(function (evt) {
                overlay.addEventListener(evt, function (e) {
                    var t = e.target;
                    if (!t || !t.id) return;
                    if (MCP_FIELD_IDS.indexOf(t.id) === -1) return;
                    invalidateTest();
                });
            });
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && getEl('mcpModalOverlay').classList.contains('open')) closeModal();
            });
        }

        // 切回本页时自动刷新已保存列表
        _pageRefreshers['page-mcp-servers'] = function () { loadServers(); };

        setTransportUi();
        bindEvents();
        loadServers();
    }

    // ── Agent 配置（DB 驱动 AgentSpec 覆盖 + agent→MCP server 绑定）──
    function initAgentConfig() {
        // 后端地址（可配置）：默认 http://localhost:8000。可用 localStorage 覆盖：agentConfigBaseUrl（否则沿用 workflowBaseUrl）。
        var AGC_API_BASE = localStorage.getItem('agentConfigBaseUrl') || localStorage.getItem('workflowBaseUrl') || 'http://localhost:8000';

        var agents = [];        // GET /agent-configs 行
        var editingName = null; // 当前编辑的 agent 名；null = New（custom）
        var origin = 'custom';  // 当前表单 origin（builtin | custom）
        var currentSearch = '';
        var saving = false;     // Save 提交进行中，防重复点击
        var mcpServerCache = null;         // GET /mcp-servers 缓存
        var serverOptionsPromise = null;   // 并发去重用

        function getEl(id) { return document.getElementById(id); }
        function setText(id, val) { var el = getEl(id); if (el) el.textContent = String(val); }
        function showError(msg) { var err = getEl('agentCfgError'); if (!err) return; err.textContent = msg; err.style.display = 'block'; }
        function clearError() { var err = getEl('agentCfgError'); if (err) err.style.display = 'none'; }
        function loadOverlay(show) { var ov = getEl('agentCfgLoadingOverlay'); if (ov) ov.classList.toggle('visible', !!show); }
        function setFieldVal(id, val) { var el = getEl(id); if (el) el.value = (val === null || val === undefined) ? '' : String(val); }

        function findAgent(name) {
            for (var i = 0; i < agents.length; i++) { if (agents[i].name === name) return agents[i]; }
            return null;
        }

        // MCP Servers 列文案：bound_servers 空 = 无绑定（两态：没配置就没有 server）；否则绑定 server 名
        function bindText(s) {
            var bserv = (s && Array.isArray(s.bound_servers)) ? s.bound_servers : [];
            if (!bserv.length) return { kind: 'none', text: '' };
            return { kind: 'sub', text: bserv.map(function (b) { return b.name; }).filter(Boolean).join(', ') };
        }

        function renderTable() {
            var tbody = getEl('agentCfgTableBody');
            if (!tbody) return;
            var filtered = agents.filter(function (a) {
                if (!currentSearch) return true;
                var hay = [a.name || '', a.role || '', a.stage || ''].join(' ').toLowerCase();
                return hay.indexOf(currentSearch) !== -1;
            });
            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="agc-table-empty">' +
                    (agents.length ? 'No agents match your search.' : 'No agent configs yet. Click "New Agent" in the top-right to create a custom agent.') +
                    '</td></tr>';
                setText('agentCfgRowCount', '0');
                return;
            }
            tbody.innerHTML = filtered.map(function (a) {
                var isBuiltin = a.origin === 'builtin';
                var originBadge = '<span class="agc-badge ' + (isBuiltin ? 'agc-badge-builtin' : 'agc-badge-custom') + '">' + (isBuiltin ? 'builtin' : 'custom') + '</span>';
                var enabledHtml = a.enabled
                    ? '<span class="apm-badge apm-badge-on">enabled</span>'
                    : '<span class="apm-badge apm-badge-off">disabled</span>';
                var bt = bindText(a);
                var mcpCell;
                if (bt.kind === 'none') mcpCell = '<span class="text-secondary agc-mcp-none" title="无 MCP server：该 agent 没有 MCP 工具（Edit 勾选 server 后生效）">\u2014</span>';
                else mcpCell = '<span class="agc-mcp-names" title="' + escapeHtml(bt.text) + '">' + escapeHtml(bt.text) + '</span>';
                var delBtn = isBuiltin
                    ? '<button class="btn apm-row-btn apm-row-del" data-act="del" disabled title="内置 agent 只能编辑/清空覆盖，不可删除">Delete</button>'
                    : '<button class="btn apm-row-btn apm-row-del" data-act="del">Delete</button>';
                return '<tr data-name="' + escapeHtml(a.name) + '">' +
                    '<td class="agc-name-cell">' + escapeHtml(a.name) + '</td>' +
                    '<td>' + originBadge + '</td>' +
                    '<td>' + escapeHtml(a.role || '') + '</td>' +
                    '<td>' + escapeHtml(a.stage || '') + '</td>' +
                    '<td>' + mcpCell + '</td>' +
                    '<td>' + enabledHtml + '</td>' +
                    '<td class="apm-actions">' +
                        '<button class="btn btn-outline apm-row-btn" data-act="edit">Edit</button>' + delBtn +
                    '</td>' +
                    '</tr>';
            }).join('');
            setText('agentCfgRowCount', String(filtered.length));
        }

        // ── MCP server 绑定卡（懒加载 GET /mcp-servers）──
        function ensureServerOptions() {
            if (mcpServerCache !== null) return Promise.resolve(mcpServerCache);
            if (!serverOptionsPromise) {
                serverOptionsPromise = fetch(AGC_API_BASE + '/mcp-servers').then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                }).then(function (data) {
                    mcpServerCache = Array.isArray(data) ? data : [];
                    return mcpServerCache;
                }).catch(function (err) {
                    window._showToast('加载 MCP server 列表失败: ' + (err && err.message ? err.message : 'network error'), 'error');
                    mcpServerCache = [];
                    return mcpServerCache;
                }).finally(function () {
                    serverOptionsPromise = null;
                });
            }
            return serverOptionsPromise;
        }

        function renderServerCards(selectedIds) {
            var wrap = getEl('agentCfgServerCards');
            if (!wrap) return;
            var opts = mcpServerCache || [];
            if (!opts.length) {
                wrap.innerHTML = '<div class="agc-server-none text-secondary">暂无已保存的 MCP server —— 先在「MCP Server Config」页添加。</div>';
                return;
            }
            var selected = {};
            (Array.isArray(selectedIds) ? selectedIds : []).forEach(function (mid) { selected[mid] = true; });
            wrap.innerHTML = opts.map(function (sv) {
                var off = sv.enabled === false;
                var toolsTxt = Array.isArray(sv.tools) ? String(sv.tools.length) + ' tools' : '';
                return '<label class="agc-server-card' + (off ? ' agc-server-off' : '') + '"' + (off ? ' title="server 已停用（该 agent 拿不到其工具）"' : '') + '>' +
                    '<input type="checkbox" value="' + escapeHtml(sv.id) + '"' + (selected[sv.id] ? ' checked' : '') + '>' +
                    '<span class="agc-server-name">' + escapeHtml(sv.name) + '</span>' +
                    '<span class="agc-server-meta">' + escapeHtml(sv.transport || '') +
                        (toolsTxt ? ' \u00b7 ' + toolsTxt : '') + '</span>' +
                    '</label>';
            }).join('');
        }

        // force=true：打开弹窗后以权威选中集合重绘（先清容器）；否则仅在容器为空时补绘（保留用户勾选）
        function syncBindUi(selectedIds, force) {
            var specific = getEl('agentCfgBindSpecific');
            var wrap = getEl('agentCfgServerCards');
            if (!specific || !wrap) return;
            if (!specific.checked) { wrap.style.display = 'none'; return; }
            wrap.style.display = '';
            if (force || wrap.innerHTML === '') {
                ensureServerOptions().then(function () { renderServerCards(selectedIds || []); });
            }
        }

        function setBindMode(mode, selectedIds, force) {
            var none = getEl('agentCfgBindNone');
            var specific = getEl('agentCfgBindSpecific');
            if (!none || !specific) return;
            none.checked = mode !== 'specific';
            specific.checked = mode === 'specific';
            syncBindUi(selectedIds, !!force);
        }
        function bindMode() {
            var specific = getEl('agentCfgBindSpecific');
            return specific && specific.checked ? 'specific' : 'none';
        }
        function checkedServerIds() {
            var wrap = getEl('agentCfgServerCards');
            var ids = [];
            if (!wrap) return ids;
            var boxes = wrap.querySelectorAll('input[type="checkbox"]:checked');
            for (var i = 0; i < boxes.length; i++) ids.push(boxes[i].value);
            return ids;
        }

        // ── 表单填充 / 清空 ──
        function setOrigin(org) {
            origin = org === 'builtin' ? 'builtin' : 'custom';
            var badge = getEl('agentCfgOriginBadge');
            if (badge) badge.innerHTML = '<span class="agc-badge ' + (origin === 'builtin' ? 'agc-badge-builtin' : 'agc-badge-custom') + '">' + origin + '</span>';
            var req = getEl('agentCfgPromptReq');
            if (req) req.style.display = origin === 'custom' ? '' : 'none';  // custom 必填非空 prompt
        }

        function setDefaults() {
            var desc = getEl('agentCfgDescription');
            var prompt = getEl('agentCfgPrompt');
            var schema = getEl('agentCfgSchema');
            if (desc) desc.setAttribute('placeholder', 'agent 职责一句话描述；留空 = 内置默认');
            if (prompt) prompt.setAttribute('placeholder', '内置留空 = 内置默认；custom 必填');
            if (schema) schema.setAttribute('placeholder', '{"type":"object","properties":{}}');
        }

        function resetForm() {
            editingName = null;
            var nameInput = getEl('agentCfgName');
            if (nameInput) { nameInput.value = ''; nameInput.disabled = false; nameInput.readOnly = false; }
            setOrigin('custom');
            var role = getEl('agentCfgRole');
            if (role) role.value = 'diagnose';
            var stage = getEl('agentCfgStage');
            if (stage) stage.value = 'detect';
            var en = getEl('agentCfgEnabled');
            if (en) en.checked = true;
            setFieldVal('agentCfgDescription', '');
            setFieldVal('agentCfgPrompt', '');
            setFieldVal('agentCfgSchema', '');
            setDefaults();
            var wrap = getEl('agentCfgServerCards');
            if (wrap) wrap.innerHTML = '';
            setBindMode('none', [], false);
            clearError();
        }

        function hintDefaults(d) {
            // 未覆盖的内置字段：把合并有效值放进 placeholder（不写 value，避免误保存成覆盖）
            var stored = d.stored || {};
            var desc = getEl('agentCfgDescription');
            if (desc) desc.setAttribute('placeholder', stored.description ? '' : (d.description || ''));
            var prompt = getEl('agentCfgPrompt');
            if (prompt) prompt.setAttribute('placeholder', stored.system_prompt ? '' : (d.system_prompt || ''));
            var schema = getEl('agentCfgSchema');
            if (schema) schema.setAttribute('placeholder', stored.schema ? '' : (d.schema && Object.keys(d.schema).length ? JSON.stringify(d.schema, null, 2) : ''));
        }

        // GET /agent-configs/{name} 的 stored 覆盖值回填文本；合并有效值仅作 placeholder 提示
        function fillFromDetail(d) {
            editingName = d.name;
            var nameInput = getEl('agentCfgName');
            if (nameInput) { nameInput.value = d.name; nameInput.disabled = true; nameInput.readOnly = true; }
            setOrigin(d.origin);
            var role = getEl('agentCfgRole');
            if (role && d.role) role.value = d.role;
            var stage = getEl('agentCfgStage');
            if (stage && d.stage) stage.value = d.stage;
            var en = getEl('agentCfgEnabled');
            if (en) en.checked = d.enabled !== false;
            var stored = d.stored || {};
            setFieldVal('agentCfgDescription', stored.description);
            setFieldVal('agentCfgPrompt', stored.system_prompt);
            setFieldVal('agentCfgSchema', stored.schema === null || stored.schema === undefined ? '' : JSON.stringify(stored.schema, null, 2));
            var wrap = getEl('agentCfgServerCards');
            if (wrap) wrap.innerHTML = '';
            var ids = d.mcp_server_ids;
            if (Array.isArray(ids)) setBindMode('specific', ids, true);
            else setBindMode('none', [], true);  // NULL/[]（无绑定）→ 不绑定 MCP server
        }

        // ── Modal open / close ──
        function openModal() { var ov = getEl('agentCfgModalOverlay'); if (ov) ov.classList.add('open'); }
        function closeModal() { var ov = getEl('agentCfgModalOverlay'); if (ov) ov.classList.remove('open'); }
        function setFormHint() {
            var hint = getEl('agentCfgFormHint');
            if (!hint) return;
            hint.textContent = editingName ? 'Editing ' + editingName : 'New Agent (custom)';
        }

        function openNew() {
            resetForm();
            setFormHint();
            ensureServerOptions();  // 预拉 server 选项（切换「指定」时即时可用）
            openModal();
        }

        function openEdit(name) {
            clearError();
            fetch(AGC_API_BASE + '/agent-configs/' + encodeURIComponent(name)).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) throw { raw: data.detail || ('HTTP ' + res.status) };
                    return data;
                });
            }).then(function (d) {
                fillFromDetail(d);
                hintDefaults(d);
                setFormHint();
                openModal();
            }).catch(function (err) {
                if (!err) return;
                var raw = (err.raw !== undefined) ? err.raw : (err.message || 'network error');
                window._showToast('加载 agent 配置失败: ' + raw, 'error');
            });
        }

        // 表单 → body（POST 新建 custom / PUT 完整对象覆盖）。"" 文本 → null（清覆盖回退内置）
        function buildBody() {
            var name = (getEl('agentCfgName').value || '').trim();
            var role = getEl('agentCfgRole').value;
            var stage = getEl('agentCfgStage').value;
            var enabled = getEl('agentCfgEnabled').checked;
            var description = (getEl('agentCfgDescription').value || '').trim();
            var system_prompt = (getEl('agentCfgPrompt').value || '').trim();
            var schemaRaw = (getEl('agentCfgSchema').value || '').trim();
            if (!editingName) {
                if (!name) { showError('请填写 agent 名称'); getEl('agentCfgName').focus(); return null; }
                if (!/^[a-zA-Z0-9_-]+$/.test(name)) { showError('name 仅支持字母/数字/下划线/中划线（同时是 workflow node.agent 引用）'); getEl('agentCfgName').focus(); return null; }
                if (!system_prompt) { showError('自定义 agent 必须提供非空 system_prompt'); getEl('agentCfgPrompt').focus(); return null; }
            } else if (origin === 'custom' && !system_prompt) {
                showError('自定义 agent 必须提供非空 system_prompt'); getEl('agentCfgPrompt').focus(); return null;
            }
            if (role !== 'diagnose' && role !== 'fix') { showError('role 仅支持 diagnose 或 fix'); return null; }
            var output_schema = null;
            if (schemaRaw) {
                try { output_schema = JSON.parse(schemaRaw); }
                catch (e) { showError('Output Schema 不是合法 JSON：' + e.message); getEl('agentCfgSchema').focus(); return null; }
                if (typeof output_schema !== 'object' || output_schema === null || Array.isArray(output_schema)) {
                    showError('Output Schema 需为 JSON 对象（{...}）'); getEl('agentCfgSchema').focus(); return null;
                }
            }
            var mcp_server_ids = null;  // 默认不绑定 → null = 无 MCP server（两态）；指定 → 选中 id 数组
            if (bindMode() === 'specific') mcp_server_ids = checkedServerIds();
            var body = {
                role: role,
                stage: stage,
                description: description || null,
                system_prompt: system_prompt || null,
                output_schema: output_schema,
                mcp_server_ids: mcp_server_ids,
                enabled: enabled
            };
            if (!editingName) body.name = name;
            return body;
        }

        function save() {
            if (saving) return;
            var btn = getEl('agentCfgSaveBtn');
            var body = buildBody();
            if (!body) return;
            clearError();
            saving = true;
            if (btn) btn.textContent = 'Saving\u2026';
            var url = AGC_API_BASE + '/agent-configs' + (editingName ? '/' + encodeURIComponent(editingName) : '');
            fetch(url, {
                method: editingName ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) throw { raw: data.detail || res.status };
                    return data;
                });
            }).then(function (data) {
                var label = (data && data.name) || editingName || body.name || '';
                window._showToast(editingName ? 'Updated ' + label : 'Created ' + label, 'success');
                closeModal();
                loadConfigs();
            }).catch(function (err) {
                if (!err) return;
                var raw = (err.raw !== undefined) ? err.raw : (err.message || 'network error');
                showError('保存失败：' + raw);
            }).finally(function () {
                saving = false;
                if (btn) btn.textContent = 'Save Agent';
            });
        }

        function remove(name) {
            if (!window.confirm('确认删除自定义 agent「' + name + '」？此操作不可撤销。')) return;
            clearError();
            fetch(AGC_API_BASE + '/agent-configs/' + encodeURIComponent(name), { method: 'DELETE' }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function () {
                if (editingName === name) closeModal();
                window._showToast('Deleted ' + name, 'success');
                loadConfigs();
            }).catch(function (err) {
                window._showToast('删除失败: ' + (err && err.message ? err.message : 'network error'), 'error');
            });
        }

        function loadConfigs() {
            clearError();
            loadOverlay(true);
            fetch(AGC_API_BASE + '/agent-configs').then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (data) {
                agents = Array.isArray(data) ? data : [];
                renderTable();
            }).catch(function (err) {
                window._showToast('加载 agent 配置列表失败: ' + (err && err.message ? err.message : 'network error'), 'error');
            }).finally(function () { loadOverlay(false); });
        }

        // ── Wire events ──
        function bindEvents() {
            var newBtn = getEl('agentCfgNewBtn');
            if (newBtn) newBtn.addEventListener('click', openNew);
            var refreshBtn = getEl('agentCfgRefreshBtn');
            if (refreshBtn) refreshBtn.addEventListener('click', function () {
                var self = this;
                self.classList.add('spinning');
                self.disabled = true;
                loadConfigs();
                setTimeout(function () { self.classList.remove('spinning'); self.disabled = false; }, 600);
            });
            var tbody = getEl('agentCfgTableBody');
            if (tbody) tbody.addEventListener('click', function (e) {
                var btn = e.target.closest('button[data-act]');
                if (!btn || btn.disabled) return;
                var tr = btn.closest('tr[data-name]');
                if (!tr) return;
                var name = tr.getAttribute('data-name');
                var act = btn.getAttribute('data-act');
                if (act === 'edit') openEdit(name);
                else if (act === 'del') remove(name);
            });
            var searchEl = getEl('agentCfgSearch');
            if (searchEl) searchEl.addEventListener('input', function () {
                var self = this;
                clearTimeout(self._timer);
                self._timer = setTimeout(function () {
                    currentSearch = self.value.trim().toLowerCase();
                    renderTable();
                }, 200);
            });
            var closeBtn = getEl('agentCfgModalClose');
            if (closeBtn) closeBtn.addEventListener('click', closeModal);
            var overlay = getEl('agentCfgModalOverlay');
            if (overlay) overlay.addEventListener('click', function (e) {
                if (e.target === this) closeModal();
            });
            var saveBtn = getEl('agentCfgSaveBtn');
            if (saveBtn) saveBtn.addEventListener('click', save);
            var cancelBtn = getEl('agentCfgCancelBtn');
            if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
            if (overlay) {
                var radios = overlay.querySelectorAll('input[name="agentCfgBindMode"]');
                for (var i = 0; i < radios.length; i++) {
                    radios[i].addEventListener('change', function () {
                        syncBindUi(checkedServerIds(), false);
                    });
                }
            }
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && getEl('agentCfgModalOverlay').classList.contains('open')) closeModal();
            });
        }

        // 切回本页时自动刷新已保存列表
        _pageRefreshers['page-agent-config'] = function () { loadConfigs(); };

        bindEvents();
        loadConfigs();
    }

    // ── Init ────────────────────────────────────────────────────
    function init() {
        // 接缝 S5/S6：嵌入 Vue 外壳时（__SIP_LEGACY_ROOT 由 src/legacy/bridge.js 设置）
        //   - S5：顶部导航与侧边栏归 Vue，本文件不再接管（否则会抢绑 Vue 的 DOM）；
        //   - S6：log-analysis / bug-solve 两个视图已迁至 Vue，其面板不在 legacy 树内，
        //         不跳过会在 getElementById(...).addEventListener 上抛错。
        var embedded = !!window.__SIP_LEGACY_ROOT;

        if (!embedded) {
            initSidebar();
            initNavigation();
        }
        initKnowledgeSearch();
        initReflowLog();
        initAgentTasks();
        initL1Automation();
        initApprovalCenter();
        initSmartInspection();
        initMetricsAnalysis();
        if (!embedded) initLogAnalysis();
        initProblems();
        initMonitorTargets();
        initDomainConfig();
        initAgentRegistry();
        initWorkflowStudio();
        if (!embedded) initBugSolve();
        initMcpServers();
        initAgentConfig();
        initFilterChips();
        initTableSorting();
        initButtonGroup();
        initRowClick();
        initClock();
    }

    if (window.__SIP_DEFER_LEGACY_INIT) {
        // 接缝 S7：Vue 外壳先把 legacy-panels.html 注入完，再显式调起本文件的 init。
        // 不延迟的话 init 会跑在空 DOM 上 —— 所有 getElementById 都返回 null。
        window.__SIP_LEGACY_INIT = init;
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
