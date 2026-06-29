# OpenStarry

本地 AI Agent 框架——微核心 + 插件驅動，3 分鐘跑起你的第一個 AI Agent。

版本：**v0.59.8-alpha** ｜ 測試：**3393 passed / 0 failed** ｜ 插件：**48 個** ｜ 授權：**Apache-2.0**

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
    ├── provider-*             # LLM Provider（8 個）
    ├── transport-*            # 傳輸層
    ├── web-ui                 # 瀏覽器介面
    └── ...                    # 共 48 個可載入插件（另 1 個共享型別庫）
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

OpenStarry 隨庫出貨 8 個 provider 插件，下方列出 6 種最常用設定。各預置配置載入的 provider 子集不同——`basic-agent.json` 預載 6 個（雲端 4＋地端 2），多數其他預置載 5 個（缺 `provider-lmstudio`）；缺的 provider 自行加入 config 的 `plugins` 清單後，登入你有的那個即可。

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
>
> **注意**：`provider-lmstudio` 僅預載於 `basic-agent.json` 與 `basic-agent-lmstudio-auto.json`——其他 config 需先把它加入 `plugins` 清單再登入。

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

### 多代理協調 (Phase 6)

OpenStarry 的 Agent 可以生成子代理，並在真實的進程樹中委派認知。

**已端到端實證**（見[十大宣言兌現帳本](https://github.com/SecludedCorner/openstarry_doc/blob/main/TENETS_FULFILLMENT.md)宣言 #10）：
- **agent-ask** 插件把認知迴圈暴露為可委派工具，經 **MCP**（mcp-server＋mcp-client）路由：一個外部呼叫穿越三代 agent 進程（父→中→孫，各自完整認知迴圈），從單一端點返回，<2 秒（`fractal-depth3.e2e.test.ts`）。
- **進程樹**是真的：root 自註冊、生成子代理的樹邊、越權拒絕（SEC-003）、父亡子收的孤兒回收，全部入 e2e 測試（`daemon-process-tree.e2e.test.ts`）。
- **優雅關閉**：父進程關閉時級聯 SIGTERM 到子進程。

實際試跑：`configs/phase6-agent.json` 啟動完整 MCP 委派堆疊（已過煙霧測試）。

**誠實邊界**（依帳本明確不宣稱條款）：代碼庫中另有通訊子系統——ICommChannel、comm-pipeline、comm-proxy、openstarry-channel 中樞、EventBridge——屬驗證層或未接入已實證路徑，請當作設計參考而非已出貨功能。協議設計筆記見 [Doc 53](https://github.com/SecludedCorner/openstarry_doc/blob/main/Architecture_Documentation/53_Multi_Agent_Communication_Interface_Spec.md)。

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

> 各配置預載的 provider 子集不同：`basic-agent.json` 載 6 個；`web/websocket/tui/mcp/full` 載 5 個（缺 `provider-lmstudio`）；`basic-agent-lmstudio-auto.json` 載 2 個；`phase6`／`klesha-modulated` 僅載 `provider-claude-cli`。修改 `cognition.provider` 與 `cognition.model` 即可在已載入的 provider 間切換。

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

OpenStarry 遵循**五蘊**哲學，把所有插件能力映射為五種基本類型：

### 插件分類

| 工程術語 | 代碼值 | 說明 |
|--------|--------|------|
| **輸入/感測** | `'rupa'` | 接收外部訊號——CLI 提示、HTTP 請求、WebSocket 訊息、檔案監視 |
| **回饋/感知** | `'vedana'` | 評估交互品質——工具結果感知、安全檢查結果、信心差距檢測 |
| **模型/認知** | `'samjna'` | 處理資訊——LLM 後端、上下文管理、認知處理策略 |
| **動作/工具** | `'samskara'` | 執行具體動作——檔案操作、Shell 命令、API 呼叫、程式碼生成 |
| **控制/治理** | `'vijnana'` | 路由決策——信心路由、齒輪仲裁、閾值審計、Agent 人格 |

### 插件關鍵性級別

| 級別 | 缺席行為 | 範例 |
|------|---------|------|
| `required` | Agent 拒絕啟動 | 上下文管理器、模型選擇器 |
| `optional-degraded` | Agent 啟動，功能降級 + 警告 | 迴圈品質監視、閾值審計 |
| `optional-no-effect` | Agent 正常啟動，功能不可用 | 自訂感測、遙測匯出 |

### 五蘊映射

| 蘊 | 介面 | 角色 |
|----|------|------|
| 色 | `IUI` + `IListener` | 外顯形相（UI 渲染）與感官輸入通道 |
| 受 | `IVedana` | 感受品質信號（苦／樂／捨三受回饋） |
| 想 | `IProvider` | LLM 服務提供者 |
| 行 | `ITool` | 可執行工具與動作 |
| 識 | `IGuide` | 系統提示與引導 |

> 註：本表早期版本曾把 `IListener` 誤歸受蘊。canonical 映射（Cycle 02-4 修正，見文件庫 Deep Dive 14）將監聽器歸於色蘊——監聽器是感官根門，不是感受本身。

**微核心**保持最小化——所有功能都在插件中。插件透過 `pushInput()` 模式與核心溝通，絕不直接呼叫 API。

## 更多文件

完整文件庫在姊妹 repo **[openstarry_doc](https://github.com/SecludedCorner/openstarry_doc)**——從它的導讀路徑開始：

| 文件 | 說明 |
|------|------|
| [致未來的信](https://github.com/SecludedCorner/openstarry_doc/blob/main/LETTER_TO_THE_FUTURE.md) | 這個專案是什麼、為什麼、證明了什麼、哪裡失敗——附誠實數據 |
| [十大宣言兌現帳本](https://github.com/SecludedCorner/openstarry_doc/blob/main/TENETS_FULFILLMENT.md) | 每條宣言被可運行的代碼證明到什麼程度，逐條附證據 |
| [GETTING_STARTED](https://github.com/SecludedCorner/openstarry_doc/blob/main/GETTING_STARTED.md) | 10 分鐘從配置到寫出第一個 Plugin（對照真實 CLI 驗證） |
| [Retrospective](https://github.com/SecludedCorner/openstarry_doc/blob/main/RETROSPECTIVE.md) | 一個多智能體開發系統如何灌水 96%、被抓到、然後誠實起來 |

## 授權

Apache-2.0——見 [LICENSE](./LICENSE) 與 [NOTICE](./NOTICE)。
