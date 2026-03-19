window.Components = window.Components || {};

window.Components.ollamaHub = () => ({
    loading: false,
    saving: false,
    testing: false,
    config: {
        ollamaCloudBaseUrl: '',
        ollamaApiKeys: [],
        ollamaBaseUrls: [],
        openaiBaseUrl: '',
        openaiApiKeys: [],
        kimiBaseUrl: '',
        kimiApiKeys: [],
        ollamaFailoverCooldownMs: 1000
    },
    apiKeysText: '',
    openaiApiKeysText: '',
    kimiApiKeysText: '',
    test: {
        model: 'kimi/moonshotai/kimi-k2.5',
        prompt: 'Reply with OK only',
        maxTokens: 16384,
        response: '',
        usage: null
    },
    usage: { totals: {}, upstreams: [], topModels: [], recentSessions: [] },

    init() {
        this.refreshAll();
    },

    async refreshAll() {
        this.loading = true;
        const store = Alpine.store('global');
        const password = store.webuiPassword;
        try {
            const [cfgReq, usageReq] = await Promise.all([
                window.utils.request('/api/config', {}, password),
                window.utils.request('/api/ollama/usage', {}, password)
            ]);
            if (cfgReq.newPassword) store.webuiPassword = cfgReq.newPassword;
            if (usageReq.newPassword) store.webuiPassword = usageReq.newPassword;

            if (cfgReq.response.ok) {
                const cfgData = await cfgReq.response.json();
                const cfg = cfgData.config || {};
                this.config.ollamaCloudBaseUrl = cfg.ollamaCloudBaseUrl || '';
                this.config.ollamaApiKeys = Array.isArray(cfg.ollamaApiKeys) && cfg.ollamaApiKeys.length > 0
                    ? cfg.ollamaApiKeys.slice(0, 100)
                    : [];
                this.config.ollamaBaseUrls = Array.isArray(cfg.ollamaBaseUrls)
                    ? cfg.ollamaBaseUrls.slice(0, 100)
                    : [];
                this.config.openaiBaseUrl = cfg.openaiBaseUrl || 'https://api.openai.com/v1';
                this.config.openaiApiKeys = Array.isArray(cfg.openaiApiKeys) && cfg.openaiApiKeys.length > 0
                    ? cfg.openaiApiKeys.slice(0, 100)
                    : [];
                this.config.kimiBaseUrl = cfg.kimiBaseUrl || 'https://integrate.api.nvidia.com/v1';
                this.config.kimiApiKeys = Array.isArray(cfg.kimiApiKeys) && cfg.kimiApiKeys.length > 0
                    ? cfg.kimiApiKeys.slice(0, 100)
                    : [];
                this.config.ollamaFailoverCooldownMs = cfg.ollamaFailoverCooldownMs || 1000;
                this.syncApiKeysTextFromConfig();
            }

            if (usageReq.response.ok) {
                const usageData = await usageReq.response.json();
                this.usage = usageData.usage || this.usage;
            }
        } catch (e) {
            store.showToast('Failed to load Ollama settings: ' + e.message, 'error');
        } finally {
            this.loading = false;
        }
    },

    async saveConfig() {
        this.saving = true;
        const store = Alpine.store('global');
        try {
            const keysFromText = this.parseApiKeysFromText(this.apiKeysText);
            const keysFromArray = (Array.isArray(this.config.ollamaApiKeys) ? this.config.ollamaApiKeys : [])
                .map(v => String(v || '').trim())
                .filter(Boolean)
                .slice(0, 100);
            const keys = keysFromText.length > 0 ? keysFromText : keysFromArray;

            const openaiKeysFromText = this.parseApiKeysFromText(this.openaiApiKeysText);
            const openaiKeysFromArray = (Array.isArray(this.config.openaiApiKeys) ? this.config.openaiApiKeys : [])
                .map(v => String(v || '').trim())
                .filter(Boolean)
                .slice(0, 100);
            const openaiKeys = openaiKeysFromText.length > 0 ? openaiKeysFromText : openaiKeysFromArray;

            const kimiKeysFromText = this.parseApiKeysFromText(this.kimiApiKeysText);
            const kimiKeysFromArray = (Array.isArray(this.config.kimiApiKeys) ? this.config.kimiApiKeys : [])
                .map(v => String(v || '').trim())
                .filter(Boolean)
                .slice(0, 100);
            const kimiKeys = kimiKeysFromText.length > 0 ? kimiKeysFromText : kimiKeysFromArray;

            const upstreams = (Array.isArray(this.config.ollamaBaseUrls) ? this.config.ollamaBaseUrls : [])
                .map(v => String(v || '').trim())
                .filter(Boolean)
                .slice(0, 100);
            this.config.ollamaApiKeys = keys;
            this.config.openaiApiKeys = openaiKeys;
            this.config.kimiApiKeys = kimiKeys;
            this.syncApiKeysTextFromConfig();

            const payload = {
                ollamaCloudBaseUrl: String(this.config.ollamaCloudBaseUrl || '').trim(),
                ollamaApiKeys: keys,
                ollamaBaseUrls: upstreams,
                openaiBaseUrl: String(this.config.openaiBaseUrl || '').trim(),
                openaiApiKeys: openaiKeys,
                kimiBaseUrl: String(this.config.kimiBaseUrl || '').trim(),
                kimiApiKeys: kimiKeys,
                ollamaFailoverCooldownMs: Number(this.config.ollamaFailoverCooldownMs || 1000)
            };

            const { response, newPassword } = await window.utils.request('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, store.webuiPassword);
            if (newPassword) store.webuiPassword = newPassword;
            const data = await response.json();
            if (data.status !== 'ok') throw new Error(data.error || 'Failed to save config');
            store.showToast('Saved provider API key settings', 'success');
            await this.refreshAll();
        } catch (e) {
            store.showToast('Failed to save: ' + e.message, 'error');
        } finally {
            this.saving = false;
        }
    },

    addApiKey() {
        if (!Array.isArray(this.config.ollamaApiKeys)) this.config.ollamaApiKeys = [];
        if (this.config.ollamaApiKeys.length >= 100) return;
        this.config.ollamaApiKeys.push('');
        this.syncApiKeysTextFromConfig();
    },

    removeApiKey(index) {
        if (!Array.isArray(this.config.ollamaApiKeys)) return;
        this.config.ollamaApiKeys.splice(index, 1);
        this.syncApiKeysTextFromConfig();
    },

    addOpenAIApiKey() {
        if (!Array.isArray(this.config.openaiApiKeys)) this.config.openaiApiKeys = [];
        if (this.config.openaiApiKeys.length >= 100) return;
        this.config.openaiApiKeys.push('');
        this.syncApiKeysTextFromConfig();
    },

    removeOpenAIApiKey(index) {
        if (!Array.isArray(this.config.openaiApiKeys)) return;
        this.config.openaiApiKeys.splice(index, 1);
        this.syncApiKeysTextFromConfig();
    },

    addKimiApiKey() {
        if (!Array.isArray(this.config.kimiApiKeys)) this.config.kimiApiKeys = [];
        if (this.config.kimiApiKeys.length >= 100) return;
        this.config.kimiApiKeys.push('');
        this.syncApiKeysTextFromConfig();
    },

    removeKimiApiKey(index) {
        if (!Array.isArray(this.config.kimiApiKeys)) return;
        this.config.kimiApiKeys.splice(index, 1);
        this.syncApiKeysTextFromConfig();
    },

    getActiveUpstreamLabel() {
        const sessions = Array.isArray(this.usage?.recentSessions) ? this.usage.recentSessions : [];
        if (sessions.length > 0 && sessions[0]?.lastUpstream) {
            return String(sessions[0].lastUpstream);
        }
        const upstreams = Array.isArray(this.usage?.upstreams) ? this.usage.upstreams : [];
        if (upstreams.length === 0) return '';
        const sorted = [...upstreams].sort((a, b) =>
            new Date(b?.lastSeen || 0).getTime() - new Date(a?.lastSeen || 0).getTime()
        );
        return String(sorted[0]?.url || '');
    },

    isActiveUpstream(url) {
        const active = this.getActiveUpstreamLabel();
        return !!active && String(url || '') === active;
    },

    accountLabelFor(url, idx) {
        const m = String(url || '').match(/^api-key-(\d+)@/);
        if (m) return `Account ${m[1]} (Cloud)`;
        return idx === 0 ? 'Local Laptop' : 'Local Laptop';
    },

    syncApiKeysTextFromConfig() {
        const keys = Array.isArray(this.config.ollamaApiKeys) ? this.config.ollamaApiKeys : [];
        const openaiKeys = Array.isArray(this.config.openaiApiKeys) ? this.config.openaiApiKeys : [];
        const kimiKeys = Array.isArray(this.config.kimiApiKeys) ? this.config.kimiApiKeys : [];
        this.apiKeysText = keys.length ? keys.join('\n') : '';
        this.openaiApiKeysText = openaiKeys.length ? openaiKeys.join('\n') : '';
        this.kimiApiKeysText = kimiKeys.length ? kimiKeys.join('\n') : '';
    },

    parseApiKeysFromText(text) {
        return String(text || '')
            .split(/[\n,]+/)
            .map(v => String(v || '').trim())
            .filter(Boolean)
            .slice(0, 100);
    },

    getProviderBaseUrl(provider) {
        if (provider === 'openai') return String(this.config.openaiBaseUrl || '').trim();
        if (provider === 'kimi') return String(this.config.kimiBaseUrl || '').trim();
        return String(this.config.ollamaCloudBaseUrl || '').trim();
    },

    getActiveApiKeyIndex(provider = 'ollama') {
        const label = this.getActiveUpstreamLabel();
        const match = String(label || '').match(/^api-key-(\d+)@(.+)$/);
        if (!match) return -1;
        const idx = parseInt(match[1], 10);
        const upstreamBase = String(match[2] || '').trim();
        const providerBase = this.getProviderBaseUrl(provider);
        if (providerBase && upstreamBase && providerBase !== upstreamBase) return -1;
        return Number.isNaN(idx) ? -1 : idx - 1;
    },

    isApiKeyActive(index, provider = 'ollama') {
        return this.getActiveApiKeyIndex(provider) === index;
    },

    lastApiKeyDescription(provider = 'ollama') {
        const label = this.getActiveUpstreamLabel();
        if (!label) return 'No requests yet';
        const match = String(label).match(/^api-key-(\d+)@(.+)$/);
        if (!match) return label;
        const providerBase = this.getProviderBaseUrl(provider);
        const upstreamBase = String(match[2] || '').trim();
        if (providerBase && upstreamBase && providerBase !== upstreamBase) return 'No requests yet';
        return `API key ${match[1]} (${label})`;
    },

    async runTest() {
        this.testing = true;
        const store = Alpine.store('global');
        try {
            const payload = {
                model: this.test.model,
                prompt: this.test.prompt,
                maxTokens: Number(this.test.maxTokens || 128)
            };
            const { response, newPassword } = await window.utils.request('/api/ollama/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, store.webuiPassword);
            if (newPassword) store.webuiPassword = newPassword;
            const data = await response.json();
            if (data.status !== 'ok') throw new Error(data.error || 'Test failed');
            this.test.response = data.reply || '';
            this.test.usage = data.usage || null;
            store.showToast('Test request completed', 'success');
            await this.refreshAll();
        } catch (e) {
            this.test.response = '';
            this.test.usage = null;
            store.showToast('Test failed: ' + e.message, 'error');
        } finally {
            this.testing = false;
        }
    },

    async copyApiKey(key) {
        if (!key) return;
        try {
            await navigator.clipboard.writeText(key);
            Alpine.store('global').showToast('API key copied', 'success');
        } catch (error) {
            Alpine.store('global').showToast('Clipboard not available', 'error');
        }
    }
});




