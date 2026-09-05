# Task 26: Civitai APIキーの`.env`永続化

更新日: 2026-08-31
状態: **実装・監督レビュー完了／最終承認**
担当: Luna
設計・レビュー: Codex

## 目的

現在、設定画面のCivitai APIキーは`sessionStorage`だけに保持されるため、ブラウザーセッション終了後に再入力が必要である。リポジトリ直下のGit管理外`.env`からCivitai APIキーをサーバー起動時に読み込み、通常利用では画面へ毎回入力しなくてよい状態にする。

対象はCivitai APIキーだけとする。GitHub token、Discord Webhook、MCP設定、Integration keyへ便乗変更しない。

## 現状確認

- UI入力: `#civitaiToken`
- Browser保持: `sessionStorage["localImageChat.civitaiToken"]`
- 対象route:
  - `POST /api/civitai/inspect`
  - `POST /api/civitai/check-duplicate`
  - `POST /api/civitai/install`
  - `POST /api/civitai/refresh-registrations`
- 現在は各routeが`request.body.token`だけを`sanitizeSecret()`してCivitai Serviceへ渡す。
- `start.bat`は`npm start`、`npm start`は`node src/server.js`を呼ぶ。
- 実環境のNodeはv24.16.0で、`--env-file-if-exists`を利用可能。
- `.env`は現在`.gitignore`へ明示されていない。

## 採用設計

### `.env`

リポジトリ直下で次を使用する。

```dotenv
LOCAL_IMAGE_CHAT_CIVITAI_TOKEN=
```

- `.env`はGit管理外とし、絶対にcommitしない。
- `.env.example`には変数名と空値だけを置く。実キー、ダミーに見える実キー、個人情報を書かない。
- `.gitignore`へ`.env`と`.env.local`を追加する。
- 既に`.env`が存在する場合は上書きしない。
- Lunaはユーザーの実キーを探索、表示、ログ出力、テストfixtureへ転記しない。

### 起動

`npm start`を次の考え方へ変更する。

```text
node --env-file-if-exists=.env src/server.js
```

`start.bat`／`start-lan.bat`は既存どおり`npm start`を呼ぶため、原則変更しない。`npm run mcp`へCivitaiキーを渡す必要はない。

このプロジェクトの実環境はNode 24であるため、本Taskでは新しい`dotenv`依存を追加しない。`package-lock.json`を変更しない。

### サーバー側の優先順位

起動時に次を1回だけ解決する。

```text
request.body.token（画面で一時入力）
  > LOCAL_IMAGE_CHAT_CIVITAI_TOKEN（.env／実環境変数）
  > 空文字（従来の公開API利用）
```

共通helperを1つ用意し、4 routeで同じfallback処理を複製しない。

概念:

```js
const civitaiTokenFromEnvironment = sanitizeSecret(
  process.env.LOCAL_IMAGE_CHAT_CIVITAI_TOKEN
);

function resolveCivitaiToken(requestToken) {
  return sanitizeSecret(requestToken) || civitaiTokenFromEnvironment;
}
```

必須条件:

- 画面で明示入力したtokenは、そのrequestだけ環境変数より優先する。
- 空欄なら`.env`のtokenを使用する。
- `.env`未設定時は従来どおりtokenなしでCivitai公開APIを利用する。
- tokenのtrim／最大長は既存`sanitizeSecret()`を維持する。
- Civitai ServiceのHTTP header構築を重複変更しない。

### UI

- password入力欄は一時上書き用として残す。
- 値をサーバーから画面へ返さない。
- inputへ環境変数の値を埋めない。
- localStorageへ保存しない。
- 既存sessionStorage挙動は維持してよい。
- 補助文を次の趣旨へ変更する。

```text
サーバー側にAPIキーを設定済みの場合は空欄で利用できます。ここへの入力はこのブラウザーセッションだけの一時上書きです。
```

環境変数が設定済みかを表示する新APIは本Taskでは不要。秘密情報の存在確認APIも安易に増やさない。

## セキュリティ

- tokenをAPI responseへ含めない。
- tokenをconsole、error message、History、metadata、Discord、MCPへ含めない。
- `.env`を静的配信しない。Expressの`public/`外に置く。
- `.env`をGitへ追加しない。
- testでは実キーを使わず、`test-token`等の明示fixtureと注入envを使う。
- 最終報告へ実キーや部分文字列を記載しない。
- `git diff`、`git status`、test outputに実キーが出ていないことを確認する。

## 変更予定ファイル

原則6ファイル以内:

1. `.gitignore`
2. `.env.example`（新規）
3. `package.json`
4. `src/server.js`
5. `public/index.html`
6. `test/server-integration.test.js`または既存の最小適合test

必要なら`docs/CURRENT_TASK.md`は状態行だけ更新してよい。`package-lock.json`、`public/app.js`、`src/civitai.js`は原則変更しない。

## 禁止事項

- `dotenv`等の新規dependency追加
- 実キーを`.env.example`、config、source、test、docsへ書くこと
- `.env`のcommit
- Browserへ環境変数tokenを返すこと
- APIキーをlocalStorageへ永続化すること
- Civitai以外のsecret管理を同時変更すること
- Civitai API／download logicの全面変更
- API request／response契約の破壊
- 実Civitai install、実LoRA registry更新
- 既存dirty差分のreset／整理／削除
- 3030／Forge Neo／ReForgeの停止・再起動

## 必須テスト

1. request tokenあり: request tokenが環境変数より優先される。
2. request token空: `LOCAL_IMAGE_CHAT_CIVITAI_TOKEN`が使用される。
3. request token未指定: 環境変数tokenが使用される。
4. 両方なし: 空文字となり従来挙動を維持する。
5. tokenの前後空白が除去される。
6. 4つのCivitai routeすべてが共通resolverを通る。
7. response、log、errorへtokenが出ない。
8. `.env`と`.env.local`がignoreされる。
9. `.env.example`に実値がない。
10. `npm start`が`.env`なしでも起動可能なscriptである。
11. 既存Civitai install／duplicate／refresh testが通る。

実外部Civitai APIを呼ばず、mock/stub／temporary workspaceで確認する。

## 検証コマンド

```powershell
npm run check
node --test test/civitai.test.js test/server-integration.test.js
npm test
git diff --check
git check-ignore .env .env.local
```

## 完了条件

1. `.env`の`LOCAL_IMAGE_CHAT_CIVITAI_TOKEN`を起動時に利用できる。
2. `start.bat`／`start-lan.bat`経由でも`.env`が読み込まれる。
3. 画面のAPIキーが空でもCivitai inspect／duplicate／install／refreshで環境変数tokenを使う。
4. 画面入力は一時上書きとして維持される。
5. `.env`未設定時の従来挙動を壊さない。
6. tokenがBrowser、API response、log、Historyへ漏れない。
7. `.env`がGit管理対象にならない。
8. 新規dependencyと`package-lock.json`変更がない。
9. 自動テストが実環境や実LoRA registryを変更しない。
10. `npm run check`、関連test、`npm test`、`git diff --check`が成功する。

## 実装後のユーザー作業

コード承認後、ユーザー本人がリポジトリ直下の`.env`へ実キーを一度だけ入力する。

```dotenv
LOCAL_IMAGE_CHAT_CIVITAI_TOKEN=ここへ実キー
```

その後、active jobsが0であることを確認してLocal Image Chat 3030だけを通常再起動する。Forge Neo／ReForgeの再起動は不要。

## Luna作業後の報告

- 変更ファイル一覧
- `.env`読込方法
- token優先順位
- 対象Civitai route
- UI上の一時上書きの扱い
- 秘密情報をresponse／logへ出さない根拠
- `.gitignore`確認
- 追加／更新testと件数
- 実行コマンドと結果
- 実キー、実Civitai、実LoRA registry、実プロセスを使用していないこと
- 残る制約

実装完了時はこの文書の状態を次へ更新する。

```text
状態: **実装完了／監督レビュー待ち**
```

監督承認、commit、push、実機再起動を勝手に行わない。
