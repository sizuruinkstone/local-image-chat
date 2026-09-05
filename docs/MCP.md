# Local Image Chat MCP Thin Wrapper

Local Image ChatのBackend API v1を、MCP Hostからstdio経由で呼び出すための薄いラッパーです。MCP ServerはWeb Serverとは別processで動作し、画像生成、Job管理、History保存、Checkpoint／LoRAの探索を実装しません。

## 前提と起動

先にLocal Image Chat Backendを通常どおり起動してください。既定では `http://127.0.0.1:3030` のBackend API v1へ接続します。

リポジトリのルートで次を実行します。

```powershell
npm run mcp
```

`npm start`はWeb Serverを起動する既存の意味のままで、MCP Serverを自動起動しません。MCP ServerはMCP Hostが子processとして管理する用途を想定しています。stdoutはMCP JSON-RPC専用のため、診断ログはstderrへ出力されます。

## 接続先とtimeout

接続先はTool引数では受け取りません。process起動時の環境変数だけで指定します。

```text
LOCAL_IMAGE_CHAT_URL=http://127.0.0.1:3030
```

URLは `http` または `https` のroot URLで、認証情報、query、hash、追加pathを含められません。既定値は常に `http://127.0.0.1:3030` です。BackendがTailscale／LAN向けにbindされていても、MCPの既定接続先はLAN全体へ公開されるアドレスへ自動変更されません。

HTTP request受付のtimeoutは既定10,000msです。必要な場合は1,000〜60,000msの範囲で指定できます。

```text
LOCAL_IMAGE_CHAT_TIMEOUT_MS=10000
```

timeoutは画像生成の完了待ち時間ではありません。`generate_image`はJob受付だけを行い、timeout時にも同じrequestを自動再送しません。

## MCP Hostへの登録例

登録形式はMCP Hostごとに異なるため、実際の設定ファイルpathとschemaは各Hostの現行ドキュメントで確認してください。設定ファイルの自動編集は行いません。

```json
{
  "command": "node",
  "args": [
    "C:/AI/local-image-chat/src/mcp/server.js"
  ],
  "env": {
    "LOCAL_IMAGE_CHAT_URL": "http://127.0.0.1:3030",
    "LOCAL_IMAGE_CHAT_IMPORT_ROOTS": "C:/Users/example/Downloads;C:/Users/example/Pictures"
  }
}
```

### Codex CLIでの登録実績

Codex CLI `0.145.0`では、既存の同名設定がないことを確認したうえで、次の登録を行います。`<repo>`はこのリポジトリのルートへ置き換えてください。

```powershell
codex mcp add local_image_chat `
  --env LOCAL_IMAGE_CHAT_URL=http://127.0.0.1:3030 `
  -- node <repo>\src\mcp\server.js
```

登録後は `codex mcp get local_image_chat` と `codex mcp list` で、stdio、`node`、`src/mcp/server.js`、`LOCAL_IMAGE_CHAT_URL`、enabled状態を確認します。登録済みMCPは既存のCodex sessionへ自動反映される前提にせず、Hostを再読込して新規chat／新規CLI sessionでTool一覧を確認してください。実AI Hostでは、9 Toolの認識後に自然言語の要求から環境確認、非同期生成、履歴確認、画像確認、必要な場合の派生生成の順に呼び出します。

## Tools

登録するToolは次の9つです。

- `get_capabilities`: Checkpoint、Sampler、Scheduler、LoRA、既定設定を取得します。生成前の公開identifier確認に使用します。
- `generate_image`: txt2imgの非同期Jobを受付し、`id`と`queued`を返します。生成完了まで待ちません。requestには `metadata.client = "mcp"` が付与されます。既存画像を視覚参照に使う場合は公開`imageId`を`ipAdapter.referenceImageId`へ指定できます。
- `get_generation`: Job IDでstatus、0〜1のprogress、完了時のHistory IDと画像URL、失敗情報を取得します。MCP Server自身はJob状態を保持しません。
- `cancel_generation`: queued／running JobをBackend API v1のcancel endpointでキャンセルします。完了済み等の判定はBackendが行います。
- `get_history`: `limit`、`cursor`、`favorites`によるcursor paginationを1ページだけ取得します。全履歴の自動取得は行いません。
- `get_history_item`: History ID単位で安全なPrompt、設定、LoRA、画像URL、派生元情報、使用時のIP-Adapter参照設定を取得します。Job状態は取得しません。
- `regenerate_image`: 既存txt2img履歴の指定画像から、新しい非同期Jobを開始します。AI Hostが明示したPromptを使い、未指定の設定は元Historyから継承します。IP-Adapterは明示指定時だけ使用し、省略時に元Historyから継承しません。`instruction`は監査用で、Promptを変更しません。元Historyと元画像は変更せず、同じrequestを自動再送しません。
- `get_image`: 指定した公開image IDの軽量thumbnailだけをBackendの固定pathから取得し、AI Hostの視覚確認用MCP image contentとして返します。画像生成、画像内容の評価、Prompt修正は行いません。ユーザーへ提示するoriginal URLは`get_generation`または`get_history_item`の結果を使います。
- `import_reference_image`: AI Hostがユーザーのattach・paste・drop操作で明示的に受け取ったlocal attachment pathを、`LOCAL_IMAGE_CHAT_IMPORT_ROOTS`で明示許可したroot内に限ってraw image bytesとして取り込みます。pathの推測・検索・列挙はせず、返された公開asset image IDをIP-Adapter参照へ渡します。

`import_reference_image`を有効にする場合は、MCP Server processの環境変数へ許可rootを明示設定します。未設定時は取り込みを無効にします。Windowsでは`;`、macOS/Linuxでは`:`で複数rootを区切ります。

```text
LOCAL_IMAGE_CHAT_IMPORT_ROOTS=C:\Users\example\Downloads;C:\Users\example\Pictures
```

Toolには、AI Hostがユーザーの実attachmentから取得して明示的に渡した絶対pathだけを指定します。相対path、URL、`file://`、UNC path、`..` traversal、glob、任意のfilesystem探索、base64、filenameだけの指定は利用できません。MCP Serverはrootと対象をcanonicalizeし、通常ファイル、サイズ、PNG/JPEG/WebPのmagic bytesを確認してからBackendへraw bytesを送信します。Backendは再度decode、サイズ、pixel、MIME、正規化PNG、thumbnail、content hashを検証します。

## IP-Adapter参照生成

`generate_image`と`regenerate_image`では、既存Local Image Chat Historyに存在する公開`imageId`だけを視覚参照として指定できます。

```json
{
  "ipAdapter": {
    "referenceImageId": "existing-image-id",
    "weight": 0.65,
    "guidanceStart": 0,
    "guidanceEnd": 1
  }
}
```

`referenceImageId`は`get_history_item`または`get_image`で確認したIDを使用してください。`weight`は0〜2、`guidanceStart`と`guidanceEnd`は0〜1で、StartはEndより小さくします。`ipAdapter`を省略するとIP-Adapterは使用されず、`regenerate_image`でも元HistoryのIP-Adapter設定を暗黙継承しません。

チャット添付を視覚参照へ使う場合は、次の順序で1回取り込みます。

```text
Hostがユーザーの実attachment pathを取得
  → import_reference_image({ attachmentPath })
  → 返されたasset image IDを必要ならget_imageで確認
  → generate_image / regenerate_imageのipAdapter.referenceImageIdへ指定
```

取り込んだassetはHistoryの画像IDとは別の公開IDですが、生成時の`referenceImageId`契約は共通です。assetのsource path、original filename、raw bytes、base64はHistory、MCP result、Backend DTOへ保存・返却しません。同じ正規化画像はcontent hashで再利用されます。

URL、任意filesystem path、filename、base64、`enabled`、family、module、modelは公開入力として使用できません。`import_reference_image`だけが、Hostから明示されたpathをMCPのallowlist readerへ渡します。参照画像の存在確認、画像解決、MIME／bytes検証、IP-Adapter capability確認、Queue投入、ReForge通信、History保存はBackendの既存Generation Runtimeが担当します。IP-Adapterは顔、衣装、構図の完全一致を保証しません。

通常の非同期フローは次のとおりです。

```text
get_capabilities
  → 必要なら公開Checkpoint／LoRA identifierを選ぶ
  → generate_image
  → 返されたJob IDを使ってget_generationをMCP Host側から呼ぶ
  → doneならresultの画像URLを利用する
```

既存画像を元に修正版を作る場合は、`get_history_item`で元Historyのレシピと画像IDを確認し、AI Hostが完成したPromptを組み立てて`regenerate_image`へ渡します。返された新しいJobを`get_generation`で確認します。`reuseSeed=true`を指定した場合だけ、指定画像の実seedを再利用します。それ以外は新しいseed（`-1`）を使います。

画像をAI Hostが視覚確認する場合は、次の順序で呼び出します。

```text
generate_image または regenerate_image
  → get_generationでterminal状態まで確認
  → result.images[].idを取得
  → get_image({ imageId })でthumbnail WebPを取得
  → AI Hostが要求と画像内容を比較
  → 必要ならget_history_itemで元recipeを確認
  → AI Hostが修正Promptとinstructionを作成
  → regenerate_imageを1回呼ぶ
  → get_generationでdoneを確認
  → 新しいimageIdをget_imageで再評価
```

`get_image`のMCP resultは短いmetadataのtext blockと、base64を`data`へ持つ`image` blockで構成されます。base64はMCP image blockの境界だけに置かれ、text／`structuredContent`へ含めません。MCP Serverは画像内容の説明・採点・Prompt修正・自動再生成を行いません。

`generate_image`から`get_generation`の呼び出しを繰り返す処理はMCP Host側の責務です。MCP Server内にpoller、Job map、History cache、Prompt state、generation defaultsを持ちません。

## 画像とBackend境界

完了JobとHistoryの画像、および取り込み済みReference Assetは、設定済みBackendと同一originのHTTP `originalUrl`／`thumbnailUrl`として返します。ユーザーへ原寸画像を提示する場合は、これらの既存URLを使用します。AI Hostの視覚確認だけは、公開image IDから固定された`/api/images/{imageId}/thumbnail`を一度取得し、384pxのWebPをMCP image blockへ変換します。MCP Serverは、`import_reference_image`のallowlist readerを除き、任意filesystem path、任意URL、MCP Resourceを扱いません。

MCP Serverは次の内部実装へ直接アクセスしません。

- ReForge
- `outputs`、`thumbnail`、History JSON
- JobManager、Generation Service、Prompt Service
- GUI、DOM、Browser

すべての操作は既存の次のAPI v1境界へ委譲します。

```text
GET  /api/v1/capabilities
POST /api/v1/generations
GET  /api/v1/generations/:id
POST /api/v1/generations/:id/cancel
GET  /api/v1/history
GET  /api/v1/history/:id
POST /api/v1/history/:id/regenerations
POST /api/v1/assets/images       # MCP attachmentのraw PNG/JPEG/WebP import
GET  /api/images/:imageId/thumbnail   # get_imageが内部で使う固定route
GET  /api/images/:imageId/original
```

`regenerate_image`もtxt2img履歴だけを対象とします。img2img、inpaint、画像アップロード、MCP Resource、Prompt template、MCP Task API、Streamable HTTP／SSE、任意URL fetchは対象外です。
