import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

const FILE_PATH = path.join(os.homedir(), '.config', 'modelhub-proxy', 'ollama-usage.json');
const MAX_SESSIONS = 300;

let loaded = false;
let dirty = false;
let cache = {
    totals: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    models: {},
    upstreams: {},
    sessions: {},
    updatedAt: null
};

function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
        if (!fs.existsSync(FILE_PATH)) return;
        const raw = fs.readFileSync(FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            cache = {
                totals: parsed.totals || cache.totals,
                models: parsed.models || {},
                upstreams: parsed.upstreams || {},
                sessions: parsed.sessions || {},
                updatedAt: parsed.updatedAt || null
            };
        }
    } catch (error) {
        logger.warn('[OllamaUsage] Failed loading usage file:', error.message);
    }
}

function saveIfNeeded() {
    if (!dirty) return;
    try {
        const dir = path.dirname(FILE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cache.updatedAt = new Date().toISOString();
        fs.writeFileSync(FILE_PATH, JSON.stringify(cache, null, 2), 'utf8');
        dirty = false;
    } catch (error) {
        logger.warn('[OllamaUsage] Failed writing usage file:', error.message);
    }
}

function boundedSessionId(sessionId) {
    const raw = String(sessionId || '').trim();
    if (!raw) return 'unknown';
    return raw.slice(0, 120);
}

function touchSession(sessionId, modelId, upstream, usage) {
    const sid = boundedSessionId(sessionId);
    const nowIso = new Date().toISOString();

    if (!cache.sessions[sid]) {
        cache.sessions[sid] = {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            lastModel: modelId,
            lastUpstream: upstream,
            firstSeen: nowIso,
            lastSeen: nowIso
        };
    }

    const row = cache.sessions[sid];
    row.requests += 1;
    row.inputTokens += usage.input_tokens || 0;
    row.outputTokens += usage.output_tokens || 0;
    row.totalTokens += (usage.input_tokens || 0) + (usage.output_tokens || 0);
    row.lastModel = modelId;
    row.lastUpstream = upstream;
    row.lastSeen = nowIso;

    // Keep latest N sessions by lastSeen
    const keys = Object.keys(cache.sessions);
    if (keys.length > MAX_SESSIONS) {
        keys.sort((a, b) => {
            const at = new Date(cache.sessions[a].lastSeen || 0).getTime();
            const bt = new Date(cache.sessions[b].lastSeen || 0).getTime();
            return bt - at;
        });
        for (const staleKey of keys.slice(MAX_SESSIONS)) {
            delete cache.sessions[staleKey];
        }
    }
}

export function trackOllamaUsage({ modelId, upstream, sessionId, usage }) {
    ensureLoaded();
    const normalizedModel = String(modelId || 'unknown');
    const normalizedUpstream = String(upstream || 'unknown');
    const u = usage || {};
    const inTok = u.input_tokens || 0;
    const outTok = u.output_tokens || 0;
    const totalTok = inTok + outTok;

    cache.totals.requests += 1;
    cache.totals.inputTokens += inTok;
    cache.totals.outputTokens += outTok;
    cache.totals.totalTokens += totalTok;

    if (!cache.models[normalizedModel]) {
        cache.models[normalizedModel] = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, lastSeen: null };
    }
    cache.models[normalizedModel].requests += 1;
    cache.models[normalizedModel].inputTokens += inTok;
    cache.models[normalizedModel].outputTokens += outTok;
    cache.models[normalizedModel].totalTokens += totalTok;
    cache.models[normalizedModel].lastSeen = new Date().toISOString();

    if (!cache.upstreams[normalizedUpstream]) {
        cache.upstreams[normalizedUpstream] = { requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, lastSeen: null, lastError: null };
    }
    cache.upstreams[normalizedUpstream].requests += 1;
    cache.upstreams[normalizedUpstream].inputTokens += inTok;
    cache.upstreams[normalizedUpstream].outputTokens += outTok;
    cache.upstreams[normalizedUpstream].totalTokens += totalTok;
    cache.upstreams[normalizedUpstream].lastSeen = new Date().toISOString();

    touchSession(sessionId, normalizedModel, normalizedUpstream, {
        input_tokens: inTok,
        output_tokens: outTok
    });

    dirty = true;
    saveIfNeeded();
}

export function trackOllamaFailure({ upstream, error }) {
    ensureLoaded();
    const normalizedUpstream = String(upstream || 'unknown');
    if (!cache.upstreams[normalizedUpstream]) {
        cache.upstreams[normalizedUpstream] = { requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, lastSeen: null, lastError: null };
    }
    cache.upstreams[normalizedUpstream].failures += 1;
    cache.upstreams[normalizedUpstream].lastError = String(error || 'unknown error').slice(0, 500);
    cache.upstreams[normalizedUpstream].lastSeen = new Date().toISOString();
    dirty = true;
    saveIfNeeded();
}

export function getOllamaUsageSnapshot() {
    ensureLoaded();

    const topModels = Object.entries(cache.models)
        .sort((a, b) => (b[1].requests || 0) - (a[1].requests || 0))
        .slice(0, 20)
        .map(([model, value]) => ({ model, ...value }));

    const upstreams = Object.entries(cache.upstreams)
        .sort((a, b) => (b[1].requests || 0) - (a[1].requests || 0))
        .map(([url, value]) => ({ url, ...value }));

    const recentSessions = Object.entries(cache.sessions)
        .sort((a, b) => new Date(b[1].lastSeen || 0).getTime() - new Date(a[1].lastSeen || 0).getTime())
        .slice(0, 30)
        .map(([sessionId, value]) => ({ sessionId, ...value }));

    return {
        totals: { ...cache.totals },
        topModels,
        upstreams,
        recentSessions,
        updatedAt: cache.updatedAt
    };
}

// Periodic flush in case process runs long and writes are batched.
setInterval(() => saveIfNeeded(), 30000);

