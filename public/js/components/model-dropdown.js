/**
 * Model Dropdown Component
 * Reusable grouped model selector with search, clear, and keyboard navigation.
 * Registers itself to window.Components for Alpine.js to consume.
 *
 * Usage (inside x-data="claudeConfig"):
 *   x-data="window.Components.modelDropdown('ANTHROPIC_MODEL', 'primaryModel', 'cyan')"
 *
 * @param {string} field - config.env key (e.g. 'ANTHROPIC_MODEL')
 * @param {string} labelKey - i18n key for the label
 * @param {string} accentColor - 'cyan' or 'purple' (maps to Tailwind border classes)
 *
 * Requires parent scope to provide: config, selectModel(), gemini1mSuffix
 */
window.Components = window.Components || {};

window.Components.modelDropdown = (field, labelKey, accentColor) => ({
    field,
    labelKey,
    accentColor,

    open: false,
    searchTerm: '',
    highlightIndex: -1,

    init() {
        if (typeof this.selectModel !== 'function' || !this.config) {
            console.error(`modelDropdown(${field}): must be nested inside a parent scope that provides config and selectModel()`);
        }

        this._commitAllHandler = () => {
            this.closeDropdown();
        };
        window.addEventListener('model-dropdown:commit-all', this._commitAllHandler);

        this.$nextTick(() => {
            if (this.$refs.dropdownInput) {
                this.$refs.dropdownInput.dataset.modelField = this.field;
            }
        });
    },

    get currentValue() {
        return this.config?.env?.[this.field] || '';
    },

    get filteredModels() {
        const models = this.$store.data.models || [];
        const defaults = [
            'ollama/llama3.1:8b',
            'ollama/qwen2.5:7b',
            'ollama/deepseek-r1:8b',
            'ollama/mistral:7b',
            'openai/gpt-4o',
            'openai/gpt-4.1',
            'openai/o3',
            'kimi/moonshotai/kimi-k2.5'
        ];
        const merged = Array.from(new Set([...models, ...defaults]));

        if (!this.searchTerm) return merged;
        const term = this.searchTerm.toLowerCase();
        const filtered = merged.filter(m => m.toLowerCase().includes(term));

        const custom = this.normalizeCustomModel(this.searchTerm);
        if (custom && !filtered.includes(custom)) {
            return [custom, ...filtered];
        }
        return filtered;
    },

    normalizeCustomModel(modelId) {
        const raw = String(modelId || '').trim();
        if (!raw) return '';

        const lower = raw.toLowerCase();
        const openAiLike = (name) => name.startsWith('gpt-') || name.startsWith('o1') || name.startsWith('o3') || name.startsWith('o4');
        const kimiLike = (name) => name.includes('kimi') || name.includes('moonshot');

        if (raw.includes('/')) {
            const slashIdx = raw.indexOf('/');
            const prefix = lower.slice(0, slashIdx);
            const rest = raw.slice(slashIdx + 1);
            const restLower = rest.toLowerCase();

            if (prefix === 'ollama' || prefix === 'openai' || prefix === 'kimi') return raw;
            if (openAiLike(restLower)) return `openai/${rest}`;
            if (kimiLike(restLower)) return `kimi/${rest}`;
            return raw;
        }

        if (openAiLike(lower)) return `openai/${raw}`;
        if (kimiLike(lower)) return `kimi/${raw}`;
        if (lower.includes('llama') || lower.includes('qwen') || lower.includes('deepseek')) return `ollama/${raw}`;
        return raw;
    },

    chooseCustomFromSearch() {
        const custom = this.normalizeCustomModel(this.searchTerm);
        if (!custom) return;
        this.choose(custom);
    },

    get groupedModels() {
        const groups = [
            { family: 'claude', label: this.$store.global.t('familyClaude'), items: [] },
            { family: 'gemini', label: this.$store.global.t('familyGemini'), items: [] },
            { family: 'ollama', label: 'Ollama', items: [] },
            { family: 'openai', label: 'OpenAI', items: [] },
            { family: 'kimi', label: 'Kimi', items: [] },
            { family: 'other', label: this.$store.global.t('familyOther'), items: [] }
        ];
        for (const modelId of this.filteredModels) {
            const fam = this.$store.data.getModelFamily(modelId);
            const group = groups.find(g => g.family === fam) || groups.find(g => g.family === 'other');
            group.items.push(modelId);
        }
        return groups.filter(g => g.items.length > 0);
    },

    get flatItems() {
        const items = [];
        if (this.currentValue) {
            items.push({ type: 'clear' });
        }
        for (const group of this.groupedModels) {
            for (const modelId of group.items) {
                items.push({ type: 'model', id: modelId });
            }
        }
        return items;
    },

    get focusBorderClass() {
        return this.accentColor === 'purple'
            ? 'focus:!border-neon-purple'
            : 'focus:!border-neon-cyan';
    },

    openDropdown() {
        this.open = true;
        this.searchTerm = '';
        this.highlightIndex = -1;
    },

    closeDropdown({ commitTyped = true } = {}) {
        if (commitTyped && String(this.searchTerm || '').trim()) {
            const custom = this.normalizeCustomModel(this.searchTerm);
            if (custom) {
                this.selectModel(this.field, custom);
            }
        }
        this.open = false;
        this.searchTerm = '';
        this.highlightIndex = -1;
    },

    choose(modelId) {
        this.selectModel(this.field, modelId);
        this.closeDropdown({ commitTyped: false });
    },

    clearField() {
        if (this.config?.env) {
            delete this.config.env[this.field];
        }
        this.closeDropdown({ commitTyped: false });
    },

    isSelected(modelId) {
        const val = this.currentValue;
        return val === modelId || val === modelId + '[1m]';
    },

    onKeydown(event) {
        if (!this.open) {
            if (event.key === 'ArrowDown' || event.key === 'Enter') {
                event.preventDefault();
                this.openDropdown();
            }
            return;
        }

        const items = this.flatItems;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.highlightIndex = Math.min(this.highlightIndex + 1, items.length - 1);
            this.scrollToHighlighted();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.highlightIndex = Math.max(this.highlightIndex - 1, 0);
            this.scrollToHighlighted();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (this.highlightIndex >= 0 && this.highlightIndex < items.length) {
                const item = items[this.highlightIndex];
                if (item.type === 'clear') {
                    this.clearField();
                } else {
                    this.choose(item.id);
                }
            } else if (String(this.searchTerm || '').trim()) {
                this.chooseCustomFromSearch();
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.closeDropdown({ commitTyped: false });
        }
    },

    scrollToHighlighted() {
        this.$nextTick(() => {
            const list = this.$refs.dropdownList;
            if (!list) return;
            const el = list.querySelector('[data-highlight="true"]');
            if (el) el.scrollIntoView({ block: 'nearest' });
        });
    },

    getFlatIndex(modelId) {
        return this.flatItems.findIndex(i => i.type === 'model' && i.id === modelId);
    }
});

