import crypto from 'crypto';
import { config } from '../config.js';
import { throttledFetch } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { trackOllamaFailure, trackOllamaUsage, getOllamaUsageSnapshot } from './stats.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_COOLDOWN_MS = 30000;

let rrCursor = 0;
const upstreamState = new Map(); // url -> { cooldownUntil, lastError }

function normalizeUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}

function buildOpenAIUrl(baseUrl, pathWithV1) {
    const base = normalizeUrl(baseUrl);
    const path = String(pathWithV1 || '');
    if (base.endsWith('/v1')) {
        return `${base}${path.replace(/^\/v1/, '')}`;
    }
    return `${base}${path}`;
}

function getOllamaBaseUrls() {
    const envPool = process.env.OLLAMA_BASE_URLS
        ? process.env.OLLAMA_BASE_URLS.split(',').map(normalizeUrl).filter(Boolean)
        : [];
    if (envPool.length > 0) return envPool;

    const envSingle = normalizeUrl(process.env.OLLAMA_BASE_URL);
    if (envSingle) return [envSingle];

    const configPool = Array.isArray(config.ollamaBaseUrls)
        ? config.ollamaBaseUrls.map(normalizeUrl).filter(Boolean)
        : [];
    if (configPool.length > 0) return configPool;

    const configSingle = normalizeUrl(config.ollamaBaseUrl);
    if (configSingle) return [configSingle];

    return [DEFAULT_OLLAMA_BASE_URL];
}

function getApiKeys(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.map(v => String(v || '').trim()).filter(Boolean).slice(0, 100);
    }
    return String(value)
        .split(',')
        .map(v => String(v || '').trim())
        .filter(Boolean)
        .slice(0, 100);
}

function getOllamaCloudBaseUrl() {
    const env = normalizeUrl(process.env.OLLAMA_CLOUD_BASE_URL);
    if (env) return env;
    return normalizeUrl(config.ollamaCloudBaseUrl);
}

function getOllamaApiKeys() {
    const envKeys = getApiKeys(process.env.OLLAMA_API_KEYS);
    if (envKeys.length > 0) return envKeys;
    return getApiKeys(config.ollamaApiKeys);
}

function getOpenAIBaseUrl() {
    const env = normalizeUrl(process.env.OPENAI_BASE_URL);
    if (env) return env;
    const cfg = normalizeUrl(config.openaiBaseUrl);
    if (cfg) return cfg;
    return 'https://api.openai.com/v1';
}

function getOpenAIApiKeys() {
    const envKeys = getApiKeys(process.env.OPENAI_API_KEYS);
    if (envKeys.length > 0) return envKeys;
    return getApiKeys(config.openaiApiKeys);
}

function getKimiBaseUrl() {
    const env = normalizeUrl(process.env.KIMI_BASE_URL);
    if (env) return env;
    const cfg = normalizeUrl(config.kimiBaseUrl);
    if (cfg) return cfg;
    return 'https://integrate.api.nvidia.com/v1';
}

function getKimiApiKeys() {
    const envKeys = getApiKeys(process.env.KIMI_API_KEYS);
    if (envKeys.length > 0) return envKeys;
    return getApiKeys(config.kimiApiKeys);
}

function getProviderFromModelId(modelId) {
    if (typeof modelId !== 'string') return 'ollama';
    if (modelId.startsWith('openai/')) return 'openai';
    if (modelId.startsWith('kimi/')) return 'kimi';
    return 'ollama';
}

function assertProviderCredentials(modelId) {
    const provider = getProviderFromModelId(modelId);
    if (provider === 'openai' && getOpenAIApiKeys().length === 0) {
        throw new Error('Provider API key missing: configure OpenAI API Keys in Settings (or OPENAI_API_KEYS env var).');
    }
    if (provider === 'kimi' && getKimiApiKeys().length === 0) {
        throw new Error('Provider API key missing: configure Kimi API Keys in Settings (or KIMI_API_KEYS env var).');
    }
}


function buildUpstreams(modelId) {
    const provider = getProviderFromModelId(modelId);

    if (provider === 'openai') {
        const baseUrl = getOpenAIBaseUrl();
        const keys = getOpenAIApiKeys();
        if (keys.length > 0) {
            return keys.map((apiKey, idx) => ({
                id: `openai:key:${idx + 1}:${baseUrl}`,
                baseUrl,
                apiKey
            }));
        }
        return baseUrl ? [{ id: `openai:url:${baseUrl}`, baseUrl, apiKey: '' }] : [];
    }

    if (provider === 'kimi') {
        const baseUrl = getKimiBaseUrl();
        const keys = getKimiApiKeys();
        if (keys.length > 0) {
            return keys.map((apiKey, idx) => ({
                id: `kimi:key:${idx + 1}:${baseUrl}`,
                baseUrl,
                apiKey
            }));
        }
        return baseUrl ? [{ id: `kimi:url:${baseUrl}`, baseUrl, apiKey: '' }] : [];
    }

    const direct = getOllamaBaseUrls().map(url => ({
        id: `ollama:url:${url}`,
        baseUrl: url,
        apiKey: ''
    }));

    const cloudBaseUrl = getOllamaCloudBaseUrl();
    const keys = getOllamaApiKeys();
    const keyUpstreams = cloudBaseUrl && keys.length > 0
        ? keys.map((apiKey, idx) => ({
            id: `ollama:key:${idx + 1}:${cloudBaseUrl}`,
            baseUrl: cloudBaseUrl,
            apiKey
        }))
        : [];

    return [...keyUpstreams, ...direct];
}

function getUpstreamLabel(upstream) {
    if (!upstream || typeof upstream !== 'object') return 'unknown';
    const id = String(upstream.id || '');
    const keyMatch = id.match(/(?:^|:)key:(\d+):/);
    if (keyMatch) {
        const keyNo = keyMatch[1] || '?';
        return `api-key-${keyNo}@${upstream.baseUrl}`;
    }
    return upstream.baseUrl || 'unknown';
}

function getFailoverCooldownMs() {
    const env = Number(process.env.OLLAMA_FAILOVER_COOLDOWN_MS);
    if (Number.isFinite(env) && env >= 1000) return env;
    if (Number.isFinite(config.ollamaFailoverCooldownMs) && config.ollamaFailoverCooldownMs >= 1000) {
        return config.ollamaFailoverCooldownMs;
    }
    return DEFAULT_COOLDOWN_MS;
}

function toModelName(modelId) {
    if (typeof modelId !== 'string') return '';
    if (modelId.startsWith('ollama/')) return modelId.slice('ollama/'.length);
    if (modelId.startsWith('openai/')) return modelId.slice('openai/'.length);
    if (modelId.startsWith('kimi/')) return modelId.slice('kimi/'.length);
    return modelId;
}

function toMessageId(rawId) {
    if (typeof rawId === 'string' && rawId.startsWith('msg_')) return rawId;
    return `msg_${crypto.randomBytes(16).toString('hex')}`;
}

function extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    const parts = [];
    for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') {
            parts.push(block.text);
            continue;
        }
        if (block.type === 'tool_result') {
            if (typeof block.content === 'string') {
                parts.push(block.content);
            } else if (Array.isArray(block.content)) {
                const toolText = block.content
                    .filter(item => item?.type === 'text' && typeof item.text === 'string')
                    .map(item => item.text)
                    .join('\n');
                if (toolText) parts.push(toolText);
            }
        }
    }
    return parts.join('\n');
}

function convertAnthropicMessagesToOpenAI(messages) {
    const converted = [];

    for (const message of messages || []) {
        const role = message?.role || 'user';
        const content = message?.content;

        if (!Array.isArray(content)) {
            converted.push({
                role: role === 'assistant' ? 'assistant' : 'user',
                content: typeof content === 'string' ? content : ''
            });
            continue;
        }

        if (role === 'assistant') {
            const textParts = [];
            const toolCalls = [];

            for (const block of content) {
                if (!block || typeof block !== 'object') continue;
                if (block.type === 'text' && typeof block.text === 'string') {
                    textParts.push(block.text);
                }
                if (block.type === 'tool_use') {
                    const toolId = block.id || `toolu_${crypto.randomBytes(12).toString('hex')}`;
                    toolCalls.push({
                        id: toolId,
                        type: 'function',
                        function: {
                            name: block.name || 'tool',
                            arguments: JSON.stringify(block.input || {})
                        }
                    });
                }
            }

            if (textParts.length > 0 || toolCalls.length > 0) {
                converted.push({
                    role: 'assistant',
                    content: textParts.join('\n'),
                    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
                });
            }
            continue;
        }

        const textParts = [];
        for (const block of content) {
            if (!block || typeof block !== 'object') continue;
            if (block.type === 'text' && typeof block.text === 'string') {
                textParts.push(block.text);
                continue;
            }
            if (block.type === 'tool_result') {
                const toolContent = extractTextContent(block.content);
                converted.push({
                    role: 'tool',
                    tool_call_id: block.tool_use_id || block.id || `toolu_${crypto.randomBytes(12).toString('hex')}`,
                    content: toolContent || ''
                });
            }
        }

        if (textParts.length > 0) {
            converted.push({ role: 'user', content: textParts.join('\n') });
        }
    }

    return converted;
}

function convertAnthropicToolsToOpenAI(tools) {
    if (!Array.isArray(tools)) return undefined;

    const converted = tools
        .filter(tool => tool?.name)
        .map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.input_schema || { type: 'object', properties: {} }
            }
        }));

    return converted.length > 0 ? converted : undefined;
}

function normalizeToolChoice(toolChoice) {
    if (!toolChoice) return undefined;
    if (typeof toolChoice === 'string') {
        if (toolChoice === 'auto' || toolChoice === 'none') return toolChoice;
        if (toolChoice === 'any') return 'required';
        return undefined;
    }
    if (toolChoice?.type === 'tool' && toolChoice?.name) {
        return {
            type: 'function',
            function: { name: toolChoice.name }
        };
    }
    if (toolChoice?.type === 'auto' || toolChoice?.type === 'any' || toolChoice?.type === 'none') {
        return normalizeToolChoice(toolChoice.type);
    }
    return undefined;
}

function mapFinishReason(reason, hasToolCalls) {
    if (hasToolCalls || reason === 'tool_calls') return 'tool_use';
    if (reason === 'length') return 'max_tokens';
    return 'end_turn';
}

function toAnthropicResponse(openaiResponse, modelId) {
    const choice = openaiResponse?.choices?.[0] || {};
    const message = choice?.message || {};
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const blocks = [];

    if (typeof message.content === 'string' && message.content.length > 0) {
        blocks.push({
            type: 'text',
            text: message.content
        });
    }

    for (const toolCall of toolCalls) {
        let input = {};
        const rawArgs = toolCall?.function?.arguments;
        if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
            try {
                input = JSON.parse(rawArgs);
            } catch {
                input = { raw: rawArgs };
            }
        }

        blocks.push({
            type: 'tool_use',
            id: toolCall.id || `toolu_${crypto.randomBytes(12).toString('hex')}`,
            name: toolCall?.function?.name || 'tool',
            input
        });
    }

    const usage = openaiResponse?.usage || {};
    return {
        id: toMessageId(openaiResponse?.id),
        type: 'message',
        role: 'assistant',
        model: modelId,
        content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }],
        stop_reason: mapFinishReason(choice?.finish_reason, toolCalls.length > 0),
        stop_sequence: null,
        usage: {
            input_tokens: usage.prompt_tokens || 0,
            output_tokens: usage.completion_tokens || 0
        }
    };
}

function isRetryableOllamaError(status, bodyText) {
    if (status >= 500 || status === 429 || status === 408 || status === 425) return true;
    const lower = String(bodyText || '').toLowerCase();
    return lower.includes('quota') ||
        lower.includes('rate limit') ||
        lower.includes('capacity') ||
        lower.includes('overloaded') ||
        lower.includes('temporarily unavailable');
}

function getUpstreamPlan(upstreams) {
    const now = Date.now();
    const ready = [];
    const cooling = [];

    for (const upstream of upstreams) {
        const state = upstreamState.get(upstream.id);
        const cooldownUntil = state?.cooldownUntil || 0;
        if (cooldownUntil > now) {
            cooling.push({ upstream, cooldownUntil });
        } else {
            ready.push(upstream);
        }
    }

    if (ready.length === 0) {
        return cooling
            .sort((a, b) => a.cooldownUntil - b.cooldownUntil)
            .map(item => item.upstream);
    }

    const offset = rrCursor % ready.length;
    rrCursor = (rrCursor + 1) % Number.MAX_SAFE_INTEGER;
    return [...ready.slice(offset), ...ready.slice(0, offset)];
}

function markUpstreamFailure(upstream, reason) {
    const cooldownMs = getFailoverCooldownMs();
    upstreamState.set(upstream.id, {
        cooldownUntil: Date.now() + cooldownMs,
        lastError: reason
    });
}

function markUpstreamSuccess(upstream) {
    if (!upstreamState.has(upstream.id)) return;
    upstreamState.set(upstream.id, {
        cooldownUntil: 0,
        lastError: null
    });
}

async function sendOpenAICompatibleRequest(anthropicRequest) {
    assertProviderCredentials(anthropicRequest?.model);
    const candidates = getUpstreamPlan(buildUpstreams(anthropicRequest?.model));
    if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error('No upstream configured for selected provider model.');
    }
    const openAIRequest = {
        model: toModelName(anthropicRequest.model),
        messages: convertAnthropicMessagesToOpenAI(anthropicRequest.messages || []),
        stream: false,
        ...(typeof anthropicRequest.max_tokens === 'number' ? { max_tokens: anthropicRequest.max_tokens } : {}),
        ...(typeof anthropicRequest.temperature === 'number' ? { temperature: anthropicRequest.temperature } : {}),
        ...(typeof anthropicRequest.top_p === 'number' ? { top_p: anthropicRequest.top_p } : {})
    };

    const tools = convertAnthropicToolsToOpenAI(anthropicRequest.tools);
    if (tools) openAIRequest.tools = tools;
    const toolChoice = normalizeToolChoice(anthropicRequest.tool_choice);
    if (toolChoice) openAIRequest.tool_choice = toolChoice;

    let lastError = null;

    for (let i = 0; i < candidates.length; i++) {
        const upstream = candidates[i];
        const baseUrl = upstream.baseUrl;
        const label = getUpstreamLabel(upstream);
        const headers = { 'Content-Type': 'application/json' };
        if (upstream.apiKey) headers.Authorization = `Bearer ${upstream.apiKey}`;
        try {
            const response = await throttledFetch(buildOpenAIUrl(baseUrl, '/v1/chat/completions'), {
                method: 'POST',
                headers,
                body: JSON.stringify(openAIRequest)
            });

            if (!response.ok) {
                const text = await response.text();
                if (isRetryableOllamaError(response.status, text) && i < candidates.length - 1) {
                    markUpstreamFailure(upstream, `HTTP ${response.status}`);
                    trackOllamaFailure({ upstream: label, error: `HTTP ${response.status}` });
                    logger.warn(`[Ollama] Upstream ${label} failed (${response.status}), trying next upstream`);
                    continue;
                }
                trackOllamaFailure({ upstream: label, error: `HTTP ${response.status}` });
                throw new Error(`Ollama request failed (${response.status}): ${text}`);
            }

            const openAIResponse = await response.json();
            markUpstreamSuccess(upstream);
            return { openAIResponse, upstream };
        } catch (error) {
            lastError = error;
            const isNetwork = error?.name === 'TypeError' || String(error?.message || '').toLowerCase().includes('fetch');
            if (isNetwork && i < candidates.length - 1) {
                markUpstreamFailure(upstream, String(error.message || 'network error'));
                trackOllamaFailure({ upstream: label, error: error.message || 'network error' });
                logger.warn(`[Ollama] Upstream ${label} network error, trying next upstream`);
                continue;
            }
            if (i < candidates.length - 1) {
                markUpstreamFailure(upstream, String(error.message || 'request failed'));
                trackOllamaFailure({ upstream: label, error: error.message || 'request failed' });
                logger.warn(`[Ollama] Upstream ${label} failed, trying next upstream`);
                continue;
            }
            trackOllamaFailure({ upstream: label, error: error.message || 'request failed' });
            throw error;
        }
    }

    throw lastError || new Error('Ollama request failed');
}

export function isOpenAICompatibleModel(modelId) {
    if (typeof modelId !== 'string') return false;
    return modelId.startsWith('ollama/') || modelId.startsWith('openai/') || modelId.startsWith('kimi/');
}

export function isOllamaModel(modelId) {
    return isOpenAICompatibleModel(modelId);
}

export async function listOllamaModels() {
    const upstreams = getUpstreamPlan(buildUpstreams('ollama/default'));
    let models = null;
    let lastError = null;
    for (const upstream of upstreams) {
        const baseUrl = upstream.baseUrl;
        const headers = { 'Content-Type': 'application/json' };
        if (upstream.apiKey) headers.Authorization = `Bearer ${upstream.apiKey}`;
        try {
            const response = await throttledFetch(`${baseUrl}/api/tags`, {
                method: 'GET',
                headers
            });

            if (!response.ok) {
                // Fallback for OpenAI-compatible endpoints
                const fallback = await throttledFetch(buildOpenAIUrl(baseUrl, '/v1/models'), {
                    method: 'GET',
                    headers
                });
                if (!fallback.ok) {
                    const text = await response.text();
                    markUpstreamFailure(upstream, `HTTP ${response.status}`);
                    lastError = new Error(`Ollama model listing failed (${response.status}): ${text}`);
                    continue;
                }
                const modelData = await fallback.json();
                const data = Array.isArray(modelData?.data) ? modelData.data : [];
                models = data.map(m => ({
                    name: String(m.id || '').replace(/^ollama\//, '')
                })).filter(m => m.name);
                markUpstreamSuccess(upstream);
                break;
            }

            const data = await response.json();
            models = Array.isArray(data?.models) ? data.models : [];
            markUpstreamSuccess(upstream);
            break;
        } catch (error) {
            markUpstreamFailure(upstream, String(error?.message || 'network error'));
            lastError = error;
        }
    }

    if (!models) {
        throw lastError || new Error('Ollama model listing failed');
    }

    return {
        object: 'list',
        data: models.map(model => ({
            id: `ollama/${model.name}`,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'ollama',
            description: model.name
        }))
    };
}

export async function sendOllamaMessage(anthropicRequest) {
    const { openAIResponse, upstream } = await sendOpenAICompatibleRequest(anthropicRequest);
    const anthropicResponse = toAnthropicResponse(openAIResponse, anthropicRequest.model);
    trackOllamaUsage({
        modelId: anthropicRequest.model,
        upstream: getUpstreamLabel(upstream),
        sessionId: anthropicRequest?.metadata?.session_id || anthropicRequest?.session_id || 'unknown',
        usage: anthropicResponse?.usage || {}
    });
    return anthropicResponse;
}

export async function* sendOllamaMessageStream(anthropicRequest) {
    const response = await sendOllamaMessage(anthropicRequest);
    const usage = response.usage || {};

    yield {
        type: 'message_start',
        message: {
            id: response.id,
            type: 'message',
            role: 'assistant',
            content: [],
            model: response.model,
            stop_reason: null,
            stop_sequence: null,
            usage: {
                input_tokens: usage.input_tokens || 0,
                output_tokens: 0
            }
        }
    };

    const blocks = Array.isArray(response.content) ? response.content : [];
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block?.type === 'text') {
            yield {
                type: 'content_block_start',
                index: i,
                content_block: { type: 'text', text: '' }
            };
            yield {
                type: 'content_block_delta',
                index: i,
                delta: { type: 'text_delta', text: block.text || '' }
            };
            yield { type: 'content_block_stop', index: i };
            continue;
        }

        if (block?.type === 'tool_use') {
            yield {
                type: 'content_block_start',
                index: i,
                content_block: {
                    type: 'tool_use',
                    id: block.id,
                    name: block.name,
                    input: block.input || {}
                }
            };
            yield {
                type: 'content_block_delta',
                index: i,
                delta: {
                    type: 'input_json_delta',
                    partial_json: JSON.stringify(block.input || {})
                }
            };
            yield { type: 'content_block_stop', index: i };
        }
    }

    yield {
        type: 'message_delta',
        delta: {
            stop_reason: response.stop_reason || 'end_turn',
            stop_sequence: null
        },
        usage: {
            output_tokens: usage.output_tokens || 0
        }
    };

    yield { type: 'message_stop' };
}

export function getOllamaUsageStats() {
    return getOllamaUsageSnapshot();
}

async function listOpenAIProviderModels(provider) {
    const sampleModel = provider === 'openai' ? 'openai/gpt-4.1' : 'kimi/kimi-k2.5';
    const upstreams = getUpstreamPlan(buildUpstreams(sampleModel));
    if (upstreams.length === 0) return { object: 'list', data: [] };

    // Avoid noisy 401 warnings when provider keys are not configured yet.
    const authedUpstreams = upstreams.filter(u => !!u?.apiKey);
    if (authedUpstreams.length === 0) return { object: 'list', data: [] };

    let lastError = null;
    for (const upstream of authedUpstreams) {
        const headers = { 'Content-Type': 'application/json' };
        if (upstream.apiKey) headers.Authorization = `Bearer ${upstream.apiKey}`;

        try {
            const response = await throttledFetch(buildOpenAIUrl(upstream.baseUrl, '/v1/models'), {
                method: 'GET',
                headers
            });

            if (!response.ok) {
                const text = await response.text();
                markUpstreamFailure(upstream, `HTTP ${response.status}`);
                lastError = new Error(`${provider} model listing failed (${response.status}): ${text}`);
                continue;
            }

            const payload = await response.json();
            const models = Array.isArray(payload?.data) ? payload.data : [];
            markUpstreamSuccess(upstream);

            return {
                object: 'list',
                data: models
                    .map(model => {
                        const id = String(model?.id || '').trim();
                        if (!id) return null;
                        return {
                            id: `${provider}/${id.replace(/^openai\//, '').replace(/^kimi\//, '')}`,
                            object: 'model',
                            created: model?.created || Math.floor(Date.now() / 1000),
                            owned_by: model?.owned_by || provider,
                            description: model?.description || id
                        };
                    })
                    .filter(Boolean)
            };
        } catch (error) {
            markUpstreamFailure(upstream, String(error?.message || 'network error'));
            lastError = error;
        }
    }

    if (lastError) throw lastError;
    return { object: 'list', data: [] };
}

export async function listOpenAIModels() {
    return listOpenAIProviderModels('openai');
}

export async function listKimiModels() {
    return listOpenAIProviderModels('kimi');
}






