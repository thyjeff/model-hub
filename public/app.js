/**
 * Model Hub Console - Main Entry
 *
 * This file orchestrates Alpine.js initialization.
 * Components are loaded via separate script files that register themselves
 * to window.Components before this script runs.
 */

// ── Auth Guard ──────────────────────────────────────────────────────────────
(async () => {
    try {
        const cfgRes = await fetch('/api/config');
        if (!cfgRes.ok) return;
        const cfgData = await cfgRes.json();

        // webuiPassword is redacted as '********' when set — treat that as "password exists"
        const hasPassword = cfgData?.config?.webuiPassword &&
                            cfgData.config.webuiPassword !== '';
        if (!hasPassword) {
            window.__mhPassword = null;
            return;
        }

        const storedPw = sessionStorage.getItem('mh_auth');
        if (!storedPw || storedPw === 'no-password') {
            window.location.href = '/login.html';
            return;
        }

        // Validate stored password
        const testRes = await fetch('/api/accounts', {
            headers: { 'x-webui-password': storedPw }
        });
        if (!testRes.ok) {
            sessionStorage.removeItem('mh_auth');
            window.location.href = '/login.html';
            return;
        }
        window.__mhPassword = storedPw;
    } catch {
        // Allow through on network error
    }
})();

// Inject password header automatically into all internal API calls
const _origFetch = window.fetch;
window.fetch = function(url, opts = {}) {
    if (window.__mhPassword && typeof url === 'string' &&
        !url.startsWith('https://') && !url.startsWith('http://') || 
        (typeof url === 'string' && (url.startsWith('/api') || url.startsWith('views/')))) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        if (!(opts.headers instanceof Headers)) {
            opts.headers['x-webui-password'] = window.__mhPassword;
        }
    }
    return _origFetch(url, opts);
};
// ────────────────────────────────────────────────────────────────────────────


document.addEventListener('alpine:init', () => {
    // Register Components (loaded from separate files via window.Components)
    Alpine.data('dashboard', window.Components.dashboard);
    Alpine.data('models', window.Components.models);
    Alpine.data('ollamaHub', window.Components.ollamaHub);
    Alpine.data('accountManager', window.Components.accountManager);
    Alpine.data('claudeConfig', window.Components.claudeConfig);
    Alpine.data('codexConfig', window.Components.codexConfig);
    Alpine.data('logsViewer', window.Components.logsViewer);
    Alpine.data('addAccountModal', window.Components.addAccountModal);

    // View Loader Directive
    Alpine.directive('load-view', (el, { expression }, { evaluate }) => {
        if (!window.viewCache) window.viewCache = new Map();
        const viewName = evaluate(expression);
        if (window.viewCache.has(viewName)) {
            el.innerHTML = window.viewCache.get(viewName);
            Alpine.initTree(el);
            return;
        }
        fetch(`views/${viewName}.html?t=${Date.now()}`)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.text();
            })
            .then(html => {
                window.viewCache.set(viewName, html);
                el.innerHTML = html;
                Alpine.initTree(el);
            })
            .catch(err => {
                el.innerHTML = `<div style="padding:16px;border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;font-family:monospace;font-size:12px">
                    Error loading view: ${viewName}<br><span style="opacity:0.6">${err.message}</span></div>`;
            });
    });

    // Main App Controller
    Alpine.data('app', () => ({
        get connectionStatus() { return Alpine.store('data')?.connectionStatus || 'connecting'; },
        get loading() { return Alpine.store('data')?.loading || false; },
        sidebarOpen: window.innerWidth >= 1024,
        toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; },

        init() {
            let lastWidth = window.innerWidth;
            let resizeTimeout = null;
            window.addEventListener('resize', () => {
                if (resizeTimeout) clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    const cur = window.innerWidth;
                    const lg = 1024;
                    if (lastWidth >= lg && cur < lg) this.sidebarOpen = false;
                    if (lastWidth < lg && cur >= lg) this.sidebarOpen = true;
                    lastWidth = cur;
                }, 150);
            });

            document.documentElement.setAttribute('data-theme', 'black');
            document.documentElement.classList.add('dark');

            if (typeof Chart !== 'undefined') {
                Chart.defaults.color = window.utils.getThemeColor('--color-text-dim');
                Chart.defaults.borderColor = window.utils.getThemeColor('--color-space-border');
                Chart.defaults.font.family = '"JetBrains Mono", monospace';
            }

            this.startAutoRefresh();
            document.addEventListener('refresh-interval-changed', () => this.startAutoRefresh());
            Alpine.store('data').fetchData();
        },

        refreshTimer: null,
        fetchData() { Alpine.store('data').fetchData(); },
        startAutoRefresh() {
            if (this.refreshTimer) clearInterval(this.refreshTimer);
            const interval = parseInt(Alpine.store('settings')?.refreshInterval || 60);
            if (interval > 0) {
                this.refreshTimer = setInterval(() => Alpine.store('data').fetchData(), interval * 1000);
            }
        },
        t(key) { return Alpine.store('global')?.t(key) || key; },

        async addAccountWeb(reAuthEmail = null) {
            const password = Alpine.store('global').webuiPassword;
            try {
                const urlPath = reAuthEmail ? `/api/auth/url?email=${encodeURIComponent(reAuthEmail)}` : '/api/auth/url';
                const { response, newPassword } = await window.utils.request(urlPath, {}, password);
                if (newPassword) Alpine.store('global').webuiPassword = newPassword;
                const data = await response.json();

                if (data.status === 'ok') {
                    Alpine.store('global').showToast(Alpine.store('global').t('oauthInProgress'), 'info');
                    const oauthWindow = window.open(data.url, 'google_oauth', 'width=600,height=700,scrollbars=yes');
                    const initialAccountCount = Alpine.store('data').accounts.length;
                    let pollCount = 0;
                    const maxPolls = 60;
                    let cancelled = false;

                    Alpine.store('global').oauthProgress = {
                        active: true, current: 0, max: maxPolls,
                        cancel: () => {
                            cancelled = true;
                            clearInterval(pollInterval);
                            Alpine.store('global').oauthProgress.active = false;
                            Alpine.store('global').showToast(Alpine.store('global').t('oauthCancelled'), 'info');
                            if (oauthWindow && !oauthWindow.closed) oauthWindow.close();
                        }
                    };

                    const pollInterval = setInterval(async () => {
                        if (cancelled) { clearInterval(pollInterval); return; }
                        pollCount++;
                        Alpine.store('global').oauthProgress.current = pollCount;
                        if (oauthWindow && oauthWindow.closed && !cancelled) {
                            clearInterval(pollInterval);
                            Alpine.store('global').oauthProgress.active = false;
                            Alpine.store('global').showToast(Alpine.store('global').t('oauthWindowClosed'), 'warning');
                            return;
                        }
                        await Alpine.store('data').fetchData();
                        if (Alpine.store('data').accounts.length > initialAccountCount) {
                            clearInterval(pollInterval);
                            Alpine.store('global').oauthProgress.active = false;
                            const actionKey = reAuthEmail ? 'accountReauthSuccess' : 'accountAddedSuccess';
                            Alpine.store('global').showToast(Alpine.store('global').t(actionKey), 'success');
                            document.getElementById('add_account_modal')?.close();
                            if (oauthWindow && !oauthWindow.closed) oauthWindow.close();
                        }
                        if (pollCount >= maxPolls) {
                            clearInterval(pollInterval);
                            Alpine.store('global').oauthProgress.active = false;
                            Alpine.store('global').showToast(Alpine.store('global').t('oauthTimeout'), 'warning');
                        }
                    }, 2000);
                } else {
                    Alpine.store('global').showToast(data.error || Alpine.store('global').t('failedToGetAuthUrl'), 'error');
                }
            } catch (e) {
                Alpine.store('global').showToast(Alpine.store('global').t('failedToStartOAuth') + ': ' + e.message, 'error');
            }
        }
    }));
});
