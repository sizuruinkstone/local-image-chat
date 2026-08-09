# Task 11 API基盤 レビュー追加修正

更新日: 2026-08-09
状態: **最終承認（指摘2点の修正・回帰テスト完了）**

## 再レビュー結果

前回指摘した2点は解消されました。Task 11の追加修正はありません。

- 生成Runtimeは`validateLoras(body.loras, config)`を呼び、既存の`config.lora.maxSelected`と`config.lora.defaultWeight`を維持する。
- 非標準設定`maxSelected: 2`、`defaultWeight: 0.85`を使用した旧Job経路のテストで、3件目が除外され、Weight未指定の2件が0.85になることを確認した。
- 非アクティブCheckpointを指定したJob Bは、先行Job Aの実行中は`queued`のままで、Checkpoint切替呼び出しは0回だった。
- Job A完了後、Job Bの実行開始時にだけ`checkpoint-y`へ1回切り替わり、ReForge生成payloadと履歴settingsへ同じ公開identifierが保存された。
- v1 API契約、旧API、UI、Job status、progress、History DTO、txt2img限定方針は変更されていない。

監督再検証:

```text
npm run check
  成功

node --test test/api-v1.test.js test/server-integration.test.js
  13 passed / 0 failed

npm test
  393 passed / 0 failed

git diff --check
  成功（CRLF warningのみ、whitespace errorなし）
```

## 最終判定

Task 11「Local Image Chat API基盤」を承認します。以下は解消済みのレビュー履歴として残し、Lunaが再実装する必要はありません。

## 総合判定

API基盤の主要構造は `docs/CURRENT_TASK.md` に沿っています。

- `POST /api/jobs`、`POST /api/generate`、`POST /api/v1/generations` は、`createGenerationRuntime()` の同じ生成実装へ合流している。
- 新しいqueue、ReForge通信、画像保存、History保存を別系統で作っていない。
- v1の5 endpoint、Prompt Service、allowlist DTO、統一エラー、txt2img限定、旧API互換が実装されている。
- v1 responseへ絶対パス、画像base64、stack traceを返していない。
- Checkpointの公開identifierはCapabilitiesの`id`とGeneration requestで共通の`title`を使用している。
- 実3030／7860、実outputs、実historyを使わず、隔離mockテストで検証している。
- `npm run check`、関連テスト、全391テスト、`git diff --check`は成功した。

ただし、Runtime抽出による旧APIの設定回帰が1件あります。また、Checkpoint切替タイミングはコード上正しいものの、この設計上重要な条件を固定する回帰テストがありません。以下の2点だけを修正してください。API契約やファイル構成の再設計は不要です。

## [P1] 旧生成RuntimeのLoRA検証へ既存configを渡す

対象:

- `src/services/generation-service.js`
- `test/api-v1.test.js`、または既存の生成Runtime単体テスト

現状:

```js
const loras = validateLoras(body.loras);
```

抽出後の関数は次のように`config`を受け取れる形へ変更されています。

```js
function validateLoras(input, config = null) {
  const maximum = boundedInt(config?.lora?.maxSelected, 4, 1, 8);
  const fallbackWeight = boundedNumber(config?.lora?.defaultWeight, 0.7, 0.05, 2);
}
```

しかし呼び出し側が`config`を渡していないため、`config.local.json`等で設定した次の値が旧API・新v1とも生成実行時に無視されます。

- `config.lora.maxSelected`
- `config.lora.defaultWeight`

抽出前の`validateLoras()`は`src/server.js`のclosureから同じ`config`を参照していたため、これは既存挙動の回帰です。現在の標準値が4件・0.7なので既存テストでは偶然検出されません。

最小修正:

```js
const loras = validateLoras(body.loras, config);
```

必須テスト:

1. Runtimeへ標準値と異なる設定、例 `maxSelected: 2`、`defaultWeight: 0.85` を渡す。
2. Weight未指定のLoRAを3件以上含む既存形式payloadをRuntimeへ渡す。
3. ReForge mockへ渡るLoRAが2件までで、未指定Weightが0.85になることを確認する。
4. 同じ確認を少なくとも旧`/api/jobs`相当のRuntime経路で行い、v1 DTO正規化だけのテストで済ませない。
5. txt2img/img2img/inpaint、Hires、IP-Adapter、履歴形式、LoRA構文の既存処理は変更しない。

## [P2] Checkpoint切替がqueue実行時だけに行われることをテストで固定する

対象:

- `test/api-v1.test.js`
- プロダクションコードは、テストで実際の問題が判明した場合だけ修正

コード上は現在、受付時の`createV1Job()`ではCheckpoint一覧からidentifierを検証するだけで、実際の`switchCheckpointFn()`は`performGeneration()`内の`prepareApiCheckpoint()`で呼ばれています。この方針は正しいです。

しかし現テストは、受付時に非アクティブCheckpointを指定したケースでも、切替がqueue開始前に起きないことを検証していません。Task 11の競合防止条件を回帰テストとして固定してください。

必須テスト:

1. 先行Job Aを実行中のまま保持する。
2. 非アクティブCheckpoint Yを指定したv1 Job Bをqueueへ追加する。
3. Bが`queued`の間は`switchCheckpointFn()`が一度もYへ切り替えていないことを確認する。
4. Aを完了させ、Bが`running`へ進んだ後にだけYへ切り替えることを確認する。
5. BのReForge生成payloadと履歴settingsに、Capabilitiesで公開した同じCheckpoint identifierが残ることを確認する。
6. request受付時の一覧照会・identifier検証自体は許可する。禁止対象はqueue外での実Checkpoint切替である。

## 変更禁止

- `/api/v1`のrequest / response契約変更
- 既存status名やprogress仕様の変更
- `src/server.js`へ生成処理を戻すこと
- 新しいqueue、ReForge adapter、History形式の追加
- UI変更、依存追加、package-lock更新
- img2img/inpaintのv1対応追加
- 実3030／7860の停止・再起動
- 実outputs、実history、実configへの書き込み

## 再レビュー時の検証

```powershell
npm run check
node --test test/api-v1.test.js test/server-integration.test.js
npm test
git diff --check
```

報告すること:

- `validateLoras()`へconfigを渡した差分
- 非既定`maxSelected`・`defaultWeight`の回帰テスト結果
- Job Bがqueued中のCheckpoint switch呼び出し回数
- Job B実行開始後のCheckpoint switch対象
- 関連テスト件数、全テスト件数
- 変更ファイル一覧
- 実3030／7860、実outputs、実historyを変更していないこと

## 今回の監督検証結果

```text
npm run check
  成功

node --test test/api-v1.test.js test/server-integration.test.js
  11 passed / 0 failed

npm test
  391 passed / 0 failed

git diff --check
  成功（CRLF warningのみ、whitespace errorなし）
```

---

# Task 10 IP-Adapter レビュー追加修正

更新日: 2026-08-07
状態: **最終承認・実機smoke test完了**

## 最終実機確認（2026-08-07）

ReForgeおよびLocal Image Chatの通常再起動後、Task 10の実機smoke testが完了しました。報告値を実環境のAPI、プロセス、outputs、履歴ハッシュと再照合し、Task 10を最終承認します。

```text
ReForge listener: PID 52624 / 127.0.0.1:7860
ReForge wrapper: PID 79328
Local Image Chat: PID 58984 / 127.0.0.1:3030
Local Image Chat active jobs: 0

module: CLIP-ViT-H (IPAdapter)
model: ip-adapter-plus_sdxl_vit-h [bc449f62]
/api/reforge/ip-adapter/options: available=true / family=sdxl

IP-Adapterあり直接生成: HTTP 200 / 画像1枚 / ControlNet適用情報あり
IP-Adapterなし直接生成: HTTP 200 / 画像1枚 / ControlNet情報なし

outputs: 2665 files / 2,589,002,581 bytes
history.json: 5,174,602 bytes
history SHA-256: C8EAAA5EC0951D01706264D4AA801E56A9DEAE578411D0672CBE7C6FFA222EB6
```

直接ReForge smoke testは保存OFFで行われ、Local Image Chatのoutputs・履歴に新しい画像やbase64を残していません。Hires結果からの実クリックだけは、保存禁止条件と衝突するため新規生成せず、DOM属性、表示条件、共通setter、イベント伝播停止、既存自動テストで確認しました。これはTask 10の完了を妨げる未対応事項とは扱いません。

## 再レビュー結果（2026-08-07）

前回指摘した2件は、実際の差分とテストで修正を確認しました。Task 10のコード変更は承認します。

- `validateIpAdapter({ enabled: false })`は`null`へ正規化され、能力確認・参照画像解決・ControlNet unit追加を行わず通常生成へ進む。
- Hires完了表示の`finalResult`にも`IP参照`操作が追加され、通常候補と同じ`setCurrentImageAsIpAdapterReference(image)`を利用する。
- Hires完了画像は`finalImage.id`を参照IDにし、プレビューは`thumbnailUrl`、なければ既存の`originalImageUrl(image)`を使う。クリック処理内で原寸fetch、FileReader、base64再変換を行わない。
- 両ボタンは生成中・画像なし・IP-Adapter利用不可時の状態を既存`syncIpAdapterUi()`で同期する。
- 追加したOFF時の統合テストとUI契約テストを含め、関連39件・全379件が成功した。

検証結果:

```text
npm run check: 成功
node --test test/server-integration.test.js test/ui-shell.test.js: 39 passed / 0 failed
npm test: 379 passed / 0 failed
git diff --check: 成功（改行コード警告のみ）
3030: PID 6732のまま
7860: PID 5696のまま
/controlnet/model_list: Noneのみ（再起動前キャッシュ）
```

残作業は、ユーザーの明示許可後に行うReForge再起動、モデル認識確認、IP-Adapterあり／なしの実機smoke test、および必要なら3030番再起動後のUI経路確認です。コード追加修正は現時点で要求しません。

## 初回レビュー判定（解消済み・履歴）

初回レビューでは、モデル2ファイルの配置、SHA-256、8ファイルの実装範囲、mock統合、履歴のbase64排除を確認しましたが、無効設定のサーバー処理とHires完了表示の導線に2件の修正を要求しました。両方とも上記の再レビューで解消済みです。

ReForgeがモデルをまだ列挙しない理由は配置ミスではありません。インストール済みReForgeの`/controlnet/model_list`はquery parameterを参照せず、起動時に構築されたメモリ上の一覧を返します。そのため`?update=true`では再走査されません。コード修正後、ジョブ停止とユーザー許可を確認してReForgeを再起動し、実機smoke testを行う必要があります。

## [P1] `enabled:false`を完全な無効設定として終了する

対象:

- `src/ip-adapter.js`の`validateIpAdapter()`
- `src/server.js`の`resolveIpAdapter()`
- `test/server-integration.test.js`

現状:

```js
if (input.enabled !== true) return { enabled: false };
```

一方、サーバーは次の判定です。

```js
const normalized = validateIpAdapter(body.ipAdapter);
if (!normalized) return null;
```

`{ enabled: false }`はtruthyなので、能力確認へ進み、モデルがあれば参照画像解決、モデルがなければ利用不可エラーになります。無効設定なのに通常生成として扱われません。

修正:

- `validateIpAdapter({ enabled: false })`を`null`へ正規化するか、`resolveIpAdapter()`で`if (!normalized?.enabled) return null;`とする。
- 判定を2箇所で食い違わせず、無効時のcanonical表現を1つに決める。推奨は`null`。
- 無効時はmodule/model能力API、参照画像解決、ControlNet unit構築を行わない。
- 無効時のReForge生成payloadは従来どおりで、`alwayson_scripts.ControlNet`を新規追加しない。

必須テスト:

- `validateIpAdapter({ enabled: false })`の期待値。
- module/modelを利用不可にしたmockで、`ipAdapter: { enabled: false }`の通常生成が成功する。
- 無効時は参照画像がなくてもエラーにならない。
- 無効時はControlNet unitが増えない。
- 無効時にIP-Adapter能力確認を生成条件として要求しない。

## [P2] Hires完了画像にも中央`IP参照`操作を提供する

対象:

- `public/index.html`
- `public/app.js`
- 必要なら既存`public/style.css`の同じ補助操作スタイル
- `test/server-integration.test.js`

現状:

- `studioMainPreview`には`studioMainIpAdapterButton`がある。
- `presentHiresResult()`は`studioMainPreview`を隠し、別DOMの`finalResult`を表示する。
- `finalResult`の操作列にはFavorite、再生成、比較、メタデータ等はあるがIP参照がない。
- このため、現在中央に表示されている画像がHires完了画像の場合、その画像をIP-Adapter参照へ設定できない。

修正:

- `finalResult`の既存`resultActions`へ、同じ補助スタイル・title・aria-labelの`IP参照`操作を追加する。
- 候補用とHires結果用で参照設定処理を複製せず、`setCurrentImageAsIpAdapterReference(image)`相当へ共通化する。
- Hires完了画像では`finalImage.id`を`referenceImageId`として使い、thumbnail URLをpreviewへ使う。
- 原寸fetch、FileReader、base64再変換を行わない。
- クリックで拡大、再生成、比較、img2img mode切替を発火させない。
- 選択画像なし、生成中、能力利用不可ではdisabledまたは非表示にする。
- 既存の中央アクション列を新しい大きな行へ分離しない。

必須テスト:

- `finalResult`にもIP参照buttonが存在し、title / aria-labelがある。
- Hires完了後のbuttonが`finalImage.id`を共通setterへ渡す。
- 候補とHiresの両方が同じsetterを使う。
- Hires画像指定でも原寸fetch / FileReader / base64変換をしない。

## 実機モデル認識とsmoke test（修正後・再起動許可待ち）

確認済み:

```text
IP-Adapter model:
  847,517,512 bytes
  SHA-256 3f5062b8400c94b7159665b21ba5c62acdcd7682262743d7f2aefedef00e6581

CLIP ViT-H encoder:
  2,528,373,448 bytes
  SHA-256 6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030

配置先:
  ReForge models/ControlNet直下およびmodels/ControlNetPreprocessor直下
```

インストール済みReForgeの実装:

```text
/controlnet/model_list
→ get_all_controlnet_names()を返すだけ
→ query parameter `update`を受け取らない
→ update_controlnet_filenames()は起動時またはGradio UIのrefresh操作で呼ばれる
```

したがって、`model_list?update=true`が`None`のままなのは現在プロセスのcacheが理由です。モデルを別名・別場所へ推測移動しないでください。

コード修正後の手順:

1. 3030 / 7860の生成・比較ジョブが0件であることを確認する。
2. ユーザーまたは監督から明示許可を得る。
3. ReForgeを通常の管理手段で1回だけ再起動する。強制killを第一選択にしない。
4. PIDが新しくなり、`/sdapi/v1/options`が応答するまで待つ。
5. `/controlnet/model_list`で`ip-adapter-plus_sdxl_vit-h [hash]`を確認する。
6. `/controlnet/control_types`のIP-Adapter系でもmodule/modelの組合せを確認する。
7. 指示済みの512×512・4 steps・保存OFFの直接ReForge smoke testを1回だけ行う。
8. HTTP 200、画像1枚、IPAdapter適用ログ、エラーなしを報告する。
9. Local Image Chatの実outputs・履歴へsmoke画像を保存しない。

3030番は現在も修正前コードのPID 6732です。Task 10の実機UI確認には、Task 10がレビュー承認された後、別途3030番も通常再起動が必要です。今回のLuna修正作業では、まだ3030 / 7860を再起動しないでください。

## 再レビュー時の検証

```powershell
npm run check
node --test test/server-integration.test.js test/ui-shell.test.js
npm test
git diff --check
```

報告:

- 上記2件の修正差分
- `{ enabled:false }`のmock生成結果
- Hires完了画像から共通setterへ渡した画像ID
- Task 10の8ファイル上限を維持していること
- 3030 PID 6732 / 7860 PID 5696をまだ変更していないこと
- モデルファイルを再download・移動・改名していないこと

## 今回のレビュー検証結果

```text
npm run check: 成功
関連テスト: 39 passed / 0 failed
npm test: 379 passed / 0 failed
git diff --check: 成功
モデル2ファイル: bytes / SHA-256一致
3030: PID 6732
7860: PID 5696
```

レビュー中に実outputsの件数・容量が増加しましたが、3030番が継続稼働しており、テストは一時workspaceを使っています。ユーザー側の生成と並行した変化と判断し、Task 10テストによる実データ変更とは扱いません。

---

# Task 09 レビュー追加修正（優先度保留）

更新日: 2026-08-07
状態: **修正完了・最終承認**

## Task 09 再レビュー結果（2026-08-07）

前回指摘した2件は解消されました。新たな修正指示はありません。

- 非既定のstored active pathは、`requireManagedMarker`により実在・通常ディレクトリ・linkなし・正規markerを起動時に再検証する。
- markerなしの空／非空フォルダ、不正marker、不存在、通常ファイル、禁止パス、symlink/junctionは採用せず、既定outputsへフォールバックする。
- 不正stored pathを作成・変更せず、markerも自動付与しない。pending/lastMigrationと環境変数優先仕様を維持する。
- 隔離した一時workspace・一時port・mock Ollama/ReForgeで実`node src/server.js`を起動し、plan、予約、キャンセル、再予約、通常終了、listen前移行、同一画像URL、Favorite、thumbnail、削除、旧source保持をHTTPで確認した。
- 同名異内容の競合ではactiveを切り替えず、旧保存先で起動して旧URLを維持することを確認した。
- 実3030/7860、実outputs、実履歴、実storage-settingsは変更されていない。

監督再検証:

```text
npm run check: 成功
関連テスト: 55 passed / 0 failed
npm test: 386 passed / 0 failed
git diff --check: 成功（改行コード警告のみ）
隔離子プロセス残留: なし

Local Image Chat: PID 58984のまま
ReForge: PID 52624のまま
outputs: 2665 files / 2,589,002,581 bytes
history.json: 5,174,602 bytes
history SHA-256: C8EAAA5EC0951D01706264D4AA801E56A9DEAE578411D0672CBE7C6FFA222EB6
data/storage-settings.json: 不存在のまま
```

## 判定

Task 09は構文チェック、関連テスト、全テストに成功し、実`outputs/`および3030番の稼働プロセスを変更していません。ただし、保存済み設定を信頼する起動経路にセキュリティ上の欠陥があり、仕様で必須とした実サーバー統合テストも不足しているため未承認です。

## [P1] 保存済みactiveOutputDirでも専用markerと実在を再検証する

対象:

- `src/storage-settings.js` の `resolveStoredOutputDir()` とパス検証
- `test/storage-settings.test.js`

現状:

```js
await validatePathSafety(candidate, {
  rootDir: resolvedRootDir,
  allowDefaultOutput: true,
  allowExistingActive: true,
  skipContentScan: true
});
```

`allowExistingActive: true` と `skipContentScan: true` の組み合わせにより、`data/storage-settings.json` の `activeOutputDir` を書き換えると、専用markerがない任意の既存フォルダでも起動時の保存先として採用されます。その結果、意図しないローカルフォルダが `/outputs` 静的配信のルートになる可能性があります。

レビュー再現結果:

```text
markerなし・無関係なsecret.txtを含む一時フォルダをactiveOutputDirへ直接記録
→ prepareStartup().source = "stored"
→ prepareStartup().outputDir = 当該フォルダ
→ acceptedUnmanaged = true
```

修正要件:

- UI/APIから一度承認済みという理由だけで、保存済み絶対パスを無条件に信用しない。
- `default outputs/` 以外のstored active pathは、起動のたびに次を確認する。
  - 対象ディレクトリが実在する。
  - 対象自体および既存祖先にsymlink/junctionがない。
  - Local Image Chat専用markerが存在し、内容が正しい。
  - 禁止ディレクトリ、repository root、現在パスの不正な親子関係ではない。
- 実在しないstored active pathを起動時に空フォルダとして再作成しない。旧履歴が突然消えたように見えるため、安全な既定`outputs/`へフォールバックし、公開状態へ理由を残す。
- marker不正、markerなし、パス不在の場合はstored pathを採用せず、既定`outputs/`へフォールバックする。
- `LOCAL_IMAGE_CHAT_OUTPUT_DIR` の既存優先仕様はこの修正で変更しない。
- エラー文やAPIレスポンスへ不要な内部ファイル一覧を出さない。

必須テスト:

- marker付きstored active pathは採用する。
- markerなしでファイルを含むstored active pathは拒否し、既定へフォールバックする。
- 不正marker付きstored active pathは拒否する。
- 保存後に削除されたstored active pathは再作成せず、既定へフォールバックする。
- symlink/junctionを含むstored active pathは拒否する。
- 改ざんした設定がrepository外の既存フォルダを `/outputs` として公開しない。

## [P1] 実サーバー経由の保存先API統合テストを追加する

対象:

- `test/storage-settings.test.js`、または既存の実サーバーテストへ最小限の追加

現状の`test/storage-settings.test.js`はサービス関数の単体テストだけで、Task 09の指示にあった「一時workspaceでサーバーをspawnし、HTTP APIと画像URL契約を往復する統合テスト」がありません。

最低限、隔離した一時workspace・一時port・小さいfixtureで次を実証してください。

- `GET /api/storage/settings`
- `POST /api/storage/plan`
- `PATCH /api/storage/settings` の予約とキャンセル
- 予約前は現在の`/outputs/...`、`/favorites/...`、`/api/images/:id/original`が読める。
- テスト用サーバーを通常終了し再起動すると、listen前移行後に同じURL契約で旧履歴画像、thumbnail、Favoriteが読める。
- 削除APIが移行後のファイルだけを安全に削除し、旧sourceは残すという今回のロールバック方針と矛盾しないことを明示する。
- 競合またはコピー失敗時は旧保存先で起動し、HTTP経由の履歴表示が維持される。
- 実`outputs/`、実3030番、実`data/storage-settings.json`には触れない。

## 再レビュー時の検証

```powershell
npm run check
node --test test/storage-settings.test.js test/ui-shell.test.js
npm test
git diff --check
```

追加で、実装担当はテスト前後に次が不変であることを報告してください。

- 実`outputs/`のファイル数と合計バイト数
- 3030番LISTEN PID
- 実`data/storage-settings.json`が新規作成・変更されていないこと

## 今回のレビュー結果

```text
npm run check: 成功
関連テスト: 43 passed / 0 failed
npm test: 376 passed / 0 failed
git diff --check: 成功
実outputs: 2,619 files / 2,554,991,941 bytes（前後不変）
3030番: PID 6732（前後不変）
実data/storage-settings.json: 存在せず
```

---

# 最終レビュー結果

更新日: 2026-08-05
状態: **Task 01〜07の指摘はすべて解消済み**

最終統合レビューで、本文書に記載したTask 04、Task 06、Task 07の追加修正がすべて反映されていることを確認しました。新しい追加修正指示はありません。以下はレビュー履歴として残しますが、Lunaが再実装する必要はありません。

---

# レビュー追加指示（解消済み・履歴）

更新日: 2026-08-05
対象レビュー: Luna Task 01 / 03 / 04 / 05

## 総合判定

- Task 01「中央メイン画像クリックで拡大」: 承認
- Task 03「画像比較の導線改善」: 承認（Task 04との表示統合修正を除く）
- Task 04「履歴タイトル生成元の分離」: 要修正1件
- Task 05「画像生成完了後のDiscord通知」: 承認

型チェック、関連テスト、全テストは成功しています。以下の1件だけ修正したうえで、Task 04を完了扱いにしてください。

## [P1] 比較トレイも共通の履歴タイトル取得関数を使用する

対象:

- `public/app.js` の `renderCompareTray()`（レビュー時点の6525行付近）
- `test/ui-shell.test.js`

現在のコード:

```js
const title = entry.generation?.description || `Seed ${entry.image.seed}`;
```

問題:

- 新規履歴に保存された `generation.title` を比較トレイだけ無視しています。
- Task 04で定義した `generationTitle(generation)` へ表示タイトル取得を集約する要件から外れています。
- 手動タイトルまたは自動生成タイトルが存在しても、比較トレイでは旧 `description` が表示されます。
- `description` をPrompt復元用として保持すること自体は正しいため、復元・派生生成側の参照は変更しないでください。

修正:

```js
const title = generationTitle(entry.generation);
```

`generationTitle()` は既に `title || description || "無題"` の後方互換fallbackを持つため、比較トレイ内で別のfallbackを重ねないでください。

テスト追加:

- `renderCompareTray()` が `generationTitle(entry.generation)` を使用すること。
- 比較トレイの表示タイトル取得で `entry.generation?.description` を直接参照しないこと。
- 新規 `title` がある履歴、旧 `description` だけの履歴、両方空の履歴の純粋関数テストは既存のTask 04テストを維持すること。

禁止:

- `description` フィールドの削除・改名
- 比較候補Stateや比較モーダルの変更
- タイトルの保存形式や自動生成方式の再設計
- Task 01、03、05の承認済み処理への便乗変更

## 修正後の確認

```powershell
npm run check
node --test test/ui-shell.test.js test/compare-view.test.js test/history.test.js test/discord.test.js test/server-integration.test.js
npm test
```

期待結果:

- すべて成功
- 比較トレイへ新しい `generation.title` が表示される
- 古い履歴は `description`、両方ない履歴は「無題」になる
- 比較候補の追加・解除・全解除・2枚以上での比較開始が従来どおり動く

## レビューで確認済みの事項

### Task 01

- 中央メイン画像はクリック、Enter、Spaceで既存の拡大モーダルを開く。
- Spaceの既定スクロールとキーリピートを抑止している。
- `tabindex`、`role="button"`、`aria-label` がある。
- バリエーションサムネイルは引き続き選択操作である。
- Escape、背景クリック、閉じるボタンは既存モーダルを再利用している。

### Task 03

- 比較候補は既存の `compareSelection` へ集約され、4枚上限を維持している。
- ナビバッジ、比較トレイ、個別解除、全解除、0枚・1枚案内、2枚以上の開始導線がある。
- 既存の `openCompareView()` を再利用している。
- 比較画面は初期表示にサムネイルを使い、明示操作時だけ原寸へ切り替える。

### Task 04

- 新規履歴へ独立した `title` を確定保存する。
- 手動タイトル、自動方式、テンプレート、実Seed、古い履歴fallbackのテストがある。
- `description` はPrompt生成・復元互換のため残されている。
- 比較トレイ以外の主要表示面は `generationTitle()` を使用している。

### Task 05

- Favorite通知と生成完了通知は別設定・別状態として扱われている。
- 生成画像保存と履歴保存の後に、生成レスポンスを待たせず通知を開始する。
- 通知失敗を生成失敗へ波及させない。
- 添付は先頭画像1枚に制限され、Webhook実値は公開しない。
- sent/sending/failedの重複防止、failed再送、stuck recoveryが維持されている。
- テスト通知は固定文面で画像を添付しない。

## レビュー時の検証結果

```text
npm run check
  成功

node --test test/ui-shell.test.js test/compare-view.test.js test/history.test.js test/discord.test.js test/server-integration.test.js test/ui.test.js test/layout-overflow.test.js
  68 passed / 0 failed

npm test
  353 passed / 0 failed
```

ブラウザ確認では、履歴画像を選択すると中央へ原寸URLが設定され、中央画像のクリック可能属性と既存比較導線が表示されることを確認しました。実Webhookへの送信、実ReForge生成、モバイルSafari実機までは今回のレビューでは実行していません。

---

# Task 07 レビュー追加指示

更新日: 2026-08-05
対象レビュー: Luna Task 07「設定画面UI改善」

## 判定

要修正2件です。2カラム、カテゴリ切替、検索、状態要約、生成画面からLoRA管理への遷移、既存保存方式の維持は確認できました。以下を修正したうえでTask 07を完了扱いにしてください。

## [P1] 重複している `loraSyncNotice` IDを解消する

対象:

- `public/index.html` の生成画面LoRA欄（レビュー時点の320行付近）
- `public/index.html` の設定画面LoRA欄（レビュー時点の963行付近）
- `public/app.js` のLoRA同期通知描画処理
- `test/ui-shell.test.js`

確認結果:

```text
document.querySelectorAll('#loraSyncNotice').length === 2
```

同じIDが次の2箇所に存在します。

```html
<div id="loraSyncNotice" ...></div>
```

`document.getElementById("loraSyncNotice")` は先に現れる生成画面側だけを取得するため、設定画面側の通知枠は更新されません。Task 07の「設定DOMとIDが重複しない」という必須条件にも反します。

修正方針:

1. 生成画面と設定画面の通知枠へ別々のIDを割り当ててください。
2. 同じLoRA同期通知を両画面で表示する必要がある場合、通知内容を作る処理は共有し、2つの表示先へ同じ内容を描画してください。
3. 設定画面側の通知枠が不要と確定できる場合は、死んでいる要素を削除しても構いません。CSSで隠すだけにはしないでください。
4. LoRA選択、衣装プリセット、同期警告の生成ロジックは変更しないでください。

テスト:

- 一部の既知IDだけでなく、`public/index.html` のすべての `id` を抽出し、重複が0件であることを検証してください。
- 両方の通知枠を残す場合は、LoRA同期通知の描画先が両方更新される契約も固定してください。

## [P2] カテゴリ選択直後に主要設定内容を表示する

対象:

- `public/index.html` の各設定カテゴリにある主要 `<details>`
- 必要なら `public/app.js` の `activateSettingsCategory()`
- `test/ui-shell.test.js`

現象:

初期HTMLでは、モデル以外の主要セクションがほぼすべて閉じています。

```text
一般                 appManagementDetails      closed
プロンプト           promptPartsDetails         closed
モデル               checkpointDetails          open
LoRA                 settingsLoraDetails        closed
履歴・ギャラリー     titleGenerationDetails     closed
Discord通知          discordDetails             closed
接続                 mobileAccessDetails        closed
詳細                 promptTemplateDetails      closed
アプリ情報           updateDetails              closed
```

カテゴリ分離自体はできていますが、多くのカテゴリで選択直後の右本文が閉じた見出しだけになります。「全設定が閉じたアコーディオンとして並び、設定状態を一覧で把握できない」というTask 07の改善目的が十分に解消されていません。

最小修正:

1. 各カテゴリの主要セクションは初期表示で開いてください。静的な `open` 属性、またはカテゴリを初めて選択した時だけ主要セクションを開く最小処理のどちらでも構いません。
2. Civitai登録、Grokテンプレート、更新適用など、長い補助機能・高度な機能・危険操作は閉じたままで構いません。
3. ユーザーが手動で閉じた主要セクションを、同じセッション中のカテゴリ切替のたびに強制的に開き直さないでください。
4. 既存input/button ID、保存ハンドラ、API呼び出しは変更しないでください。
5. 全設定を同時表示へ戻さず、現在のカテゴリ分離は維持してください。

テスト:

- 一般、プロンプト、履歴、Discord、接続などのカテゴリを選択した直後に、主要設定内容へ追加クリックなしで到達できること。
- Civitaiや高度な補助設定は意図どおり折りたたみを維持すること。
- カテゴリ切替後も各設定DOMが複製されないこと。

## 修正後の確認

```powershell
npm run check
node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js
npm test
```

期待結果:

- 全コマンド成功
- HTML内の重複IDが0件
- 設定画面側のLoRA同期通知が死んだDOMにならない
- カテゴリ選択直後に主要設定が読める
- 生成画面からLoRA管理へ移動してもPromptと生成設定が保持される
- 既存のlocalStorage、個別API、手動保存、自動保存の方式が変わらない

## Task 07で承認済みの部分

- `220px minmax(0, 1fr)` のデスクトップ2カラム
- 本文最大幅860pxと `min-width: 0`
- 860px以下でデスクトップナビをnative selectへ縮退するCSS
- 一般、プロンプト、モデル、LoRA、履歴、Discord、接続、詳細、アプリ情報のカテゴリ分離
- 空の外観カテゴリを追加していない
- 検索語の大文字小文字を区別しない複数語AND検索
- 検索0件の空状態
- 検索結果からカテゴリ、対象details、最初の操作要素への遷移
- `activateSettingsCategory()` をデスクトップナビ、狭幅select、検索、LoRA管理導線で共有
- 生成画面からLoRA管理へ移動しても入力中Character Promptが保持されることをブラウザで確認
- ReForge、Discord、更新の状態要約が既存表示結果を再利用している
- Task 07のための新規依存、API、保存データ形式変更がない

## レビュー時の検証結果

```text
npm run check
  成功

node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js
  39 passed / 0 failed

npm test
  358 passed / 0 failed
```

ブラウザ確認は1280×720相当で実施し、カテゴリ切替、Webhook検索からDiscord設定への遷移、生成画面からLoRA管理への遷移、Prompt保持を確認しました。CSS上の860px以下縮退と横幅制約は確認しましたが、モバイルSafari実機と125%ズームの手動確認は今回実施していません。

---

# Task 06 レビュー追加指示

更新日: 2026-08-05
対象レビュー: Luna Task 06「ギャラリー画面UI改善」

## 判定

要修正3件です。20件ページング、サムネイル配信、検索・並び替え、フィルターモーダル、タグAND絞り込み、Favorite、三点メニューの既存操作、比較モードは正常に動作しています。以下だけをギャラリーの範囲内で修正してください。

## [P1] 画像詳細モーダルへ対象画像を表示する

対象:

- `public/app.js` の `openHistoryDetail()`（レビュー時点の7152行付近）
- `public/style.css` の詳細モーダル用スタイル
- `test/ui-shell.test.js`

現象:

三点メニューの「詳細」から既存 `openHistoryDetail(generation, image)` は開きますが、モーダル内に画像要素がありません。ブラウザのアクセシビリティツリーでも、詳細ダイアログにはタイトル・パラメータ・Prompt・操作だけがあり、大きな画像は存在しません。

Task 06では詳細表示に「大きな画像」を含めることが必須です。カード画像クリックの拡大モーダルが別に存在していても、三点メニューの「詳細」から画像と情報を一緒に確認できる必要があります。

最小修正:

1. `openHistoryDetail()` のヘッダー直後、またはメタデータ直前へ画像プレビューを1つ追加してください。
2. 詳細を明示的に開いた時だけ取得されるため、`originalImageUrl(image)` を使用して構いません。
3. `alt` は `generationTitle(generation)` を使用してください。
4. `object-fit: contain`、`max-width: 100%`、適切な最大高を設定し、縦長・横長とも切らないでください。
5. 画像クリックでさらに既存拡大モーダルを開く場合も、新しいモーダル基盤は作らず既存 `openImageModal()` を再利用してください。
6. 一覧カードの `src` は引き続きサムネイルのままにしてください。

テスト:

- `openHistoryDetail()` が対象画像の表示要素を作ること。
- 詳細画像は `originalImageUrl(image)` を使用すること。
- 一覧カードは引き続き `configureThumbnailImage()` を使用し、原寸を初期 `src` にしないこと。

## [P1] 三点メニューから共通 `details` のカード装飾を外す

対象:

- `public/style.css` の `.historyCardMenu`（レビュー時点の3118行付近）
- `test/ui-shell.test.js` または `test/layout-overflow.test.js`

原因:

全体共通スタイルとして次があります。

```css
details {
  margin-top: 12px;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: 13px;
}
```

`.historyCardMenu` はnative `<details>` ですが、現在の上書きは `position` と `align-self` だけです。そのため閉じた三点メニュー自体が約64pxの別カードになり、カード本文下部へ大きな空白と二重枠を作っています。1280×720の実画面でも、各画像カード下部にメニュー専用の大きな囲みが見えました。

これはTask 06の「カードの中へ別カードを作らない」「常設操作をFavoriteとコンパクトな三点メニューへ減らす」という要件に反します。

最小修正例:

```css
.historyCardMenu {
  position: relative;
  align-self: flex-end;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
```

既存の`.historyCardMenu > summary`の36pxタップ領域と、開いた時の`.historyCardMenuBody`は維持してください。メニュー項目のイベント処理、削除確認、比較、読込、詳細は変更しないでください。

必要なら`.preferenceSummaryDetails`も共通`details`の余分な外枠・paddingを継承していないか同じ観点で確認してください。ただしFavorite傾向の機能や内容は変更しないでください。

テスト:

- `.historyCardMenu` が共通`details`のmargin、padding、borderを明示的にリセットすること。
- 閉じたメニューのクリック領域は36px以上を維持すること。
- 開いたメニューがカードや隣接カードの背面へ隠れないこと。

## [P2] デスクトップのグリッド密度を指定範囲へ合わせる

対象:

- `public/style.css` の `.historyGrid`（レビュー時点の3083行付近）
- `test/ui-shell.test.js`

確認結果:

1280px幅のブラウザで次の実測でした。

```text
1行のカード数: 5
カード幅: 約236px
grid-template-columns: 235.8px × 5列
```

Task 06の目安は1366pxで3〜4列、1920pxで5〜6列です。現在の`minmax(230px, 1fr)`固定では1280pxですでに5列になり、1920pxではさらに7〜8列へ増えるため、画像とタイトルが過密になります。

修正方針:

1. デスクトップの最小カード幅をおおむね280〜300pxへ調整し、1366pxで4列、1920pxで6列前後を目安にしてください。
2. 1080px以下では230px程度まで縮小して構いません。
3. 760px以下の2列、420px以下の1列は維持してください。
4. `minmax(0, 1fr)`と`min-width: 0`を維持し、横スクロールを発生させないでください。
5. 固定列数だけで全幅を決めず、既存の`auto-fill`または適切なメディアクエリを使用してください。

テスト:

- 1366px相当で3〜4列。
- 1920px相当で5〜6列。
- 760px以下で2列、420px以下で1列。
- ページ全体に横スクロールがないこと。

## 修正後の確認

```powershell
npm run check
node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js test/image-delivery-ui.test.js
npm test
```

ブラウザ確認:

- 1366×768で4列前後
- 1920×1080で6列前後
- 三点メニューが別カードのように見えない
- 詳細ダイアログに対象画像とメタデータが表示される
- 一覧20枚の画像URLはサムネイルのまま
- 追加20件後も重複しない

## Task 06で承認済みの部分

- 初回20件、追加20件のカーソルページングを維持
- 実ブラウザで20件から40件へ追加し、画像IDの重複が0件であることを確認
- 一覧20枚すべてが `/api/images/{id}/thumbnail` を使用
- 一覧で `/original` が0件
- 先頭4枚だけeager、以降はlazy、全画像が`decoding="async"`
- サムネイルは`object-fit: contain`
- タグ、Checkpoint、LoRA、期間をnative dialogへ格納
- タグ候補は取得済みのStructured Promptを優先し、fallback Promptを利用
- 複数タグはAND条件で絞り込み
- 選択タグの個別解除と全解除
- 表示件数に「取得済み」の範囲を明記
- 新しい順・古い順の安定ソート
- Favorite星クリックと三点メニュー操作をカード拡大から分離
- 三点メニューから既存の読込、比較、詳細、削除へ接続
- Discord状態を三点メニュー内で維持
- 比較モードは既存 `compareSelection` を共有
- 0件・1件・2件以上の案内と開始可否
- 比較候補、ナビバッジ、既存比較トレイの同期
- 比較モード終了時に候補を勝手に消さない
- API、履歴形式、Favoriteデータ、比較データ形式を変更していない

## レビュー時の検証結果

```text
npm run check
  成功

node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js test/image-delivery-ui.test.js
  41 passed / 0 failed

npm test
  358 passed / 0 failed
```

ブラウザ確認は1280×720相当で実施しました。フィルター、タグAND絞り込み、三点メニュー、詳細、比較モード、20件追加読込を確認しています。1366×768、1920×1080、125%ズーム、モバイルSafari実機は今回実施していません。

---

# Task 08B レビュー修正指示

更新日: 2026-08-07
状態: レビュー承認済み

## 判定

Task 08Bは、ロック取得ロジック、runtime API、旧サーバー互換UI、単体テストの基本方針は適切です。ただし、全テスト終了後に終了済みテストサーバーのロックファイルが残留することと、実サーバーを2プロセス起動した統合テストがないことを確認しました。

現時点では完了条件7、8、12、20を統合レベルで確認できないため、承認保留です。プロダクションコードを全面的に書き直さず、終了テストとテスト後クリーンアップを補ってください。

## [P1] 実サーバー2プロセスで二重起動拒否を検証する

対象:

- `test/server-integration.test.js`
- 必要な場合のみ既存テストヘルパー
- `src/server.js`は、テストで実際の不具合が判明した場合だけ修正

現在の`test/instance-lock.test.js`は、同一テストプロセス内で`acquireInstanceLock()`を2回呼ぶ単体テストです。次は未検証です。

- `src/server.js`がロックを実際に取得してからlistenすること
- 同じroot・同じportで起動した2個目のNodeプロセスが非0終了すること
- 2個目の標準エラーに既起動のPIDとPortが表示されること
- 1個目のサーバーが2個目の失敗後も`/api/config`へ応答すること
- 2個目でbackfill処理が開始されないこと
- 1個目の終了後に同じroot・portで再起動できること

テスト専用の一時config、data、outputs、空きポートを使い、3030番と現在稼働中のPID `7040` / `43312`には触れないでください。

最低限の統合テスト手順:

1. テスト専用ポートで1個目の`src/server.js`を起動する。
2. `/api/config`の応答を待つ。
3. 完全に同じroot・portで2個目を起動する。
4. 2個目が一定時間内に非0終了することを待つ。
5. stderrへ「既に起動」「PID」「Port」が含まれることを確認する。
6. 1個目の`/api/config`が引き続き200を返すことを確認する。
7. 1個目を終了させ、終了完了まで待つ。
8. 同じroot・portで3個目を起動できることを確認する。
9. 3個目も終了完了まで待つ。

子プロセス終了は`child.kill()`を呼ぶだけで終えず、`exit`または`close`イベントを必ず待ってください。タイムアウトを設け、失敗時も全子プロセスを回収してください。

## [P1] Windowsのテスト終了後にstale lockを残さない

対象:

- `test/server-integration.test.js`
- `test/server-recovery.test.js`
- `test/server-experiments.test.js`
- `test/server-workspace.test.js`
- 必要ならテスト専用の小さな共通ヘルパー

レビュー時に`npm test`を実行した直後、次の5ファイルが`%TEMP%\local-image-chat`へ残りました。

```text
<root-hash>-60236.lock  PID 73660  dead
<root-hash>-60239.lock  PID 24752  dead
<root-hash>-60242.lock  PID 80336  dead
<root-hash>-60246.lock  PID 71928  dead
<root-hash>-60340.lock  PID 37216  dead
```

各ファイルのPIDは既に存在しません。既存サーバーテストのcleanupが概ね次の形で、Windowsでは子プロセスの終了完了とgraceful shutdownを保証していないことが原因です。

```js
t.after(async () => {
  child.kill();
  // childのexitを待っていない
});
```

修正要件:

1. テストの子プロセス終了を共通化し、終了イベントを待つ。
2. gracefulな終了を試みたあと、一定時間で終わらない場合だけ強制終了へフォールバックする。
3. Windowsで強制終了となり`exit`ハンドラーを実行できない場合、テストが所有するroot・portのロックだけを明示的に除去する。
4. 削除対象は必ず`getInstanceLockPath(rootDir, testPort)`で厳密に算出する。
5. `%TEMP%\local-image-chat`全体を再帰削除しない。
6. 他テスト・実アプリ・別ポートのロックを削除しない。
7. 子プロセスの終了確認前に一時config/data/outputを削除しない。
8. cleanupはテスト失敗時にも必ず動く。

テスト後、今回使用した各portのロックが存在しないことをassertしてください。stale lockの自動回収機能は維持しますが、「次回起動時に回収されるからテスト終了時に残ってよい」とはしないでください。ランダムポートのテストでは次回取得が発生せず、実行ごとにファイルが増え続けます。

## [P2] SIGINT / SIGTERM解放の実証を追加する

対象:

- `test/server-integration.test.js`または上記の共通終了ヘルパー

OS差を考慮しつつ、少なくともテスト環境で利用可能なgraceful終了経路について次を確認してください。

- 終了後にロックファイルがない
- 終了コードまたはsignalが期待どおり
- 同じroot・portを直後に再取得できる

Windowsの`child.kill()`がNodeの`SIGTERM`ハンドラーを通らない場合は、その事実をテスト名またはコメントで明示し、テスト専用cleanupで補ってください。プロダクションへテスト専用shutdown APIを追加しないでください。

## 維持する実装

次はレビューで問題を確認していないため、必要なく変更しないでください。

- rootの正規化SHA-256＋portによるロックキー
- hostをロックキーへ含めない仕様
- `fs.open(lockPath, "wx")`による排他取得
- live PIDの拒否
- stale/corrupt lockの回収
- `instanceId`による所有者確認
- 別rootまたは別portの同時利用
- `/api/config.runtime`の後方互換な追加
- runtimeから絶対パス・秘密情報・instanceIdを除外
- Task 08Aの画面版・サーバー版比較
- runtimeがない旧サーバーでのUIフォールバック
- listen成功後だけbackfillを開始する構造
- 現在稼働中3030プロセスを停止・再起動しない方針

## 修正後の検証

修正前に、今回レビューで残った`.lock`だけをPIDがdeadであることを再確認してから個別に削除して構いません。ディレクトリ全体の削除は禁止します。

```powershell
git diff --check
npm run check
node --test test/instance-lock.test.js test/server-integration.test.js test/server-recovery.test.js test/server-experiments.test.js test/server-workspace.test.js test/ui-shell.test.js
npm test
```

検証後:

```powershell
$lockDir = Join-Path ([IO.Path]::GetTempPath()) 'local-image-chat'
Get-ChildItem $lockDir -Filter '*.lock'
```

少なくとも修正後のテストが使用したportについて、新しいdead PIDのロックが増えていないことを確認してください。別作業が所有するlive PIDのロックは削除しないでください。

3030番のread-only確認:

```powershell
Get-NetTCPConnection -LocalPort 3030 -State Listen
```

PID `7040`と`43312`を停止・再起動しないでください。

## レビュー時の検証結果

```text
npm run check
  成功

node --test test/instance-lock.test.js test/ui-shell.test.js test/net-info.test.js
  47 passed / 0 failed

npm test
  367 passed / 0 failed
```

テスト結果自体は全件成功していますが、`npm test`後にdead PIDのロックが5件増えたため、完了とは判定しません。

3030番の既存プロセスはレビュー前後で変化していません。

```text
127.0.0.1:3030  PID 7040
0.0.0.0:3030    PID 43312
```

## 修正後レビュー

更新日: 2026-08-07

指摘した修正は完了しています。

- 実サーバー1個目・重複2個目・再取得3個目を使う統合テストを追加
- 2個目が終了コード1となり、stderrへ既起動・PID・Portを出すことを確認
- 重複拒否後も1個目の`/api/config`が200を返すことを確認
- 1個目終了後、同じroot・portを別PIDで再取得できることを確認
- 全サーバーテストで子プロセスの終了完了を待つcleanupへ変更
- Windowsでgraceful handlerを通らない場合も、テスト所有のroot・portだけを明示清掃
- 関連テスト後・全テスト後とも、テスト由来のdead PIDロックは0件
- 稼働中PID `6732`の3030 live lockは削除せず維持

検証結果:

```text
npm run check
  成功

node --test test/instance-lock.test.js test/server-integration.test.js test/server-recovery.test.js test/server-experiments.test.js test/server-workspace.test.js test/ui-shell.test.js
  46 passed / 0 failed

npm test
  367 passed / 0 failed

git diff --check
  成功
```

実ブラウザーでは次を確認しました。

```text
Version 3.0.0　最新ファイルを使用中
PID 6732 · 起動 2026/08/07 02:25 · 0.0.0.0:3030
```

`#versionContractStatus`は1個、`aria-live="polite"`を維持しています。Task 08Bは承認済みです。
