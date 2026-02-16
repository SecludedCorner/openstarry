# OpenStarry

本地 AI Agent 框架——微核心 + 插件驅動，3 分鐘跑起你的第一個 AI Agent。

版本：**v0.22.0-beta** ｜ 測試：**1451 tests** ｜ 插件：**22 個**

[English](./README.md)

## 系統需求

- Node.js >= 20.0.0
- pnpm >= 9.0.0

## 專案結構

```
parent_directory/
├── openstarry/                ← 核心框架（你現在在這裡）
│   ├── packages/sdk/          # 類型契約（介面、事件、錯誤）
│   ├── packages/core/         # Agent 核心（EventBus、ExecutionLoop）
│   ├── packages/shared/       # 共用工具
│   ├── apps/runner/           # CLI 啟動器
│   └── configs/               # 預置配置範例
│
└── openstarry_plugin/         ← 插件生態系統（同層目錄）
    ├── standard-function-*    # 標準工具
    ├── provider-*             # LLM Provider（6 個）
    ├── transport-*            # 傳輸層
    ├── web-ui                 # 瀏覽器介面
    └── ...                    # 共 22 個插件
```

> `pnpm-workspace.yaml` 已將 `../openstarry_plugin/*` 納入工作區，安裝、編譯、測試一次搞定。

## 快速開始

### 安裝

```bash
cd openstarry
pnpm install
pnpm build
```

### 執行

```bash
node apps/runner/dist/bin.js --config ./configs/basic-agent.json
```

首次執行會自動建立 `~/.openstarry/` 目錄。啟動後設定 Provider（見下方 [Provider 設定](#provider-設定)），即可開始對話：

```
> 幫我讀取 package.json 的內容
[tool] Calling: fs.read
[result] { "name": "openstarry", ... }
```

## Provider 設定

OpenStarry 內建 6 個 LLM Provider，所有預置配置都會載入全部 Provider——只需登入你有的那個即可。

### 方案 A：Gemini（API Key）— 最簡單

到 [Google AI Studio](https://aistudio.google.com/app/apikey) 免費取得 API Key，然後：

```
> /provider login gemini <你的API_KEY>
```

在配置檔的 `cognition` 設定：
```json
"cognition": {
  "provider": "gemini",
  "model": "gemini-2.0-flash"
}
```

### 方案 B：Claude（Anthropic）

到 [Anthropic Console](https://console.anthropic.com/) 取得 API Key，然後：

```
> /provider login claude <你的API_KEY>
```

配置：
```json
"cognition": {
  "provider": "claude",
  "model": "claude-sonnet-4-20250514"
}
```

可用模型：`claude-sonnet-4-20250514`、`claude-opus-4-20250514`、`claude-haiku-4-5-20251001`

### 方案 C：ChatGPT（OpenAI）

到 [OpenAI Platform](https://platform.openai.com/api-keys) 取得 API Key，然後：

```
> /provider login chatgpt <你的API_KEY>
```

配置：
```json
"cognition": {
  "provider": "chatgpt",
  "model": "gpt-4o"
}
```

可用模型：`gpt-4o`、`gpt-4o-mini`、`o3-mini`、`gpt-4-turbo`、`gpt-3.5-turbo`

### 方案 D：LM Studio（本地推理）

如果你有 [LM Studio](https://lmstudio.ai/) 在本機運行：

```
> /provider login lmstudio
```

Plugin 會自動從 LM Studio 的 `/v1/models` 抓取可用模型列表。自訂 URL：

```
> /provider login lmstudio http://192.168.1.100:1234/v1
```

選擇模型：
```
> /provider model llama-3.2-1b-instruct
```

配置：
```json
"cognition": {
  "provider": "lmstudio",
  "model": "llama-3.2-1b-instruct"
}
```

> **提示**：執行 `/provider login lmstudio` 即可看到 LM Studio 中所有已載入的模型。

### 方案 E：Ollama（本地 LLM）

安裝並啟動 [Ollama](https://ollama.ai/)，然後：

```
> /provider login ollama
```

若 Ollama 在非預設 host：
```
> /provider login ollama http://你的host:11434
```

配置：
```json
"cognition": {
  "provider": "ollama",
  "model": "llama3"
}
```

> 模型會從你的 Ollama 自動偵測。拉取新模型後可用 `/ollama refresh` 重新掃描。

### 方案 F：Gemini OAuth（Google Code Assist）

如果你是 Google Cloud 使用者，有 OAuth 憑證：

```
> /provider login gemini-oauth <CLIENT_ID> <CLIENT_SECRET>
```

瀏覽器會開啟 Google OAuth 頁面。此 Provider 使用 Code Assist 端點，支援自動配置專案。

### Provider 管理指令

```
/provider status                    — 查看所有 Provider 狀態
/provider login <provider> [args]   — 設定 Provider
/provider logout <provider>         — 清除登入（保留配置）
/provider remove <provider>         — 移除所有憑證
```

## 更多範例

### 瀏覽器 Web UI

```bash
node apps/runner/dist/bin.js --config ./configs/web-agent.json
```

啟動後開啟瀏覽器：

- **Web UI**：`http://localhost:8081`
- **WebSocket**：`ws://localhost:8080/ws`

直接在瀏覽器中與 Agent 對話，支援串流回應。

### 背景 Daemon 模式

```bash
# 背景啟動
node apps/runner/dist/bin.js daemon start --config ./configs/basic-agent.json

# 查看運行中的 agent
node apps/runner/dist/bin.js ps

# 附加到背景 agent 繼續對話
node apps/runner/dist/bin.js attach

# 停止
node apps/runner/dist/bin.js daemon stop
```

## 可用配置

預置配置在 `configs/` 目錄：

| 配置檔 | 說明 | 使用方式 |
|--------|------|----------|
| `basic-agent.json` | 最小 CLI agent | 基本聊天 + 檔案操作 |
| `basic-agent-lmstudio-auto.json` | LM Studio 自動連線 | 零配置本地推理 |
| `web-agent.json` | 瀏覽器 Web UI | 開啟 `http://localhost:8081` |
| `websocket-agent.json` | 純 WebSocket（無 CLI） | 程式化 API 存取 |
| `tui-agent.json` | 終端機全螢幕面板 | 視覺化監控 |
| `mcp-agent.json` | MCP 協議 agent | 與 Claude Code 等 MCP 客戶端整合 |
| `full-agent.json` | 全功能 | 開發、展示用 |

> 所有配置都載入全部 6 個 Provider。修改 `cognition.provider` 和 `cognition.model` 即可切換。

## Provider 自動配置

除了每次手動 `/provider login`，你也可以直接在 agent 配置檔中寫入 provider 設定。Plugin 啟動時自動讀取 `config` 並完成配置——不需要互動式登入。

### 範例：LM Studio 自動連線

`configs/basic-agent-lmstudio-auto.json` 展示了這個模式。啟動 LM Studio 後直接執行：

```bash
node apps/runner/dist/bin.js --config ./configs/basic-agent-lmstudio-auto.json
```

配置檔的關鍵部分：

```json
{
  "cognition": {
    "provider": "lmstudio",
    "model": "llama-3.2-1b-instruct"
  },
  "plugins": [
    { "name": "@openstarry-plugin/provider-lmstudio", "config": { "baseUrl": "http://127.0.0.1:1234/v1" } }
  ]
}
```

Plugin 的 `config` 物件會作為 `ctx.config` 傳入 factory。啟動時 provider 讀取 `baseUrl`，自動連線 LM Studio，不需要手動 `/provider login`。

### 各 Provider 支援的 Config 欄位

| Provider | Config 欄位 | 範例 |
|----------|-------------|------|
| `provider-lmstudio` | `baseUrl` | `{ "baseUrl": "http://127.0.0.1:1234/v1" }` |
| `provider-local-llama` | `hostUrl` | `{ "hostUrl": "http://127.0.0.1:11434" }` |
| `provider-gemini` | `apiKey` | `{ "apiKey": "AIza..." }` |
| `provider-claude` | `apiKey` | `{ "apiKey": "sk-ant-..." }` |
| `provider-chatgpt` | `apiKey`、`baseUrl` | `{ "apiKey": "sk-...", "baseUrl": "https://api.openai.com/v1" }` |
| `provider-gemini-oauth` | `clientId`、`clientSecret`、`projectId` | `{ "clientId": "...", "clientSecret": "..." }` |

> **注意**：Config 值只在 SecureStore 中沒有現有憑證時才會使用。一旦設定完成（無論透過 config 或 `/provider login`），憑證會加密儲存在 `~/.openstarry/`——後續執行自動使用已儲存的憑證。

## 架構

OpenStarry 採用**五蘊（Five Aggregates）**哲學，將所有插件能力映射為五種基本類型：

| 蘊 | 介面 | 角色 |
|----|------|------|
| 色 | `IUI` | 使用者介面渲染 |
| 受 | `IListener` | 事件監聽與傳輸 |
| 想 | `IProvider` | LLM 服務提供者 |
| 行 | `ITool` | 可執行工具與動作 |
| 識 | `IGuide` | 系統提示與引導 |

**微核心**保持最小化——所有功能都在插件中。插件透過 `pushInput()` 模式與核心溝通，絕不直接呼叫 API。

## 更多文件

| 文件 | 說明 |
|------|------|
| [架構概覽](./docs/TW/architecture.md) | 五蘊哲學、微核心設計、事件驅動流程 |
| [插件一覽](./docs/TW/plugins.md) | 全 19 個插件的分類與說明 |
| [配置格式](./docs/TW/configuration.md) | agent.json 結構、插件解析順序、環境變數 |
| [開發指南](./docs/TW/development.md) | 開發新插件、測試指令、編譯 |
| [CLI 指令](./docs/TW/cli.md) | CLI 指令總覽、斜線指令 |

## 授權

MIT
