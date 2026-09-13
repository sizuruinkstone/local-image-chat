# Local Image Chat

ローカルの画像生成環境を、ブラウザ・API・MCPからまとめて扱うための個人向け画像生成フロントエンドです。

Stable Diffusion系の生成Runtime、構造化Prompt、LoRA、履歴、比較実験、Civitai連携、Discord通知などを1つのUIにまとめています。日本語の説明からOllamaでStable Diffusion向けPromptを作ることも、Promptを直接編集して生成することもできます。

> 現在のpackage versionは `3.0.0` です。
>
> `main` は既存ProductionとBackend / API / Runtime / MCPの安定基盤です。新しいProduction UI（New Studio / Pearl Glass）は `checkpoint/frontend-refactor-phase13` で開発中です。

## 主な機能

### 画像生成

- txt2img
- 複数候補生成とサーバー側Job Queue
- Seed / Steps / CFG / Sampler / Scheduler / 解像度の指定
- Runtimeごとのcapability判定
- 生成中の進捗確認・キャンセル
- Hires.fix / img2img / Inpaint / IP-Adapter（対応Runtimeのみ）
- 生成結果・設定・Prompt・LoRA・派生元をHistoryへ保存

生成処理は画面遷移とは独立したJobとして動くため、生成中にGalleryやSettingsへ移動してもJobは継続します。

### Prompt Workspace

Positive Promptは次の6項目へ分けて編集できます。

1. キャラクター
2. 容姿・衣装
3. ポーズ・構図
4. シチュエーション・背景
5. 画風・品質
6. 追加プロンプト

分割入力は生成時に1本のPositive Promptへ結合されます。入力したタグの順番・重み・LoRA構文を勝手に並べ替えたり削除したりしません。

`Raw Prompt`へ切り替えて、最終Promptを直接編集することもできます。

Ollamaを使う場合は、日本語の説明からStable Diffusion向けタグPromptを生成できます。Promptを直接書く場合、Ollamaは必須ではありません。

### Checkpoint / Runtime

複数の画像生成Runtimeを同じJob / History基盤から扱います。

#### Forge Neo

Forge NeoはProfile単位でCheckpointと必要moduleをまとめて管理します。

- Anima系Profile
- SDXL / Illustrious系Profile
- `forge_preset`
- VAE / Text Encoderなどのadditional modules
- Profile allowlist
- Job実行時の安全なProfile activation

現在のForge Neo経路は主にtxt2img向けです。非対応機能をReForgeへ暗黙fallbackすることはありません。

詳細は [`docs/FORGE_NEO.md`](docs/FORGE_NEO.md) を参照してください。

#### ReForge

ReForge providerは既存互換Runtimeとして維持しています。txt2imgに加え、Runtimeが対応している場合はHires.fix、img2img、Inpaint、IP-Adapterなどの高度な生成経路を利用できます。

## LoRA

- 導入済みLoRAの一覧・検索・フォルダ分類
- Civitai metadata / previewの取得
- Trigger Words / Negative Words / Weight管理
- Favorite
- Character / Outfit用途のProfile
- Prompt内 `<lora:name:weight>` とUI選択の同期
- 生成ごとのON/OFF・Weight変更
- LoRA folderの整理

LoRAの管理情報と、各生成で実際に使用したLoRA設定は分けて保存します。

Civitai API tokenは `.env` の `LOCAL_IMAGE_CHAT_CIVITAI_TOKEN` から読み込めます。

```text
LOCAL_IMAGE_CHAT_CIVITAI_TOKEN=...
```

`.env` / `config.local.json` はGitへcommitしない前提です。

## Library / History

生成画像はHistoryとして保存され、Gallery / Libraryから再利用できます。

- thumbnail表示
- Favorite
- Prompt / Negative Prompt / Seed / Model / LoRAなどのmetadata表示
- 過去設定のReuse
- 生成結果からの派生生成
- 比較実験
- A/B評価
- Discord通知

履歴の既定保持件数は `config.json` の `storage.historyLimit` で管理しています。

## Civitai連携

Civitai URLからLoRA情報を取得し、ローカルのLoRA registryへ反映できます。

主に次の情報を扱います。

- Model / Version名
- Base Model
- Trigger Words
- Preview image
- 推奨Weight
- Source URL
- file metadata

実際のinstall先や秘密情報はローカル設定側で管理します。

## Discord通知

Discord Webhookを設定すると、生成完了やFavorite画像をDiscordへ送信できます。

Webhook URLはブラウザへ返さず、サーバー側の `config.local.json` または環境設定からのみ扱います。

例:

```json
{
  "discord": {
    "webhookUrl": "https://discord.com/api/webhooks/..."
  }
}
```

## API v1 / MCP

Local Image Chatの生成機能はBackend API v1へ集約されており、Web UI以外からも利用できます。

```text
Web UI / MCP Host
        │
        ▼
Local Image Chat :3030
        │
        ├─ Prompt / Generation Service
        ├─ Job Manager
        ├─ History / Image Delivery
        └─ Runtime Provider
             ├─ Forge Neo
             └─ ReForge
```

MCP serverはBackend API v1のthin wrapperです。MCP側に別のJob ManagerやHistory DBを持たず、既存Backendへ処理を委譲します。

```powershell
npm run mcp
```

既定接続先:

```text
LOCAL_IMAGE_CHAT_URL=http://127.0.0.1:3030
```

MCPからは、capability確認、非同期生成、Job確認・cancel、History取得、再生成、画像確認、Reference Image importなどを利用できます。

詳細は [`docs/MCP.md`](docs/MCP.md) を参照してください。

## New Studio / 現在のフロントエンド開発

新しいProduction UIは `checkpoint/frontend-refactor-phase13` で開発しています。

主な変更点:

- Pearl Glassデザイン
- Canvas中心のStudio
- Prompt Workspace / Prompt Dock
- Full Library / Viewer
- LoRA Browser
- Advanced creation tools
- 生成sessionの復元
- Scenes
- Section Profiles
- General / NSFW分類
- Checkpoint Style Profiles
- Trigger Wordの個別ON/OFF
- frontendの責務分割とES module化

New Studioでは通常URL `/` を新UIとし、明示的なrollback用に `?legacy=1` を残す設計です。

このbranchは `main` より先行しているため、`main` をcloneしただけでは上記の開発中UIすべてが入っているとは限りません。

## 必要環境

- Node.js 20+
- npm
- 画像生成Runtime
  - Forge Neo または
  - ReForge
- Ollama（日本語→Prompt変換を使う場合のみ）

既定値:

| Service | URL / value |
| --- | --- |
| Local Image Chat | `http://127.0.0.1:3030` |
| Ollama | `http://127.0.0.1:11434` |
| Ollama model | `qwen3:1.7b` |
| ReForge / Forge系Runtime | 通常 `http://127.0.0.1:7860` |

## Install

```powershell
git clone https://github.com/sizuruinkstone/local-image-chat.git
cd local-image-chat
npm install
```

Windowsでは `install.bat` でも依存関係を導入できます。

## 起動

```powershell
npm start
```

またはWindowsで `start.bat` を実行します。

ブラウザで次を開きます。

```text
http://127.0.0.1:3030
```

## ローカル設定

共通の既定値は `config.json` にあります。

PC固有のpath、Runtime Profile、Discord Webhookなどは `config.local.json` へ置きます。

```json
{
  "lora": {
    "installDir": "C:\\AI\\StabilityMatrix-win-x64\\Data\\Models\\Lora"
  },
  "discord": {
    "webhookUrl": "https://discord.com/api/webhooks/..."
  }
}
```

`config.local.example.json` を参考にしてください。

Forge NeoのProfile設定は [`docs/FORGE_NEO.md`](docs/FORGE_NEO.md) にまとめています。

## LAN / スマホ / PWA

同じLAN内のスマホから使う場合は `start-lan.bat` を使用できます。

```text
LOCAL_IMAGE_CHAT_HOST=0.0.0.0
```

その後、スマホから次の形式でアクセスします。

```text
http://<PCのIPアドレス>:3030
```

iPhone / AndroidではPWAとしてホーム画面へ追加できます。

### セキュリティ

Local Image Chat自体にはログイン機能がありません。

- 通常は `127.0.0.1` のまま使用する
- LAN公開は信頼できるプライベートネットワーク内だけで行う
- インターネットへ直接port forwardしない
- 外出先から使う場合はTailscaleなどのprivate networkを使う
- Forge Neo / ReForgeのportを直接外部公開しない

## 開発・検証

構文チェック:

```powershell
npm run check
```

テスト:

```powershell
npm test
```

New Studio開発branchでは追加のStudio / Scenes向けcheck・smoke testも使用しています。

## Repository structure

```text
local-image-chat/
├─ public/              # Web UI / browser-side modules
├─ src/                 # Backend / Runtime / API / MCP
├─ test/                # node:test
├─ docs/                # Runtime / MCP / implementation docs
├─ config.json          # shared defaults
├─ config.local.json    # machine-local settings (not committed)
├─ start.bat
├─ start-lan.bat
└─ package.json
```

## Documentation

- [`DESIGN.md`](DESIGN.md) — UI / design baseline
- [`docs/FORGE_NEO.md`](docs/FORGE_NEO.md) — Forge Neo Runtime / Profile運用
- [`docs/MCP.md`](docs/MCP.md) — MCP wrapper / tools / security boundary
- [`docs/CURRENT_TASK.md`](docs/CURRENT_TASK.md) — 実装中Taskの詳細記録
- [`TODO.md`](TODO.md) — backlog

## 方針

Local Image Chatは「機能追加の履歴をREADMEへ積み上げる」のではなく、READMEでは**現在の使い方と構成だけ**を説明します。

細かい実装履歴・検証記録・過去TaskはGit historyと `docs/` に残します。
