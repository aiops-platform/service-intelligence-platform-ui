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
