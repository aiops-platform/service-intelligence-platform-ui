/**
 * Service Intelligence Platform - Main Application
 */

(function () {
    'use strict';

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

    function navigateToPage(pageId, context) {
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
        document.querySelectorAll('.page-panel').forEach(function (p) {
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

    // ── Sidebar ─────────────────────────────────────────────────
    function initSidebar() {
        var sidebars = document.querySelectorAll('.sidebar');

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
        var navItems = document.querySelectorAll('.nav-item');
        var sidebarEngOps = document.getElementById('sidebar-eng-ops');
        var sidebarBizOps = document.getElementById('sidebar-biz-ops');
        var sidebarServiceOps = document.getElementById('sidebar-service-ops');
        var sidebarAgents = document.getElementById('sidebar-agents');
        var pageTitle = document.querySelector('.page-title');
        var pageDesc = document.querySelector('.page-desc');

        function hideAllSidebars() {
            document.querySelectorAll('.sidebar').forEach(function (s) { return s.classList.remove('visible'); });
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
        var API_URL = 'http://localhost:8080/api/sip-aiops/app-indicator';
        var services = [];
        var currentFilter = 'all';
        var isLoading = false;

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

        function deriveStatus(s) {
            if (s.status) return s.status.toLowerCase();
            var cpu = s.cpu, mem = s.mem;
            if ((cpu !== null && cpu >= 90) || (mem !== null && mem >= 90)) return 'critical';
            if ((cpu !== null && cpu >= 70) || (mem !== null && mem >= 70)) return 'warning';
            if (cpu !== null || mem !== null || disk !== null) return 'healthy';
            return 'unknown';
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
                agent: item.agentName,
                type: item.serviceType,
                cpu: item.cpuUsage,
                cpuBaseline: 70,
                mem: item.memoryUsage,
                memBaseline: 80,
                disk: item.blockIO,
                netIO: item.netIO,
                netIn: item.netIn,
                netOut: item.netOut,
                uptime: item.uptime,
                restartCount: item.restartCount,
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

        // ── API Fetch ────────────────────────────────────────────
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
                    if (data.success && data.data && data.data.content) {
                        services = data.data.content.map(transformService);
                        // Fetch log error counts per service
                        return fetch('http://localhost:8080/api/sip-aiops/log-alert?size=500')
                            .then(function (res) { return res.json(); })
                            .then(function (logData) {
                                var logCounts = {};
                                if (logData.success && logData.data && logData.data.content) {
                                    logData.data.content.forEach(function (a) {
                                        var sn = a.serviceName;
                                        logCounts[sn] = (logCounts[sn] || 0) + 1;
                                    });
                                }
                                services.forEach(function (s) {
                                    s.logErrorCount = logCounts[s.name] || 0;
                                });
                                updateSIStats();
                                doSIFilter();
                                hideLoading();
                            });
                    } else {
                        throw new Error('Invalid response format');
                    }
                })
                .catch(function (err) {
                    console.warn('Smart Inspection fetch error, falling back to mock data:', err.message);
                    useMockData();
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

        function alertBadge(count, serviceName) {
            if (count === null || count === undefined) return '<span class="si-alert-badge null-alert">-</span>';
            var cls = count > 0 ? 'has-alerts' : '';
            var attrs = '';
            if (count > 0 && serviceName) {
                attrs = ' style="cursor:pointer;" data-service="' + serviceName.replace(/"/g, '&quot;') + '"';
            }
            return '<span class="si-alert-badge ' + cls + '"' + attrs + '>' + count + '</span>';
        }

        function renderSITable(data) {
            var tbody = document.getElementById('siTableBody');
            if (!tbody) return;
            tbody.innerHTML = data.map(function (s) {
                var logBadgeAttrs = '';
                if ((s.logErrorCount || 0) > 0 && s.name) {
                    logBadgeAttrs = ' style="cursor:pointer;" data-service="' + s.name.replace(/"/g, '&quot;') + '"';
                }
                return '<tr class="' + rowClass(s.status) + '" data-id="' + s.id + '">' +
                    '<td><div class="si-service-cell"><span class="si-service-name">' + fmtText(s.name) + '</span></div></td>' +
                    '<td><span class="si-agent-name">' + fmtText(s.agent) + '</span></td>' +
                    '<td><span class="si-service-type">' + fmtText(s.type) + '</span></td>' +
                    '<td>' + renderMetricCell(s.cpu, s.cpuBaseline) + '</td>' +
                    '<td>' + renderMetricCell(s.mem, s.memBaseline) + '</td>' +
                    '<td><span class="si-metric-val" style="font-family:SF Mono,monospace;font-size:11px;white-space:nowrap;">' + fmtText(s.disk) + '</span></td>' +
                    '<td>' + alertBadge(s.alertCount, s.name) + '</td>' +
                    '<td>' + alertBadge(s.logErrorCount || 0, s.name) + '</td>' +
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
            var totalAlerts = services.reduce(function (sum, s) { return sum + (s.alertCount || 0); }, 0);
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
                        (s.agent || '').toLowerCase().indexOf(search) !== -1 ||
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
                '<span class="meta-badge">' + fmtText(s.agent) + '</span>' +
                '<span class="meta-badge">' + fmtText(s.type) + '</span>' +
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
                '<div class="meta-item"><label>Service ID</label><span>' + s.id + '</span></div>' +
                '<div class="meta-item"><label>Agent</label><span style="font-family:SF Mono,monospace;color:var(--accent-purple);">' + fmtText(s.agent) + '</span></div>' +
                '<div class="meta-item"><label>Type</label><span>' + fmtText(s.type) + '</span></div>' +
                '<div class="meta-item"><label>Owner</label><span>' + fmtText(s.owner) + '</span></div>' +
                '<div class="meta-item"><label>Enabled</label><span>' + (s.enabled ? 'Yes' : 'No') + '</span></div>' +
                '<div class="meta-item"><label>Status</label><span>' + statusBadge(s.status) + '</span></div>' +
                '<div class="meta-item"><label>Alert Count</label><span style="font-weight:600;">' + fmtText(s.alertCount, '') + '</span></div>' +
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
        // Alert badge click delegation (bind once, not in renderSITable)
        var siTbody = document.getElementById('siTableBody');
        if (siTbody) {
            siTbody.addEventListener('click', function (e) {
                var badge = e.target.closest('.si-alert-badge.has-alerts');
                if (badge) {
                    e.stopPropagation();
                    var serviceName = badge.getAttribute('data-service');
                    if (!serviceName) return;
                    // Check if this is the log anomaly column (second alert badge in row)
                    var allBadges = badge.parentElement.parentElement.querySelectorAll('.si-alert-badge.has-alerts');
                    var isLogBadge = allBadges.length > 1 && badge === allBadges[allBadges.length - 1];
                    if (isLogBadge) {
                        navigateToPage('log-analysis', {serviceName: serviceName});
                    } else {
                        navigateToPage('metrics-analysis', {serviceName: serviceName});
                    }
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
        });

        document.getElementById('siRetryBtn').addEventListener('click', function () {
            fetchServices();
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

        function startPolling() {
            stopPolling();
            pollTimer = setInterval(function () {
                // Only poll when Smart Inspection page is visible
                var page = document.getElementById('page-smart-inspection');
                if (page && page.style.display !== 'none') {
                    fetchServices(true);
                }
            }, 1000);
        }

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        fetchServices();
        startPolling();
    }

    // ── Filter Chips ────────────────────────────────────────────
    function initFilterChips() {
        const chips = document.querySelectorAll('.filter-chip');
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
                    var allChip = document.querySelector('.filter-chip.active');
                    if (allChip && allChip.textContent.trim().startsWith('All')) {
                        allChip.classList.remove('active');
                    }
                }
            });
        });
    }

    // ── Table Sorting ───────────────────────────────────────────
    function initTableSorting() {
        var headers = document.querySelectorAll('th');
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
        var btns = document.querySelectorAll('.btn-group .btn');
        btns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                btns.forEach(function (b) { return b.classList.remove('active'); });
                btn.classList.add('active');
            });
        });
    }

    // ── Row Click ───────────────────────────────────────────────
    function initRowClick() {
        var rows = document.querySelectorAll('tbody tr');
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

    // ── Problem Center Page ──────────────────────────────────
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
        var allProblems = [];
        var pcPollTimer = null;    // 5s 自动刷新定时器
        var pcRefreshing = false;  // 请求在途标志：避免轮询堆叠

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
            if (currentService && seen[currentService]) sel.value = currentService;
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
                if (currentService && p.service !== currentService) return false;
                if (currentSeverity !== 'all' && (p.severity || '').toLowerCase() !== currentSeverity) return false;
                if (currentState !== 'all') {
                    var st = (p.state || '').toLowerCase();
                    if (currentState === 'open') {
                        if (st !== 'pending' && st !== 'in_progress') return false;
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
                    html += '<tr>' +
                        '<td class="col-title" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</td>' +
                        '<td>' + escapeHtml(p.service || '-') + '</td>' +
                        '<td>' + escapeHtml(p.domain || '-') + '</td>' +
                        '<td><span class="alert-tag severity-' + sev + '">' + escapeHtml(p.severity || 'warning') + '</span></td>' +
                        '<td><span class="alert-tag status-' + st + '">' + escapeHtml(p.state || 'pending') + '</span></td>' +
                        '<td>' + (p.occurrence_count || 1) + '</td>' +
                        '<td class="col-time">' + formatTime(p.detected_at || p.first_seen_at) + '</td>' +
                        '<td class="pc-actions">' +
                        '<button class="btn-alert-detail" data-id="' + escapeHtml(p.record_id) + '" data-act="detail">Detail</button>' +
                        (st === 'pending' ? '<button class="btn-alert-detail pc-analyze-btn" data-id="' + escapeHtml(p.record_id) + '" data-act="analyze">Analyze</button>' : '') +
                        (st === 'pending' ? '<button class="btn-alert-detail pc-ignore-btn" data-id="' + escapeHtml(p.record_id) + '" data-act="ignore">Ignore</button>' : '') +
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
            var st = (rec.state || 'pending').toLowerCase();
            html += '<div class="pd-header">' +
                '<span class="alert-tag severity-' + sev + '">' + escapeHtml(rec.severity || 'warning') + '</span> ' +
                '<span class="alert-tag status-' + st + '">' + escapeHtml(rec.state || 'pending') + '</span>' +
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

        function confirmIgnore(rec) {
            confirmDialog('Ignore problem ' + rec.record_id + '? This resolves it and records it as a false positive.', function () {
                apmApi('/v1/problems/' + encodeURIComponent(rec.record_id) + '/resolve', { method: 'POST', body: { false_positive: true } })
                    .then(function () {
                        window._showToast('Ignored ' + rec.record_id, 'success');
                        refresh();
                    })
                    .catch(function (err) {
                        window._showToast('Ignore failed: ' + err.message, 'error');
                    });
            });
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
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && getEl('pcDetailOverlay') && getEl('pcDetailOverlay').classList.contains('open')) closeProblemDetail();
        });

        // 切回本页时自动刷新
        _pageRefreshers['page-problems'] = function () { refresh(); };

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

        function applyTransform() {
            var zEl = getEl(opts.zoomId);
            if (zEl) zEl.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
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
        // 后端地址（可配置）：默认 http://localhost:8000。可用 localStorage 覆盖：workflowBaseUrl。
        var WS_API_BASE = localStorage.getItem('workflowBaseUrl') || 'http://localhost:8000';

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
            fetch(WS_API_BASE + '/workflows').then(function (res) {
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
            fetch(WS_API_BASE + '/workflows/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml: yamlEl.value })
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
            var url = WS_API_BASE + '/workflows' + (editingId ? '/' + editingId : '');
            var method = editingId ? 'PUT' : 'POST';
            fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, yaml: yamlText })
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
            fetch(WS_API_BASE + '/workflows/' + wid).then(function (res) {
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
            fetch(WS_API_BASE + '/workflows/' + wid, { method: 'DELETE' }).then(function (res) {
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
        initSidebar();
        initNavigation();
        initKnowledgeSearch();
        initReflowLog();
        initAgentTasks();
        initL1Automation();
        initApprovalCenter();
        initSmartInspection();
        initMetricsAnalysis();
        initLogAnalysis();
        initProblems();
        initMonitorTargets();
        initDomainConfig();
        initAgentRegistry();
        initWorkflowStudio();
        initBugSolve();
        initMcpServers();
        initAgentConfig();
        initFilterChips();
        initTableSorting();
        initButtonGroup();
        initRowClick();
        initClock();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
