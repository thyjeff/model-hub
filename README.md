# Model Hub

> A unified AI model gateway — run Claude, Gemini, Ollama, OpenAI, and Kimi models through a single Anthropic-compatible API, with multi-account load balancing, quota tracking, and a web dashboard.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![License](https://img.shields.io/badge/License-MIT-yellow) ![npm](https://img.shields.io/npm/v/model-hub-proxy)

---

## Quick Start — 3 commands

### Linux / macOS
```bash
git clone https://github.com/badri-s2001/model-hub-proxy.git
cd model-hub-proxy
npm install && npm start
```

### Windows
```cmd
git clone https://github.com/badri-s2001/model-hub-proxy.git
cd model-hub-proxy
npm install && npm start
```

Then open **http://localhost:8080** — the web dashboard guides you through adding accounts.

---

## What is it?

```
Claude Code CLI  →  Model Hub (this)  →  Google Cloud Code API (Gemini/Claude)
                                      →  Ollama (local models)
                                      →  OpenAI API
                                      →  Kimi API
```

Model Hub sits in front of any AI provider and exposes a single **Anthropic-compatible API** on `localhost:8080`. Point Claude Code, Cursor, or any OpenAI-compatible client at it and get:

- **Free Gemini & Claude models** via Google Cloud Code (requires Google account)
- **Multi-account rotation** — add multiple Google accounts, quotas rotate automatically
- **Ollama passthrough** — local models via `ollama/model-name`
- **OpenAI & Kimi support** — use `openai/gpt-4o` or `kimi/kimi-k2` as model names
- **Web dashboard** — live quota bars, usage charts, account health, log streaming

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Git** — [git-scm.com](https://git-scm.com)
- A **Google account** (free tier works) — or just use Ollama for fully local models

---

## Installation

### Option 1: Clone (recommended)

```bash
# Clone
git clone https://github.com/badri-s2001/model-hub-proxy.git
cd model-hub-proxy

# Install dependencies (also builds CSS)
npm install

# Start
npm start
```

### Option 2: npx (no install)

```bash
npx model-hub-proxy@latest start
```

### Option 3: Global install

```bash
npm install -g model-hub-proxy
model-hub-proxy start
```

---

## Add your first account

After `npm start`, open **http://localhost:8080** → **Accounts** tab → **Add Account** → sign in with Google.

**Headless / no browser?**

```bash
npm run accounts:add -- --no-browser
```

---

## Connect Claude Code CLI

Create or edit `~/.claude/settings.json` (Windows: `%USERPROFILE%\.claude\settings.json`):

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "any-value",
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_MODEL": "claude-opus-4-6-thinking"
  }
}
```

Then just run `claude` — it routes through Model Hub automatically.

---

## Available Models

| Prefix | Example | Backend |
|--------|---------|---------|
| _(none)_ | `claude-sonnet-4-5-thinking` | Google Cloud Code |
| _(none)_ | `gemini-3.1-pro-high` | Google Cloud Code |
| `ollama/` | `ollama/llama3.2` | Local Ollama |
| `openai/` | `openai/gpt-4o` | OpenAI API |
| `kimi/` | `kimi/kimi-k2` | Kimi API |

Run `curl http://localhost:8080/v1/models` for the full live list.

---

## Configuration

Copy `config.example.json` to `~/.config/modelhub-proxy/config.json` and edit:

```json
{
  "port": 8080,
  "apiKey": "optional-auth-key",
  "ollamaBaseUrl": "http://127.0.0.1:11434",
  "openaiApiKeys": ["sk-..."],
  "kimiApiKeys": ["your-key"]
}
```

Or use environment variables:

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 8080) |
| `API_KEY` | Protect the proxy with an API key |
| `OLLAMA_BASE_URL` | Ollama endpoint |
| `OLLAMA_BASE_URLS` | Comma-separated pool of Ollama endpoints |
| `OPENAI_API_KEYS` | Comma-separated OpenAI keys |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL |
| `KIMI_API_KEYS` | Comma-separated Kimi keys |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (optional override) |

---

## Account Selection Strategies

Pass `--strategy` to control how accounts are chosen:

```bash
npm start -- --strategy=hybrid      # Smart (default) — health + quota + LRU
npm start -- --strategy=sticky      # Stay on one account (best for prompt cache)
npm start -- --strategy=round-robin # Rotate every request (max throughput)
```

---

## Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Account pool status |
| `GET /account-limits` | Per-account quota table |
| `GET /account-limits?format=table` | ASCII table |
| `POST /v1/messages` | Anthropic Messages API |
| `POST /v1/chat/completions` | OpenAI Chat API |
| `GET /v1/models` | List all available models |

---

## Troubleshooting

**"No accounts available"** — Add a Google account via the web dashboard or `npm run accounts:add`

**Port already in use** — `PORT=3001 npm start`

**Claude Code asks for login** — Add `"hasCompletedOnboarding": true` to `~/.claude.json`

**Windows: native module error** — Run `npm rebuild` then `npm start`

---

## Credits

Built on top of:
- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) — Google Cloud Code OAuth
- [claude-code-proxy](https://github.com/1rgs/claude-code-proxy) — Original proxy concept

---

## License

MIT — see [LICENSE](LICENSE)
