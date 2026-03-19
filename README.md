<div align="center">

<img src="images/modelhub.png" alt="Model Hub" width="120" />

# Model Hub

**Unified AI model gateway — Claude, Gemini, Ollama, OpenAI, Kimi through one API**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/thyjeff/model-hub?style=social)](https://github.com/thyjeff/model-hub)
[![Works on Windows](https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white)](https://github.com/thyjeff/model-hub)
[![Works on Linux](https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black)](https://github.com/thyjeff/model-hub)
[![Works on macOS](https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white)](https://github.com/thyjeff/model-hub)

</div>

---

<div align="center">
<img src="images/dashboard.png" alt="Model Hub Dashboard" width="100%" />
</div>

---

## ⚡ Quick Start — 3 commands

Works identically on **Windows**, **Linux**, and **macOS**.

```bash
git clone https://github.com/thyjeff/model-hub.git
cd model-hub
npm install && npm start
```

Then open **http://localhost:8080** in your browser — the dashboard walks you through the rest.

> **Requires:** [Node.js 18+](https://nodejs.org) and [Git](https://git-scm.com)

---

## What is Model Hub?

```
Your AI Client  →  Model Hub  →  Google Cloud Code (Claude + Gemini, free)
  (Claude Code,                →  Ollama           (local models)
   Cursor, etc.)               →  OpenAI API
                               →  Kimi API
```

Model Hub exposes a single **Anthropic-compatible API** on `localhost:8080`. Any tool that talks to Claude works instantly — no code changes needed.

**Key features:**
- 🆓 **Free Claude & Gemini** via Google Cloud Code (just needs a Google account)
- 🔄 **Multi-account rotation** — add multiple Google accounts, quotas auto-rotate
- 📊 **Web dashboard** — live quota bars, usage charts, account health, real-time logs
- 🦙 **Ollama passthrough** — use local models via `ollama/model-name`
- 🔑 **OpenAI & Kimi** — use `openai/gpt-4o`, `kimi/kimi-k2` as drop-in models
- ⚖️ **Smart load balancing** — hybrid health/quota/LRU strategy across accounts

---

## 🔌 Connect Claude Code CLI

Create or edit `~/.claude/settings.json`  
(Windows: `%USERPROFILE%\.claude\settings.json`):

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "any-value",
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_MODEL": "claude-sonnet-4-5-thinking",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-6-thinking",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5-thinking",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-sonnet-4-5"
  }
}
```

Then run `claude` — requests route through Model Hub automatically.

> **Note:** `ANTHROPIC_AUTH_TOKEN` can be any non-empty string — Model Hub handles real auth via Google OAuth.

---

## 📦 Available Models

| Prefix | Example | Backend |
|--------|---------|---------|
| _(none)_ | `claude-sonnet-4-5-thinking` | Google Cloud Code (free) |
| _(none)_ | `gemini-3.1-pro-high` | Google Cloud Code (free) |
| `ollama/` | `ollama/llama3.2` | Local Ollama instance |
| `openai/` | `openai/gpt-4o` | OpenAI API (key required) |
| `kimi/` | `kimi/kimi-k2` | Kimi API (key required) |

```bash
# See all available models live
curl http://localhost:8080/v1/models
```

---

## 👤 Add Google Account

After `npm start`, go to **http://localhost:8080** → **Accounts** → **Add Account** → sign in with Google.

**No browser / headless server?**
```bash
npm run accounts:add -- --no-browser
```

Add multiple accounts for higher combined quota — Model Hub rotates between them automatically.

---

## ⚙️ Configuration

Copy `config.example.json` to `~/.config/modelhub-proxy/config.json`:

```json
{
  "port": 8080,
  "apiKey": "",
  "ollamaBaseUrl": "http://127.0.0.1:11434",
  "openaiApiKeys": [],
  "kimiApiKeys": []
}
```

Or use environment variables (create a `.env` file in the project root):

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `8080`) |
| `API_KEY` | Optional: password-protect the proxy |
| `OLLAMA_BASE_URL` | Ollama endpoint |
| `OLLAMA_BASE_URLS` | Comma-separated Ollama pool for failover |
| `OPENAI_API_KEYS` | Comma-separated OpenAI API keys |
| `OPENAI_BASE_URL` | Custom OpenAI-compatible base URL |
| `KIMI_API_KEYS` | Comma-separated Kimi API keys |
| `GOOGLE_CLIENT_ID` | Custom Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Custom Google OAuth client secret |

---

## 🎛️ Account Strategies

```bash
npm start -- --strategy=hybrid       # Default: smart health + quota + LRU
npm start -- --strategy=sticky       # Best for prompt caching (stay on one account)
npm start -- --strategy=round-robin  # Max throughput (rotate every request)
npm start -- --fallback              # Auto-fallback to alternate model when quota hits
```

---

## 🔑 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET  /health` | Account pool status |
| `GET  /account-limits` | Per-account quota (JSON) |
| `GET  /account-limits?format=table` | Per-account quota (ASCII table) |
| `POST /v1/messages` | Anthropic Messages API |
| `POST /v1/chat/completions` | OpenAI Chat Completions API |
| `POST /v1/responses` | OpenAI Responses API |
| `GET  /v1/models` | List all available models |

---

## 🔒 Security

- **No API keys are hardcoded** — all credentials load from environment variables or your local `config.json` (which is never committed)
- **`.env` is gitignored** — secrets stay on your machine
- **OAuth tokens** are stored only in `~/.config/modelhub-proxy/accounts.json` on your local machine
- **`ANTHROPIC_AUTH_TOKEN`** in Claude Code settings can be any placeholder string — Model Hub handles real Google OAuth

---

## 🛠️ Troubleshooting

**"No accounts available"**
→ Open http://localhost:8080 → Accounts → Add Account

**Port already in use**
→ `PORT=3001 npm start`

**Claude Code asks for login**
→ Add `"hasCompletedOnboarding": true` to `~/.claude.json` and restart terminal

**Windows: native module error (`better-sqlite3`)**
→ `npm rebuild` then `npm start`

**npm package not found (`model-hub-proxy`)**
→ The package is not on npm — use the git clone method above instead:
```bash
git clone https://github.com/thyjeff/model-hub.git && cd model-hub && npm install && npm start
```

---

## 🏗️ Architecture

```
src/
├── server.js              Express server — /v1/messages, /v1/models, /health
├── cloudcode/             Google Cloud Code API client (Claude + Gemini)
├── account-manager/       Multi-account pool with strategies
│   └── strategies/        sticky | round-robin | hybrid
├── ollama/                Ollama + OpenAI-compatible passthrough
├── auth/                  Google OAuth flow
├── format/                Anthropic ↔ Google format conversion
└── webui/                 Web dashboard backend
```

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
<strong>Model Hub</strong> — One gateway, all models.<br>
<a href="https://github.com/thyjeff/model-hub/issues">Report a bug</a> · <a href="https://github.com/thyjeff/model-hub/issues">Request a feature</a>
</div>
