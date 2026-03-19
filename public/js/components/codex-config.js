/**
 * Codex Config Component
 * Registers itself to window.Components for Alpine.js to consume
 */
window.Components = window.Components || {};

window.Components.codexConfig = () => ({
    config: {
        providerId: 'modelhub',
        model: 'kimi/moonshotai/kimi-k2.5',
        baseUrl: 'http://localhost:8081/v1',
        apiKey: 'test',
        wireApi: 'responses'
    },
    configPath: '~/.codex/config.toml',
    loading: false,
    modeLoading: false,
    currentMode: 'paid', // 'proxy' or 'paid'
    presets: [],
    selectedPresetName: '',
    savingPreset: false,
    deletingPreset: false,
    newPresetName: '',
    recommendedModels: [
        'kimi/moonshotai/kimi-k2.5',
        'openai/gpt-4o',
        'openai/gpt-4.1',
        'openai/o3',
        'ollama/deepseek-v3.1:671b-cloud'
    ],

    init() {
        if (this.$store.global.settingsTab === 'codex') {
            this.fetchConfig();
            this.fetchMode();
            this.fetchPresets();
            this.ensureModelCatalogLoaded();
        }

        this.$watch('$store.global.settingsTab', (tab, oldTab) => {
            if (tab === 'codex' && oldTab !== undefined) {
                this.fetchConfig();
                this.fetchMode();
                this.fetchPresets();
                this.ensureModelCatalogLoaded();
            }
        });
    },

    get availableModels() {
        const fromStore = Array.isArray(Alpine.store('data')?.models) ? Alpine.store('data').models : [];
        return Array.from(new Set([...this.recommendedModels, ...fromStore]));
    },

    async ensureModelCatalogLoaded() {
        const dataStore = Alpine.store('data');
        if (!dataStore) return;
        if (Array.isArray(dataStore.models) && dataStore.models.length > 0) return;
        try {
            await dataStore.fetchData();
        } catch (e) {
            console.debug('Codex model catalog fallback failed:', e?.message || e);
        }
    },

    async fetchConfig() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/codex/config', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            this.config = {
                ...this.config,
                ...(data.config || {})
            };
            this.config.providerId = 'modelhub';
            this.configPath = data.path || this.configPath;
            if (data.mode) this.currentMode = data.mode;
        } catch (e) {
            console.error('Failed to fetch Codex config:', e);
        }
    },

    async fetchMode() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/codex/mode', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            if (data.status === 'ok') {
                this.currentMode = data.mode || 'paid';
            }
        } catch (e) {
            console.error('Failed to fetch Codex mode:', e);
        }
    },

    async fetchPresets() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/codex/presets', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.presets = data.presets || [];
                if (!this.selectedPresetName && this.presets.length > 0) {
                    this.selectedPresetName = this.presets[0].name;
                }
            }
        } catch (e) {
            console.error('Failed to fetch Codex presets:', e);
        }
    },

    loadSelectedPreset() {
        const preset = this.presets.find(p => p.name === this.selectedPresetName);
        if (!preset || !preset.config) return;
        this.config = {
            ...this.config,
            ...preset.config,
            providerId: 'modelhub'
        };
        Alpine.store('global').showToast(`Preset "${preset.name}" loaded`, 'success');
    },

    async saveToSelectedPreset() {
        if (!this.selectedPresetName) {
            Alpine.store('global').showToast('Select a preset first', 'error');
            return;
        }
        await this.executeSavePreset(this.selectedPresetName);
    },

    openSavePresetModal() {
        this.newPresetName = '';
        const modal = document.getElementById('save_codex_preset_modal');
        if (modal && !modal.open) modal.showModal();
    },

    async executeSavePreset(name) {
        const cleanedName = String(name || '').trim();
        if (!cleanedName) {
            Alpine.store('global').showToast('Preset name is required', 'error');
            return;
        }
        if (cleanedName.length > 60) {
            Alpine.store('global').showToast('Preset name must be 60 characters or fewer', 'error');
            return;
        }

        this.savingPreset = true;
        const password = Alpine.store('global').webuiPassword;
        try {
            const payload = {
                name: cleanedName,
                config: {
                    providerId: 'modelhub',
                    model: this.config.model,
                    baseUrl: this.config.baseUrl,
                    apiKey: this.config.apiKey,
                    wireApi: 'responses'
                }
            };
            const { response, newPassword } = await window.utils.request('/api/codex/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status !== 'ok') throw new Error(data.error || 'Failed to save preset');
            this.presets = data.presets || [];
            this.selectedPresetName = cleanedName;
            this.newPresetName = '';
            const modal = document.getElementById('save_codex_preset_modal');
            if (modal && modal.open) modal.close();
            Alpine.store('global').showToast(`Preset "${cleanedName}" saved`, 'success');
        } catch (e) {
            Alpine.store('global').showToast(`Failed to save preset: ${e.message}`, 'error');
        } finally {
            this.savingPreset = false;
        }
    },

    async deleteSelectedPreset() {
        if (!this.selectedPresetName) return;
        this.deletingPreset = true;
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request(
                `/api/codex/presets/${encodeURIComponent(this.selectedPresetName)}`,
                { method: 'DELETE' },
                password
            );
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status !== 'ok') throw new Error(data.error || 'Failed to delete preset');
            this.presets = data.presets || [];
            this.selectedPresetName = this.presets.length > 0 ? this.presets[0].name : '';
            Alpine.store('global').showToast('Preset deleted', 'success');
        } catch (e) {
            Alpine.store('global').showToast(`Failed to delete preset: ${e.message}`, 'error');
        } finally {
            this.deletingPreset = false;
        }
    },

    async saveCodexConfig() {
        this.loading = true;
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/codex/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            if (data.path) this.configPath = data.path;
            this.currentMode = 'proxy';
            Alpine.store('global').showToast(
                Alpine.store('global').t('codexConfigSaved') || 'Codex configuration saved',
                'success'
            );
        } catch (e) {
            Alpine.store('global').showToast(
                (Alpine.store('global').t('saveConfigFailed') || 'Failed to save configuration') + ': ' + e.message,
                'error'
            );
        } finally {
            this.loading = false;
        }
    },

    async toggleMode(newMode) {
        if (this.modeLoading || newMode === this.currentMode) return;
        this.modeLoading = true;

        const password = Alpine.store('global').webuiPassword;
        try {
            const payload = { mode: newMode };
            if (newMode === 'proxy') payload.config = this.config;

            const { response, newPassword } = await window.utils.request('/api/codex/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            if (data.status === 'ok') {
                this.currentMode = data.mode;
                if (data.config) {
                    this.config = { ...this.config, ...data.config };
                    this.config.providerId = 'modelhub';
                }
                if (data.path) this.configPath = data.path;
                Alpine.store('global').showToast(data.message || 'Codex mode updated', 'success');
            } else {
                throw new Error(data.error || 'Failed to switch mode');
            }
        } catch (e) {
            Alpine.store('global').showToast(
                (Alpine.store('global').t('modeToggleFailed') || 'Failed to switch mode') + ': ' + e.message,
                'error'
            );
        } finally {
            this.modeLoading = false;
        }
    }
});

