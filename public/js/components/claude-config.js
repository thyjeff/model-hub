/**
 * Claude Config Component
 * Registers itself to window.Components for Alpine.js to consume
 */
window.Components = window.Components || {};

window.Components.claudeConfig = () => ({
    config: { env: {} },
    configPath: '', // Dynamic path from backend
    models: [],
    loading: false,
    restoring: false,
    gemini1mSuffix: false,

    // Mode toggle state (proxy/paid)
    currentMode: 'proxy', // 'proxy' or 'paid'
    modeLoading: false,

    /**
     * Extract port from ANTHROPIC_BASE_URL for display
     * @returns {string} Port number or '8080' as fallback
     */
    getProxyPort() {
        const baseUrl = this.config?.env?.ANTHROPIC_BASE_URL || '';
        try {
            const url = new URL(baseUrl);
            return url.port || '8080';
        } catch {
            return '8080';
        }
    },

    // Presets state
    presets: [],
    selectedPresetName: '',
    savingPreset: false,
    deletingPreset: false,
    pendingPresetName: '', // For unsaved changes confirmation
    newPresetName: '', // For save preset modal input
    saveThenLoadPresetName: '',

    // Model fields that may contain Gemini model names
    geminiModelFields: [
        'ANTHROPIC_MODEL',
        'CLAUDE_CODE_SUBAGENT_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL'
    ],

    init() {
        // Only fetch config if this is the active sub-tab
        if (this.$store.global.settingsTab === 'claude') {
            this.fetchConfig();
            this.fetchPresets();
            this.fetchMode();
        }

        // Watch settings sub-tab (skip initial trigger)
        this.$watch('$store.global.settingsTab', (tab, oldTab) => {
            if (tab === 'claude' && oldTab !== undefined) {
                this.fetchConfig();
                this.fetchPresets();
                this.fetchMode();
            }
        });

        this.$watch('$store.data.models', (val) => {
            this.models = val || [];
        });
        this.models = Alpine.store('data').models || [];
    },

    /**
     * Get env safely — returns {} when config.env is undefined (e.g. Paid mode)
     */
    getEnv() {
        return this.config?.env ?? {};
    },

    /**
     * Detect if any Gemini model has [1m] suffix
     */
    detectGemini1mSuffix() {
        const env = this.getEnv();
        for (const field of this.geminiModelFields) {
            const val = env[field];
            if (val && val.toLowerCase().includes('gemini') && val.includes('[1m]')) {
                return true;
            }
        }
        return false;
    },

    /**
     * Toggle [1m] suffix for all Gemini models
     */
    toggleGemini1mSuffix(enabled) {
        if (!this.config.env) this.config.env = {};
        for (const field of this.geminiModelFields) {
            const val = this.config.env[field];
            if (val && /gemini/i.test(val)) {
                if (enabled && !val.includes('[1m]')) {
                    this.config.env[field] = val.trim() + '[1m]';
                } else if (!enabled && val.includes('[1m]')) {
                    this.config.env[field] = val.replace(/\s*\[1m\]$/i, '').trim();
                }
            }
        }
        this.gemini1mSuffix = enabled;
    },

    /**
     * Helper to select a model from the dropdown
     * @param {string} field - The config.env field to update
     * @param {string} modelId - The selected model ID
     */
    selectModel(field, modelId) {
        if (!this.config.env) this.config.env = {};

        let finalModelId = modelId;
        if (this.gemini1mSuffix && modelId.toLowerCase().includes('gemini')) {
            if (!finalModelId.includes('[1m]')) {
                finalModelId = finalModelId.trim() + '[1m]';
            }
        }

        this.config.env[field] = finalModelId;
    },

    async fetchConfig() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/claude/config', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.config = data.config || {};
            this.configPath = data.path || '~/.claude/settings.json';
            if (!this.config.env) this.config.env = {};

            const hasExistingSuffix = this.detectGemini1mSuffix();
            const hasGeminiModels = this.geminiModelFields.some(f =>
                this.config.env[f]?.toLowerCase().includes('gemini')
            );

            if (!hasExistingSuffix && hasGeminiModels) {
                this.toggleGemini1mSuffix(true);
            } else {
                this.gemini1mSuffix = hasExistingSuffix || !hasGeminiModels;
            }
        } catch (e) {
            console.error('Failed to fetch Claude config:', e);
        }
    },

    async saveClaudeConfig() {
        this.loading = true;
        const password = Alpine.store('global').webuiPassword;
        try {
            window.dispatchEvent(new CustomEvent('model-dropdown:commit-all'));
            await this.$nextTick();

            document.querySelectorAll('[data-model-field]').forEach((input) => {
                const field = input.dataset.modelField;
                if (!field) return;
                const value = String(input.value || '').trim();
                if (!this.config.env) this.config.env = {};
                if (value) {
                    this.config.env[field] = value;
                } else {
                    delete this.config.env[field];
                }
            });

            const { response, newPassword } = await window.utils.request('/api/claude/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const activeModel = this.config?.env?.ANTHROPIC_MODEL || '';
            Alpine.store('global').showToast(Alpine.store('global').t('claudeConfigSaved') + (activeModel ? ' Model: ' + activeModel : ''), 'success');
        } catch (e) {
            Alpine.store('global').showToast(Alpine.store('global').t('saveConfigFailed') + ': ' + e.message, 'error');
        } finally {
            this.loading = false;
        }
    },

    restoreDefaultClaudeConfig() {
        document.getElementById('restore_defaults_modal').showModal();
    },

    async executeRestore() {
        this.restoring = true;
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/claude/config/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            Alpine.store('global').showToast(Alpine.store('global').t('claudeConfigRestored'), 'success');
            document.getElementById('restore_defaults_modal').close();
            await this.fetchConfig();
        } catch (e) {
            Alpine.store('global').showToast(Alpine.store('global').t('restoreConfigFailed') + ': ' + e.message, 'error');
        } finally {
            this.restoring = false;
        }
    },

    // ==========================================
    // Presets Management
    // ==========================================

    async fetchPresets() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/claude/presets', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.presets = data.presets || [];
                if (this.presets.length > 0 && !this.selectedPresetName) {
                    this.selectedPresetName = this.presets[0].name;
                }
            }
        } catch (e) {
            console.error('Failed to fetch presets:', e);
        }
    },

    loadSelectedPreset() {
        const preset = this.presets.find(p => p.name === this.selectedPresetName);
        if (!preset) return;

        if (!this.config.env) this.config.env = {};
        this.config.env = { ...this.config.env, ...preset.config };
        this.gemini1mSuffix = this.detectGemini1mSuffix();

        Alpine.store('global').showToast(
            Alpine.store('global').t('presetLoaded') || `Preset "${preset.name}" loaded. Click "Apply to Claude CLI" to save.`,
            'success'
        );
    },

    currentConfigMatchesPreset() {
        const relevantKeys = [
            'ANTHROPIC_BASE_URL',
            'ANTHROPIC_AUTH_TOKEN',
            'ANTHROPIC_MODEL',
            'CLAUDE_CODE_SUBAGENT_MODEL',
            'ANTHROPIC_DEFAULT_OPUS_MODEL',
            'ANTHROPIC_DEFAULT_SONNET_MODEL',
            'ANTHROPIC_DEFAULT_HAIKU_MODEL'
        ];

        const env = this.getEnv();
        for (const preset of this.presets) {
            let matches = true;
            for (const key of relevantKeys) {
                const currentVal = env[key] || '';
                const presetVal = preset.config[key] || '';
                if (currentVal !== presetVal) {
                    matches = false;
                    break;
                }
            }
            if (matches) return true;
        }
        return false;
    },

    async onPresetSelect(newPresetName) {
        if (!newPresetName || newPresetName === this.selectedPresetName) return;

        const hasUnsavedChanges = !this.currentConfigMatchesPreset();

        if (hasUnsavedChanges) {
            this.pendingPresetName = newPresetName;
            document.getElementById('unsaved_changes_modal').showModal();
            return;
        }

        this.selectedPresetName = newPresetName;
        this.loadSelectedPreset();
    },

    confirmLoadPreset() {
        document.getElementById('unsaved_changes_modal').close();
        this.selectedPresetName = this.pendingPresetName;
        this.pendingPresetName = '';
        this.loadSelectedPreset();
    },

    cancelLoadPreset() {
        document.getElementById('unsaved_changes_modal').close();
        const select = document.querySelector('[aria-label="Select preset"]');
        if (select) select.value = this.selectedPresetName;
        this.pendingPresetName = '';
        this.saveThenLoadPresetName = '';
    },

    saveBeforeLoadPreset() {
        if (!this.pendingPresetName) return;
        this.saveThenLoadPresetName = this.pendingPresetName;
        document.getElementById('unsaved_changes_modal').close();
        this.saveCurrentAsPreset();
    },

    async saveCurrentAsPreset() {
        this.newPresetName = '';
        const modal = document.getElementById('save_preset_modal');
        if (!modal) {
            Alpine.store('global').showToast('Save preset dialog not found', 'error');
            return;
        }
        if (!modal.open) {
            modal.showModal();
        }
    },

    async saveToSelectedPreset() {
        if (!this.selectedPresetName) {
            Alpine.store('global').showToast('Select a preset first', 'error');
            return;
        }
        await this.executeSavePreset(this.selectedPresetName);
    },

    async executeSavePreset(name) {
        const cleanedName = String(name || '').trim();
        if (!cleanedName) {
            Alpine.store('global').showToast(Alpine.store('global').t('presetNameRequired'), 'error');
            return;
        }
        if (cleanedName.length > 60) {
            Alpine.store('global').showToast('Preset name must be 60 characters or fewer', 'error');
            return;
        }

        this.savingPreset = true;
        const password = Alpine.store('global').webuiPassword;

        try {
            // FIX: use getEnv() so this works even when config.env is undefined (Paid mode)
            const env = this.getEnv();
            const relevantKeys = [
                'ANTHROPIC_BASE_URL',
                'ANTHROPIC_AUTH_TOKEN',
                'ANTHROPIC_MODEL',
                'CLAUDE_CODE_SUBAGENT_MODEL',
                'ANTHROPIC_DEFAULT_OPUS_MODEL',
                'ANTHROPIC_DEFAULT_SONNET_MODEL',
                'ANTHROPIC_DEFAULT_HAIKU_MODEL'
            ];
            const presetConfig = {};
            relevantKeys.forEach(k => {
                if (env[k]) presetConfig[k] = env[k];
            });

            const { response, newPassword } = await window.utils.request('/api/claude/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: cleanedName, config: presetConfig })
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.presets = data.presets || [];
                this.selectedPresetName = cleanedName;
                this.newPresetName = '';
                Alpine.store('global').showToast(
                    Alpine.store('global').t('presetSaved') || `Preset "${cleanedName}" saved`,
                    'success'
                );
                const modal = document.getElementById('save_preset_modal');
                if (modal && modal.open) modal.close();

                if (this.saveThenLoadPresetName) {
                    this.selectedPresetName = this.saveThenLoadPresetName;
                    this.saveThenLoadPresetName = '';
                    this.pendingPresetName = '';
                    this.loadSelectedPreset();
                }
            } else {
                throw new Error(data.error || Alpine.store('global').t('saveFailed'));
            }
        } catch (e) {
            Alpine.store('global').showToast(Alpine.store('global').t('failedToSavePreset') + ': ' + e.message, 'error');
        } finally {
            this.savingPreset = false;
        }
    },

    async deleteSelectedPreset() {
        if (!this.selectedPresetName) {
            Alpine.store('global').showToast(Alpine.store('global').t('noPresetSelected'), 'warning');
            return;
        }

        const confirmMsg = Alpine.store('global').t('deletePresetConfirm', { name: this.selectedPresetName });
        if (!confirm(confirmMsg)) return;

        this.deletingPreset = true;
        const password = Alpine.store('global').webuiPassword;

        try {
            const { response, newPassword } = await window.utils.request(
                `/api/claude/presets/${encodeURIComponent(this.selectedPresetName)}`,
                { method: 'DELETE' },
                password
            );
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.presets = data.presets || [];
                this.selectedPresetName = this.presets.length > 0 ? this.presets[0].name : '';
                Alpine.store('global').showToast(
                    Alpine.store('global').t('presetDeleted') || 'Preset deleted',
                    'success'
                );
            } else {
                throw new Error(data.error || Alpine.store('global').t('deleteFailed'));
            }
        } catch (e) {
            Alpine.store('global').showToast(Alpine.store('global').t('failedToDeletePreset') + ': ' + e.message, 'error');
        } finally {
            this.deletingPreset = false;
        }
    },

    // ==========================================
    // Mode Toggle (Proxy/Paid)
    // ==========================================

    async fetchMode() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/claude/mode', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.currentMode = data.mode;
            }
        } catch (e) {
            console.error('Failed to fetch mode:', e);
        }
    },

    async toggleMode(newMode) {
        if (this.modeLoading || newMode === this.currentMode) return;

        this.modeLoading = true;
        const password = Alpine.store('global').webuiPassword;

        try {
            const { response, newPassword } = await window.utils.request('/api/claude/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: newMode })
            }, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data.status === 'ok') {
                this.currentMode = data.mode;
                if (data.config) {
                    this.config = data.config;
                    if (!this.config.env) this.config.env = {};
                }
                Alpine.store('global').showToast(data.message, 'success');
                await this.fetchConfig();
                await this.fetchMode();
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
