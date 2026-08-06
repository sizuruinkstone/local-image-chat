# 現在の実装対象：Luna Task 09レビュー修正「保存先の起動時再検証と実サーバー統合テスト」

更新日: 2026-08-07
状態: **実装・再レビュー完了（最終承認）**
担当: Luna
優先度: 最優先（Task 10完了後）

## 1. 目的

Task 09「output保存場所変更」の既存実装を維持したまま、レビューで判明した2件だけを修正してください。

1. `data/storage-settings.json`の`activeOutputDir`を起動時に無条件で信用しない。
2. 保存先APIと再起動移行後の画像URL契約を、隔離した実サーバーで検証する。

新機能追加、UI変更、移行方式の作り直しは行いません。Task 10 IP-Adapterは最終承認済みなので、関連コード・モデル・ReForge連携へ触れないでください。

## 2. 現在の実環境を保護する

現在の実環境:

```text
Local Image Chat: PID 58984 / 127.0.0.1:3030
ReForge: PID 52624 / 127.0.0.1:7860
active jobs: 0
outputs: 2665 files / 2,589,002,581 bytes
history.json: 5,174,602 bytes
history SHA-256: C8EAAA5EC0951D01706264D4AA801E56A9DEAE578411D0672CBE7C6FFA222EB6
```

必須保護条件:

- PID 58984とPID 52624を停止・再起動しない。
- 実3030番、実7860番をテストに使わない。
- 実`outputs/`、`data/history.json`、`data/storage-settings.json`、Favorite、LoRA registryを変更しない。
- 実保存先設定APIへPATCH/POSTしない。
- テストはOS一時ディレクトリ、一時ポート、mock Ollama/ReForgeだけで行う。
- reset、restore、checkout、stashで既存のdirty worktreeを消さない。
- Task 08A/08B、ReForge options hotfix、Task 10の差分を維持する。

## 3. 変更対象

原則として次の3ファイル以内です。

1. `src/storage-settings.js`
2. `test/storage-settings.test.js`
3. `test/server-integration.test.js`または`test/server-workspace.test.js`のどちらか一方（実サーバー統合テストを既存ヘルパーへ置く場合のみ）

推奨は、単体テストを`test/storage-settings.test.js`へ追加し、実サーバー統合テストを既存のspawn/一時port/終了ヘルパーを再利用できるテストファイルへ最小追加する構成です。

次は変更しないでください。

- `public/index.html`
- `public/app.js`
- `public/style.css`
- `src/server.js`（既存API契約で検証できるため原則変更不要）
- `src/ip-adapter.js`
- `src/reforge.js`
- `src/history.js`
- `package.json`
- `package-lock.json`
- ReForge本体・モデルファイル

3ファイルを超える、または`src/server.js`変更が必要と判断した場合は、実装を止めて具体的な理由を報告してください。

## 4. 修正1：保存済みactiveOutputDirの起動時再検証

対象は`src/storage-settings.js`の`resolveStoredOutputDir()`と、必要最小限の共通検証処理です。

現状の問題:

```js
await validatePathSafety(candidate, {
  rootDir: resolvedRootDir,
  allowDefaultOutput: true,
  allowExistingActive: true,
  skipContentScan: true
});
```

`allowExistingActive: true`と`skipContentScan: true`により、設定JSONを改ざんすると、markerのない任意の既存ディレクトリをstored outputとして採用できます。そこが`/outputs`の静的配信ルートになるため、セキュリティ上許容できません。

### 4.1 正しい採用条件

`default outputs/`以外のstored active pathは、起動または`getSettings()`で解決するたびに最低限次を確認してください。

- 絶対パスとして正規化できる。
- 対象ディレクトリが実在する。
- 通常のディレクトリである。
- 対象および既存祖先にsymlink/junctionがない。
- Local Image Chat専用markerが存在する。
- marker JSONの`type`と`schemaVersion`が既存仕様に一致する。
- リポジトリルート、ファイルシステムルート、`public`、`src`、`data`、`.git`、`.updates`、`node_modules`ではない。
- 禁止ディレクトリ配下ではない。
- 現在の安全規則で禁止している不正な親子関係を許可しない。

stored active pathの中身を全件hashする必要はありません。markerとパス安全性を確認するために必要な範囲に留め、巨大な保存先の起動を不必要に遅くしないでください。ただし`skipContentScan`を理由にmarker確認まで省略してはいけません。

### 4.2 不正時の挙動

次の場合、stored pathを採用しないでください。

- パスが存在しない。
- markerがない。
- markerが壊れている。
- marker内容が不正。
- 対象がファイル。
- symlink/junctionを含む。
- 禁止パスまたは不正な親子関係。

挙動:

- 安全な既定`<repository>/outputs`へフォールバックする。
- 存在しないstored pathを自動作成しない。
- unmanaged stored pathへmarkerを自動作成しない。
- 改ざんされたstored path内のファイルを読まない・配信しない・削除しない。
- `source`は`default`として返す。
- サーバーログには安全条件を満たさずフォールバックしたことを簡潔に残す。
- UI/APIへディレクトリ内ファイル一覧や内部例外全文を返さない。
- 設定JSONの`activeOutputDir`を勝手に別値へ書き換える必要はない。ランタイム解決だけ安全側へ倒す。
- `pendingMigration`と`lastMigration`を破壊しない。

### 4.3 維持する仕様

- `LOCAL_IMAGE_CHAT_OUTPUT_DIR`が設定されている場合の既存優先順位を変更しない。
- リポジトリ既定の`outputs/`は従来どおり使用できる。
- 正規の移行完了時に作成されたmarker付き保存先は採用する。
- 保存先の予約、キャンセル、listen前移行、旧source保持、Favorite追従を変更しない。
- 空の任意フォルダを「新規移行先候補」としてplanする既存仕様と、起動済みstored pathの採用条件を混同しない。
- active stored pathではmarker必須、pending targetでは既存の予約検証規則を維持する。

## 5. 修正1の必須単体テスト

`test/storage-settings.test.js`へ、少なくとも次を追加・更新してください。

1. 正しいmarker付きstored active pathを採用し、`source === "stored"`になる。
2. markerなしで無関係なファイルを含むstored pathを拒否し、既定outputsへフォールバックする。
3. markerなしの空stored pathもactive pathとしては拒否する。
4. JSON破損、type不一致、schemaVersion不一致のmarkerを拒否する。
5. 保存後に削除されたstored pathを再作成せず、既定へフォールバックする。
6. stored pathが通常ファイルの場合に拒否する。
7. symlink/junction自身または祖先を含むstored pathを拒否する。OS権限上作成できない場合だけ、既存テスト方針に合わせて明示的にskipする。
8. repository rootおよび禁止ディレクトリを拒否する。
9. 改ざんした設定がrepository外のmarkerなし既存フォルダを採用しない。
10. `LOCAL_IMAGE_CHAT_OUTPUT_DIR`の優先仕様を維持する。
11. 不正stored pathへのフォールバックで`pendingMigration`と`lastMigration`を消さない。

テストでは「返り値がdefaultになった」だけでなく、拒否対象ディレクトリが作成・変更されていないことも確認してください。

## 6. 修正2：隔離した実サーバーAPI統合テスト

サービス関数を直接呼ぶだけでは不十分です。`node src/server.js`を子プロセスとして実際に起動し、HTTP API、listen前移行、静的配信、履歴画像APIを往復してください。

### 6.1 隔離方式

保存先予約を検証するため、`LOCAL_IMAGE_CHAT_OUTPUT_DIR`で固定してはいけません。固定すると`PATCH /api/storage/settings`が仕様どおり拒否され、Task 09の主要経路を検証できません。

推奨方式:

1. OS一時ディレクトリへテスト用ワークスペースを作る。
2. 実行に必要な`src/`、`public/`、`package.json`、`config.json`等を一時ワークスペースへコピーする。
3. 依存解決は既存`node_modules`へのテスト専用junction/symlink、または既存テストで採用済みの安全な方法を使う。実リポジトリは変更しない。
4. 一時ワークスペース内の`src/server.js`を、一時cwd・一時port・mock Ollama/ReForgeでspawnする。
5. 一時ワークスペースの既定`outputs/`と`data/`だけを使う。
6. 現在の3030番とは異なる予約済み一時portを使う。
7. テスト終了時は子プロセスを通常終了し、instance lockと一時ディレクトリを確実に片付ける。

テスト専用のために本番用`LOCAL_IMAGE_CHAT_ROOT_DIR`のような新しい環境変数を追加しないでください。サーバー全体をapp factoryへ大規模分解することも禁止します。

### 6.2 成功経路

小さい有効PNG fixtureと、それを参照する最小履歴を用意するか、mock ReForge経由で1枚だけ生成してください。以下をHTTPで確認します。

移行予約前:

- `GET /api/storage/settings`がHTTP 200。
- `currentOutputDir`が一時ワークスペースの既定outputs。
- `POST /api/storage/plan`が対象、一時ファイル数・容量、`restartRequired`を返す。
- `PATCH /api/storage/settings`で`confirmMigration: true`を伴う予約が成功する。
- 必要なら既存API形式に従い、キャンセル後に同じ対象を再予約できることも確認する。
- `/outputs/<filename>`が読める。
- `/favorites/<filename>`が読める。
- `/api/images/<id>/original`が読める。
- `/api/images/<id>/thumbnail`が有効なWebPを返す。

再起動:

- 1個目のテストサーバーを通常終了する。
- 同じ一時ワークスペース・同じdata・空いた一時portで再起動する。
- listen開始前に予約移行が完了する。
- `GET /api/storage/settings`が新保存先と`source: "stored"`を返す。
- 新保存先に専用markerがある。
- pendingが解除され、`lastMigration.status === "completed"`になる。

移行後:

- 移行前と同じ`/outputs/<filename>`で画像を読める。
- 移行前と同じ`/favorites/<filename>`でFavorite画像を読める。
- 同じ`/api/images/<id>/original`で原寸を読める。
- 同じ`/api/images/<id>/thumbnail`でサムネイルを読める。
- Content-Typeが正しい。
- 旧sourceの原寸、thumbnail、Favoriteが残っている。
- URLへローカル絶対パスが露出しない。

削除契約:

- 移行後にテスト画像の既存削除APIを呼ぶ。
- activeな新保存先の対象ファイルだけが削除される。
- 旧source側コピーはロールバック用として残る。
- 他のfixture、marker、保存先外ファイルを削除しない。

### 6.3 失敗フォールバック経路

別の隔離ケースで、予約後・再起動前に意図的な同名異内容競合など既存仕様で検出できるコピー失敗を作ってください。

再起動後:

- サーバー自体は旧保存先で起動する。
- `GET /api/storage/settings`は旧保存先を返す。
- `lastMigration.status === "failed"`または既存公開契約の失敗状態を返す。
- 旧`/outputs/<filename>`、原寸API、thumbnail、Favoriteが読める。
- 旧sourceを削除・上書きしていない。
- 部分コピーを完成済みactive保存先として採用しない。
- 実3030番や実outputsには影響しない。

## 7. API契約

既存API形式を変更しないでください。

```text
GET   /api/storage/settings
POST  /api/storage/plan
PATCH /api/storage/settings
```

既存の予約・キャンセルrequest body、status code、公開レスポンスをそのままテストしてください。テストを通すためだけの専用API、テスト用query、任意ローカルパス配信APIを追加しないでください。

## 8. 禁止事項

- UI変更
- 保存形式変更
- DB導入
- 新規依存
- package更新
- Task 10変更
- IP-Adapterモデル再配置・再ダウンロード
- ReForge API変更
- 実outputsをテストfixtureにする
- 実history/storage-settingsを書き換える
- stored path不正時に自動marker付与
- stored path不在時の自動再作成
- markerなし任意フォルダの静的公開
- 旧sourceの自動削除
- copy失敗時のactive切替
- 全面リファクタリング
- 現在の3030/7860再起動

## 9. 完了条件

1. 正規marker付きstored pathだけを起動時に採用する。
2. markerなし・不正marker・不存在・ファイル・link・禁止パスを拒否する。
3. 不正stored pathで既定outputsへ安全にフォールバックする。
4. 不存在stored pathを再作成しない。
5. 任意フォルダを`/outputs`として公開しない。
6. 環境変数優先仕様を維持する。
7. 予約・キャンセル・listen前移行を維持する。
8. 成功時だけactiveを新保存先へ切り替える。
9. 失敗時は旧保存先で起動し、画像URL契約を維持する。
10. 移行後も原寸、thumbnail、Favoriteを同じURLで読める。
11. 削除APIはactive側だけを削除し、旧sourceを残す。
12. 実サーバー統合テストが一時ワークスペース・一時portで成功する。
13. 実3030、実7860、実outputs、実履歴を変更しない。
14. Task 10と既存生成・ギャラリー・Favoriteを壊さない。
15. check、関連テスト、全テスト、diff checkが成功する。

## 10. 検証コマンド

```powershell
npm run check
node --test test/storage-settings.test.js
node --test test/storage-settings.test.js test/server-integration.test.js test/server-workspace.test.js test/ui-shell.test.js
npm test
git diff --check
```

統合テストを追加しなかった既存テストファイルは、関連テストコマンドから省略して構いません。ただし`npm test`は必須です。

テスト前後に次を読み取り比較してください。

```text
3030/7860のPID
active job件数
実outputsのファイル数・合計bytes
実history.jsonのsize・SHA-256
実data/storage-settings.jsonの有無・size・SHA-256（存在する場合）
```

## 11. Lunaの報告項目

- 変更ファイル一覧
- `resolveStoredOutputDir()`の修正内容
- stored pathのmarker検証方法
- 不存在・不正・link時のフォールバック
- 環境変数優先仕様を維持した根拠
- 追加した単体テスト一覧
- 実サーバー統合テストの隔離方法
- 成功移行前後のHTTP URL確認結果
- 失敗フォールバックの確認結果
- 削除時に旧sourceを残した確認結果
- テスト前後の実データfingerprint
- 3030/7860 PIDを変更していないこと
- 実行した検証コマンドと件数
- 残っている制約

---

# コードレビュー合格：Luna Hotfix「ReForge optionsの未対応キー送信を止める」

更新日: 2026-08-07
状態: 実装・自動テスト・コードレビュー完了（実ReForge確認のみ未実施）
担当: Luna
変更種別: 生成前API互換性の最小修正

## 1. このHotfixの扱い

このHotfixは実装済みで、追加コード修正はありません。下にある「Luna Task 10：IP-Adapter（SDXL）至急導入」を現在の実装対象とします。Hotfix差分を削除・再実装せず、`src/reforge.js`で変更箇所が近接する場合も挙動を維持してください。

現在のdirty worktreeにはTask 08A / 08B / 09などの未コミット差分があります。

- reset、restore、checkout、stash、既存差分の削除は禁止。
- 今回の対象外ファイルを整形・整理・リファクタリングしない。
- ReForge本体、設定ファイル、実outputs、履歴、3030/7860のプロセスを変更しない。
- package.json / package-lock.jsonを変更せず、依存を追加・更新しない。

## 2. 症状と確定した原因

画像生成のたびにReForgeで次のエラーが発生します。

```text
POST /sdapi/v1/options
KeyError: 'sd_noise_schedule_sampling'
```

送信元は`src/reforge.js`です。

- `generateImages()`が画像生成開始時、候補画像ループと`txt2img` / `img2img` POSTより前に、毎回`applyNoiseSchedule(config, request.noiseSchedule)`をawaitしています。
- `applyNoiseSchedule()`は既定キーを`sd_noise_schedule_sampling`とし、`POST /sdapi/v1/options`へ`{ [key]: value }`を無条件に送っています。
- `config.json`の`defaults.noiseSchedule`は`Automatic`です。`src/server.js`の`validateSettings()`が生成要求ごとに空でない値へ正規化し、`performGeneration()`が`...settings`として`generateImages()`へ渡すため、ユーザーが明示操作しなくても毎回呼ばれます。
- 現在稼働中の`GET http://127.0.0.1:7860/sdapi/v1/options`はHTTP応答し、537キーを返しましたが、`sd_noise_schedule_sampling`は存在しませんでした。
- 同レスポンスには`sd_noise_schedule`があります。ただし今回の調査だけでは両キーの意味・値仕様が完全に同一とは確定できないため、自動的な別名置換は今回の範囲外です。
- 現コードはoptions POSTの失敗を警告して生成を続けますが、ReForgeはPOSTを受け取った時点でKeyErrorを記録します。したがってcatchや警告抑制では解決せず、未対応キーを含むPOST自体を止める必要があります。

導入経緯はcommit `042b787`（`Add Noise schedule for sampling setting (v2.8.0) (#7)`）です。

## 3. 確定要求

- `POST /sdapi/v1/options`の前に`GET /sdapi/v1/options`を行う。
- GETレスポンス自身のプロパティとして、送信予定のoptionキーが存在するときだけ、その1キーをPOSTする。
- キーが存在しなければ、options POSTを一切行わず、従来どおり画像生成を続ける。
- `config.reforge.noiseScheduleOptionKey`相当の既存上書き仕様を維持する。上書きキーもGETレスポンスに存在するときだけ送る。
- GET失敗、非2xx、JSON不正、object以外のレスポンスの場合も、存在確認ができないためoptions POSTを行わない。画像生成は従来どおり続け、原因が分かる簡潔なwarningだけを残す。
- 対応キーが存在するA1111系・旧ReForge等では、従来どおりNoise schedule値をPOSTする。
- `txt2img` / `img2img`の生成payload、候補画像ループ、進捗監視、保存、履歴、状態管理は変更しない。

## 4. 実装方針

変更の中心は`src/reforge.js`の`applyNoiseSchedule()`だけに限定します。

1. 現在と同じ方法で`value`と送信予定`key`を決定する。
2. `GET ${config.url}/sdapi/v1/options`をタイムアウト付きで実行する。
3. GETが非2xxなら、POSTせず、既存の「optional設定失敗でも生成継続」という境界内でwarningを出してreturnする。
4. JSONを読み、null、配列、primitiveを除くobjectであることを確認する。
5. `Object.prototype.hasOwnProperty.call(options, key)`など、prototypeの影響を受けないown-property判定を使う。
6. own propertyがなければ、未対応であることが分かるwarningを出し、POSTせずreturnする。
7. own propertyがある場合に限り、現在と同じ`POST /sdapi/v1/options`、body `{ [key]: value }`を行う。
8. POST自体の非2xx・例外時に生成を継続する既存仕様は維持する。

GET結果をグローバル状態やサーバーstateへ保存する必要はありません。生成1回ごとの能力確認に留め、API層や状態管理を作り替えないでください。

## 5. 変更対象

必須:

- `src/reforge.js`
- `test/server-integration.test.js`

必要性を実証できる場合だけ追加可:

- ReForge呼び出しだけを分離検証する既存テストファイル（既存がなければ、新規テストファイルを増やすより統合テストへの最小追加を優先）

変更禁止:

- `src/server.js`
- `public/app.js`
- `public/index.html`
- `config.json`
- `package.json`
- `package-lock.json`
- ReForge側のコード・設定

## 6. テスト要件

`test/server-integration.test.js`のmock ReForgeを、options GETの対応キー有無を表現できるよう最小限拡張してください。

最低限、次を自動テストで証明します。

1. GETレスポンスに`sd_noise_schedule_sampling`が存在するバックエンドでは、GETの後に従来どおりそのキーと値をPOSTし、その後に生成endpointを呼ぶ。
2. GETレスポンスに同キーが存在しないバックエンドでは、`sd_noise_schedule_sampling`を含むoptions POSTが0回である。
3. 未対応時も`txt2img`または`img2img`の生成endpointは呼ばれ、生成ジョブは成功する。
4. options GETより前にoptions POSTされていないことを、mockの記録順または未対応キー拒否で証明する。
5. checkpoint切替の`{ sd_model_checkpoint: ... }` POSTは今回の対象ではなく、壊さない。

可能なら同じ統合テスト内で、最初の対応ケース後にmockの対応キーを無効化し、その後の既存生成ケースを未対応ケースとして利用してください。大規模なfixture再編は不要です。

## 7. 禁止事項と互換性条件

- catch追加だけ、HTTPエラー無視だけ、ログ非表示だけで済ませない。
- GETに存在しないキーを試しにPOSTしない。
- `sd_noise_schedule_sampling`を無条件に`sd_noise_schedule`へ置換しない。
- GETで見つけた名前の似たキーへ推測で値を送らない。
- options全体をPOSTし返さない。
- Noise schedule UI、recipe、checkpoint profile、既定値を削除・変更しない。
- 生成API payloadへNoise scheduleを移動しない。
- options能力のための新しい永続state、キャッシュ、endpointを作らない。
- 無関係なリファクタリング、依存更新、新機能追加を行わない。

## 8. 完了条件

1. 現在のReForgeのようにGET optionsへキーがない場合、`sd_noise_schedule_sampling`を含むPOSTが送られない。
2. 対応バックエンドでは従来のoptions POSTが維持される。
3. options能力確認に失敗しても、生成処理本体の挙動を変えず生成を続ける。
4. 対応・未対応の両ケースが自動テストで通る。
5. 既存のcheckpoint options POSTが通る。
6. 関連テスト、`npm run check`、全テスト、`git diff --check`が成功する。
7. 差分が`src/reforge.js`と必要最小限のテスト変更に限定される。
8. 実ReForge確認では、生成1回の前後ログに`KeyError: 'sd_noise_schedule_sampling'`が新規発生しない。

## 9. 検証手順

まずmockだけで確認してください。

```powershell
npm run check
node --test test/server-integration.test.js
npm test
git diff --check
```

実機確認は自動テスト成功後に1回だけ行います。3030/7860を勝手に停止・再起動せず、生成中ジョブがないことを確認してください。現在動作中の3030が修正前コードのままなら、勝手に再起動せず「実機未確認」と報告し、レビュー担当の指示を待ってください。

実機確認を実施できる場合:

- 修正後コードを読み込んだLocal Image Chatから通常生成を1回だけ行う。
- ReForge側で生成直前から完了後までのログを確認する。
- `POST /sdapi/v1/options`に`sd_noise_schedule_sampling`が送られていないことを確認する。
- `KeyError: 'sd_noise_schedule_sampling'`が新規発生しないことを確認する。
- 通常の生成endpointが成功し、画像が返ることを確認する。

## 10. Lunaの報告項目

- 変更ファイルと各変更内容
- GETレスポンスのキー判定方法
- 対応キーあり・なし・GET失敗時の挙動
- options GET / POST / 生成endpointの呼び出し順
- 実行したコマンドと結果
- mockで未対応キーPOSTが0回だった証拠
- 実機確認の実施有無
- 実施した場合、KeyErrorが消えた証拠と生成成功結果
- 未実施の場合、その理由
- `git diff --stat`

## 11. 監督レビュー結果（2026-08-07）

判定: **コードレビュー合格。実機確認のみ保留。**

- `src/reforge.js`: GET成功・object・own property確認後だけ既存POSTへ進む。キーなし、通信失敗、非2xx、JSON不正、object以外ではPOSTせず生成を継続する。
- `test/server-integration.test.js`: 対応時は`GET options → POST options → POST txt2img`、未対応時は`GET options → POST txt2img`を検証。未対応キーを含むoptions POST 0回と生成成功を確認した。
- `npm run check`: 成功。
- `node --test test/server-integration.test.js`: 1件成功、失敗0。
- `npm test`: 376件成功、失敗0。
- `git diff --check`: 成功（改行コード警告のみ）。
- 3030番のNodeプロセス開始は2026-08-07 02:24:59、`src/reforge.js`更新は03:57:15であり、稼働中3030は修正前コード。指示に従って停止・再起動・実生成は行っていない。
- したがって、mockではKeyError原因となるPOST停止を実証済みだが、実ReForgeログで`KeyError: 'sd_noise_schedule_sampling'`が消えたことは未確認。次回、修正後コードを読み込む通常再起動後の生成1回で確認する。
- 追加修正指示はないため、`docs/REVIEW_FIXES.md`への追記なし。

---

# 現在の実装対象：Luna Task 10「IP-Adapter（SDXL）至急導入」

更新日: 2026-08-07
状態: **実装・レビュー・実機smoke test完了**
担当: Luna
優先度: 最優先

## 1. 優先順位と既存差分

他の未着手タスクは保留し、本タスクだけを進めてください。Task 09はレビューで要修正ですが、今回は修正しません。指摘は`docs/REVIEW_FIXES.md`冒頭にあります。

現在のdirty worktreeにはTask 08A / 08B / 09の未コミット差分があります。

- reset、restore、checkout、stash、既存差分の削除は禁止。
- Task 09の保存先処理・API・UIを便乗修正しない。
- `data/`、実`outputs/`、履歴JSON、LoRA registryを直接変更しない。
- 実装・自動テスト中に3030番と7860番を停止・再起動しない。
- レビュー前に3030番を勝手に再起動しない。

## 2. 目的と範囲

生成画面から1枚の参照画像をIP-Adapterへ渡せるようにします。今回は現在のIllustrious系Checkpointと互換性がある**SDXL IP-Adapter Plus（ViT-H）1ユニット**に限定します。

対応:

- txt2img / img2img / inpaint
- 参照画像の選択・解除・preview
- 中央の選択画像をワンクリックでIP-Adapter参照に設定
- Weight、適用開始、適用終了
- 履歴保存・復元・再生成・Hires.fix

対象外:

- FaceID / InstantID
- SD1.5
- 複数参照画像、複数ControlNet unit
- 領域mask、advanced block weighting
- ControlNet全般を扱う汎用UI

## 3. 作業前に読むもの

- `DESIGN.md`
- `docs/REVIEW_FIXES.md`冒頭
- `src/reforge.js`
- `src/server.js`の`performGeneration()`、`validateSettings()`、`resolveSourceImage()`、`saveContentAddressedImage()`
- `public/index.html`の生成設定・img2img参照UI
- `public/app.js`の生成payload、履歴復元、自動保存、busy制御、drop処理
- `public/style.css`
- `test/server-integration.test.js`
- `test/ui-shell.test.js`

ReForge側は読むだけで編集しません。

- `C:\AI\StabilityMatrix-win-x64\Data\Packages\reforge\extensions-builtin\sd_forge_controlnet\tests\web_api\template.py`
- `...\tests\web_api\ipadapter_advanced_weighting.py`
- `C:\AI\StabilityMatrix-win-x64\Data\Packages\reforge\extensions-builtin\sd_forge_ipadapter\scripts\forge_ipadapter.py`

## 4. 実機で確認済みの前提

```text
Local Image Chat: 127.0.0.1:3030 / PID 6732
ReForge:          127.0.0.1:7860 / PID 5696 / --api
Checkpoint:       sd\obsessionIllustrious_vPredV20.safetensors

/sdapi/v1/scripts:
  txt2img / img2img ともに controlnet あり

/controlnet/module_list:
  CLIP-ViT-H (IPAdapter) あり

/controlnet/model_list:
  Noneのみ（IP-Adapter本体は未配置）
```

今回の正しい組合せ:

```text
model:  ip-adapter-plus_sdxl_vit-h.safetensors
module: CLIP-ViT-H (IPAdapter)
```

`CLIP-ViT-bigG (IPAdapter)`へ置換しないでください。Forge公式の対応表でもPlus SDXL ViT-HモデルはViT-H encoderを使います。

## 5. 公式モデルの安全な配置

新しいnpm/Python依存は追加せず、ReForge本体・builtin extensionのコードも変更しません。

### IP-Adapter本体

```text
URL:
https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors

配置先:
C:\AI\StabilityMatrix-win-x64\Data\Packages\reforge\models\ControlNet\ip-adapter-plus_sdxl_vit-h.safetensors

bytes:   847,517,512
SHA-256: 3f5062b8400c94b7159665b21ba5c62acdcd7682262743d7f2aefedef00e6581
```

### CLIP ViT-H画像エンコーダ

初回生成時の自動download待ちを避けるため、こちらも事前配置します。

```text
URL:
https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors

配置先:
C:\AI\StabilityMatrix-win-x64\Data\Packages\reforge\models\ControlNetPreprocessor\CLIP-ViT-H-14.safetensors

bytes:   2,528,373,448
SHA-256: 6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030
```

### 配置規則

- 同名ファイルがあればsizeとSHA-256を先に確認し、一致なら再取得しない。
- 不一致の既存ファイルは上書き・削除せず、停止して報告する。
- 同一ディレクトリの`.part`へdownloadし、sizeとhash一致後だけ最終名へrenameする。
- 0バイトまたは未検証の最終ファイルを残さない。Gitへ追加しない。
- PID 5696を停止しない。
- 配置後は`GET /controlnet/model_list?update=true`で再走査する。
- 再走査しても認識しない場合、勝手にReForgeを再起動せず報告する。

## 6. 変更対象（最大8ファイル）

1. `src/ip-adapter.js`（新規。検証・能力判定・unit構築）
2. `src/reforge.js`
3. `src/server.js`
4. `src/history.js`（optionalな`generation.ipAdapter`の安全な正規化・永続化）
5. `public/index.html`
6. `public/app.js`
7. `public/style.css`
8. `test/server-integration.test.js`（純粋関数・UI契約・mock統合をこの1ファイルへ集約）

`test/ip-adapter.test.js`は新規作成しません。これにより`src/history.js`を加えても8ファイル以内です。8ファイルを超える場合は実装を止めて理由を報告してください。`package.json`、lockfile、Task 09実装ファイルは変更禁止です。

## 7. バックエンド

### 7.1 能力取得API

```text
GET /api/reforge/ip-adapter/options
```

短いtimeoutで次を照会します。

```text
GET {reforgeUrl}/controlnet/module_list?alias_names=true
GET {reforgeUrl}/controlnet/model_list?update=false
```

返却例:

```json
{
  "available": true,
  "family": "sdxl",
  "module": "CLIP-ViT-H (IPAdapter)",
  "model": "ip-adapter-plus_sdxl_vit-h [hash]",
  "message": "利用できます"
}
```

要件:

- moduleは完全一致。
- modelはReForgeの実際の表示名からbasenameが`ip-adapter-plus_sdxl_vit-h`のものを選ぶ。hashを固定・推測しない。
- `None`のみ、module不足、ReForge切断、timeout、JSON不正は`available:false`。
- 能力取得失敗でアプリ起動やIP-Adapter無効の通常生成を止めない。
- ローカル絶対パス、stack、巨大な全一覧をブラウザーへ返さない。
- Checkpoint変更後は能力を再取得する。SD1.5時は利用不可にする。

### 7.2 入力と検証

概念形:

```js
ipAdapter: {
  enabled: true,
  weight: 0.65,
  guidanceStart: 0,
  guidanceEnd: 1,
  referenceImageId: "履歴画像ID" // または
  referenceImage: "data:image/...;base64,..." // または
  referenceImageUrl: "/outputs/ip-adapter-reference_<hash>.png"
}
```

- 参照指定は有効時に正確に1つ。0件・2件以上は入力エラー。
- `enabled`はboolean。
- weightは0〜2、既定0.65。
- start/endは0〜1かつ`start < end`。
- 画像は既存PNG/JPEG/WebP判定と20MB上限を再利用。
- IDは既存`requireId()`と履歴解決を再利用。
- URLは同一originの`/outputs/ip-adapter-reference_...`だけ。basename、拡張子、outputDir境界を検証する。
- 任意URL、`file://`、絶対パス、`../`、別prefixのoutputs URLは禁止。
- 有効なのに画像・module・modelが無い場合、ReForge生成前に日本語エラー。黙ってIP-Adapterなしで生成しない。
- 無効時は参照画像とIP-AdapterパラメータをReForgeへ送らない。

### 7.3 ReForge payload

有効時だけ既存payloadへmergeします。

```js
payload.alwayson_scripts = {
  ...(payload.alwayson_scripts ?? {}),
  ControlNet: {
    args: [{
      enabled: true,
      image: referenceBase64,
      module: resolvedModule,
      model: resolvedModel,
      weight,
      resize_mode: "Crop and Resize",
      guidance_start: guidanceStart,
      guidance_end: guidanceEnd,
      pixel_perfect: false,
      processor_res: -1,
      threshold_a: -1,
      threshold_b: -1,
      control_mode: "Balanced",
      save_detected_map: false
    }]
  }
};
```

- script名はReForge公式テストと同じ`ControlNet`。
- ReForgeへはdata URL prefixなしのbase64本体を渡す。
- txt2imgに`init_images`を追加しない。
- img2img/inpaintのinit image・maskとIP-Adapter imageを混同しない。
- HiresはReForge既定の両pass適用。未検証の`hr_option`を追加しない。
- 既存/将来の`alwayson_scripts`を丸ごと上書きしない。
- 無効時のpayloadは変更前と同一。

### 7.4 保存・履歴

- upload画像は生成成功後だけ既存content-addressed保存を再利用し、`ip-adapter-reference_<hash>.<ext>`とする。
- 同内容は再利用。失敗生成では保存しない。
- 履歴JSONへbase64やローカル絶対パスを保存しない。
- optionalな`generation.ipAdapter`へ、enabled、family、実module、実model、weight、start、end、referenceImageId/Urlを保存する。
- API response、recipe、履歴復元、再生成、Hires.fixへ同じoptional構造を通す。
- 古い履歴はIP-Adapter無効として正常に扱う。

`src/history.js`の`normalizeGeneration()`へ、次のように専用normalizerを通したoptionalフィールドを追加してください。

```js
ipAdapter: normalizeIpAdapter(input.ipAdapter),
```

`normalizeIpAdapter()`の要件:

- `null`、非object、`enabled !== true`は`null`。
- 許可するのは、`enabled`、`family`、`module`、`model`、`weight`、`guidanceStart`、`guidanceEnd`、`referenceImageId`、`referenceImageUrl`だけ。
- input全体を`structuredClone()`して保存しない。
- `referenceImage`、`base64`、`buffer`、ローカル絶対パス、任意追加キーを保存しない。
- 文字列長と数値範囲は`src/ip-adapter.js`の共通境界と一致させる。
- `referenceImageId`と`referenceImageUrl`は生成時にサーバーが確定した安全な値だけを受け取り、両方同時に残す必要がなければ実際の由来に応じて片方を`null`にする。
- 古い履歴にフィールドがなければ`null`。
- 読み込み時にも同じnormalizerを通る現在の履歴構造を利用し、壊れた保存値でUIを落とさない。

## 8. フロントエンド

左カラムの「生成設定」アコーディオン内、「詳細設定」付近へコンパクトなIP-Adapterサブセクションを追加します。新画面・新カラムは作りません。

表示:

- 有効toggle、利用可否の補助テキスト
- drop zone / file input / preview / 解除
- Weight（range + 値、既定0.65）
- Start（0.0）、End（1.0）
- model名の読み取り専用表示（ellipsis + title）

操作:

- file input、click、drag & drop。acceptはPNG/JPEG/WebP。
- ブラウザーでも20MB超を早期拒否するが、サーバー検証を残す。
- previewは`object-fit:contain`。
- Object URLを使う場合、差替え・解除・unload時にrevokeする。
- base64画像をlocalStorageへ保存しない。
- enabled/weight/start/endだけ既存自動保存方式またはlocalStorageへ保存可。
- 再読込で画像がない場合、enabledだけを有効復元しない。
- busy中は操作をdisabledにし、完了・失敗・中止後に戻す。
- IP-Adapter参照とimg2img参照は必ず別state。片方の選択・解除で他方を変更しない。
- 履歴復元時は設定と同一origin参照URLのpreviewを復元する。
- 再生成・Hires.fixは元のIP-Adapter設定と参照画像を維持する。
- 明示解除後の次回生成へ混入させない。

### 中央の選択画像を参照に使用

中央メインプレビューの既存画像操作領域へ、コンパクトな`IP参照`操作を追加してください。対象は現在中央に表示されている選択画像です。バリエーションサムネイル自体へボタンを増やしません。

表示・アクセシビリティ:

- ラベルは短く`IP参照`とする。
- `title="この画像をIP-Adapter参照に使用"`。
- `aria-label="この画像をIP-Adapter参照に使用"`。
- 既存ツールバーが窮屈になる場合は、既存overflowメニューがあればそこへ入れる。新しい大きな行は作らない。
- 選択画像がない場合は非表示またはdisabled。
- 生成中はdisabled。
- ライム背景の主要ボタンにはせず、既存の補助画像操作と同じ見た目にする。

クリック時の処理:

```text
中央の選択画像
→ 既存のimage IDをIP-Adapter参照stateへ設定
→ IP-AdapterをON
→ 生成設定とIP-Adapterサブセクションを開く
→ 左カラム内でIP-Adapter設定が確認できる位置へ移動
→ previewを表示
```

重要:

- ブラウザーで原寸画像をfetchしてbase64へ変換し直さない。
- 既存の`image.id`を`referenceImageId`として使う。
- previewは既存の`thumbnailUrl`を優先し、なければ既存の安全な画像URL helperを使う。previewのためだけに原寸を再取得しない。
- 生成直後の候補、バリエーション選択、右履歴から選択した画像のすべてで、現在中央に表示される画像IDを正しく取得する。
- image IDが得られない古い項目では勝手にURL/base64方式へ落とさず、短いエラーを表示する。
- IP-Adapter能力が利用不可の場合はONにせず、参照だけを黙って設定したように見せない。利用不可理由を表示する。
- `event.stopPropagation()`を使い、IP参照クリックでメイン画像の拡大、画像選択、履歴選択を発火させない。
- 生成モードをTXTからIMGへ切り替えない。
- `initImageReference`、inpaint mask、img2img previewを変更しない。
- 既に同じ画像が参照中なら重複stateを作らず、「この画像を参照中」と分かる状態にする。
- 別画像を選ぶとIP-Adapter参照だけを置き換え、Weight / Start / Endは維持する。
- ファイルuploadと中央画像指定の処理を個別実装せず、共通`setIpAdapterReference(...)`相当へ集約する。

見た目は既存の黒白＋落ち着いたライム。ライムは有効/成功だけ。大カード、発光、独自modalは作りません。本文は13px未満にしません。

## 9. テスト

### 純粋関数・履歴・UI契約テスト

新規テストファイルは作らず、以下を`test/server-integration.test.js`内の独立したtestとして追加します。巨大な1ケースへ詰め込まず、失敗理由が分かる単位へ分けてください。

- hash付きSDXL Plus表示名の選択。
- `None`のみ、module不足、切断はunavailable。
- weight/start/end境界と`start < end`。
- 参照0件・2件を拒否。
- PNG/JPEG/WebP、破損、20MB超。
- 任意URL、絶対パス、`../`、許可prefix外を拒否。
- ControlNet unitの公式キー。
- 無効時はalwaysonなし、既存alwaysonはmergeで維持。
- HTMLにlabel、accept、利用可否live regionがある。
- app.jsがimg2imgとは別stateを使い、Object URLの解放経路を持つ。
- 中央`IP参照`操作が現在画像のIDを共通setterへ渡す。
- `IP参照`クリックで拡大・画像選択のhandlerへ伝播しない。
- 中央画像指定では原寸fetch、FileReader、base64変換を行わない。
- 同一画像の再指定は重複せず、別画像への変更でもWeight / Start / Endを維持する。
- 利用不可時はONにならず、img2img mode/stateも変化しない。
- `normalizeGeneration()`が安全な`ipAdapter`だけを永続化し、base64・buffer・任意キーを捨てる。
- `ipAdapter`なしの旧履歴、不正object、範囲外値を安全に扱う。

### mock ReForge統合

`test/server-integration.test.js`のmockを拡張します。

- 能力APIのmodule/model正規化。
- txt2img + IP-Adapterの`alwayson_scripts.ControlNet.args[0]`。
- txt2imgに`init_images`がない。
- img2img/inpaintのinit/mask/IP imageが別。
- 無効時の従来payload維持。
- uploadは成功後URL化され、履歴にbase64がない。
- recipe、再生成、古い履歴の互換。
- 中央画像IDを参照指定した生成では、サーバーが履歴画像を安全に解決しControlNet imageへ渡す。
- module/model不足時は生成endpointを呼ばない。
- 既存通常生成、img2img、inpaint、Hires、cancelが通る。

テストは一時workspaceとmockのみ。実3030/7860/outputsを変更しません。

## 10. 実機smoke test

コードテスト後、2ファイルのhashと`model_list?update=true`の認識を確認します。認識された場合のみ、Local Image Chatを再起動せずReForge APIへ直接1回だけ実施可能です。

- ReForge付属の安全な小fixture。
- txt2img、512×512、4 steps、batch 1、固定Seed。
- `save_images:false`、`do_not_save_samples:true`、`do_not_save_grid:true`。
- 実際に返ったmodule/model名を使用。
- HTTP 200、画像1枚、ReForgeログのIPAdapter適用を確認。
- Local Image Chatの実履歴・実outputsへ保存しない。
- OOM、不整合、timeout時は別モデルや設定を推測して自動再試行しない。

## 11. 禁止事項

- ReForge本体/builtin extension変更
- npm/Python依存追加
- FaceID、InstantID、SD1.5、複数unitのついで実装
- base64の履歴/localStorage保存
- 任意パス・任意URL受付
- モデル不足時の通常生成fallback
- img2img参照stateとの共有
- Task 09便乗修正
- 3030/7860の無断停止・再起動
- 実outputs/履歴を使う自動テスト
- 無関係な整形・全面リファクタリング・依存更新

## 12. 完了条件

1. 公式model/encoderがbytes・SHA-256一致で配置済み。
2. ReForge再走査でmodelを認識。
3. UIで有効化、画像選択、preview、解除、weight/start/end操作が可能。
4. 中央の現在画像を`IP参照`で設定でき、拡大・選択・img2img modeを誤発火しない。
5. 中央画像指定はIDを使い、原寸fetchやbase64再変換をしない。
6. txt2imgで適用される。
7. img2img/inpaintと混同せず併用できる。
8. 無効時の既存生成が不変。
9. 未準備・不整合時は生成前に明示エラー。
10. upload参照は成功後URL化され、履歴にbase64なし。
11. 履歴・recipe・再生成・Hiresで実設定を維持。
12. 古い履歴が正常。
13. 任意パス、破損、巨大画像を拒否。
14. Object URLを解放。
15. mock統合でControlNet payloadを実証。
16. 条件を満たす場合、実ReForge smoke test成功。
17. Task 09差分、実outputs、3030/7860 PIDを変更しない。
18. check、関連テスト、全テスト、diff checkが成功。

## 13. 検証

```powershell
npm run check
node --test test/server-integration.test.js test/ui-shell.test.js
npm test
git diff --check

Get-NetTCPConnection -LocalPort 3030,7860 -State Listen |
  Select-Object LocalPort,OwningProcess

Invoke-RestMethod "http://127.0.0.1:7860/controlnet/module_list?alias_names=true"
Invoke-RestMethod "http://127.0.0.1:7860/controlnet/model_list?update=true"
```

2モデルファイルは`Get-FileHash -Algorithm SHA256`とLengthを報告してください。

## 14. 作業後の報告

- 変更ファイルと内容
- model/encoderの配置先、bytes、SHA-256
- ReForgeが返したmodule/model名
- 能力API仕様
- UI配置、state分離、保存
- ControlNet unit（base64は伏せる）
- 参照画像のURL化、履歴、復元
- 未準備・不整合時の挙動
- テストとsmoke test結果
- 3030/7860 PIDが前後不変
- 実outputs/履歴を変更していないこと
- FaceID、複数unit、SD1.5が未対応であること
