/**
 * Codex CLI Configuration Utility
 *
 * Writes Model Hub settings to ~/.codex/config.toml without requiring manual env vars.
 * Uses two managed blocks:
 * - Root block (top-level keys)
 * - Tables block (profiles/provider tables)
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

const ROOT_START = '# >>> modelhub-codex-root >>>';
const ROOT_END = '# <<< modelhub-codex-root <<<';
const TABLES_START = '# >>> modelhub-codex-tables >>>';
const TABLES_END = '# <<< modelhub-codex-tables <<<';

// Backward-compat legacy single-block marker used by previous implementation.
const LEGACY_START = '# >>> antigravity-codex-proxy >>>';
const LEGACY_END = '# <<< antigravity-codex-proxy <<<';

const DEFAULT_CODEX_PROXY_CONFIG = {
    profile: 'default',
    providerId: 'modelhub',
    model: 'ollama/deepseek-v3.1:671b-cloud',
    baseUrl: 'http://localhost:8081/v1',
    apiKey: 'test',
    wireApi: 'responses'
};

const DEFAULT_CODEX_PRESETS = [
    {
        name: 'Codex Ollama',
        config: {
            providerId: 'modelhub',
            model: 'ollama/deepseek-v3.1:671b-cloud',
            baseUrl: 'http://localhost:8081/v1',
            apiKey: 'test',
            wireApi: 'responses'
        }
    }
];

function escapeTomlString(value = '') {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stripManagedBlocks(content = '') {
    const rootRe = new RegExp(`${ROOT_START}[\\s\\S]*?${ROOT_END}\\r?\\n?`, 'm');
    const tablesRe = new RegExp(`${TABLES_START}[\\s\\S]*?${TABLES_END}\\r?\\n?`, 'm');
    const legacyRe = new RegExp(`${LEGACY_START}[\\s\\S]*?${LEGACY_END}\\r?\\n?`, 'm');
    return content.replace(rootRe, '').replace(tablesRe, '').replace(legacyRe, '');
}

function splitRootAndTables(content = '') {
    const lines = content.split(/\r?\n/);
    const firstTableIndex = lines.findIndex(line => /^\s*\[[^\]]+\]\s*$/.test(line));
    if (firstTableIndex === -1) {
        return { root: content.trim(), tables: '' };
    }
    return {
        root: lines.slice(0, firstTableIndex).join('\n').trim(),
        tables: lines.slice(firstTableIndex).join('\n').trim()
    };
}

function removeTopLevelKeys(rootContent = '') {
    const lines = rootContent.split(/\r?\n/);
    const previous = { profile: '', modelProvider: '', model: '' };
    const kept = [];

    for (const line of lines) {
        const profileMatch = line.match(/^\s*profile\s*=\s*"([^"]*)"\s*$/);
        if (profileMatch) {
            if (!previous.profile) previous.profile = profileMatch[1];
            continue;
        }

        const providerMatch = line.match(/^\s*model_provider\s*=\s*"([^"]*)"\s*$/);
        if (providerMatch) {
            if (!previous.modelProvider) previous.modelProvider = providerMatch[1];
            continue;
        }

        const modelMatch = line.match(/^\s*model\s*=\s*"([^"]*)"\s*$/);
        if (modelMatch) {
            if (!previous.model) previous.model = modelMatch[1];
            continue;
        }

        kept.push(line);
    }

    return { root: kept.join('\n').trim(), previous };
}

function removeNamedTable(content = '', tableName = '') {
    if (!tableName) return content;
    const lines = content.split(/\r?\n/);
    const kept = [];
    let skip = false;

    for (const line of lines) {
        const tableMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
        if (tableMatch) {
            const currentTable = tableMatch[1].trim();
            if (currentTable === tableName) {
                skip = true;
                continue;
            }
            skip = false;
        }
        if (!skip) kept.push(line);
    }

    return kept.join('\n').trim();
}

function parseRootBlock(content = '') {
    const rootRe = new RegExp(`${ROOT_START}[\\s\\S]*?${ROOT_END}`, 'm');
    const match = content.match(rootRe);
    if (!match) {
        return { enabled: false, previous: { profile: '', modelProvider: '', model: '' }, config: { ...DEFAULT_CODEX_PROXY_CONFIG } };
    }

    const block = match[0];
    const readComment = (key) => (block.match(new RegExp(`#\\s*${key}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || '';
    const readKey = (key) => (block.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || '';

    return {
        enabled: true,
        previous: {
            profile: readComment('previous_profile'),
            modelProvider: readComment('previous_model_provider'),
            model: readComment('previous_model')
        },
        config: {
            ...DEFAULT_CODEX_PROXY_CONFIG,
            profile: readKey('profile') || DEFAULT_CODEX_PROXY_CONFIG.profile,
            providerId: readKey('model_provider') || DEFAULT_CODEX_PROXY_CONFIG.providerId,
            model: readKey('model') || DEFAULT_CODEX_PROXY_CONFIG.model
        }
    };
}

function parseTablesBlock(content = '', config) {
    const tablesRe = new RegExp(`${TABLES_START}[\\s\\S]*?${TABLES_END}`, 'm');
    const match = content.match(tablesRe);
    if (!match) return config;
    const block = match[0];
    const readKey = (key) => (block.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || '';

    return {
        ...config,
        baseUrl: readKey('base_url') || config.baseUrl,
        apiKey: readKey('api_key') || config.apiKey,
        wireApi: readKey('wire_api') || config.wireApi
    };
}

function buildRootBlock(config, previous) {
    return [
        ROOT_START,
        '# Managed by Model Hub WebUI (Codex CLI tab)',
        `# previous_profile = "${escapeTomlString(previous.profile || '')}"`,
        `# previous_model_provider = "${escapeTomlString(previous.modelProvider || '')}"`,
        `# previous_model = "${escapeTomlString(previous.model || '')}"`,
        `profile = "${escapeTomlString(config.profile)}"`,
        `model_provider = "${escapeTomlString(config.providerId)}"`,
        `model = "${escapeTomlString(config.model)}"`,
        ROOT_END
    ].join('\n');
}

function buildTablesBlock(config) {
    return [
        TABLES_START,
        `[profiles.${config.profile}]`,
        `model_provider = "${escapeTomlString(config.providerId)}"`,
        `model = "${escapeTomlString(config.model)}"`,
        '',
        `[model_providers.${config.providerId}]`,
        'name = "Model Hub Proxy"',
        `base_url = "${escapeTomlString(config.baseUrl)}"`,
        `api_key = "${escapeTomlString(config.apiKey)}"`,
        `wire_api = "${escapeTomlString(config.wireApi)}"`,
        TABLES_END
    ].join('\n');
}

function normalizeForWrite(input = {}) {
    return {
        profile: DEFAULT_CODEX_PROXY_CONFIG.profile,
        providerId: DEFAULT_CODEX_PROXY_CONFIG.providerId,
        model: (input.model || DEFAULT_CODEX_PROXY_CONFIG.model).trim() || DEFAULT_CODEX_PROXY_CONFIG.model,
        baseUrl: (input.baseUrl || DEFAULT_CODEX_PROXY_CONFIG.baseUrl).trim() || DEFAULT_CODEX_PROXY_CONFIG.baseUrl,
        apiKey: String(input.apiKey || DEFAULT_CODEX_PROXY_CONFIG.apiKey),
        wireApi: 'responses'
    };
}

export function getCodexConfigPath() {
    if (process.env.CODEX_HOME) {
        return path.join(process.env.CODEX_HOME, 'config.toml');
    }
    return path.join(os.homedir(), '.codex', 'config.toml');
}

export function getCodexPresetsPath() {
    return path.join(os.homedir(), '.config', 'modelhub-proxy', 'codex-presets.json');
}

export async function readCodexProxyConfig() {
    const configPath = getCodexConfigPath();
    try {
        const content = await fs.readFile(configPath, 'utf8');
        const parsedRoot = parseRootBlock(content);
        const config = parseTablesBlock(content, parsedRoot.config);
        return {
            path: configPath,
            mode: parsedRoot.enabled ? 'proxy' : 'paid',
            config
        };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { path: configPath, mode: 'paid', config: { ...DEFAULT_CODEX_PROXY_CONFIG } };
        }
        logger.error('[CodexConfig] Failed to read config:', error.message);
        throw error;
    }
}

export async function setCodexProxyConfig(inputConfig = {}) {
    const configPath = getCodexConfigPath();
    const config = normalizeForWrite(inputConfig);
    let content = '';
    try {
        content = await fs.readFile(configPath, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const parsedRoot = parseRootBlock(content);
    let clean = stripManagedBlocks(content);

    // Remove old target tables if user had them outside managed blocks.
    clean = removeNamedTable(clean, `profiles.${config.profile}`);
    clean = removeNamedTable(clean, `model_providers.${config.providerId}`);

    const split = splitRootAndTables(clean);
    const rootCleaned = removeTopLevelKeys(split.root);
    const previous = {
        profile: parsedRoot.previous.profile || rootCleaned.previous.profile,
        modelProvider: parsedRoot.previous.modelProvider || rootCleaned.previous.modelProvider,
        model: parsedRoot.previous.model || rootCleaned.previous.model
    };

    const rootBlock = buildRootBlock(config, previous);
    const tablesBlock = buildTablesBlock(config);

    const rootPart = [rootBlock, rootCleaned.root].filter(Boolean).join('\n\n').trim();
    const tablesPart = [split.tables, tablesBlock].filter(Boolean).join('\n\n').trim();
    const nextContent = [rootPart, tablesPart].filter(Boolean).join('\n\n') + '\n';

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, nextContent, 'utf8');
    logger.info(`[CodexConfig] Updated config at ${configPath}`);
    return { path: configPath, mode: 'proxy', config };
}

export async function setCodexPaidMode() {
    const configPath = getCodexConfigPath();
    let content = '';
    try {
        content = await fs.readFile(configPath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { path: configPath, mode: 'paid', config: { ...DEFAULT_CODEX_PROXY_CONFIG } };
        }
        throw error;
    }

    const parsedRoot = parseRootBlock(content);
    const config = parseTablesBlock(content, parsedRoot.config);
    let clean = stripManagedBlocks(content);
    clean = removeNamedTable(clean, `profiles.${config.profile}`);
    clean = removeNamedTable(clean, `model_providers.${config.providerId}`);

    const split = splitRootAndTables(clean);
    const rootCleaned = removeTopLevelKeys(split.root);

    const restore = [];
    if (parsedRoot.previous.profile) restore.push(`profile = "${escapeTomlString(parsedRoot.previous.profile)}"`);
    if (parsedRoot.previous.modelProvider) restore.push(`model_provider = "${escapeTomlString(parsedRoot.previous.modelProvider)}"`);
    if (parsedRoot.previous.model) restore.push(`model = "${escapeTomlString(parsedRoot.previous.model)}"`);

    const rootPart = [restore.join('\n').trim(), rootCleaned.root].filter(Boolean).join('\n\n').trim();
    const nextContent = [rootPart, split.tables].filter(Boolean).join('\n\n');

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, nextContent ? `${nextContent}\n` : '', 'utf8');
    logger.info(`[CodexConfig] Restored paid mode at ${configPath}`);
    return { path: configPath, mode: 'paid', config };
}

export async function readCodexPresets() {
    const presetsPath = getCodexPresetsPath();
    try {
        const content = await fs.readFile(presetsPath, 'utf8');
        if (!content.trim()) return DEFAULT_CODEX_PRESETS;
        return JSON.parse(content);
    } catch (error) {
        if (error.code === 'ENOENT') {
            try {
                await fs.mkdir(path.dirname(presetsPath), { recursive: true });
                await fs.writeFile(presetsPath, JSON.stringify(DEFAULT_CODEX_PRESETS, null, 2), 'utf8');
                logger.info(`[CodexPresets] Created presets file with defaults at ${presetsPath}`);
            } catch (writeError) {
                logger.warn(`[CodexPresets] Could not create presets file: ${writeError.message}`);
            }
            return DEFAULT_CODEX_PRESETS;
        }
        if (error instanceof SyntaxError) {
            logger.error(`[CodexPresets] Invalid JSON in presets at ${presetsPath}. Returning defaults.`);
            return DEFAULT_CODEX_PRESETS;
        }
        logger.error(`[CodexPresets] Failed to read presets at ${presetsPath}: ${error.message}`);
        throw error;
    }
}

export async function saveCodexPreset(name, presetConfig) {
    const cleanedName = String(name || '').trim();
    if (!cleanedName) throw new Error('Preset name is required');
    const config = normalizeForWrite(presetConfig || {});
    const presetsPath = getCodexPresetsPath();
    const presets = await readCodexPresets();
    const nextPreset = { name: cleanedName, config };
    const idx = presets.findIndex(p => p?.name === cleanedName);
    if (idx >= 0) {
        presets[idx] = nextPreset;
        logger.info(`[CodexPresets] Updated preset: ${cleanedName}`);
    } else {
        presets.push(nextPreset);
        logger.info(`[CodexPresets] Created preset: ${cleanedName}`);
    }
    await fs.mkdir(path.dirname(presetsPath), { recursive: true });
    await fs.writeFile(presetsPath, JSON.stringify(presets, null, 2), 'utf8');
    return presets;
}

export async function deleteCodexPreset(name) {
    const cleanedName = String(name || '').trim();
    if (!cleanedName) throw new Error('Preset name is required');
    const presetsPath = getCodexPresetsPath();
    let presets = await readCodexPresets();
    const originalLength = presets.length;
    presets = presets.filter(p => p?.name !== cleanedName);
    if (presets.length === originalLength) {
        logger.warn(`[CodexPresets] Preset not found: ${cleanedName}`);
        return presets;
    }
    await fs.mkdir(path.dirname(presetsPath), { recursive: true });
    await fs.writeFile(presetsPath, JSON.stringify(presets, null, 2), 'utf8');
    logger.info(`[CodexPresets] Deleted preset: ${cleanedName}`);
    return presets;
}

