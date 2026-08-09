# 現在の実装対象：Task 11「Local Image Chat Backend API v1基盤」

更新日: 2026-08-09
状態: **実装待ち**
担当: Luna
設計・レビュー: Codex
優先度: 高

## 1. 目的

既存のLocal Image Chatへ、人間向けWeb UI・将来のMCP・CLIが同じ生成処理を利用できるBackend API基盤を追加してください。

目標構造:

```text
Web UI ─┐
        ├─> Local Image Chat Backend API
MCP ────┘               │
                        ▼
               Application Service
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
         ReForge    JobManager    History
```

今回MCP Server本体は作りません。将来のMCPは`/api/v1`を呼ぶ薄いラッパーとし、GUI・DOM・ブラウザ自動操作・ReForge直接操作を行わせません。

最重要成果はエンドポイント数ではなく、**既存Web UIと新APIが同じGeneration Service／同じJobManager／同じReForge・History処理を通ること**です。

## 2. 作業開始時の保護条件

作業開始時点の実環境:

```text
Local Image Chat: 0.0.0.0:3030 / PID 30076
ReForge:          127.0.0.1:7860 / PID 52624
active jobs:      0
active output:    D:\AI\local-image-chat\outputs
```

必須:

- PIDは開始時に再確認する。
- 実3030・実7860を停止、再起動、置換しない。
- 実ReForgeへ生成POSTを送らない。
- 実`D:\AI\local-image-chat\outputs`、`data/history.json`、Favorite、LoRA registry、storage settingsをテストで変更しない。
- API生成テストはOS一時workspace、一時port、mock Ollama／mock ReForgeを使用する。
- worktreeがdirtyなら既存差分を保持し、`reset`、`restore`、`checkout`、`stash`で消さない。
- 新規依存を追加しない。
- `package-lock.json`は依存変更がない限り変更しない。

## 3. 現状調査で確定した構成

### 3.1 現在の生成経路

Web UIは次の経路を使用しています。

```text
public/app.js submitGeneration()
  → POST /api/jobs
  → jobs.create(body, meta)
  → createJobManager(generateWithRecovery)
  → generateWithRecovery()
  → performGeneration()
  → generateImages() in src/reforge.js
  → 原画像・thumbnail保存
  → history.addGeneration()
  → Job result
  → GET /api/jobs/:jobId のpolling
```

同期互換API`POST /api/generate`も、現在は同じ`performGeneration()`を直接呼びます。

したがって、ReForge呼び出しを新API用に再実装してはいけません。現在`src/server.js`内にある生成固有処理を**移動して共通化**し、旧APIと新APIから利用してください。

### 3.2 Job Manager

`src/job-manager.js`の`createJobManager(execute)`を使用します。

既存status:

```text
queued
running
done
failed
cancelled
```

既存機能:

- 直列queue
- `create(payload, meta)`
- `get(id)`
- `list()`
- `cancel(id)`
- AbortController
- progress 0〜100
- terminal後payload解放
- retention cleanup

新しいqueueや別のMapを作らないでください。

### 3.3 Prompt

`public/structured-prompt.js`はDOM非依存の純粋モジュールです。次が既にあります。

- `PROMPT_FIELDS`
- `normalizeSections()`
- `joinPromptSections()`
- `buildFinalPrompt()`
- Trigger Words関連処理

結合順は既に次で固定されています。

```text
character
appearance
composition
situation
style
extra
```

`joinPromptSections()`は前後の空白・端のカンマだけを処理し、内部のタグ順・重複・構文を変更しません。Prompt Serviceはこれを再利用してください。

現在Web UIは最終Positiveを`body.prompt`として送信し、履歴復元用に以下も送ります。

- `structuredPrompt`
- `rawPromptOverride` boolean
- `rawPrompt`
- `appliedTriggerWords`
- `negativePrompt`

### 3.4 Settings

既存defaultは`config.json`の`config.defaults`です。`src/server.js`の既存`validateSettings()`が次を正規化しています。

- width / height
- steps / cfgScale / seed
- samplerName / scheduler / noiseSchedule
- candidateCount
- img2img / inpaint
- hiresEnabled / hiresScale / hiresSteps / hiresDenoising / hiresUpscaler
- 履歴用Checkpoint情報

別のdefault定義を作らず、この検証処理をGeneration Serviceへ**移動して再利用**してください。

### 3.5 ReForge・Capabilities

既存`src/reforge.js`に次があります。

- `listCheckpoints()`
- `listSamplers()`
- `listLoras()`
- `switchCheckpoint()`
- `generateImages()`
- fallback sampler / scheduler

インストール済みLoRAは`getInstalledLoras()`相当、つまり`listLoras()`と`civitai.mergeWithInstalled()`の既存経路を再利用します。

### 3.6 History

`createHistoryService()`は`JsonStore`を使用し、現在schemaVersion 2です。

既存機能:

- `addGeneration()`
- `listPage({ favoritesOnly, limit, cursor })`
- image ID cursor
- 1〜100件制限
- 古い履歴の読み出し時normalize

保存済みgenerationには次が既に含まれます。

- structuredPrompt
- rawPromptOverride / rawPrompt
- prompt / negativePrompt
- effectivePrompt / effectiveNegativePrompt
- settings / checkpoint metadata
- loras / appliedTriggerWords
- seed / images

History schemaを上げたり全面Migrationしたりしないでください。

### 3.7 アクセス制御

- 既定bindは`127.0.0.1`。
- `LOCAL_IMAGE_CHAT_HOST=0.0.0.0`ではLAN／Tailscaleへ公開可能。
- 一般APIにログイン機能はない。
- `/api/integrations`だけは既存integration key保護がある。

`/api/v1`は既存一般APIと同じExpress app・同じbindへmountします。CORSを新規開放したり、新APIだけ別port・別server・保護迂回にしたりしないでください。

## 4. 採用する構造

原則として次を使用してください。

```text
src/
├─ api/
│  └─ v1/
│     ├─ router.js
│     ├─ generations.js
│     ├─ capabilities.js
│     └─ history.js
├─ services/
│  ├─ generation-service.js
│  └─ prompt-service.js
├─ server.js
├─ reforge.js
├─ job-manager.js
└─ history.js
```

不要な既存ファイル移動は行わないでください。

### 4.1 責務

`src/api/v1/*`:

- Express request/response
- HTTP status
- v1のエラー形式
- DTO serialization
- Application Service呼び出し

`src/services/prompt-service.js`:

- v1 PromptInputの検証
- structured / rawの解決
- positive / negative / modeの決定
- DOM、Express、ReForge、Historyへ依存しない

`src/services/generation-service.js`:

- request validation
- v1 requestから既存generation payloadへの変換
- existing defaults適用
- Job作成／取得／cancel
- capabilities取得
- Generation Runtime（既存performGeneration）の保持
- ReForge／History／thumbnail／Discord／recoveryの既存処理のオーケストレーション

`src/job-manager.js`:

- queueと状態遷移だけを担当
-責務を増やさない

### 4.2 Generation Serviceの構築順

循環依存を避けるため、同じファイルから次の2段階をexportして構いません。

```js
const runtime = createGenerationRuntime(dependencies);
const jobs = createJobManager(runtime.executeWithRecovery);
const generationService = createGenerationService({
  jobs,
  runtime,
  config,
  capabilityDependencies,
  history,
});
```

役割:

- Runtime: 実際の1生成をReForge→保存→Historyまで実行
- Service: API入力を正規化し、既存JobManagerへ投入・参照・cancel

別queue、別worker、別History保存は作りません。

## 5. 段階的な実装順

### Phase A: 挙動を変えない抽出

まず、現在`src/server.js`内にある次を`src/services/generation-service.js`へ**コピーではなく移動**してください。

- `generateWithRecovery()`
- `performGeneration()`
- generation request/settings/mode/LoRA/structured prompt検証
- source image / mask / IP-Adapter解決
- generation固有の画像保存・履歴接続
- generation固有のPrompt・LoRA合成補助
- retry/recovery接続

次は既存モジュールへ残します。

- Express route定義
- app/server lifecycle
- `createJobManager()`本体
- `src/reforge.js`のpayload構築・progress polling
- `src/history.js`の保存normalize
- thumbnail service
- Discord service
- experiment service

抽出後、旧`POST /api/jobs`と旧`POST /api/generate`の既存テストを先に通してください。ここで挙動を変えないことが条件です。

### Phase B: Prompt Service

`src/services/prompt-service.js`へ、少なくとも次を追加してください。

```js
resolvePrompt(input)
```

入力:

```js
{
  structured?: {
    character?: string,
    appearance?: string,
    composition?: string,
    situation?: string,
    style?: string,
    extra?: string,
  },
  rawOverride?: string | null,
  negative?: string,
}
```

出力:

```js
{
  structured,
  rawOverride,
  positive,
  negative,
  mode: "structured" | "raw",
}
```

判定:

- `rawOverride`が`null`／`undefined`以外の文字列ならraw mode。
- raw modeの`positive`は`rawOverride`そのものを前後trimした値。
- structured modeは`normalizeSections()`と`joinPromptSections()`を再利用。
- `negative`は文字列として保持し、前後trim以外の変更をしない。
- structured modeでは6項目を正規化したobjectを返す。
- positiveが空のgeneration requestはGeneration Serviceで400にする。

禁止:

- タグ自動分類
- 並び替え
- 重複削除
- 大文字小文字変更
- LoRA構文や重み構文変更
- 中身のカンマ正規化
- 翻訳・AI補正

### Phase C: API v1

`app.use("/api/v1", createV1Router(...))`として同じExpress appへmountしてください。

旧`/api/*`は削除・rename・レスポンス変更しません。

## 6. v1 Generation Request契約

初期完成範囲は安全な`txt2img`です。

```json
{
  "mode": "txt2img",
  "prompt": {
    "structured": {
      "character": "1girl",
      "appearance": "blonde hair",
      "composition": "cowboy shot",
      "situation": "ruined castle",
      "style": "masterpiece, best quality",
      "extra": ""
    },
    "rawOverride": null,
    "negative": "lowres, worst quality"
  },
  "settings": {
    "checkpoint": "example-model",
    "width": 768,
    "height": 1280,
    "steps": 30,
    "cfgScale": 4,
    "sampler": "Euler a",
    "scheduler": "SGM Uniform",
    "seed": -1,
    "candidateCount": 1,
    "hires": {
      "enabled": false,
      "scale": 1.5,
      "steps": 20,
      "denoising": 0.4,
      "upscaler": "R-ESRGAN 4x+ Anime6B"
    }
  },
  "loras": [
    {
      "name": "example",
      "weight": 0.7,
      "enabled": true
    }
  ],
  "metadata": {
    "client": "web"
  }
}
```

API境界で次へ変換します。

```text
prompt.structured       → structuredPrompt
resolved positive       → prompt
prompt.rawOverride      → rawPromptOverride=true + rawPrompt
prompt.negative         → negativePrompt
settings.sampler        → settings.samplerName
settings.hires.enabled  → settings.hiresEnabled
settings.hires.scale    → settings.hiresScale
settings.hires.steps    → settings.hiresSteps
settings.hires.denoising→ settings.hiresDenoising
settings.hires.upscaler → settings.hiresUpscaler
```

未指定settingsは既存`config.defaults`と既存validationを利用します。

### 6.1 Mode

- v1初期版では`txt2img`を実装完了条件とする。
- `img2img`／`inpaint`を安全なimage ID契約まで同時に実装できない場合、400 `UNSUPPORTED_MODE`で明示的に拒否する。
- 任意filesystem pathや任意URLを受け取るだけの暫定実装は禁止。
- 旧APIのimg2img／inpaintは変更しない。

### 6.2 Checkpoint

`settings.checkpoint`は任意文字列をReForgeへ素通ししないでください。

- `listCheckpoints()`の現在一覧と完全一致で解決する。
- titleまたは公開用IDで指定できるようにする。
- 見つからなければ400 `INVALID_CHECKPOINT`。
- 指定がなければ現在active checkpointを使用。
- queue実行時に対象checkpointがactiveでない場合だけ、既存`switchCheckpoint()`を使用する。
- queueへ入る前の無秩序な切替は、別jobとの競合になるため禁止。
- Historyへ保存するcheckpoint情報は実際に使用した正規化済み値にする。

既存Web UIのlegacy payloadには現在active checkpoint情報が入っています。既存生成で不要な切替が発生しないことをテストしてください。

### 6.3 LoRA

- nameは既存`validateLoras()`相当の制限を維持。
- weightは既存0.05〜2、最大選択数を維持。
- enabledを保持。
- `<lora:...>`生成は既存`appendLoras()`経路を使用。
- v1用にLoRA tag生成を別実装しない。
- nameを任意ファイルパスとして扱わない。

### 6.4 Client metadata

- `metadata.client`は任意の短い識別子として受け付ける。
- 最大40文字程度、制御文字不可。
- `web`、`mcp`、`cli`を想定するが、client別に生成挙動を変えない。
- Job metaへ保持する場合は`src/job-manager.js`の既存`normalizeMeta()`へ安全な文字列フィールドとして最小追加する。
- 秘密情報、Prompt、パスをJob metaへ入れない。

## 7. Endpoint契約

### 7.1 GET `/api/v1/capabilities`

Status: `200`

最低限:

```json
{
  "checkpoints": [],
  "samplers": [],
  "schedulers": [],
  "loras": [],
  "defaults": {}
}
```

既存`listCheckpoints()`、`listSamplers()`、`getInstalledLoras()`相当を再利用してください。

公開DTO制約:

- Checkpointのローカル絶対`filename`を返さない。
- LoRAのinstall path、preview path、registry内部パスを返さない。
- Checkpointは`id/title/modelName/hash/active`程度。
- LoRAは`name/displayName/recommendedWeight/favorite`など生成選択に必要な最小情報。
- defaultsは既存`config.defaults`から公開可能な生成設定だけ。
- ReForge由来の内部例外全文・stackを返さない。

### 7.2 POST `/api/v1/generations`

正常受付: `202 Accepted`

```json
{
  "id": "既存JobManagerのUUID",
  "status": "queued"
}
```

- Prompt Serviceでpositiveを確定。
- v1 requestを既存generation payloadへ変換。
- Generation Serviceから既存`jobs.create()`へ投入。
- 新しいqueueを作らない。
- 受付前validation errorは400。

### 7.3 GET `/api/v1/generations/:id`

既存status名を維持します。

running例:

```json
{
  "id": "...",
  "status": "running",
  "progress": 0.62,
  "message": "ReForgeで生成中"
}
```

- v1の`progress`は0〜1へ変換する。
- 既存legacy Job APIの0〜100は変更しない。

done例:

```json
{
  "id": "...",
  "status": "done",
  "progress": 1,
  "result": {
    "historyId": "generation UUID",
    "images": []
  }
}
```

- `historyId`は既存resultの`generationId`。
- imagesは既存thumbnailUrl/originalUrlを維持。
- resultから絶対filesystem pathを除く。

failed例:

```json
{
  "id": "...",
  "status": "failed",
  "progress": 0.25,
  "error": {
    "code": "GENERATION_FAILED",
    "message": "..."
  }
}
```

有効形式だが存在しないID: `404 JOB_NOT_FOUND`
不正なID形式: `400 INVALID_REQUEST`

### 7.4 POST `/api/v1/generations/:id/cancel`

- queued/runningは既存`jobs.cancel()`を使用。
- 成功は`200`でcancel後のv1 job DTOを返す。
- 存在しないIDは404。
- done/failed/cancelledは409 `JOB_NOT_CANCELLABLE`。
- raceでcancel直前にterminalへ遷移した場合も409として安全に返す。

旧`DELETE /api/jobs/:jobId`の既存挙動は変更しません。

### 7.5 GET `/api/v1/history`

既存`history.listPage()`をそのまま再利用します。

query:

```text
limit    既存どおり既定20、最大100
cursor   image ID cursor
favorites=1 は維持してよい
```

response:

```json
{
  "generations": [],
  "limit": 20,
  "total": 0,
  "nextCursor": null,
  "hasMore": false
}
```

- 一覧へbase64を含めない。
- imageはthumbnailUrl/originalUrlを返す。
- `settings.checkpointFilename`など絶対pathをv1 DTOから除く。
- Prompt、settings、LoRA、seed、画像情報は既存History互換の範囲で返す。
- History schema、保存形式、既存`GET /api/history`は変更しない。

## 8. エラー契約

`/api/v1`だけ次へ統一します。

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "width must be greater than 0"
  }
}
```

最低限のcode:

```text
INVALID_REQUEST
UNSUPPORTED_MODE
INVALID_CHECKPOINT
JOB_NOT_FOUND
JOB_NOT_CANCELLABLE
GENERATION_FAILED
CAPABILITIES_UNAVAILABLE
INTERNAL_ERROR
```

実装条件:

- status/code/messageを持つ小さなError classまたはhelperをv1 router内で共通化。
- routeごとに異なるエラーJSONを書かない。
- stack trace、絶対path、ReForgeレスポンス全文をclientへ返さない。
- server logにはmethod/path/codeと原因を残す。
- malformed JSONも可能な範囲でv1 error形式へする。
- `/api/v1/*`の未知routeは404の同形式。
- 旧APIのエラー形式は変更しない。

## 9. 既存APIの接続

### 9.1 `POST /api/jobs`

既存request/responseを一切変えず、内部だけ次へ寄せます。

```text
legacy route
  → generationService.createLegacyJob(body, meta)
  → existing jobs.create()
```

### 9.2 `POST /api/generate`

削除しません。同期responseも変えません。

```text
legacy route
  → generationService.generateLegacyNow(body, context)
  → same Generation Runtime
```

完全統合が抽出リスクを大きくする場合でも、ReForge呼び出し・画像保存・History保存の巨大ロジックを2本作ることは禁止です。未統合の薄いadapterだけを残課題として報告してください。

### 9.3 Web UI

- `public/app.js`を`/api/v1`へ移行しない。
- UI全面変更を行わない。
- 既存`POST /api/jobs` pollingとcancelを維持。
- Backend抽出によるUI回帰だけ既存テストで確認。

## 10. セキュリティ

- 任意shell commandを受け付けない。
- 任意filesystem pathを受け付けない。
- 任意URLをfetchしない。
- v1 txt2imgへinit image pathを足さない。
- Checkpoint／LoRAは現在のcapability一覧から安全に解決。
- API responseへローカル絶対pathを出さない。
- API responseへbase64画像を出さない。
- client metadataを処理分岐、ファイル名、ログ注入へ使わない。
- body sizeは既存Express JSON limitを維持し、今回拡大しない。
- CORSを追加しない。
- bind設定を変更しない。
- 新APIだけReForge URLや内部configを公開しない。
- stack traceを返さない。

## 11. 変更対象

想定変更:

```text
src/server.js
src/job-manager.js                         （client metaを保持する場合のみ）
src/services/prompt-service.js             新規
src/services/generation-service.js         新規
src/api/v1/router.js                       新規
src/api/v1/generations.js                  新規
src/api/v1/capabilities.js                 新規
src/api/v1/history.js                      新規
test/prompt-service.test.js                新規
test/generation-service.test.js または test/api-v1.test.js
test/server-integration.test.js            実配線確認を既存fixtureへ最小追加する場合
test/job-manager.test.js                   client meta変更時のみ
package.json                               npm run check対象追加のみ
```

原則13ファイル以内。13ファイルを超える場合は、実装を続ける前に理由と追加対象を報告してください。

原則変更禁止:

```text
public/index.html
public/app.js
public/style.css
src/reforge.js
src/history.js
src/json-store.js
src/migrations.js
data/*
config.local.json
package-lock.json
ReForge本体
```

既存ロジックを安全に移動するため、`src/reforge.js`または`src/history.js`のexport調整が本当に必要な場合だけ、先に理由を報告してください。History schema変更は認めません。

## 12. テスト

### 12.1 Prompt Service

必須:

1. 6項目を指定順で結合
2. 一部空欄
3. structured全空欄
4. 改行を含む値
5. 日本語
6. `<lora:name:0.7>`を無変更
7. `(tag:1.2)`など重み構文を無変更
8. rawOverrideあり
9. rawOverrideなし
10. negative保持
11. タグ重複を勝手に削除しない
12. 大文字小文字を変更しない

### 12.2 Generation Service

実`createJobManager()`とstub runtimeを使用して確認:

1. v1 requestをlegacy payloadへ正しく変換
2. existing defaults適用
3. sampler alias
4. nested hires alias
5. metadata.client保持
6. Job Managerへ1回だけ投入
7. 同じ入力が同じresolved Promptになる
8. raw mode
9. invalid width/height/steps/cfg/seed
10. invalid LoRA
11. unknown checkpoint拒否
12. arbitrary path／URLフィールドを採用しない

### 12.3 API v1

一時portの小さいExpress app、または既存隔離server fixtureを使う:

1. `GET /api/v1/capabilities` 200
2. responseに絶対pathがない
3. `POST /api/v1/generations`正常request→202
4. 不正request→400統一error
5. `GET /api/v1/generations/:id` queued/running
6. done→historyId/images
7. failed→構造化error
8. 存在しないJob→404
9. queued cancel→200/cancelled
10. terminal cancel→409
11. `GET /api/v1/history` pagination
12. history responseにbase64／絶対pathなし
13. unknown v1 route→404統一error
14. stack traceを返さない

### 12.4 回帰

既存テストで最低限確認:

- legacy `/api/jobs`
- legacy `/api/generate`
- img2img / inpaint / Hires
- IP-Adapter
- recovery retry
- History保存・復元
- thumbnail/original URL
- Web UI job polling/cancel

## 13. 検証コマンド

```powershell
npm run check
node --test test/prompt-service.test.js test/generation-service.test.js test/api-v1.test.js
node --test test/job-manager.test.js test/server-integration.test.js test/server-recovery.test.js test/ui-shell.test.js
npm test
git diff --check
git status --short
```

実際のファイル名に合わせて存在する関連テストだけ指定してください。

`package.json`の`check`へ次の新規JSを明示追加してください。

- `src/services/prompt-service.js`
- `src/services/generation-service.js`
- `src/api/v1/router.js`
- `src/api/v1/generations.js`
- `src/api/v1/capabilities.js`
- `src/api/v1/history.js`

### 13.1 endpoint smoke

実3030ではなく隔離serverで確認:

```text
GET  /api/v1/capabilities
POST /api/v1/generations
GET  /api/v1/generations/:id
POST /api/v1/generations/:id/cancel
GET  /api/v1/history
```

mock ReForgeを使用し、実GPU・実outputs・実historyを変更しないでください。

## 14. 禁止事項

- 新規リポジトリ
- MCP Server本体
- MCP→GUI／DOM／browser automation
- MCP→ReForge直接接続
- 新queue／新Job Manager
- ReForge generation payloadの複製
- History二重保存
- UI全面改修
- DB導入
- History全面Migration／schema bump
- server.js完全分割
- ReForge abstraction全面刷新
- OpenAPI完全整備
- 認証全面刷新
- Civitai／Discord／LoRA管理／比較APIのついで整理
- 新規依存
- CORS開放
- 任意path／URL／shell受付
- base64画像をv1 response/historyへ格納
- 無関係なformat変更
- 実3030／7860の無断停止・再起動
- 実outputs／historyを使う自動テスト

## 15. 完了条件

1. `/api/v1`routerが存在する。
2. capabilities、generation作成、status、cancel、historyが存在する。
3. generation作成は既存JobManagerを使う。
4. 新queueを作っていない。
5. ReForge呼び出し・画像保存・History保存を複製していない。
6. Prompt ServiceがDOM／Express非依存。
7. structured promptを正しい順で解決する。
8. Raw Prompt Overrideを解決する。
9. backendが実際のpositiveを確定する。
10. existing defaultsを再利用する。
11. Checkpoint／LoRAを安全に解決する。
12. v1 responseにbase64／絶対path／stackがない。
13. 一貫したv1 error形式。
14. History schema・旧履歴互換を維持。
15. 旧`/api/jobs`、`/api/generate`を維持。
16. 既存UIを変更・破壊していない。
17. img2img／inpaint／Hires／IP-Adapterのlegacy回帰なし。
18. client別に生成挙動を変えていない。
19. MCP固有ロジックがない。
20. 単体・API・回帰テストが追加されている。
21. `npm run check`成功。
22. `npm test`成功。
23. `git diff --check`成功。
24. 実3030／7860、実outputs／historyを変更していない。

## 16. 作業後の報告

次だけを具体的に報告してください。

### 変更ファイル

- 一覧
- 各ファイルの責務と変更内容

### 既存構成の確認結果

- 旧生成経路
- Job Manager
- ReForge
- History
- Prompt

### Application Service

- Runtimeへ移した処理
- Serviceが担当する処理
- 旧API／v1が同じ処理へ合流する場所

### API

各endpointについて:

- method/path
- request
- response
- status code
- error code

### Prompt

- structured結合
- raw override
- negative
- LoRAとの接続

### Generation

- Job Manager投入
- Checkpoint解決・切替
- ReForge呼び出し
- 画像保存
- History保存

### 後方互換性

- `/api/jobs`
- `/api/generate`
- UI
- History
- img2img/inpaint/Hires/IP-Adapter

### Tests / Verification

- 追加テスト
- 全コマンドとpassed/failed件数
- 実環境を変更していない証拠

### 残課題

必ず明記:

- Web UIの`/api/v1`移行
- v1 img2img／inpaint（今回未対応なら）
- MCP Server
- OpenAPI
- legacy adapterの残存箇所

## 17. 実装停止条件

次の場合は推測で進めず、変更前またはその時点で設計監督へ報告してください。

- 13ファイルを超える。
- History schema bumpが必要に見える。
- ReForge payloadを別実装しないと進められない。
- UI変更が必要に見える。
- 任意path／URL受付が必要に見える。
- 新依存が必要に見える。
- 実3030／7860を再起動しないとテストできない。
- 既存`performGeneration()`を共通Runtimeへ移せず、巨大生成ロジックが2本になる。

## 18. Luna向け補足：実装時の重要ルール

この節は本文の補足です。本文と解釈が競合する場合は、本文の具体的なAPI契約・変更範囲・停止条件を正本として優先してください。

### 18.1 最優先は既存挙動を変えない共通化

今回作るものは新しい画像生成機能ではありません。次を同じGeneration Runtimeへ収束させるための基盤です。

```text
既存 POST /api/jobs
既存 POST /api/generate
新規 POST /api/v1/generations
将来 MCP
          │
          ▼
同じGeneration Runtime
```

別系統のqueue、ReForge生成、画像保存、History保存を作らないでください。

Phase 1の入力と出力は次でなければなりません。

```text
同じ入力
  → 同じvalidation
  → 同じReForge request
  → 同じ画像保存
  → 同じHistory
  → 同じresult
```

### 18.2 Phase 1へ機能改善を混ぜない

Generation Runtime抽出と同時に、次を変更しないでください。

- request schema全面変更
- History形式変更
- ReForge request形式変更
- Job Manager設計変更
- Prompt仕様変更
- legacy APIのエラー形式変更
- default値変更
- legacy settings名称変更

抽出後に旧API回帰を確認し、失敗が残っている状態でPrompt Serviceや`/api/v1`の実装へ進まないでください。

Phase 1の確認対象:

```text
POST /api/jobs
GET /api/jobs/:id
DELETE /api/jobs/:id
POST /api/generate
txt2img
img2img
inpaint
Hires.fix
IP-Adapter
History
cancel
```

現行のlegacy cancelは`DELETE /api/jobs/:jobId`です。存在しない`POST /api/jobs/:id/cancel`へ変更・追加しないでください。

### 18.3 generation-service.jsを第二のserver.jsにしない

循環依存は禁止です。

```text
generation-service.js → server.jsをimport
server.js → generation-service.jsをimport
```

上記のような構造にしないでください。

Serviceが`server.js`のmutable globalを暗黙参照する構造も避け、必要な依存だけをfactory引数等で明示してください。

候補:

- config
- history service
- thumbnail service
- Discord service
- experiment service
- ReForge adapter functions
- Ollama functions
- output directory
- Job Manager

DI frameworkやservice containerは追加しません。既存ES moduleと小さなfactoryで十分です。

Generation Serviceはオーケストレーション層です。queue、AbortController管理、ReForge HTTP、History storageの仕組み自体を取り込み直さないでください。

現在、原画像保存は`performGeneration()`内にあります。抽出時はその既存処理をRuntimeとともに移して構いませんが、保存方式の再設計や別実装は行わないでください。Thumbnailは既存serviceを呼びます。

### 18.4 Promptロジックの正本を1つにする

第一候補は既存`public/structured-prompt.js`のDOM非依存関数をBackendから再利用することです。

```js
normalizeSections()
joinPromptSections()
```

`src/services`から`public`への依存が、実際の抽出後構造で明らかに不自然になる場合だけ、純粋PromptロジックをBrowser／Backend双方からimportできる共通モジュールへ**移動**して構いません。

禁止:

- Browser版とBackend版のコピー
- 2つの`PROMPT_FIELDS`
- 2つの`joinPromptSections()`
- UIとAPIで異なるRaw Override判定

Prompt仕様の正本は常に1つにしてください。

入力文字列に対して、次を行いません。

- タグ順変更
- 重複タグ削除
- AI分類・修正
- 翻訳
- capitalization変更
- LoRA構文変更
- weight構文変更
- 内部空白の正規化
- 過剰なcomma正規化

変更してよいのは、既存仕様にある各section端の処理と、6項目の順序付き結合だけです。

```text
character → appearance → composition → situation → style → extra
```

Raw Prompt Overrideはstructuredより必ず優先します。

### 18.5 API DTOはallowlistで組み立てる

Capabilities、Job result、Historyの公開DTOは、内部objectのclone後に危険fieldをdeleteする方式を避けてください。

推奨:

```js
return {
  id,
  title,
  modelName,
  hash,
  active,
};
```

のように公開fieldを明示するallowlist方式です。

次を`/api/v1`responseへ含めません。

```text
C:\AI\...
C:\stable-diffusion\...
checkpointFilename
installPath
absolute image path
absolute LoRA path
ReForge working directory
内部config
stack trace
base64 image
```

画像は既存のimage ID、`thumbnailUrl`、`originalUrl`を使用してください。

History DTOの最低限候補:

```text
id
createdAt
title（存在する場合）
prompt.structured
prompt.rawPromptOverride
prompt.effectivePrompt
prompt.negativePrompt
settings.checkpoint（公開identifier）
settings.width / height / steps / cfgScale
settings.sampler / scheduler / seed
loras
images
```

既存Historyに存在しない値を推測して生成する必要はありません。

### 18.6 Checkpoint identifierは1種類

`GET /api/v1/capabilities`が返すCheckpointの公開`id`を、`POST /api/v1/generations`の`settings.checkpoint`へそのまま渡せるようにしてください。

```text
capabilities.checkpoints[].id
        ↓ same value
generation.settings.checkpoint
```

公開identifierをtitle／modelName／filename／pathの複数推測にしないでください。

- 公開`id`を1種類決める。
- Generation Serviceは現在一覧の公開`id`と完全一致で解決する。
- 内部で対応するcanonical titleを取得する。
- 任意pathをReForgeへ渡さない。
- 不一致は400 `INVALID_CHECKPOINT`。

Checkpoint切替はrequest受付時ではなく、そのJobがqueue内で`running`になった後、ReForge生成直前に行います。

```text
Job A: checkpoint X
Job B: checkpoint Y
```

が待機中に互いのCheckpointを変更しないよう、既存queueの直列性を利用してください。

### 18.7 Job状態とprogressの正本

Job Manager内部statusは変更しません。

```text
queued
running
done
failed
cancelled
```

新APIだけ`done`を`completed`へ変換しないでください。

progressをv1で0〜1にする処理はDTO境界だけです。

```js
progress: job.progress / 100
```

Job Manager内部と旧`/api/jobs`の0〜100仕様は変更しません。

### 18.8 client metadataは情報だけ

`metadata.client`は保持して構いませんが、次のような生成分岐は禁止です。

```js
if (client === "mcp") {
  // 別のPrompt・settings・ReForge処理
}
```

`web`、`mcp`、`cli`の同じGenerationRequestは同じ意味・同じRuntimeになります。

### 18.9 txt2img以外を無理にv1へ入れない

v1初期完成範囲はtxt2imgです。

img2img／inpaintの安全なasset transportが未設計なら、400で次を返してください。

```json
{
  "error": {
    "code": "UNSUPPORTED_MODE",
    "message": "This mode is not available in API v1"
  }
}
```

次の暫定入力は禁止です。

```json
{ "imagePath": "C:\\..." }
{ "imageUrl": "https://arbitrary-site/..." }
{ "imageBase64": "..." }
```

将来のasset upload／asset ID APIは別タスクです。既存legacy APIのimg2img／inpaintは維持します。

### 18.10 API routeは薄く、error mappingは境界で行う

routeは次の程度に留めます。

```js
router.post("/generations", async (request, response) => {
  const result = await generationService.create(request.body);
  response.status(202).json(result);
});
```

route内へ次を書かないでください。

- Checkpoint切替
- ReForge payload構築
- 画像保存
- History保存
- Prompt結合
- queue実装

既存内部moduleのError形式を全面変更せず、v1 API境界でvalidation／checkpoint／job／generation errorを公開Errorへ変換します。

### 18.11 実環境を汚さず、小さいdiffを優先

テスト対象:

```text
temporary workspace
temporary port
mock/stub Ollama
mock/stub ReForge
temporary history
temporary outputs
```

変更禁止:

```text
実3030
実7860
実outputs
実history
実config
CSS
UI構造
無関係な変数名
大量formatting
History schema
ReForge module設計
依存
package-lock
```

### 18.12 指示と現コードが食い違う場合

推測で設計を拡大しないでください。

最終報告へ次を記載します。

1. 何がCURRENT_TASKの想定と違ったか。
2. 指示どおりに進めると何が危険だったか。
3. どの既存挙動を正本としたか。
4. 代わりに行った最小変更。

13ファイル上限や他の停止条件へ該当する場合は、変更を増やす前に設計監督へ確認してください。

### 18.13 完了時の必須提出物

本文16節の報告に加え、次を明確に分けて提出してください。

1. `git diff --stat`と追加／変更／削除ファイル。
2. Runtime抽出前後のcall flow。
3. `POST /api/jobs`と`POST /api/generate`が通るService／Runtime。
4. v1全5 endpointのrequest／response／status／error。
5. structured／Raw Overrideの共通化方法。
6. Capabilities／History DTOのallowlist。
7. Checkpoint公開IDとqueue内切替。
8. path／base64／stack漏洩防止。
9. 追加テストとpassed／failed件数。
10. `npm run check`、`npm test`、`git diff --check`の結果。
11. 実3030／7860、実outputs／historyを変更していないこと。
12. 意図的に未対応とした次の項目。

```text
v1 img2img
v1 inpaint
asset API
Web UIのv1移行
MCP Server
OpenAPI
```

このタスクの成功条件は単なるendpoint追加ではありません。旧Web UI、旧API、新v1 API、将来MCPが、既存挙動を維持した同じGeneration Runtimeへ自然に収束できる構造であることです。
