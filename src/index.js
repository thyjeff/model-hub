/**
 * Model Hub
 * Entry point - starts the proxy server
 */

// Load .env variables early for local development / GitHub secrets
import 'dotenv/config';

// Initialize proxy support BEFORE any other imports that may use fetch
import './utils/proxy.js';

import app, { accountManager } from './server.js';
import { DEFAULT_PORT } from './constants.js';
import { logger } from './utils/logger.js';
import { config } from './config.js';
import { getStrategyLabel, STRATEGY_NAMES, DEFAULT_STRATEGY } from './account-manager/strategies/index.js';
import { getPackageVersion } from './utils/helpers.js';
import path from 'path';
import os from 'os';

const packageVersion = getPackageVersion();

// Parse command line arguments
const args = process.argv.slice(2);
const isDebug = args.includes('--debug') || args.includes('--dev-mode') || process.env.DEBUG === 'true' || process.env.DEV_MODE === 'true';
const isFallbackEnabled = args.includes('--fallback') || process.env.FALLBACK === 'true';

// Parse --strategy flag (format: --strategy=sticky or --strategy sticky)
let strategyOverride = null;
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--strategy=')) {
        strategyOverride = args[i].split('=')[1];
    } else if (args[i] === '--strategy' && args[i + 1]) {
        strategyOverride = args[i + 1];
    }
}
// Validate strategy
if (strategyOverride && !STRATEGY_NAMES.includes(strategyOverride.toLowerCase())) {
    logger.warn(`[Startup] Invalid strategy "${strategyOverride}". Valid options: ${STRATEGY_NAMES.join(', ')}. Using default.`);
    strategyOverride = null;
}

// Initialize logger and devMode
logger.setDebug(isDebug);

if (isDebug) {
    config.devMode = true;
    config.debug = true;
    logger.debug('Developer mode enabled');
}

if (isFallbackEnabled) {
    logger.info('Model fallback mode enabled');
}

// Export fallback flag for server to use
export const FALLBACK_ENABLED = isFallbackEnabled;

const PORT = process.env.PORT || DEFAULT_PORT;
const HOST = process.env.HOST || '0.0.0.0';

if (process.env.HOST) {
    logger.info(`[Startup] Using HOST environment variable: ${process.env.HOST}`);
}

// Home directory for account storage
const HOME_DIR = os.homedir();
const CONFIG_DIR = path.join(HOME_DIR, '.model-hub-proxy');

const server = app.listen(PORT, HOST, () => {
    // Get actual bound address
    const address = server.address();
    const boundHost = typeof address === 'string' ? address : address.address;
    const boundPort = typeof address === 'string' ? null : address.port;

    // Clear console for a clean start
    console.clear();

    const border = 'â•‘';
    // align for 2-space indent (60 chars), align4 for 4-space indent (58 chars)
    const align = (text) => text + ' '.repeat(Math.max(0, 60 - text.length));
    const align4 = (text) => text + ' '.repeat(Math.max(0, 58 - text.length));

    // Build Control section dynamically
    const strategyOptions = `(${STRATEGY_NAMES.join('/')})`;
    const strategyLine2 = '                       ' + strategyOptions;
    let controlSection = 'â•‘  Control:                                                    â•‘\n';
    controlSection += 'â•‘    --strategy=<s>     Set account selection strategy         â•‘\n';
    controlSection += `${border}  ${align(strategyLine2)}${border}\n`;
    if (!isDebug) {
        controlSection += 'â•‘    --dev-mode         Enable developer mode                  â•‘\n';
    }
    if (!isFallbackEnabled) {
        controlSection += 'â•‘    --fallback         Enable model fallback on quota exhaust â•‘\n';
    }
    controlSection += 'â•‘    Ctrl+C             Stop server                            â•‘';

    // Get the strategy label (accountManager will be initialized by now)
    const strategyLabel = accountManager.getStrategyLabel();

    // Build status section - always show strategy, plus any active modes
    let statusSection = 'â•‘                                                              â•‘\n';
    statusSection += 'â•‘  Active Modes:                                               â•‘\n';
    statusSection += `${border}    ${align4(`âœ“ Strategy: ${strategyLabel}`)}${border}\n`;
    if (isDebug) {
        statusSection += 'â•‘    âœ“ Developer mode enabled                                   â•‘\n';
    }
    if (isFallbackEnabled) {
        statusSection += 'â•‘    âœ“ Model fallback enabled                                  â•‘\n';
    }
    if (process.env.CLAUDE_CONFIG_PATH) {
        statusSection += `${border}    ${align4(`âœ“ Claude config: ${process.env.CLAUDE_CONFIG_PATH}`)}${border}\n`;
    }

    const environmentSection = `â•‘  Environment Variables:                                      â•‘
â•‘    PORT                Server port (default: 3001)           â•‘
â•‘    HOST                Bind address (default: 0.0.0.0)       â•‘
â•‘    HTTP_PROXY          Route requests through a proxy        â•‘
â•‘    CLAUDE_CONFIG_PATH  Path to .claude dir (for systemd)     â•‘
â•‘    See README.md for detailed configuration examples         â•‘`

    logger.log(`
â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•‘                 Model Hub Server v${packageVersion}                      â•‘
â• â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•£
â•‘                                                              â•‘
${border}  ${align(`Server and WebUI running at: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)}${border}
${border}  ${align(`Bound to: ${boundHost}:${boundPort}`)}${border}
${statusSection}â•‘                                                              â•‘
${controlSection}
â•‘                                                              â•‘
â•‘  Endpoints:                                                  â•‘
â•‘    POST /v1/messages         - Anthropic Messages API        â•‘
â•‘    GET  /v1/models           - List available models         â•‘
â•‘    GET  /health              - Health check                  â•‘
â•‘    GET  /account-limits      - Account status & quotas       â•‘
â•‘    POST /refresh-token       - Force token refresh           â•‘
â•‘                                                              â•‘
${border}  ${align(`Configuration:`)}${border}
${border}    ${align4(`Storage: ${CONFIG_DIR}`)}${border}
â•‘                                                              â•‘
â•‘  Usage with Claude Code:                                     â•‘
${border}    ${align4(`export ANTHROPIC_BASE_URL=http://localhost:${PORT}`)}${border}
${border}    ${align4(`export ANTHROPIC_API_KEY=${config.apiKey || 'dummy'}`)}${border}
â•‘    claude                                                    â•‘
â•‘                                                              â•‘
â•‘  Add accounts:                                        â•‘
â•‘    npm run accounts                                          â•‘
â•‘                                                              â•‘
â•‘  Prerequisites (if no accounts configured):                  â•‘
â•‘    - Local desktop app must be running                             â•‘
â•‘    - Keep an active chat panel open in the desktop app                   â•‘
â•‘                                                              â•‘
${environmentSection}
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  `);

    logger.success(`Server started successfully on port ${PORT}`);
    if (isDebug) {
        logger.warn('Running in DEVELOPER mode - verbose logs enabled');
    }
});

// Graceful shutdown
const shutdown = () => {
    logger.info('Shutting down server...');
    server.close(() => {
        logger.success('Server stopped');
        process.exit(0);
    });

    // Force close if it takes too long
    setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

