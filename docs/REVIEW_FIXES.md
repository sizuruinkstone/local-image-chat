# Task 22 実機Profile activation失敗

更新日: 2026-08-15
状態: **実機再現済み／修正必要**

13 Profileの`config.local.json`登録は完了している。実機でAnimaから`obsessionIllustrious_vPredV20`へ切り替えるSmoke Testを行ったところ、Neoの`POST /sdapi/v1/options`が次で失敗した。

```text
RuntimeError: Model "'sd/obsessionIllustrious_vPredV20.safetensors'" not found...
```

## 根本原因

`normalizeConfiguredResource()`は設定Checkpointの区切りを`/`へ正規化する。`resolveCheckpointCatalog()`はこの正規化済み設定値を`target.requestName`として保持し、`prepareGeneration()`がそれを`sd_model_checkpoint`へ送っている。

実Neoのcheckpoint aliasはWindows上で次を含む。

- catalog `title`／`name`: `sd\\obsessionIllustrious_vPredV20.safetensors`
- catalog `model_name`: `sd_obsessionIllustrious_vPredV20`
- basename: `obsessionIllustrious_vPredV20.safetensors`

Neo本体`modules/sysinfo.py`は、受信値が`sd_models.checkpoint_aliases`に完全一致しなければ拒否する。`sd/obsession...`はaliasに存在しないため失敗する。ファイル未配置やConfig allowlistの問題ではない。

Neo本体もread-only確認済みで、`CheckpointInfo.ids`へ`model_name`を必ず登録する。したがって送信用identifierには、設定文字列を再利用せず、照合済みcatalog entryの安全な`modelName`を使うのが第一候補である。

## 追加の実害：optionsが部分適用された

現在のPOST bodyは次の順で構築されている。

```text
forge_preset
forge_additional_modules
sd_model_checkpoint
```

Neoはrequestのproperty順に逐次適用する。Checkpointで例外になる前にpresetとmodulesが変更されたため、実Neoの現在状態は次の不整合になっている。

```text
sd_model_checkpoint: oneObsessionAnima_v30
forge_preset: xl
forge_additional_modules: []
```

修正・復旧前に生成しないこと。

## Luna修正指示

対象は原則次の2ファイルだけ。

- `src/forge-neo.js`
- `test/task20.test.js`または`test/task22.test.js`

### 1. options POST用Checkpoint identifier

- 設定値`desired.checkpoint.requestName`をそのままPOSTしない。
- `resolveCheckpointCatalog()`でallowlist設定と一意照合済みのcatalog entryから、Neoがaliasとして正式に公開する安全な`modelName`を送信する。
- `modelName`が空または安全に取得できない場合はPOSTせず、安全な503で停止する。
- catalogのabsolute `filename`は送らない。
- hash付きtitleへ依存しない。
- 公開DTOのCheckpoint ID、Config形式、比較用のslash正規化は変更しない。
- no-op判定は現在どおりhash、slash／backslash、basename差を吸収してよい。

概念:

```text
Config/public ID: sd/obsessionIllustrious_vPredV20.safetensors
catalog match:    model_name = sd_obsessionIllustrious_vPredV20
options POST:     sd_model_checkpoint = sd_obsessionIllustrious_vPredV20
```

### 2. options bodyの安全な順序

- `sd_model_checkpoint`を最初に構築する。
- 続いて`forge_preset`、`forge_additional_modules`を送る。
- 事前のCheckpoint／module catalog検証を維持する。
- POSTは引き続き1回だけとし、成功後GET再検証を維持する。
- これは完全なtransaction化ではないが、未知Checkpoint時にpreset/moduleだけが先に変わる今回の破損を防ぐ。

### 3. 必須テスト

- Configが`sd\\...`でも内部正規化後の`sd/...`でも、POSTはcatalog `model_name`を使う。
- mock Neoが`sd/...`を拒否し`model_name`だけを受理する実機相当fixtureでactivation成功。
- POST bodyのkey順が`sd_model_checkpoint`、`forge_preset`、`forge_additional_modules`である。
- 不正Checkpoint時にpreset/moduleが部分変更されないfixture。
- options POSTは切替時1回、no-op時0回。
- POST後のGET完全一致確認。
- absolute path、hash付きtitleをPOST／公開DTOへ出さない。
- AnimaとXLの両方向を検証する。

### 4. 修正中の禁止事項

- 実Neoへoptions POSTを再送しない。
- 実生成しない。
- 3030／Neoを再起動しない。
- `config.local.json`の13 Profileを戻さない。
- Neo本体を変更しない。
- filesystem pathをConfigやAPIへ追加しない。

### 5. 検証

```text
npm run check
node --test test/task22.test.js test/task20.test.js
npm test
git diff --check
```

## 修正承認後の復旧Smoke Test

修正後はactive jobs 0を確認し、必要なら3030だけを通常再起動する。最初にAnima Profileを1件適用して、現在の不整合状態を次へ戻す。

```text
checkpoint: oneObsessionAnima_v30
preset: anima
modules:
  - qwen_image_vae.safetensors
  - oneObsessionAnima_v30_txt.safetensors
```

GET再検証で完全一致した後にだけ低負荷Anima生成を許可する。その後、別の明示GOで代表XL 1件を試す。失敗時に自動retryや別identifierの総当たりをしない。

# Task 22 限定追加修正 最終レビュー

更新日: 2026-08-15
状態: **修正確認済み／コード承認**

前回の限定指摘2件は解消済み。

- Neo healthがcheckpointなしを正常応答した場合、`activeCheckpoint`をnullへ同期し、`selectedCheckpoint`を維持する。
- healthが後からcheckpointありを返す場合、実active表示を復元する。
- Neo selectorの処理中表示は「次回生成用のCheckpointを確認中」となり、モデル即時ロードを示さない。
- ReForgeの即時切替中／切替完了表示は維持されている。
- Neo selectorはLocal API validationだけを呼び、options POSTはqueue実行時に残っている。

監督実行結果:

- `npm run check`: 成功
- Task 22／20／UI関連: 69 passed / 0 failed
- 全テスト: 465 passed / 0 failed
- `git diff --check`: 成功（改行コードwarningのみ）

コードの追加修正はこれ以上要求しない。

ただし、Task 22 Phase Bの実環境設定は未実施である。`config.local.json`は現在も`activationMode: preloaded`、旧単一Anima設定、`profiles`なしのまま。次の作業は`docs/CURRENT_TASK.md`先頭に定義済みの13 Profile登録であり、コード修正の再実装ではない。

# Task 22 追加修正 再レビュー

更新日: 2026-08-14
状態: **限定追加修正必要**

前回指摘したBackendのProfile完全一致判定、managed/preloadedの区別、UIの`activeCheckpoint`／`selectedCheckpoint`分離、および次回generation payloadへの選択値反映は確認できた。関連テスト69件、全テスト465件、構文検査、`git diff --check`も成功している。

ただし、実active状態を誤表示し得る次の2点を最終承認前に限定修正すること。大規模な再設計は不要。

## 1. P1: healthがactive Profileなしを返しても古いactive Checkpointが画面へ残る

対象:

- `public/app.js`
- `test/task22.test.js`または既存UIテスト

現在の`checkHealth()`は、Neoの`runtimeHealth.checkpoint`が存在する場合だけ`activeCheckpoint`を更新する。managed-optionsでNeoへ接続できるが、現在状態がどの設定済みProfileにも完全一致しない場合、Backendは意図どおり`ok: true`かつcheckpointなしを返す。しかし画面側は以前の`activeCheckpoint`を消さないため、実際には設定済みProfileがactiveでないのに「使用中: 旧Checkpoint」と表示し続ける。

修正条件:

- Neo Runtimeのhealth responseを正常に受信した場合、`runtimeHealth.checkpoint`がなければ`activeCheckpoint = null`として実状態へ同期する。
- `selectedCheckpoint`は維持し、表示は「次回生成で切替: ...（使用中のCheckpointを確認できません）」相当にする。
- Runtime自体の接続失敗やHTTP失敗時は、単純に選択値まで消さない。
- ReForgeの既存状態更新へ影響させない。
- managed-optionsでactiveなし、preloadedでactiveなし、active Profileありの3状態を区別する。

必須回帰:

- 以前のactive値がある状態でNeo healthがcheckpointなしを返すと、古いactive表示が消える。
- selected値はgeneration payload用に残る。
- 次にhealthがcheckpointありを返せばactive表示が復元される。

## 2. P2: Neo選択開始時だけ「モデル読込中」と表示している

対象:

- `public/app.js`
- `test/task22.test.js`

`switchSelectedCheckpoint()`の完了後表示は「次回生成で切替」へ修正されているが、POST前にはRuntimeを問わず次を表示している。

```text
切替中: ...（モデル読込に時間がかかる場合があります）
```

Neoの`/api/checkpoints/select`はallowlist validationだけで、selector操作時にはモデルをロードしない。この文言は再び即時ロードと誤認させる。

修正条件:

- Neoでは「次回生成用のCheckpointを確認中」等、validation中だと分かる文言にする。
- ReForgeの即時切替では既存の「切替中／モデル読込」文言を維持してよい。
- selector操作からNeo options POSTを行わない。
- 完了後の「次回生成で切替」とReForgeの「切替完了」の分岐を維持する。

## 検証

```text
npm run check
node --test test/task22.test.js test/task20.test.js test/ui-shell.test.js
npm test
git diff --check
```

実3030／Neoの再起動、options POST、実生成、`config.local.json`のProfile推測追加は行わないこと。修正後は変更箇所とテスト結果だけを報告し、監督再レビューを依頼すること。

# Task 22 Forge Neo Multi-Profile 監督レビュー追加修正

更新日: 2026-08-14
状態: **追加修正必要**

Task 22のMulti-Profile基盤、allowlist、queue実行時activation、単一options POST、再検証、後方互換、および自動テストは概ね設計どおりである。以下の2件は、複数Profile運用時に実状態とUI表示を誤らせるため、最終承認前に修正すること。

## 1. P1: `checkHealth()`が常に先頭Profileを稼働中として扱う

対象:

- `src/forge-neo.js`
- `test/task22.test.js`

現状の`checkHealth()`はcatalog取得後に`selectProfile(catalog)`を引数なしで呼び、常に`profiles[0]`を選択している。そのためNeoへ第2Profile（SDXL / Illustrious等）が実際にロードされていても、health responseのcheckpointが先頭Anima Profileになり得る。また、先頭ProfileのCheckpointが未配置でも第2Profileが利用可能な場合に、Runtime全体をoffline扱いする可能性がある。

修正方針:

- `/sdapi/v1/options`の現在Checkpoint、`forge_preset`、`forge_additional_modules`を、各設定済みProfileの3要素と完全照合する。
- 完全一致したProfileを「実際にactiveなProfile」としてhealthへ返す。
- hash付き／hashなしCheckpoint表記の既存正規化を再利用する。
- module比較は既存どおり順序非依存の完全一致とする。
- 第2Profileがactiveなら、そのProfileの安全な公開Checkpoint identifierを返す。
- 先頭Profileが未配置でも、別の設定済みProfileがcatalog上利用可能なら、`managed-options` Runtime全体を単純にofflineへ落とさない。Runtime到達可否と「現在activeな設定済みProfileがあるか」を混同しない。
- `preloaded`では、現在状態がどの設定済みProfileにも完全一致しない場合、生成不能であることが分かる既存互換のhealth結果にする。
- URL、絶対path、内部module path、stackを公開DTOへ追加しない。

必須テスト:

- 第2Profileがactiveなときhealthが第2Profileを返す。
- hash付きcatalog titleとhashなしoptions値でも正しくactive判定できる。
- 先頭Profileが未配置・第2Profileが利用可能なmanaged-options構成で、Runtime全体が誤って利用不能にならない。
- preloadedでどのProfileにも一致しない場合の安全な結果を固定する。
- 従来の単一Anima設定のhealth契約を壊さない。

## 2. P1: Checkpoint選択UIがvalidation完了を「ロード完了」と表示する

対象:

- `public/app.js`
- 必要な既存UIテスト（原則`test/ui-shell.test.js`、Task 22固有契約なら`test/task22.test.js`）

現状のCheckpoint selectorは`POST /api/checkpoints/select`成功後に`activeCheckpoint`を選択値へ上書きし、`切替完了`と表示する。しかしTask 22のNeo契約では、このPOSTはallowlist validationだけであり、実際のoptions切替はgeneration jobの実行時に行う。したがって、まだAnimaがロード中でもSDXLを「切替完了」と表示でき、画面状態とNeo実状態が食い違う。

修正方針:

- 「次回生成に使う選択Checkpoint」と「Neoへ現在ロードされているactive Checkpoint」を概念上分離する。
- Neo Runtimeでselectorを変更した時は、options POSTや実ロード済み扱いをせず、`次回生成で切替: <checkpoint>`等の明確な文言を表示する。
- validation成功だけを`切替完了`と表現しない。
- generation requestには選択Checkpointを従来どおり送る。
- 実active状態は、catalog／healthなどBackendが返す実状態を再取得した時だけ更新する。
- ReForgeの既存selectorが実際に即時切替を行う場合、その従来挙動・文言は維持する。
- Runtime切替、Checkpoint再読込、保存済みフォーム復元、生成後のフォーム状態を壊さない。
- selector操作からNeoの`/sdapi/v1/options`を直接呼ばない既存契約を維持する。

必須テスト:

- Neo selectorのvalidation成功後に`切替完了`と表示しない。
- Neo selector選択値が次のgeneration payloadへ入る。
- selector変更だけでは実active Checkpointを上書きしない。
- ReForgeの既存即時切替表示を壊さない。
- RuntimeをNeo停止／ReForge起動へ切り替える既存Task 21回帰を維持する。

## 3. 実環境Multi-Profile設定は推測で追加しない

現在の`config.local.json`は`preloaded`かつ旧単一Anima設定であり、具体的なSDXL / Illustrious Profileは未設定である。このため、コード上のMulti-Profile基盤は存在するが、実環境で「AnimaとSDXLをNeoだけで選択して使う」完了条件はまだ成立していない。

- Lunaは実Checkpoint、preset、additional modulesを推測して`config.local.json`へ書かないこと。
- 上記2件のコード修正後、監督レビューを先に受けること。
- 実Profile追加は、ユーザーが使用するCheckpointと必要moduleを確認した別の運用工程とする。
- 実機options POST、Checkpoint切替、生成Smoke Test、3030／Neo再起動は追加修正中に行わない。

## 検証

最低限、以下を実行すること。

```text
npm run check
node --test test/task22.test.js test/task20.test.js test/ui-shell.test.js
npm test
git diff --check
```

作業後は、変更ファイル、healthのactive Profile判定、managed/preloadedの相違、UIのselected/active分離、追加テスト、全検証結果を報告すること。

# Task 21 Forge Neo Checkpoint再読込ボタンが機能しない

更新日: 2026-08-13
状態: **修正確認済み／監督レビュー完了・最終承認**

## 現象

Forge Neo選択中に生成設定のCheckpoint「再読込」を押しても、Checkpoint一覧が更新されない。

## 原因1: MouseEventをRuntime contextとして渡している

現在のイベント登録:

```js
elements.refreshCheckpointsButton.addEventListener("click", loadCheckpoints);
```

`loadCheckpoints(context = runtimeRequestContext())`は第1引数をRuntime request contextとして扱う。click時にはMouseEventが第1引数へ渡るため、GET完了後の次の判定がfalseになる。

```js
if (!isRuntimeContextCurrent(context)) return false;
```

その結果、HTTP GET自体が成功してもresponseをUIへ適用せず終了する。ReForge／Neo共通のUI不具合である。

## 原因2: Neoの正式なCheckpoint再走査APIを呼んでいない

現状の`loadCheckpoints()`は`GET /api/checkpoints`だけを行う。これは現在Neoが保持するcatalogの再取得であり、Checkpointディレクトリの再走査ではない。

実Forge NeoのOpenAPIには次の正式endpointが存在する。

```text
POST /sdapi/v1/refresh-checkpoints
GET  /sdapi/v1/sd-models
```

今回GETで確認した実状態:

- Neo direct `/sdapi/v1/sd-models`: 11件
- Local Image Chat `/api/checkpoints?runtimeId=forge-neo-anima`: 設定済みAnima allowlist 1件
- Neo／3030のhealthは正常

固定allowlist 1件はTask 20の安全契約であり、再読込不具合とは別である。再読込後も任意の11モデルを公開・選択可能にしてはならない。複数モデル対応はTask 22「Forge Neo Multi-Profile Runtime」で別途実装する。

## 修正要件

優先度: **P1**

1. click handlerを無引数wrapperへ変更し、MouseEventをcontextとして渡さない。

```js
elements.refreshCheckpointsButton.addEventListener("click", () => void refreshCheckpoints());
```

2. 初期読込／Runtime切替用の`loadCheckpoints(context)`はGET-onlyのまま維持する。画面起動のたびにprovider refreshを発生させない。
3. ユーザーが「再読込」を押した場合だけ使用する`refreshCheckpoints()`を分離する。
4. BackendへRuntime-awareなCheckpoint refresh endpointを追加する。既存命名に合わせて、例えば次を使用する。

```text
POST /api/checkpoints/refresh?runtimeId=forge-neo-anima
```

5. Forge Neo providerは`POST /sdapi/v1/refresh-checkpoints`を1回だけ実行し、その後に既存`listCheckpoints()`で再取得・固定allowlist解決を行う。
6. ReForgeについては既存挙動を確認する。正式refresh endpointを安全に共通利用できる場合だけprovider methodへ共通化する。既存ReForgeでGET再取得だけが正本なら、Task 20のために挙動を無理に変更しない。
7. `refreshCheckpoints`をRuntime providerの小さなoptional methodとして追加し、route内へNeo URLやprovider固有payloadを記述しない。
8. refreshはcatalog再走査だけに限定する。次を行わない。
   - options POST
   - Checkpoint切替
   - preset変更
   - additional modules変更
   - Job作成
   - ReForgeへのfallback
   - provider独自retry
9. refresh後もNeo公開Checkpointは設定済み固定allowlistだけとする。11件の任意CheckpointをUI/APIへ公開しない。
10. configured Anima Checkpointがrefresh後も見つからない場合は、安全なエラーを返す。absolute path、Neo URL、stack、raw provider responseを公開しない。
11. 生成中およびRuntime切替中はボタンをdisabledにする既存仕様を維持する。
12. refresh中表示、成功時の使用中表示、失敗時のエラー表示を既存UIへ反映する。
13. response適用前に現在のRuntime token/contextを再確認し、途中でRuntimeが変わった場合は古い結果を捨てる。
14. Prompt、LoRA選択、Seed、生成設定、候補、履歴を変更しない。

## 変更対象候補

- `public/app.js`
- `src/generation-runtimes.js`
- `src/forge-neo.js`
- `src/reforge.js`（既存契約上必要な場合だけ）
- `src/server.js`
- `test/task20.test.js`
- `test/ui-shell.test.js`
- `docs/CURRENT_TASK.md`（状態行のみ）

新規依存、UI全面変更、API v1変更、History変更、Generation Runtime変更は不要。

## 必須テスト

1. click handlerがMouseEventを`loadCheckpoints`のcontextへ渡さない。
2. 初期loadとRuntime切替のCheckpoint読込はrefresh POSTを行わない。
3. Neoの手動再読込で`POST /sdapi/v1/refresh-checkpoints`が1回だけ呼ばれる。
4. POST後にGET catalogを再取得する。
5. refresh前に未検出、refresh後に検出されたconfigured Checkpointを公開一覧へ反映できる。
6. refresh後も固定allowlist外のCheckpointを公開しない。
7. refreshはoptions POST、Checkpoint切替、module／preset変更、生成を行わない。
8. Runtimeが途中で切り替わった場合に古いresponseをUIへ適用しない。
9. Neo refresh失敗時にsafe errorとなり、内部path／URL／stackを返さない。
10. ReForgeの既存Checkpoint取得・切替が回帰しない。
11. `npm run check`、Task20／UI関連test、`npm test`、`git diff --check`が成功する。

## 実機確認

監督再レビュー後、追加画像生成なしで実施する。3030への反映が必要ならactive jobs 0を確認し、ユーザー許可後に3030だけを通常再起動する。7860は再起動しない。

1. Neoへ新規Checkpointを配置済みの状態で再読込を押す。
2. Neoのrefresh endpointが成功する。
3. configured Anima Checkpointが公開一覧・使用中表示へ反映される。
4. allowlist外のCheckpointはLocal Image Chatの選択肢へ増えない。
5. options／checkpoint／modulesが前後不変である。

---

# Task 20 追加修正の監督最終確認

更新日: 2026-08-12
状態: **修正確認済み／Task 20最終承認**

## 結論

直前レビューで指摘した2件は修正された。

1. installed LoRA側のbasename衝突を事前indexで判定し、別folderの同名LoRAへ誤ったRegistryをfallback結合しない。
2. Forge Neo health診断を生成用timeoutから分離し、既定5秒・最大30秒の短い上限で終了する。生成・activationの既存timeoutは維持する。

監督側で同一再現条件を再実行し、次を確認した。

- `FolderA/shared`と`FolderB/shared`がinstalled、RegistryはFolderAだけの場合、FolderAだけが結合されFolderBは未結合になる。
- generation timeout 900000ms、health timeout 30ms、never-resolving fetchでもhealthが約44msで安全なoffline DTOへsettleする。
- raw error、stack、Runtime URLは公開されない。

検証結果:

- `npm run check`: 成功
- `node --test test/task20.test.js test/ui-shell.test.js`: 58 passed／0 failed
- `npm test`: 454 passed／0 failed
- `git diff --check`: whitespace errorなし。LF／CRLF warningのみ

Task 20のコード変更は最終承認とする。追加画像生成は不要。実行中3030へ最新コードを反映し、Runtime selector・Neo LoRA folder表示を確認するには、active jobs 0を確認したうえで3030だけを通常再起動する。Forge Neo 7860の再起動は不要。

---

# Task 20 Runtime／Neo LoRA追加修正の監督再レビュー

更新日: 2026-08-12
状態: **追加修正必要／2件**

## レビュー結論

Runtime selectorのlive health反映、active Runtimeのhealth表示、Runtime別recovery文言、Neo LoRA folder導出、NeoへのRegistry merge、Neo再読込のGET再取得は実装されている。関連テスト57件、構文検査、差分空白検査は成功した。全テストは初回に既存server-recovery testが一時失敗したが、単独再実行と全体再実行はいずれも成功し、最終結果は453 passed／0 failedだった。

ただし、指示済みの曖昧LoRA Registry要件を満たさない再現可能な不具合1件と、live health導入に伴う画面初期化停止リスク1件が残る。Task 20の最終承認は保留する。

## P1: 別folderの同名LoRAへ誤ったRegistryが結合される

対象:

- `src/civitai.js`の`mergeWithInstalled()`／`findRegistryEntry()`
- `test/task20.test.js`

現在のbasename fallbackはRegistry側の候補数だけで一意性を判定している。installed LoRA側の同名重複を考慮していない。

再現条件:

```text
installed:
  FolderA/shared
  FolderB/shared

registry:
  FolderA/shared だけ登録済み
```

実行結果:

```text
FolderA/shared -> FolderAのRegistry（正しい）
FolderB/shared -> FolderAのRegistry（誤り）
```

これにより、FolderB側へFolderAの表示名、character分類、Trigger Words、Negative Words、衣装プリセットが誤適用される。既存テストは「同basenameのRegistry entryが2件ある場合」だけを確認しており、「installedが2件、Registryが1件」のケースを検出できていない。

修正要件:

1. Registry mergeはinstalled LoRA一覧全体のrelative name／basename衝突も考慮する。
2. relative name完全一致を最優先する。
3. basename fallbackは、対象basenameがinstalled側でもRegistry側でも一意に解決できる場合だけ許可する。
4. folderが異なるLoRAへ別folderのRegistryをfallback結合しない。
5. ReForgeとNeoの既存の一意なbasename fallbackは維持する。
6. `mergeWithInstalled()`の外部契約は変えず、内部で事前indexを構築する最小変更を優先する。
7. 上記再現条件をそのまま回帰テストへ追加し、FolderB側の`registry`が未設定であることを確認する。

## P1: live healthが生成用timeoutを使い、初期画面を長時間停止できる

対象:

- `src/forge-neo.js`の`checkHealth()`／`readActivationCatalog()`
- `test/task20.test.js`

`loadConfig()`は初期catalog読込より前に`GET /api/runtimes`をawaitする。`/api/runtimes`は`runtimeRegistry.healthAll()`を呼び、Forge Neoの`checkHealth()`はoptions／sd-models／sd-modulesを確認する。しかし各GETは生成用の`neoConfig.timeoutMs`をそのまま使用する。

実環境の`timeoutMs`は900000msである。Forge Neo processがlistenerを保持したまま応答停止した場合、画面初期化が最大15分規模で`loadConfig()`に停止し、生成画面全体へ到達できない可能性がある。接続拒否なら即時失敗するため通常テストでは見えない。

修正要件:

1. health／catalog availability確認には生成timeoutとは独立した短い上限を使う。
2. 推奨は`checkHealth()`全体へ5秒程度のAbortSignalを渡し、options／models／modulesを含む診断全体をその時間内で終了させること。
3. generation、managed-options activation、txt2imgの既存900000ms timeoutは変更しない。
4. health timeout時は既存の安全な`available:false`、`ok:false`、公開用errorへ変換する。
5. raw timeout、Neo URL、stackを公開しない。
6. retry、process restart、Runtime自動生成fallbackを追加しない。
7. never-resolving fetch fixtureで`checkHealth()`が短い上限内にsettleするテストを追加する。テストを5秒待たせず、health timeoutをdependency/configとして短縮可能にするかfake timer／abort-aware fixtureを使う。
8. `/api/runtimes`がNeo応答停止時にも有限時間でresponseを返すことを確認する。

## 維持する実装

以下は今回の追加修正で戻さない。

- `/api/runtimes`のlive health DTOとstable Runtime order
- offline optionのdisabled表示とonline default fallback
- active Runtimeを表示するheader health
- switch失敗時のform／catalog rollback
- ReForge legacy health field
- Forge Neo／ReForge別のrecovery文言
- Neo LoRAの既知marker以下だけをfolderへ公開する処理
- Neoへの共通Registry merge
- Neo再読込をprovider list GETとして扱う処理
- absolute path、Runtime URL、stackの非公開

## 必須検証

```powershell
npm run check
node --test test/task20.test.js test/ui-shell.test.js
npm test
git diff --check
```

コード修正後も実生成は不要。3030／7860の再起動や実データ変更は、監督再レビュー前には行わない。

---

# Task 20 Forge Neo LoRA階層・既存管理情報の欠落

更新日: 2026-08-12
状態: **追加修正必要／実Neoカタログで原因確認済み**

## 現象と実測

Forge Neo選択時にLoRAがRoot相当へ潰れ、既存のフォルダ単位・キャラクター単位で確認できない。

実Neo `GET /sdapi/v1/loras`とLocal Image Chat `GET /api/loras?runtimeId=forge-neo-anima`を読み取り専用で比較した。

- Forge NeoはLoRAを93件返している
- raw responseの`path`には`models/Lora/`以下の相対階層を導出できる情報がある
- 例: `Anima/Character`、`Anima/Style`、`SDXL_Illustrious_NoobAI/Character/Arknights`、`.../Style`
- 現在の`src/forge-neo.js normalizeLora()`は全件を`folder: ""`、`category: "direction"`へ固定する
- 3030の公開LoRA DTOも93件すべてfolder空、direction扱いとなる
- `GET /api/loras`と`getInstalledLoras()`はCivitai／手動RegistryのmergeをReForgeだけに限定しており、Neoでは既存表示名、分類、Trigger Words、衣装プリセット等が結合されない

LoRAファイルがNeoから欠落しているのではない。**Neo用normalizerとprovider ID分岐により、階層と既存管理情報が公開DTOから失われている**。

## 修正要件

優先度: **P1**

1. Forge NeoのLoRA正規化でも、既存ReForgeの安全な`normalizeLora()`／folder推定規則を正本として再利用するか、同じ純粋helperへ共通化する。仕様コピーを二重管理しない。
2. raw absolute `path`は比較・相対folder導出にだけ使用し、公開DTO、log、error、History、MCPへ出さない。
3. `models/Lora`、`models/Loras`、`models/LyCORIS`相当の既知markerより後ろだけをrelative folderとして扱う。marker不明時にabsolute path全体をfolderへ出さない。
4. Root直下のLoRAだけは`folder: ""`のままとする。今回の実Neo catalogにはRoot直下は0件で、93件すべてサブフォルダに存在する。
5. `Character`／`Characters`／`Chara`／`キャラ`系folderは既存規則どおりcharacter categoryにし、それ以外はdirectionとする。
6. Neoのinstalled LoRAにも既存`civitai.mergeWithInstalled()`を適用し、設定画面で登録済みの表示名、分類、Trigger Words、Negative Words、衣装プリセット、preview等を二重管理せず再利用する。
7. Registry mergeはRuntime IDではなく、安全に正規化済みのinstalled LoRA DTOへ共通適用する。ReForgeの既存結果を変えない。
8. 同名basenameが別folderに存在する場合に誤ったRegistryを結合しない。relative nameが利用可能なら最優先し、basename fallbackは一意に解決できる場合だけにする。曖昧な場合は未結合のまま安全に表示する。
9. 生成へ送るLoRA identifierはNeo APIが受理する既存`name`を維持する。表示folderやRegistry relativeNameを勝手にpromptの`<lora:...>`名へ置換しない。
10. Runtime切替時、ReForgeとNeoの同名LoRAを自動的に同一物と断定しない。現在Runtimeに存在しない選択は既存仕様どおり解除し、存在するものだけ保持する。
11. Neoで「再読込」操作が未対応のままなら、失敗するPOSTを有効表示しない。依存追加なしの最小案として、Neoでは通常のGET再取得として扱うか、補助文付きでdisabledにする。ReForgeの`refresh-loras`挙動は維持する。
12. LoRA install root、ファイル移動、Civitai追加は既存ReForge管理rootの機能であることを明示し、Neo Runtime選択だけで別rootへファイル操作しない。

## 変更対象候補

- `src/forge-neo.js`
- `src/reforge.js`（純粋normalizer/helperの再利用に必要な最小変更のみ）
- `src/server.js`
- `src/civitai.js`（同名basename曖昧性を直す必要がある場合のみ）
- `public/app.js`（Neo再読込表示のみ）
- `test/task20.test.js`
- `test/ui-shell.test.js`
- `docs/CURRENT_TASK.md`（状態行のみ）

無関係なLoRA保存形式、設定画面編集、生成Prompt、Runtime通信、History、API v1、MCP、依存関係は変更しない。

## 必須テスト

1. Neo absolute pathから`models/Lora`以下だけをfolderへ導出する。
2. absolute prefix、drive letter、ユーザー名、package pathが公開DTOへ出ない。
3. `Anima/Character/Vtuber`をfolderとして保持しcharacter分類する。
4. `Anima/Style`をdirection分類する。
5. Root直下はfolder空のまま安全に扱う。
6. path marker不明時はabsolute folderを公開しない。
7. Neoでも既存Registryの表示名、分類、Trigger Words、衣装プリセットをmergeできる。
8. 同一basenameが複数folderにある場合に誤mergeしない。
9. promptへ送るNeo LoRA nameは変更されない。
10. ReForgeの既存LoRA folder、Registry merge、refreshが回帰しない。
11. Neoの再読込操作がエラー導線として残らない。
12. `npm run check`、Task20／UI関連test、`npm test`、`git diff --check`が成功する。

## 実機再確認

修正後の画像生成は不要。3030反映後、Neoを再起動せずGETとUIだけで確認する。

- Neo LoRA 93件を維持
- `Anima/Character`等のfolder groupが表示される
- 登録済みCharacter LoRAがcharacter分類・既存表示名・Trigger／衣装情報付きで見える
- 公開responseにabsolute pathがない
- Runtime切替後も現在Runtimeに存在する選択だけが安全に維持される

---

# Task 20 Runtime切替時の接続状態表示・選択制御

更新日: 2026-08-12
状態: **追加修正必要／Runtime実生成経路は承認済み**

## 現象と確認結果

ユーザーがRuntime selectorで切り替えた際に接続エラーとなった。読み取り専用で実状態を確認した結果、Forge Neoの接続は切れていない。

- Local Image Chat: 3030／PID 113504で稼働
- Forge Neo: 7860／PID 88208で稼働、health成功、progress 0
- ReForge: 設定先7861にlistenerなし、health失敗
- `/api/health`はReForgeをoffline、Forge Neoをonlineとして正しく返す
- `/api/runtimes`および`/api/config`のRuntime descriptorは、live healthではなく設定上のenabled状態を`available`として返す
- UIはdescriptorの`available`だけでoptionをdisabled判定するため、停止中のReForgeも選択可能に見える
- header health表示もReForge固定で、active RuntimeがForge Neoの場合に誤解を招く

したがって根本原因はNeoの切断ではなく、**設定済みRuntimeと現在接続可能なRuntimeをUI/API境界で区別していないこと**である。

## 修正要件

優先度: **P1（Runtime selector）／P2（表示文言）**

1. Runtime selectorへ渡すavailabilityはlive healthを反映する。
2. ReForgeがofflineでForge Neoがonlineの場合、ReForge optionをdisabledにし、Forge Neoを選択・維持する。
3. offline Runtimeを選択したsaved preferenceが残っている場合、接続可能なdefault Runtime、なければ先頭の接続可能Runtimeへ安全にfallbackする。
4. selector上ではoffline状態が利用者に分かる補助表示を行う。ライムの成功表示はonline Runtimeだけに使う。
5. Runtime切替途中でhealth/catalog取得に失敗した場合は、既存のtoken・rollback処理で直前の有効Runtimeへ戻す。Prompt、生成設定、LoRA、生成枚数を失わない。
6. header health表示をReForge固定にしない。active Runtimeのlabelと接続状態を正しく表示する。ReForge legacy health fieldはAPI後方互換のため維持する。
7. `/api/config`を静的descriptorのまま維持する場合は、初期catalog読込より前にlive `/api/runtimes`または`/api/health`を取得・mergeする。初期表示のraceでoffline Runtimeのcatalogを読まないこと。
8. `/api/runtimes`をlive health化する場合は非同期routeとして`runtimeRegistry.healthAll()`を再利用し、公開DTOのallowlist、安定したRuntime順序、内部URL・port・path・raw error非公開を維持する。
9. transient health snapshotを理由にRuntime Registryの`resolve()`自体を恒久的に拒否する設計にはしない。live availabilityはUI選択補助であり、実生成時の正本は各providerの既存readinessである。
10. 新しいretry、process restart、自動Runtime fallback生成、ReForgeへの暗黙fallbackは追加しない。
11. 直下にある既存P2「Neo失敗時にReForge固定文言になる問題」も同じ修正パスで完了する。

## 変更対象候補

- `src/server.js`（live Runtime DTO endpointが必要な場合のみ）
- `public/app.js`
- `test/task20.test.js`
- `test/ui-shell.test.js`
- `docs/CURRENT_TASK.md`（状態行のみ）

無関係なUI、Generation Runtime、History、ReForge／Neo provider通信、依存関係は変更しない。

## 必須テスト

1. ReForge offline／Neo onlineで、ReForge optionがdisabled、Neoが選択される。
2. Neo offline／ReForge onlineで、Neo optionがdisabled、ReForgeが選択される。
3. saved Runtimeがofflineの場合にonline defaultへfallbackする。
4. Runtimeが読込後にofflineになった場合、health更新でselectorとheaderが更新される。
5. active Forge Neo時のheaderがForge Neo接続成功を示し、ReForgeだけの失敗表示にならない。
6. switch失敗時に直前Runtimeへrollbackし、フォーム状態を保持する。
7. `/api/health`の既存`reforge` fieldを維持する。
8. Runtime DTOへ内部URL、port、absolute path、stack、provider raw errorを出さない。
9. Neo接続切断時のJob messageはForge Neo、ReForge接続切断時は既存ReForge文言を返す。
10. `npm run check`、Task20/API/UI関連test、`npm test`、`git diff --check`が成功する。

## 実機再確認

コード修正後の追加画像生成は不要。3030への反映に再起動が必要ならactive jobs 0を確認し、ユーザー許可後に3030だけを通常再起動する。7860は再起動しない。次をGET/UI操作だけで確認する。

- Forge Neoがonline、ReForgeがofflineとして表示される
- ReForgeは選択不能または選択時に安全にNeoへ戻る
- Forge Neoを選んだ状態でcatalogが正常表示される
- Promptと現在設定がRuntime表示更新で失われない

---

# Task 20 Forge Neoメモリ復旧後の実機Smoke Test成功

更新日: 2026-08-12
状態: **Runtime経路は実機承認／接続失敗時のRuntime別文言修正だけ継続**

## 結論

低仮想メモリの原因となったClaudeとvmmemが解放された後、Forge Neoを通常起動し、追加生成1件だけでSmoke Testを再実施した。API v1からJobManager、Forge Neo、History、画像保存、original／thumbnail配信まで成功した。Checkpoint、preset、required modulesは前後不変で、preloaded契約を維持した。

## 成功した実生成

- Local Image Chat PID: 113504
- Forge Neo PID: 88208
- Job ID: f6a8a9b3-e89a-412a-8766-a57e6d14a015
- History ID: 604b33dc-2a68-471f-85e7-d11c571dd2ff
- Image ID: 6ed4db43-8784-404a-91df-cae4a7105d37
- runtimeId: forge-neo-anima
- provider: forge-neo
- request: 640×896、12 steps、CFG 1、Euler、automatic、seed 20260813
- LoRAなし、Hiresなし、IP-Adapterなし、candidateCount 1
- HTTP受付: 202 queued
- status: queued／running／done
- progress: 1

## 配信・History

- original: HTTP 200、image/png、852507 bytes
- thumbnail: HTTP 200、image/webp、9732 bytes
- History detailのruntime: forge-neo-anima／forge-neo
- Historyのimage IDはJob resultと一致
- original追加1、thumbnail追加1
- History新規1件。500件保持上限により総容量が同一でもhashは更新
- Favorite変更0
- Discord generationAutoSendはfalse、通知なし
- 公開Job responseに絶対path、Neo URL、base64、data URL、stackなし

## Runtime状態

- Checkpoint前後不変
- forge_preset前後不変
- additional modules前後不変
- 生成後Forge Neo progress 0、jobなし
- Local Image Chat active jobs 0
- 3030と7860は生成後も同じPIDで生存
- 再試験時間帯に新しいWindows Resource Exhaustion Eventなし

## API v1 Job resultのruntimeについて

GET generations/:idのresultはTask 11からの既存allowlistどおりhistoryIdとimagesだけを返し、runtimeを含めない。内部Job resultとHistory detailにはruntimeが保存されている。Task 20で既存Job result DTOを拡張する要件ではないため、後方互換を優先し、追加修正は要求しない。Runtime確認の正本はGET history/:idとする。

## 残修正

失敗時にNeo Jobのrecovery messageがReForge固定だった問題だけを継続する。直前の「Task 20 実機Smoke Test失敗の調査結果」に記載したP2要件をLunaが実装し、自動テストを通すこと。成功経路の再生成Smoke Testは不要。

---

# Task 20 実機Smoke Test失敗の調査結果

更新日: 2026-08-12
状態: **環境復旧と小規模追加修正が必要／追加生成禁止**

## 実施結果

config.local.jsonへForge Neo 7860、ReForge 7861、default forge-neo-anima、activationMode preloadedを設定し、Local Image Chat 3030だけをPID 102212からPID 113504へ通常再起動した。Forge Neo PID 79156は再起動せず、既存の外部生成完了とprogress 0を確認してから、API v1で低負荷txt2imgを1件だけ開始した。

- Job ID: f86864d0-070e-43f6-b68a-4732b7fc7581
- runtimeId: forge-neo-anima
- 768×1024、16 steps、CFG 1、Euler、automatic
- candidateCount 1、LoRAなし、Hiresなし、IP-Adapterなし
- 202 Accepted
- running progress 0.26から0.89まで進行
- 0.89でfailed
- Forge Neoの7860 listenerとPython PID 79156が終了
- Local Image Chat 3030 PID 113504は生存
- History追加0、Local Image Chat original追加0、thumbnail追加0、Favorite変更0
- Checkpoint変更やoptions POSTを意図的に行っていない

## 環境上の根本原因

Windows System Event ID 2004が生成終了時刻に記録され、低仮想メモリ状態を検出している。

- python.exe PID 79156: 約16.65 GB
- claude.exe PID 97020: 約7.82 GB（イベント記録値）
- vmmem PID 98384: 約4.30 GB
- 物理RAM: 約15.93 GB
- pagefile: 約49.15 GB

Forge Neoは生成終盤のdecode／保存付近でメモリ圧迫により終了したと判断する。HTTP Runtime、Checkpoint照合、Job Queueの失敗ではない。Forge Neoを再起動する前に、不要なClaude process、WSL／Docker等のvmmem、その他大容量processをユーザー判断で終了する。Codexから勝手に終了しない。

## 追加コード修正

優先度: **P2**

Neo Job失敗時のlegacy Job message／recoveryが次を返した。

- ReForgeとの接続が切れました
- reason: ReForgeとの接続が切れました

実際のRuntimeはForge Neoである。Runtime Provider導入後もrecovery表示がReForge固定になっているため、利用者が原因を誤認する。

修正要件:

1. generation recovery／Job messageの接続先名称をgenerationのruntimeIdまたはprovider descriptorから決定する。
2. Forge NeoではForge Neoとの接続が切れたことを表示する。
3. ReForgeの既存文言と既存recovery behaviorは維持する。
4. API v1の安全なGENERATION_FAILED DTO、stack非公開、provider raw error非公開を維持する。
5. 新しいretry、process restart、fallbackを追加しない。
6. Neo connection terminationのJob testでmessage／recoveryにReForgeが含まれず、Forge Neoが含まれることを確認する。
7. ReForge connection terminationの既存testまたは追加testでReForge文言が維持されることを確認する。

対象候補:

- src/services/generation-service.js
- test/task20.test.js
- docs/CURRENT_TASK.md状態行

## 再試験条件

1. ユーザーが不要な大容量processを終了する。
2. Stability MatrixからForge Neoを通常起動する。
3. 7860 listener、Anima Checkpoint、preset、modules、progress 0をGET確認する。
4. 上記P2修正を監督レビューする。
5. 追加生成は1件だけ。最初はメモリ余裕を優先し、必要なら640×896または768×1024を選ぶ。
6. 生成失敗時は再送せず再調査する。

---

# Task 20 Checkpoint表記互換修正の再レビュー・実機GET診断結果

更新日: 2026-08-12
状態: **修正確認済み／コード最終承認／実機設定とSmoke Testは別許可待ち**

## 結論

hashなしoptionsとhash付きcatalog titleの実環境差分は解消された。固定Checkpoint allowlistを維持したまま比較identityだけを正規化し、managed-optionsのPOST値も設定済み固定identifierへ変更されている。実Forge NeoへGETだけのpreloaded診断を再実行し、readiness成功、active Checkpoint一致、options POST 0回を確認した。追加コード修正は要求しない。

## 実機GET診断

対象:

- Forge Neo: http://127.0.0.1:7860
- activationMode: preloaded
- configured Checkpoint: sd\\oneObsessionAnima_v30.safetensors
- preset: anima
- modules: qwen_image_vae.safetensors、oneObsessionAnima_v30_txt.safetensors

結果:

- catalog取得成功
- activeCheckpoint: sd/oneObsessionAnima_v30.safetensors [ed32d6584f]
- prepareGeneration成功
- readiness checkpointも同一公開identifier
- 使用HTTP methodはGETだけ
- GET options、sd-models、sd-modulesだけを使用
- options POST 0回
- txt2img 0回
- process停止・再起動0回

## コード確認

- 比較用正規化は末尾の空白付き角括弧hex hashだけを除去する。
- 一般の括弧、非hex suffix、Checkpoint本文、フォルダ名は変更しない。
- catalog解決は設定済み固定Checkpointに対して行い、任意Checkpointを許可しない。
- requestNameはcatalog表示titleではなく設定済み固定identifierを使用する。
- capabilitiesの公開identifierはgeneration requestへ戻せる。
- 絶対filenameは公開DTOへ出ない。
- module basename比較は既存のまま維持されている。

## 監督検証

- node --test test/task20.test.js: **19 passed / 0 failed**
- npm run check: 成功
- Task 20＋API＋MCP＋UI関連: **93 passed / 0 failed**
- npm test: **450 passed / 0 failed**
- git diff --check: 成功（LF/CRLF warningのみ）

## 次工程

最初の実機Smoke Testでは、現在のAnima状態を変更しないpreloadedを採用する。現状態が一致しているため、managed-optionsの不一致POSTを意図的に発生させる必要はない。

Smoke Test前に次を別途確定する。

1. Forge Neoを現在の7860で維持するか。
2. 停止中のReForgeを7861へ割り当てるか。
3. config.local.jsonへNeo Runtime設定を追加するか。
4. Task 20未反映の3030をactive jobs 0で通常再起動してよいか。

上記の明示許可までは、config作成、3030再起動、options POST、実生成を行わない。

---

# Task 20 Forge Neo実環境GET調査で判明したCheckpoint表記互換修正

更新日: 2026-08-12
状態: **再現確認済み／追加修正必須／options POST・実生成は禁止**

## 結論

Forge Neoは実際に起動しており、GET API、固定Checkpoint、Anima preset、required modulesの実値を確認できた。しかし、実環境のCheckpoint表記は、catalog titleだけにhash suffixがあり、optionsの現在値にはhash suffixがない。現Providerは両者を同一Checkpointと判定できないため、Task 20のコード承認を一旦取り下げる。以下を修正するまでoptions POSTと実生成Smoke Testを行わないこと。

## 実環境で確認した値

- Forge Neo package: Stable Diffusion WebUI Forge - Neo
- 現在の待受: http://127.0.0.1:7860
- forge_preset: anima
- optionsのsd_model_checkpoint: sd\\oneObsessionAnima_v30.safetensors
- catalog title: sd\\oneObsessionAnima_v30.safetensors [ed32d6584f]
- catalog model_name: sd_oneObsessionAnima_v30
- catalog filename: oneObsessionAnima_v30.safetensorsの絶対path
- required modules:
  - qwen_image_vae.safetensors
  - oneObsessionAnima_v30_txt.safetensors
- sampler 21件、scheduler 17件、LoRA 1件
- generation progress 0、Forge Neo側jobなし
- Local Image Chat PID 102212、Forge Neo listener PID 79156
- config.local.jsonは未作成
- 稼働中3030はTask 20反映前で、api/runtimesが404、capabilitiesにruntimesがない

## 再現結果

実環境へGETだけを行うpreloaded Provider診断で、listCheckpointsはcatalogを取得できたが、prepareGenerationは次で失敗した。

- code: NEO_ANIMA_ACTIVATION_FAILED
- message: Forge NeoのAnima Checkpointが有効ではありません
- HTTP相当: 503

原因は、optionsのhashなしCheckpointとcatalog titleのhash付きCheckpointをactivationMatches／assertActivationが比較しているためである。managed-optionsでは、正しい現在状態でも不要なoptions POSTへ進む可能性があり、POST後にoptionsがhashなし表記へ戻れば再検証も失敗する。

## Luna向け追加修正

優先度: **P1**

対象候補:

- src/forge-neo.js
- test/task20.test.js
- docs/CURRENT_TASK.mdの状態行

要件:

1. Checkpointの同一性判定では、catalog title末尾のhex hash suffixを比較用にだけ正規化する。
2. 対象は末尾の角括弧付きhex hashに限定し、一般の括弧、Checkpoint本文、フォルダ名、大小文字以外の文字列を勝手に除去しない。
3. optionsの現在値は、固定allowlistとして設定されたcheckpoint、catalog filename、catalog titleの正規化identityと照合する。
4. managed-optionsのPOSTで送るsd_model_checkpointは、catalog表示titleのhash付き文字列ではなく、設定済み固定Checkpoint identifierを使用する。
5. public capabilitiesで返したCheckpoint identifierをgeneration requestへそのまま戻せる契約は維持する。
6. 実環境と同じfixtureを追加する。
   - options: hash suffixなし
   - model title: hash suffixあり
   - model_nameあり
   - filenameは絶対path
   - modulesはmodel_nameと絶対filename
7. 上記fixtureでpreloadedが成功し、options POSTが0回であること。
8. 同じfixtureでmanaged-optionsも既に一致と判定し、options POSTが0回であること。
9. 本当に別Checkpointの場合だけoptions POSTが1回となり、bodyのCheckpointが固定設定値であること。
10. activeCheckpoint判定も同一Checkpointとして扱うこと。
11. 絶対pathを公開DTOやerrorへ出さない既存契約を維持する。
12. module basename比較は実環境形式で既に成功しているため、無関係に作り直さない。

禁止:

- 実Forge Neoへのoptions POST
- 実生成
- 3030／7860の停止・再起動
- hashを無視して任意Checkpointを許可すること
- 固定Checkpoint allowlistの緩和
- ReForge側Checkpoint比較の無関係な変更

検証:

- npm run check
- node --test test/task20.test.js
- 関連API／MCP／UIテスト
- npm test
- git diff --check

修正後は、監督が同じ実環境へpreloadedのGET診断だけを再実行する。これが成功するまでmanaged-optionsと実生成へ進まないこと。

---

# Task 20 Forge Neo / Anima Runtime 追加修正の再レビュー結果

更新日: 2026-08-12
状態: **4指摘の修正確認済み／コード最終承認／実機Smoke Testは別承認待ち**

## 再レビュー結論

前回の4指摘は、実装とテストの両方で解消を確認した。Task 20のコードは最終承認とする。実3030、ReForge、Forge Neoの停止・再起動・実生成は、この再レビューでは行っていない。実機Smoke Testは接続先、固定Checkpoint、preset、required modulesの実値を確定し、active jobsが0であることを確認してから別工程で行う。

## 確認した修正

1. Forge Neoを指定した旧同期APIは、既存JobManagerへ合流した。完了時は従来のgeneration resultを返し、failed・cancelled・abort時はresponse待機を残さない。ReForgeの従来同期経路は維持されている。
2. 履歴レシピの復元はRuntime切替とRuntime固有catalog取得を待ってから進む。request tokenで遅いresponseの反映を防ぎ、失敗時は旧Runtimeと旧フォームstateへ戻す。切替中の生成・LoRA操作も抑止される。
3. Hiresの表示・実行判定は現在のselectorではなく生成元Runtimeを使う。Neo候補・Neo履歴では無効となり、ReForge履歴ではReForge Runtime IDを明示して送る。Backend guardも維持されている。
4. connection reset/refused、malformed response、timeout、activation failure、preloaded一致、API 4xx、MCP runtimeId伝搬、safe History runtime DTOの回帰テストが追加された。

## 監督再検証

- npm run check: 成功
- 関連テスト: **92 passed / 0 failed**
- npm test: **449 passed / 0 failed**
- git diff --check: 成功（LF/CRLF warningのみ、whitespace errorなし）

## 非ブロッカー

loadRecipeFields内に、Runtime切替を待った後の旧非同期切替ブロックが残っている。先行するensureRuntimeForRecipeが成功した場合は条件が成立せず、失敗した場合はその前にreturnするため、現在は実行されない死コードである。実機Smoke Testを止める問題ではない。将来その周辺を触る際に削除できるが、Task 20承認のための追加修正は要求しない。

---

# Task 20 Forge Neo / Anima Runtime 監督レビュー追加修正

更新日: 2026-08-12
状態: **実装確認済み／追加修正必須／実機Smoke Test禁止継続**

## レビュー結論

Runtime Provider、coordinated options POST、safe History metadata、API／MCPの`runtimeId`対応という主要設計は反映されている。`npm run check`、関連テスト、全テスト（440 passed / 0 failed）、`git diff --check`も成功した。

ただし、モデル遷移の直列化とUIのRuntime復元に再現可能な問題が残る。以下を直すまでTask 20は最終承認せず、実3030／ReForge／Forge Neoを使うSmoke Testを開始しないこと。

## 1. Neoの同期旧APIをJobManagerの外で実行しない

優先度: **P1**

対象候補:

- `src/services/generation-service.js`
- 必要なら`src/server.js`
- `test/task20.test.js`または既存integration test

現状の`generateLegacyNow()`は、Forge Neoを選択しても`runtime.execute()`を直接呼ぶ。`POST /api/generate`はJobManagerを経由しないため、既にqueued／runningのNeo jobがある状態で別のNeo `prepareGeneration()`、`POST /options`、`txt2img`を並行実行できる。

これは次の契約に反する。

```text
model transitionはJob実行時に行う
Neoのmodel/module transitionをserializeする
Web UI／旧API／API v1は同じJobManagerへ合流する
```

修正要件:

1. Forge Neoを指定した`POST /api/generate`も、同じJobManagerの直列Queue内で実行する。
2. 同期旧APIのresponse契約は維持し、呼出側には従来どおりgeneration resultを返す。
3. 新しいQueue、Provider専用mutex、Neo専用Job mapを作らない。既存JobManagerを正本にする。
4. ReForgeの同期旧API挙動は不要に変更しない。別processであるReForgeとNeoの間に無意味な共通model lockを追加しない。
5. queued Neo jobを意図的にblockしたmock testを追加し、同期旧APIの2件目が先行して`POST /options`または`txt2img`へ到達しないことを確認する。
6. 1件目のterminal後に2件目が開始し、responseが既存generation DTOになることを確認する。
7. cancel／failed時に待機中の同期responseがhangしないことを確認する。

`POST /api/generate`でForge Neoを黙ってReForgeへfallbackする対応、Neoだけ409で恒久拒否する対応、Runtime Provider内へ独自Queueを作る対応は禁止する。

## 2. 履歴Runtime切替を待ってからフォーム／LoRAを復元する

優先度: **P1**

対象候補:

- `public/app.js`
- `test/ui-shell.test.js`またはTask 20 UI test

現状の`loadRecipeFields()`は、履歴のRuntimeが現在値と違う場合に`void handleRuntimeChange()`を開始した直後、旧Runtimeの`installedLoras`を使ってLoRA、衣装、Prompt、Sampler等の復元を続ける。

その後、非同期の`loadLoras()`が完了すると、復元済みLoRAを削除したり、逆に旧Runtime一覧を基準に履歴LoRAを落としたりできる。`changeLoraOnly()`はcatalog切替完了前にmodalを開くため、別RuntimeのLoRA一覧を表示し得る。

修正要件:

1. Runtime切替とRuntime固有catalog取得を完了してから、履歴フォームの復元を行う。
2. `loadRecipeFields()`をasync化する場合、全call siteで復元完了を待ってから次の操作を行う。
3. 少なくとも次の導線を確認する。
   - 構図／Seed固定
   - 同Seed再生成
   - 設定複製
   - LoRAだけ変更
   - 衣装／背景／表情の派生
   - 履歴詳細からの設定読込
4. Runtime切替失敗時は旧Runtimeと旧フォーム状態を保持し、中途半端な履歴復元を行わない。
5. 切替中は生成開始やLoRA modal操作を許可しない。
6. ReForge→Neo、Neo→ReForgeの両方向で、対象RuntimeのLoRA／Sampler／Checkpoint一覧を使って復元するtestを追加する。
7. 長い通信の完了順が逆転しても、最後に選択したRuntime以外のresponseでcatalog stateを上書きしないようにする。必要ならrequest generation token等の小さい競合防止を使う。

Runtimeごとの新しい永続state基盤を追加したり、LoRAデータ形式を変更したりしない。

## 3. Hires操作の有効判定を生成元Runtimeへ結び付ける

優先度: **P2**

対象候補:

- `public/app.js`
- `test/ui-shell.test.js`またはTask 20 UI test

現状の`selectCandidate()`は常に`finishButton.disabled = false`とするため、Neo生成後にもHiresボタンが再度有効になる。handler内では拒否されるが、「Neoではunsupported操作をdisabledにして理由を表示する」というUI契約を満たさない。

また、履歴／ギャラリーのHires判定は現在選択中Runtimeを基準にしており、画像を生成したRuntimeと一致しない。

例:

- Neo履歴を表示中にactive RuntimeがReForgeなら、Neo画像へReForge Hiresを提示・送信できる。
- ReForge履歴を表示中にactive RuntimeがNeoなら、本来可能なHiresを拒否する。

修正要件:

1. candidate選択後も、`lastGeneration.runtime`がHires非対応ならHiresボタンをdisabledのまま維持する。
2. 履歴／ギャラリー操作は`generation.runtime.id`を正本にする。runtime情報のない旧Historyだけ`reforge`として扱う。
3. ReForge履歴のHires requestには生成元Runtime IDを明示し、現在のselector値へ偶然依存しない。
4. Neo履歴ではHires actionをdisabledまたは非表示にし、利用不可理由を確認できるようにする。
5. Runtime selectorを生成後に変更した場合でも、candidate／history actionの意味が変わらないtestを追加する。
6. handler内のBackend guardは防御として維持する。

## 4. Task 20の必須失敗経路とAPI／MCP mapping testを補完する

優先度: **P2**

対象候補:

- `test/task20.test.js`
- 必要に応じて`test/api-v1.test.js`
- `test/mcp-client.test.js`
- `test/mcp-tools.test.js`
- `test/ui-shell.test.js`

現在のTask 20専用testは主要happy pathを確認しているが、指示書で必須とした以下が不足している、またはtest名に対して十分に実行されていない。

追加要件:

1. Neoの`txt2img`がconnection reset／connection refused／malformed JSON／timeoutになった場合、Jobが`failed`になりHistory追加が0件であること。
2. activation失敗時もJobが`failed`、`txt2img` 0回、History追加0件であることをRuntime＋JobManager経路で確認する。現在の統合testは成功経路だけである。
3. preloadedの正常一致時に`POST /options` 0回で生成へ進めること。
4. 実Neoの形に合わせ、`/sd-modules`が`{ model_name, filename }`を返し、`filename`がabsolute pathでもbasenameだけでrequired modulesを解決できること。
5. `/sd-models`の`title`にhash suffix、`filename`にabsolute path、`options.sd_model_checkpoint`に別の安全な表記がある場合のno-op／再検証契約を固定する。異なる表記を許容するなら、configured checkpointとの同一性をcatalog内の同一record経由で比較し、任意modelを同一扱いしない。
6. API v1でunknown／disabled Runtime、Neo unsupported mode、fixed Checkpoint mismatchが想定4xx error DTOになること。
7. MCPの`generate_image`と`regenerate_image`が`runtimeId`をPOST bodyへ渡すこと。現在のTask 20 MCP testは`get_capabilities` queryだけを確認している。
8. MCP History detailのruntime DTOが`{id, provider}`だけであることを検証し、URL／path／余分なkeyを含むmalformed DTOを拒否すること。
9. 上記1〜3でProvider独自retry、silent ReForge fallback、未完了History保存がないこと。

実Neo processを落とすtestは禁止する。すべてmock HTTP server／temporary History／temporary outputsで再現する。

## 5. 変更範囲

今回の追加修正は原則として次の範囲内に収める。

- `src/services/generation-service.js`
- 必要なら`src/server.js`
- `public/app.js`
- `test/task20.test.js`
- 必要な既存API／MCP／UI test
- `docs/CURRENT_TASK.md`の状態行だけ

Forge Neo Provider本体は、上記追加testで実際の表記互換問題が判明した場合だけ最小修正する。

新規依存、package-lock更新、UI再設計、History schema変更、ReForge改修、Neo本体改変は禁止する。

## 6. 再検証

最低限:

```powershell
npm run check
node --test test/task20.test.js test/api-v1.test.js test/mcp-client.test.js test/mcp-tools.test.js test/ui-shell.test.js
npm test
git diff --check
```

実装修正中も実3030／7860／Forge Neo、実History、実outputs、config.local.jsonを使用しない。

修正完了後、`docs/CURRENT_TASK.md`の状態行だけを次へ変更する。

```text
状態: **修正完了／監督再レビュー待ち**
```

監督再レビュー前に実機Smoke Test、process再起動、commit、pushを行わない。

---

# Task 18 Chat Attachment Reference Assets 監督レビュー追加修正

更新日: 2026-08-11
状態: **修正確認済み／最終承認**

## 最終確認（2026-08-12）

下記4項目の修正反映を確認した。`npm run check`、Task 18関連テスト、全テスト（431 passed / 0 failed）、`git diff --check`はいずれも成功している。Task 18は最終承認とし、追加の実装指示はない。

実3030／7860の再起動や実データ変更は、この最終確認では行っていない。

## レビュー結論

Task 18の主要実装は共有worktreeへ反映されている。ただし、最終承認前に以下4点を修正すること。新機能追加や設計変更は行わない。

## 1. 既存画像配信へ`dotfiles: "allow"`を広げない

対象: `src/server.js`、`test/server-integration.test.js`

現在の`sendImmutableImage()`は全呼び出しで`response.sendFile(filePath, { dotfiles: "allow" })`を使用している。Reference Asset用の許可が、通常のHistory original / thumbnail配信にも広がっている。

修正要件:

1. `dotfiles: "allow"`は`isReferenceAssetId()`で分岐し、`resolveAssetPath()`で解決済みのReference Assetだけに適用する。
2. 通常History original / thumbnailはTask 18以前のdotfile拒否挙動を維持する。
3. `/outputs/.reference-assets/...`の直接配信404を維持する。
4. ドットファイル名を持つ不正・破損History fixtureが固定画像APIから公開されない回帰テストを追加する。

## 2. dedupe再取込・保存失敗で既存Assetを消さない

対象: `src/reference-assets.js`、`test/reference-assets.test.js`

現在の`writeFileAtomically()`はtemporary file作成後、既存destinationを`rm()`してから`rename()`する。同一content hashの再取込でも既存original / thumbnailを毎回置換するため、renameやthumbnail保存の失敗時に登録済みAssetを欠損させ得る。

修正要件:

1. dedupeで既存recordが見つかり、original / thumbnailが通常ファイルとして存在する場合は書き直さず、同じ公開Assetを返す。
2. 新規Assetはdestinationが存在しない前提でtemporary fileからrenameし、既存destinationを先に削除しない。
3. original保存後にthumbnail保存またはregistry保存が失敗した場合、今回新規作成したfinal fileだけをrollbackする。
4. 既存Assetの再取込失敗で既存original / thumbnail / registry recordが失われないことをfailure injectionで確認する。
5. 新規保存失敗後に`.tmp`、片側だけのorphan、registry recordが残らないことを確認する。
6. content hash dedupeの既存ID再利用を維持する。

既存データを消して再生成する方式、registry全面再構築、自動cleanup task追加は禁止する。

## 3. MCP起動時の明示`env`をAttachment Readerへ渡す

対象: `src/mcp/server.js`、必要なら`src/mcp/tools.js`、既存MCP test

`main({ env })`はHTTP clientへは渡しているが、Attachment Readerは`createMcpServer({ client })`内部で`process.env`から作成される。明示注入した`LOCAL_IMAGE_CHAT_IMPORT_ROOTS`が同じ設定源になっていない。

修正要件:

1. `main({ env })`で`createAttachmentReader({ env })`を作り、`createMcpServer({ client, attachmentReader })`へ渡す。
2. 実process起動時の`process.env`既定挙動は維持する。
3. 設定が空、または有効なabsolute rootが0件なら`ATTACHMENT_IMPORT_NOT_CONFIGURED`とする。相対pathだけで設定済み扱いにしない。
4. 注入envとglobal `process.env`が異なる場合でも、注入envだけが使われることを確認する。

## 4. 指示した一連のRuntime境界テストを追加する

対象: `test/server-integration.test.js`または`test/api-v1.test.js`、必要なら既存MCP fixture

現状はraw Asset API、MCP mapping、Asset ServiceからRuntimeへの接続を別々に確認している。しかし`CURRENT_TASK.md` 12.5で必須とした次の公開経路を、一連のテストとして通していない。

```text
temporary attachment fixture
→ allowlisted Attachment Reader / import_reference_image相当
→ raw POST /api/v1/assets/images
→ returned public Asset ID
→ POST /api/v1/generations または regenerations
→ common reference resolver
→ actual Generation Runtime
→ mock ReForge
→ temporary History
```

修正要件:

1. 上記を一連のテストとして追加し、内部Serviceへの直接Asset注入だけで代替しない。
2. mock ReForgeへ正規化PNG bytesがIP-Adapter referenceとして渡ることを確認する。
3. Historyには公開Asset IDとWeight / Start / Endだけが保存され、attachment path、元filename、absolute path、base64が保存されないことを確認する。
4. generationとregenerationの両方でreturned Asset IDを利用できることを確認する。
5. capability unavailable時にJob failed、ReForge生成0、History追加0、fallbackなしを維持する。

## 変更範囲

追加修正は原則8ファイル以内とする。

```text
src/reference-assets.js
src/server.js
src/mcp/server.js
src/mcp/attachment-reader.js
src/mcp/tools.js（必要時のみ）
test/reference-assets.test.js
test/server-integration.test.js または test/api-v1.test.js
test/mcp-tools.test.js または既存MCP server test
```

禁止: Backend DTO変更、MCP Tool追加・削除・rename、UI/CSS、ReForge、Job Manager、History schema、依存、output migration設計の変更、3030/7860再起動、実Asset import、実画像生成、実outputs/History変更、commit、push。

## 必須検証

```powershell
npm run check
node --test test/reference-assets.test.js test/api-v1.test.js test/server-integration.test.js test/mcp-client.test.js test/mcp-tools.test.js
npm test
git diff --check
```

各指摘の修正箇所、failure injection、公開経路Runtime境界テスト、検証結果、変更ファイル数を報告すること。`docs/CURRENT_TASK.md`の状態行は`**修正完了／監督再レビュー待ち**`へ更新する。

## 判定

- Task 18の主要実装は確認済み。
- 追加修正が必要なため最終承認しない。
- 実AI Host Smoke Test、3030再起動、実添付取込は引き続き禁止する。

---

# Task 18 Chat Attachment Reference Assets 実装未反映（解消済み）

更新日: 2026-08-11
状態: **解消済み／後続実装を確認**

## 確認結果

Task 18完了連絡後に作業ツリーを確認したが、`docs/CURRENT_TASK.md`は依然として次の状態だった。

```text
状態: **設計完了／Luna実装待ち**
```

また、リポジトリ全体を検索したが、次のTask 18必須symbol / ファイルは存在しない。

```text
import_reference_image
LOCAL_IMAGE_CHAT_IMPORT_ROOTS
POST /api/v1/assets/images
attachmentPath
ATTACHMENT_IMPORT_NOT_CONFIGURED
src/reference-assets.js
src/api/v1/assets.js
src/mcp/attachment-reader.js
```

`src/server.js`、`src/api/v1/router.js`、`test/server-integration.test.js`にもTask 18相当の更新は確認できない。現在のMCP ToolはTask 17までの8 Toolであり、Reference Asset import経路は追加されていない。

## Lunaへの指示

1. `docs/CURRENT_TASK.md`を正本として全文読む。
2. Task 18実装が別worktree / 別branch / 未反映状態にある場合は、この共有worktreeへ安全に反映する。
3. 未実装の場合は、`CURRENT_TASK.md`のPhase 1から実装を開始する。
4. 既存dirty差分とTask 11〜17実装を削除・巻き戻し・整形しない。
5. Task 18完了後は`CURRENT_TASK.md`の状態行だけを`**実装完了／監督レビュー待ち**`へ更新する。
6. 変更ファイル、実装契約、テスト結果を報告する。
7. 監督再レビュー前に3030/7860再起動、実Asset import、実画像生成、commit、pushを行わない。

## 判定

- Task 18は未完了。
- 実装diffが存在しないため、コードレビューとテスト再実行はまだ開始しない。
- アプリ本体の追加修正指摘ではなく、Task 18実装の反映が必要。

---

# Task 17 Reference-Guided MCP Generation レビュー追加修正

更新日: 2026-08-11
状態: **追加テスト解消／実機Smoke Test成功／Task 17最終承認**

## 実機Smoke Test最終結果

2026-08-11、ユーザーの明示許可後に実Codex CLI HostからLocal Image Chat MCPを使用し、Task 17の実機経路を1回だけ検証した。

開始時にactive jobs 0、Discord `generationAutoSend=false`、ReForge正常、active Checkpoint、output保存先を確認した。Task 17コード反映のため3030だけを1回通常再起動し、PIDは`107536`から`102212`へ変更された。7860はPID `52624`のまま再起動していない。

実行経路:

```text
get_history_item
→ get_image
→ regenerate_image（1回のみ）
→ get_generation（同一Jobを終端状態まで確認）
→ get_history_item
→ get_image
```

確認結果:

- Job ID: `a8e194b2-96c3-4c70-8464-da1a73e99acd`
- status: `queued → running → running → done`
- progress: `0.26 → 0.72 → 1`
- History ID: `4cfe5068-2f65-43ea-84dd-fb4b44da62fc`
- Image ID: `2243a5c5-5f4d-4f5c-89dc-2aa2f1520f03`
- `meta.client = mcp`
- `parentGenerationId = dae1eab9-48e1-4c57-94b2-231195a3ad4b`
- `parentImageId = 3660fdf4-6f12-48dc-a011-d32be8d84c4e`
- `ipAdapter.referenceImageId = 3660fdf4-6f12-48dc-a011-d32be8d84c4e`
- Weight `0.7`、Start `0`、End `1`
- Original: HTTP 200 / `image/png`
- Thumbnail: HTTP 200 / `image/webp`
- 終了時active jobs 0、Checkpoint変更なし、Discord送信なし、Favorite 63件で変更なし、storage変更なし
- outputはOriginal +1、Thumbnail +1の計2ファイルのみ増加
- Historyは新規派生履歴が保存され、500件上限により総件数は500のままrotation
- 通常生成へのfallback、重複再生成、cancel、Checkpoint切替はなし

視覚比較では、参照画像の全身跳躍構図、短い暗色の髪、マゼンタの瞳、濃紺スカート、星系アクセサリー、明るいステージ背景がおおむね維持された。一方で、マイク、手前へ伸ばす遠近感、衣装の一部色に差異があり、IP-Adapterが完全一致を保証しないことも確認した。

最終判定:

- Task 17のAPI v1、MCP、Generation Runtime、ReForge、History、画像配信を含む実機経路は成立した。
- Task 17を最終承認する。
- 追加コード修正は要求しない。

## 追加テスト再レビュー結果

前回指摘したRuntime境界テストは解消しました。実装コードの追加修正は不要です。

追加テストはtemporary output directory、小型PNG fixture、temporary History、mock IP-Adapter capability、mock ReForge generationを使い、実3030/7860へ接続していません。

確認済み:

- API v1 requestから実`createGenerationRuntime()`へipAdapterが渡る。
- RuntimeがHistory image IDをfixture fileへ解決する。
- Runtimeがmock ReForge requestへmodule、model、referenceBase64、Weight/Start/Endを渡す。
- `weight`省略時に既存default `0.65`が適用される。
- Historyに`referenceImageId`とIP-Adapter metadataが保存される。
- 不正`referenceImageId`は400 `INVALID_REQUEST`となり、Job、ReForge request、Historyを増やさない。
- capability利用不可は202受付後のJobを`failed`にし、`generateImages()`を呼ばず、Historyを追加せず、通常生成へfallbackしない。
- 派生再生成で`sourceImageId === referenceImageId`の場合、異なる場合の両方が成功する。
- parent provenanceとIP-Adapter reference IDが独立して保存される。

監督再実行結果:

```text
npm run check: 成功
関連test: 34 passed / 0 failed
npm test: 420 passed / 0 failed
git diff --check: 成功（CRLF warningのみ）
```

最終判定:

- Task 17の実装と自動テストを監督承認する。
- 追加コード修正は要求しない。
- 実機3030/7860のSmoke Testは未実施のため、Task 17全体の実機承認はユーザー許可後に判定する。
- Smoke Test前にactive jobs、Discord設定、Checkpoint、output保存先を確認する。
- 新コード反映に3030再起動が必要な場合は、active jobs 0を確認し、ユーザー許可の範囲で1回だけ通常再起動する。

## レビュー結果

実装本体に重大な欠陥は現時点で確認されません。次の契約はコード上で確認できました。

- API v1の公開`ipAdapter`は`referenceImageId`、`weight`、`guidanceStart`、`guidanceEnd`のstrict allowlistです。
- `validateIpAdapter()`の既存default/境界値検証を再利用しています。
- 存在確認後の値は、新規Runtimeを作らず既存Job payloadの`ipAdapter`へ渡されます。
- 不存在参照はJob作成前に404 `REFERENCE_IMAGE_NOT_FOUND`となります。
- 派生再生成で`ipAdapter`省略時は元Historyの参照を継承しません。
- History detail DTOは安全な4 fieldだけを返し、History listには追加していません。
- MCP Tool数は8のままです。
- MCP schemaはURL、path、base64、module/model等の追加fieldを拒否します。
- MCP History validatorは不正なipAdapter responseを拒否します。
- 新規依存、UI変更、ReForge変更、Job Manager変更はありません。

監督再実行結果:

```text
npm run check: 成功
関連test: 33 passed / 0 failed
npm test: 419 passed / 0 failed
git diff --check: 成功（CRLF warningのみ）
```

## 必須修正：API v1と実Runtimeの境界テストを補完する

`docs/CURRENT_TASK.md`で14.1節の必須条件にした次のケースが、現在のTask 17追加テスでは十分に証明されていません。

1. API v1受付から実`createGenerationRuntime()`へipAdapterを通し、既存`resolveIpAdapter()`、ReForge request、History保存までつながること。
2. IP-Adapter capability利用不可時にJobが`failed`となり、`generateImages()`が呼ばれず、参照なし通常生成へfallbackしないこと。
3. 派生再生成の`sourceImageId`と`ipAdapter.referenceImageId`が同じ場合と、異なる場合の両方。
4. `weight`省略時に既存default `0.65`が適用されること。現テストは下限0と上限2は確認していますが、既存default値をassertしていません。
5. `referenceImageId`自体の形式が不正な場合に400 `INVALID_REQUEST`となり、Jobを作成しないこと。

### 修正範囲

原則として次の2ファイルだけを変更してください。

```text
test/api-v1.test.js
docs/CURRENT_TASK.md（状態行のみ）
```

実装コードの修正は、追加テストが実際の欠陥を検出した場合だけ行ってください。その場合は勝手に変更ファイルを増やさず、検出した事実と必要ファイルを報告してください。

### テスト方針

`test/api-v1.test.js`の既存`createRuntimeHarness()`を最小拡張して構いません。

必要なテス用要素:

- temporary output directoryに有効な小型PNG fixtureを作る。
- temporary Historyの`getImage()`がfixtureのfilenameを返す。
- `getIpAdapterOptions()`を注入可能にし、available/unavailableをmockする。
- available時は既存Runtimeが`generateImages()`へ渡すrequestの`ipAdapter`が正規化済みであることをassertする。
- 生成後のHistory recordに`referenceImageId`、Weight/Start/Endが保存されることをassertする。
- unavailable時はJob terminal stateが`failed`、`generateImages()`呼出し0回、History追加0件をassertする。
- API受付のテストは実3030/7860を使わず、temporary Express appまたはService harnessで行う。

既存の`src/ip-adapter.js`、`src/reforge.js`、`src/server.js`、`src/history.js`、`test/server-integration.test.js`は今回変更不要です。

## 必須検証

```powershell
npm run check
node --test test/api-v1.test.js test/mcp-client.test.js test/mcp-tools.test.js
npm test
git diff --check
```

完了後、`docs/CURRENT_TASK.md`の状態行だけを次へ更新してください。

```text
状態: **追加テスト修正完了／監督再レビュー待ち**
```

実3030/7860、実outputs、実History、Favorite、Discord、storageは変更しないでください。commit、push、プロセス再起動、実機Smoke Testも行わないでください。

---

# Task 16 AI Visual Feedback Loop レビュー追加修正

更新日: 2026-08-11
状態: **Task 16実AI Host Visual Feedback Loop成功／監督最終承認**

## Phase B実AI Host Visual Feedback Loop結果

ユーザーの明示許可後、Phase Aで人物欠落を確認した既存画像を元に、Codex CLI HostからLocal Image Chat MCPの派生再生成を1回だけ実行しました。

実行経路:

```text
get_history_item
→ get_image（元画像の人物欠落を視覚確認）
→ regenerate_image（1回だけ）
→ get_generation
→ done
→ get_image（新画像を視覚確認）
```

元データ:

```text
historyId: 5b2d93a1-a207-4ea0-a8ac-786c9c7a69e1
imageId:   eaa97f7a-aa40-424c-bd4e-7174047a0c88
prompt:    1girl, solo, night city background
result:    人物なし。濃紺の抽象的な夜景と発光帯のみ。
```

再生成の明示差分:

```text
rawOverride: 1girl, solo, centered character, clearly visible face and upper body,
             looking at viewer, night city background, masterpiece, best quality,
             detailed face
negative:    lowres, worst quality, empty scene, scenery only, no humans
resolution:  832 x 1216
steps:       24
CFG:         4
candidate:   1
reuseSeed:   false
Hires.fix:   false
LoRA:        []
Checkpoint:  元Historyと同じ公開identifierを継承
Sampler:     Euler aを継承
Scheduler:   Automaticを継承
```

完了結果:

```text
jobId:      df61a40c-2a10-475b-ad7e-33a26033d3fe
status:     done
progress:   1
historyId:  0e382d40-ab74-4f57-a30a-0cc026a9bb46
imageId:    0436293b-1cce-438a-a701-6be33d247070
seed:       1837937173
size:       832 x 1216
meta.client:mcp
```

派生Historyの連結も正常です。

```text
parentGenerationId: 5b2d93a1-a207-4ea0-a8ac-786c9c7a69e1
parentImageId:      eaa97f7a-aa40-424c-bd4e-7174047a0c88
derivation.type:    ai-workflow
derivation.instruction:
  Make the female character clearly visible in the center while preserving the night city background.
```

Hostの`get_image`視覚認識と監督側の独立照合は一致しました。

- アニメ調の女性が1人明確に現れた。
- 短い暗色のボブヘア、紫系の瞳、黒いハイネック衣装が視認できる。
- 顔と上半身が中央に大きく配置され、視線も正面方向。
- 背後に青・紫・ピンクの発光を持つ夜間の都市スカイラインと水面反射が残っている。
- 元画像の「夜景のみで人物がいない」という主要不一致は解消した。

実行時、ユーザーが予告したとおり別セッションの生成Jobも近接してキューへ入りました。Task 16のJobは既存Job Managerの直列キューに従い、他Jobのキャンセル、割込み、優先度変更、Checkpoint切替、プロセス再起動は行っていません。Task 16自身の`regenerate_image`は1回だけで、追加改善生成はありません。

終了状態:

```text
Local Image Chat PID: 107536（維持）
ReForge PID:          52624（維持）
active jobs:          0
active Checkpoint:    obsessionIllustrious_vPredV20のまま
output directory:     D:\AI\local-image-chat\outputsのまま
3030 restart:         なし
7860 restart:         なし
```

Phase B判定:

- `Generate → Observe → Evaluate → Modify → Regenerate → Observe`の閉ループが実AI HostとLocal Image Chat MCPで成立。
- 512 x 512 / 10 stepsの低負荷条件を832 x 1216 / 24 stepsへ変更することで、意味のある視覚改善を確認。
- Backend、MCP、History、Web UIの追加修正は不要。
- Task 16を最終承認する。
- 次候補はTask 17「Visual Iteration UX」。現時点で自動無限再生成やMCP内画像採点は追加しない。

## Phase A実AI Host Smoke Test結果

ユーザーの明示許可後、新しいCodex CLI Host sessionでPhase Aを実施しました。新規生成・再生成は行っていません。

使用Host:

```text
Codex CLI 0.145.0
transport: stdio
MCP server: local_image_chat
Backend: http://127.0.0.1:3030
```

対象はTask 15Bで生成済みの既存画像です。

```text
historyId: 5b2d93a1-a207-4ea0-a8ac-786c9c7a69e1
imageId:   eaa97f7a-aa40-424c-bd4e-7174047a0c88
prompt:    1girl, solo, night city background
```

HostへTool名を直接指定せず、接続済みLocal Image Chat MCPだけで履歴と画像を確認する自然言語要求を与えました。shell、PowerShell、curl、直接HTTP、Browser、Chrome、GUI、filesystem、History JSON、outputsの代替参照は禁止しました。

実際のTool call:

```text
1. get_history_item
   id = 5b2d93a1-a207-4ea0-a8ac-786c9c7a69e1

2. get_image
   imageId = eaa97f7a-aa40-424c-bd4e-7174047a0c88
```

他のLocal Image Chat Toolは呼ばれていません。

`get_image` result:

```text
variant:    thumbnail
mimeType:   image/webp
byteLength: 7,840
content:    text block + image block
```

Codex HostはMCP image contentを視覚入力として正常に受け取り、次を画像内容として説明しました。

- 女の子や人物は見当たらない。
- 濃紺の画面に、都市の窓や光のような矩形状の発光が横方向へ並ぶ。
- 下部に青い光の反射のような帯がある。
- 正方形構図で、都市らしい発光帯は中央よりやや下、上部は暗い余白。
- 主要色は濃紺、藍、青、シアン、紫、マゼンタ。
- `night city background`とは部分的に一致する。
- `1girl, solo`とは不一致で、人物入り夜景より抽象化された都市光景に見える。

この説明はPrompt文字列の単純な言い換えではなく、Promptとの不一致である「人物が存在しない」こと、発光帯の位置、上部余白、主要色まで含みます。したがって、URL文字列やHistory情報だけからの推測ではなく、MCP image contentがHostの実視覚入力として利用されたと判断します。

監督側でもSmoke Test終了後に同じ既存thumbnailを読み取り専用で視覚照合し、人物が存在しないこと、濃紺の背景、中央より下のシアン／紫／マゼンタの発光帯、上部の暗い余白がHost説明と一致することを確認しました。この事後照合はHostのMCP-only試験経路とは分離して行い、画像・履歴を変更していません。

開始・終了状態:

```text
Local Image Chat PID:      107536 → 107536
ReForge PID:               52624 → 52624
ReForge health:            true → true
active jobs:               0 → 0
active Checkpoint:         obsessionIllustrious_vPredV20のまま
Discord generationAutoSend:false → false
History total:             968 → 968
Favorite total:            63 → 63
output directory:          D:\AI\local-image-chat\outputsのまま
disk free:                 686,087,864,320 bytes
```

副作用:

- 新規generationなし。
- `regenerate_image`呼出しなし。
- History追加・rotationなし。
- outputs書込みなし。
- Favorite変更なし。
- Discord送信なし。
- Checkpoint変更なし。
- storage変更なし。
- 3030／7860再起動なし。

Host session終了時に、既存の未認証Notion MCPについてAuthRequired warningが出ましたが、`local_image_chat`のTool call、画像取得、視覚認識には影響していません。Local Image Chat以外のMCP Toolは対象処理に使用されていません。

Phase A判定:

- Codex Hostは`get_image`を自然言語から選択できる。
- `image/webp`のMCP image contentを視覚入力として扱える。
- 既存URLだけでは成立しなかった視覚認識が、`get_image`で成立した。
- MCP Resource、PNG変換、original埋込み、Backend base64 APIは不要。
- Task 16のPhase Aを成功として承認する。
- Phase Bの派生再生成は自動実行せず、ユーザーの別途許可を待つ。

## 追加修正の再レビュー結果

必須修正1は解消されました。追加コード修正はありません。

確認結果:

- `local-image-chat-client.js`は検証済みWebPをraw `Buffer`の`bytes`として返し、base64化しない。
- `tools.js`は`Buffer`／`Uint8Array`と`byteLength`の一致をimage block生成前に検証する。
- production codeのbase64 encodeは、`runImageTool()`がMCP image blockを作る直前の`bytes.toString("base64")` 1箇所だけ。
- 旧`isCanonicalBase64()`とdecode→再encode処理は削除済み。
- text／`structuredContent`は`imageId`、`variant`、`mimeType`、`byteLength`だけを返す。
- error resultへraw bytes、base64、image blockを含めない。
- testはimage blockを復号し、元bytesと一致することを確認する。
- `byteLength`不一致は`LOCAL_IMAGE_CHAT_INVALID_RESPONSE`としてimage block生成前に拒否する。
- MIME、WebP header、0 byte、2 MiB上限、timeout、redirect、same-origin、自動retryなしの既存条件を維持する。

監督再実行結果:

```text
npm run check
  成功

node --test test/mcp-client.test.js test/mcp-tools.test.js
  22 passed / 0 failed

npm test
  417 passed / 0 failed

git diff --check
  成功（LF／CRLF warningのみ、whitespace errorなし）
```

追加修正承認時点の判定（Phase A実施済み）:

- Task 16のコード実装と自動テスト段階を承認する。
- 3030／7860の再起動は不要。
- ユーザーの明示許可後、新しいCodex Host sessionでPhase Aだけを実施する方針とした。
- Phase Aは既存Task 15B画像を使い、新規生成、History追加、outputs書込みなしで実施済み。
- Phase A成功後のPhase B再生成は別途判断し、自動的に続行しない。

## 初回レビュー結論（解消済み）

Task 16の基本設計と安全境界は適合しています。実機Smoke Testへ進む前に、base64変換の重複だけを最小修正してください。

合格済みの項目:

- 追加Toolは`get_image` 1つだけで、Tool総数は8。
- 入力は既存ID規則に従う`imageId`だけ。
- configured Backendの固定`/api/images/:imageId/thumbnail`だけへGETする。
- 任意URL、filesystem path、filename、variantを受け付けない。
- `Accept: image/webp`、MIME、0 byte、RIFF/WEBP headerを検証する。
- redirectと別originを拒否する。
- raw 2 MiB上限を`Content-Length`とstream累積byte数の両方で強制する。
- header前およびbody stallのtimeoutを処理する。
- 自動retryしない。
- base64をtext／`structuredContent`へ含めない。
- error resultへimage block、raw bytes、stack、pathを含めない。
- Backend、UI、History、ReForge、依存関係を変更していない。
- 公式SDK in-memory transportでimage contentが保持される。
- `npm run check`、MCP関連22 test、全417 test、`git diff --check`が成功する。

## 必須修正1（解消済み）：base64変換をMCP境界の1回だけにする

### 原因

現在は次の2箇所でbase64 encodeが実行されます。

```text
src/mcp/local-image-chat-client.js
Buffer.from(bytes).toString("base64")

src/mcp/tools.js / isCanonicalBase64()
decoded.toString("base64")
```

HTTP clientでraw bytesをbase64化した後、Tool層のcanonical検証でdecodeし、さらに再encodeしています。

これはTask 16正本の次の条件と一致しません。

```text
response bytesは必要な1回だけbase64化する
base64はMCP protocolのimage content境界だけに置く
```

最大2 MiBのraw imageに対して不要なBufferとbase64 stringを追加生成するため、stdio送信前のメモリ・CPUも増えます。

### 修正方針

第一候補は、HTTP clientからTool層まではraw bytesを保持し、`runImageTool()`がMCP image blockを組み立てる直前に1回だけbase64化する構造です。

概念形:

```js
// local-image-chat-client.js
return {
  imageId,
  variant: "thumbnail",
  mimeType: "image/webp",
  byteLength: bytes.byteLength,
  bytes
};

// tools.js
const data = Buffer.from(image.bytes).toString("base64");
return {
  content: [
    { type: "text", text: JSON.stringify(metadata) },
    { type: "image", data, mimeType: image.mimeType }
  ],
  structuredContent: metadata
};
```

要件:

- raw bytesは`Buffer`または`Uint8Array`として内部だけで受け渡す。
- Tool層で`byteLength`との一致を検証する。
- MCP image block構築直前に`toString("base64")`を1回だけ呼ぶ。
- `isCanonicalBase64()`のdecode→再encode検証は削除する。
- text／`structuredContent`／log／errorへraw bytesやbase64を入れない。
- 2 MiB上限、MIME、WebP header、timeout、same-originの既存検証を維持する。
- Tool resultへ返したbase64をtest側でdecodeし、元bytesと一致することを確認する。
- base64変換回数のためだけにglobal monkey patch等の壊れやすいtestを追加しない。

raw bytesをTool層まで渡すことが既存実装上不自然な場合は、HTTP clientで1回だけencodeした値をTool層が再encodeせず使用する最小案も許容します。ただし、canonical確認のための`decoded.toString("base64")`は残さないでください。第一候補のraw bytes方式を推奨します。

### 変更範囲

原則、次の4ファイル以内です。

```text
src/mcp/local-image-chat-client.js
src/mcp/tools.js
test/mcp-client.test.js
test/mcp-tools.test.js
```

必要なら`docs/CURRENT_TASK.md`の状態行だけを更新してください。Backend、依存、MCP schema、documentation本文を追加変更しないでください。

### 修正後の検証

```powershell
npm run check
node --test test/mcp-client.test.js test/mcp-tools.test.js
npm test
git diff --check
```

修正完了後、`docs/CURRENT_TASK.md`の状態を次へ更新してください。

```text
状態: **修正完了／監督再レビュー待ち**
```

監督再レビュー前に実3030／7860へ接続せず、実AI Host Smoke Testや実画像生成を行わないでください。

---

# Task 15B AI Image Workflow レビュー追加修正

更新日: 2026-08-11
状態: **実機Smoke Test完了・Task 15B最終承認済み**

## 実機Smoke Test 最終承認

ユーザーの明示許可後、Task 15Bの実機Smoke Testを完了しました。追加コード修正はありません。

実行経路:

```text
新しいCodex CLI Host session
→ local_image_chat MCP stdio
→ get_history_item
→ regenerate_image（1回だけ）
→ 実3030 /api/v1/history/:id/regenerations
→ 既存Job Manager／Generation Runtime
→ ReForge 7860
→ get_generation（running → done）
→ get_history_itemで派生History確認
```

開始時の安全条件:

```text
Local Image Chat PID: 46712
ReForge PID:          52624
active jobs:          0
generationAutoSend:   false
output:               D:\AI\local-image-chat\outputs
空き容量:             約639 GiB
History:              500件
active Checkpoint:    sd\obsessionIllustrious_vPredV20.safetensors [5d1c3f154d]
```

最新Backendコードを反映するため、active jobs 0確認後にLocal Image Chat 3030だけを通常再起動しました。

```text
3030: PID 46712 → PID 107536
7860: PID 52624のまま
```

派生元:

```text
historyId:     e1b2fa60-a692-49dd-8c90-642a66cc65a1
sourceImageId: 868da85d-cfad-4c9a-bfbd-04946a010971
prompt:        1girl, solo, simple background
size:          512 × 512
steps:         10
LoRA:          なし
Hires:         false
```

Codex Hostは自然言語要求から`get_history_item`、`regenerate_image`、`get_generation`を選択しました。`regenerate_image`は1回だけ呼ばれ、同じJobをterminal状態まで追跡しました。

```text
jobId:     d617128e-8dd1-4726-b565-85294f51ca00
status:    queued → running（0.73）→ done（1）
client:    mcp
historyId: 5b2d93a1-a207-4ea0-a8ac-786c9c7a69e1
imageId:   eaa97f7a-aa40-424c-bd4e-7174047a0c88
seed:      3569520054
prompt:    1girl, solo, night city background
negative:  lowres, worst quality
size:      512 × 512
steps:     10
candidates: 1
reuseSeed: false
LoRA:      なし
Hires:     false
```

派生History:

```text
parentGenerationId: e1b2fa60-a692-49dd-8c90-642a66cc65a1
parentImageId:       868da85d-cfad-4c9a-bfbd-04946a010971
derivation.type:     ai-workflow
derivation.instruction:
  Change the simple background to a night city background while preserving the subject.
```

Hostは監査文字列を英語で送信しましたが、ユーザー要求と同じ意味であり、Backendは受信した文字列をPromptへ混入せずそのまま保存しました。これはTask 15Bの契約どおりです。

画像配信:

```text
original:
  HTTP 200
  Content-Type image/png
  243,479 bytes

thumbnail:
  HTTP 200
  Content-Type image/webp
  7,840 bytes
```

副作用確認:

```text
output files: 2826 → 2828（原画像+1、thumbnail+1）
output bytes: 2,650,447,762 → 2,650,699,081（+251,319）
画像2ファイル合計: 243,479 + 7,840 = 251,319
History: 500件のまま、新historyIdが先頭へ追加
Favorite: 終了時63件、新画像はfalse、Favorite変更操作なし
active Checkpoint: 変更なし
Discord generationAutoSend: falseのまま
storage output: 変更なし
active jobs: 0へ復帰
元History: 残存
元画像: 残存
3030 PID: 107536
7860 PID: 52624
```

セキュリティ確認:

- MCP／API公開DTOにWindows絶対path、UNC path、ReForge URL、LoRA install path、base64、data URL、stack traceは出ていない。
- CheckpointはCapabilitiesの公開identifierを使用し、active Checkpointと同一のため切替は発生していない。
- 画像は既存の同一Backend originのoriginal／thumbnail URLだけを返した。
- 追加生成、再送、cancel試験、img2img／inpaint試験は行っていない。

最終判断:

- Task 15BのBackend、MCP、自動テスト、実AI Host Workflow、実画像生成、History派生情報、画像配信を最終承認する。
- Task 15Bは完了。追加修正、追加生成、7860再起動は不要。

## 再レビュー最終判定

前回の指摘1〜3は解消されました。Task 15Bの追加コード修正はありません。

確認結果:

- History継承LoRAは、`name`・`weight`・`enabled`を現在のinstalled一覧と既存`normalizeV1Loras()`で再検証した後、生成再現に必要なTrigger／Negative／衣装関連メタデータだけを復元する。
- 復元値は既存Generation Runtimeの`validateLoras()`を通るため、History objectを無検証でReForgeへ渡さない。
- 元LoRAが現在未導入なら`INVALID_REQUEST`となり、黙って除外しない。
- `loras: []`および完全置換時の旧LoRAタグ除去は、PositiveをHistoryから継承するときだけ実行する。
- LoRAタグ除去は既存`parseLoraTags()`／`removeLoraTags()`を使用し、単純な文字列置換を行わない。
- 明示された新しい`prompt.rawOverride`または完全structured Promptは書き換えない。
- History detail DTOは`prompt.rawPromptOverride`だけを返し、boolean aliasの`prompt.rawOverride`を返さない。
- MCP clientも`rawPromptOverride`を検証し、不正なresponse aliasを拒否する。
- LoRA継承・未導入拒否・解除・完全置換・明示Prompt保持・Hires継承／解除・古いHistory fallback・DTO契約の回帰テストが追加された。

監督再実行結果:

```text
npm run check
  成功

node --test test/api-v1.test.js test/mcp-client.test.js test/mcp-tools.test.js
  23 passed / 0 failed

npm test
  409 passed / 0 failed

git diff --check
  whitespace errorなし
  LF／CRLF warningのみ
```

判定:

- Task 15Bの実装と自動検証を最終承認する。
- 追加コード修正は要求しない。
- 実3030／7860、実History／outputsを使ったSmoke Testはまだ実行していない。
- 実機Smoke Testへ進むには、ユーザーの明示許可、active jobs 0、Discord generationAutoSend false、storage／空き容量正常の確認後、3030だけを通常再起動する。
- ReForge 7860は原則再起動しない。
- 新しいCodex Host sessionでMCPを再接続し、Task 15B指示書どおり低負荷派生生成を1件だけ行う。

## 初回監督判定（解消済み）

Task 15Bの構造、API route、既存Job Manager／Generation Runtimeへの合流、MCP 7 Tool化、由来情報保存、Seed規則は概ね指示どおりです。`npm run check`とTask 15B関連23件も監督環境で再実行し、成功しました。

初回レビューでは、LoRAを含む元Historyの派生生成で再現性を失う実装上の問題と、History item DTOの契約重複を確認し、以下の最小修正を要求しました。これらは上記の再レビューですべて解消済みです。

## 指摘1: LoRA省略／解除／完全置換の実効Promptが契約どおりにならない

### 根拠

初回実装時の`historyLorasToV1()`は元HistoryのLoRAを次の3項目だけへ落としていました。

```text
name
weight
enabled
```

その後`normalizeV1Loras()`を通るため、元Historyに保存されていた次の生成用情報が失われます。

```text
triggerWords
negativeWords
characterTriggerWords
outfitChoiceId
outfitPresetName
outfitTriggerWords
source
```

Generation Runtimeは`appendLoras()`と`appendLoraNegatives()`で`triggerWords`／`negativeWords`を実効Promptへ追加します。したがって、`loras`省略時に名前とWeightだけを維持しても、元生成と同じLoRA適用内容にはなりません。

実Historyにも次の状態が存在することをread-onlyで確認しました。

```text
negativePrompt:
  lowres, ...

effectiveNegativePrompt:
  lowres, ..., high-waist shorts, tank top, pantyhose, ...

source LoRA negativeWords:
  high-waist shorts, tank top, pantyhose, ...
```

初回実装で同じHistoryから`loras`を省略して派生すると、LoRAの`negativeWords`が落ち、元の実効Negativeを再現できませんでした。

また、元の`rawPrompt`／`prompt`自体に`<lora:...>`が含まれるHistoryでは、初回実装の処理で次が起こり得ました。

```text
loras: []
→ 選択配列は空になるが、継承Prompt内の旧LoRA構文は残り、ReForgeではLoRAが適用される

loras: [replacement]
→ 継承Prompt内の旧LoRA構文とreplacementが同時に残り、「完全置換」にならない
```

### 必須修正

1. `request.loras === undefined`では、元HistoryのLoRA名・Weight・enabledを必ず現在のinstalled LoRA一覧と既存`normalizeV1Loras()`で再検証すること。
2. 再検証後、元Historyに保存された生成再現に必要なLoRA付随情報を安全に引き継ぐこと。History objectを無検証でそのままJobへ渡さず、既存`validateLoras()`で最終的にsanitizeされる形にすること。
3. 元LoRAが現在未導入なら、指示書どおり意味のあるvalidation errorを返し、無視しないこと。
4. `request.loras`が明示され、かつPositive Promptを元Historyから継承する場合は、元History由来のLoRA構文を構造的に扱うこと。
   - `loras: []`では元History由来のLoRA構文を除外する。
   - `loras: [...]`では元History由来のLoRA構文を除外して新一覧へ完全置換する。
   - 単純な文字列置換は禁止。既存`removeLoraTags()`／`sameLoraName()`等のLoRA構文用純粋関数を利用すること。
5. 利用者が明示的な`prompt.rawOverride`または完全structured Promptを同時に送った場合、その新Positiveを勝手に書き換えないこと。旧LoRA除去は「元Historyから継承したPositive」に限定すること。
6. 元History、元画像、元Jobは変更しないこと。

## 指摘2: History item DTOにRaw modeを表すfieldが二重にある

既存allowlist DTOの正本は次です。

```text
prompt.rawPromptOverride
prompt.rawPrompt
```

Task 15Bの指示書にあるHistory item response例も`rawPromptOverride`です。しかし現在の詳細取得だけ、追加で次を返しています。

```text
prompt.rawOverride
```

この結果、`rawPromptOverride`と`rawOverride`が同じresponse内に並びます。`rawOverride`は再生成request側のfield名であり、History responseへ別名aliasとして追加する指示はありません。AI Hostが編集対象文字列とmode flagを混同する原因になります。

### 必須修正

- `GET /api/v1/history/:id`のresponseは既存の`prompt.rawPromptOverride`を正本とし、追加したboolean `prompt.rawOverride`を削除すること。
- MCP clientのHistory item response validationも`rawPromptOverride`を検証すること。
- `POST .../regenerations`およびMCP `regenerate_image`のrequest fieldである文字列`prompt.rawOverride`は変更しないこと。
- 既存`GET /api/v1/history`のDTO契約は変更しないこと。

## 指摘3: 正本で必須とした回帰ケースを追加する

既存テストは主要経路を確認していますが、今回の不具合を検出できません。少なくとも次を既存のTask 15B対象テストへ追加してください。新しいテストファイルは不要です。

- LoRA省略時に、元の`triggerWords`と`negativeWords`を含む実効Positive／Negativeが維持される。
- LoRA省略時に、元LoRAがinstalled一覧から消えていればvalidation errorになる。
- Positive省略＋`loras: []`で、継承Prompt内の元LoRA構文が残らない。
- Positive省略＋LoRA完全置換で、旧LoRA構文が残らず新LoRAだけになる。
- 明示的な新`rawOverride`に含まれるLoRA構文は、元History由来除去処理で勝手に消されない。
- Hires設定の省略継承と`settings.hires.enabled=false`による明示解除。
- 古いHistoryで`structuredPrompt`／`rawPrompt`がない場合の`prompt`、最後に`effectivePrompt`へのfallback。
- History item DTOは`rawPromptOverride`だけを返し、boolean aliasの`rawOverride`を返さない。

## 変更範囲

原則として既存Task 15Bの変更対象内に限定してください。想定対象は次です。

```text
src/services/generation-service.js
src/api/v1/history.js
src/mcp/local-image-chat-client.js
test/api-v1.test.js
test/mcp-client.test.js
必要ならdocs/MCP.md
docs/CURRENT_TASK.md（状態行のみ）
```

新規依存、UI変更、ReForge変更、Job Manager変更、History schema version変更、実データ変更は禁止です。

## 再提出条件

修正後に次を提出してください。

```text
npm run check
node --test test/api-v1.test.js test/mcp-client.test.js test/mcp-tools.test.js
npm test
git diff --check
```

あわせて、上記LoRA 5ケースとDTO契約のテスト名・結果を報告してください。状態は`修正完了／監督再レビュー待ち`とし、最終承認済みにしないでください。

実3030／7860の停止・再起動、実History／outputsへの書込み、実機Smoke Testは監督再レビューとユーザー許可まで禁止します。

---

# Task 14 実AI Host統合 最終レビュー

更新日: 2026-08-10
状態: **最終承認済み／追加修正なし**

Codex CLI `0.145.0`を実AI Hostとして使用したTask 14の報告を、MCP登録状態、実API、Job、History、画像配信、listener、関連テストと再照合しました。

確認結果:

- `local_image_chat`はstdio、`node`、現在の`src/mcp/server.js`、`LOCAL_IMAGE_CHAT_URL`を使ってenabled。
- 自然言語から`get_capabilities`、`generate_image`、`get_generation`、`get_history`を選択し、同じ非同期Jobを`done`まで追跡できた。
- job `b113f66d-1fcb-4d94-9bba-9e91cf799360`は`done`、progress 1。
- history `e1b2fa60-a692-49dd-8c90-642a66cc65a1`とimage `868da85d-cfad-4c9a-bfbd-04946a010971`はJob結果、History、画像URLで一致。
- 同じJobの既存Job DTOで`meta.client = "mcp"`を確認。
- originalはHTTP 200 `image/png` 192,117 bytes、thumbnailはHTTP 200 `image/webp` 1,742 bytes。合計193,859 bytesで報告差分と一致。
- active jobsは0。3030はPID 46712、7860はPID 52624のままで再起動なし。
- `npm run check`成功、MCP関連14件成功、全407件成功、`git diff --check`はwhitespace errorなし。

非阻害事項:

- 生成session冒頭のBrowser Skill補助commandはsandboxで失敗し、Local Image Chatのソース、API、History、outputsを代替参照していない。その後の対象操作はMCP Tool経由で成立しているため、Task 14の失敗条件には該当しない。
- 未認証Notion MCPのshutdown警告は既存の別MCP設定によるもので、`local_image_chat`のTool discovery、生成、履歴確認へ影響していない。
- Hostは画像URLを有効な結果として提示できたが画像内容の視覚確認は行っていないため、ケースBとして承認する。Task 15Aのbase64／Image Resource追加理由にはしない。
- 厳密なpoll intervalのraw logは保存されていないが、同一Jobの完了、重複生成なし、done後の通常pollingなし、画像差分1件が確認できるため追加実生成を要求しない。

最終判断:

- Task 14を最終承認する。
- Codexの`local_image_chat`登録は成功したHost設定として維持してよい。
- 追加コード修正、追加生成、3030／7860再起動は不要。
- 次候補はTask 15B「AI Image Workflow」を推奨する。Task 15Aは、将来Hostが画像URLを扱えない、またはAIによる画像内容確認が明確に必要になった時点で再検討する。

---

# Task 13 MCP Thin Wrapper レビュー追加修正

更新日: 2026-08-10
状態: **修正完了・再レビュー最終承認済み**

## 再レビュー最終判定

指摘1は解消されました。Task 13の追加コード修正はありません。

## 実機MCP Smoke Test 最終承認

実機MCP Smoke Testは完了し、監督のread-only再確認も成功しました。Task 13を最終承認します。

実行経路:

```text
MCP Host test client
→ stdio MCP Server
→ Local Image Chat HTTP client
→ 実3030 /api/v1
→ Generation Runtime
→ ReForge 7860
→ History／original／thumbnail配信
```

実生成:

```text
jobId:     da2a7e11-3463-4a7f-be93-033995d31976
historyId: 9f24b03a-2f28-425f-925c-445b70dc7888
imageId:   4b0c81a9-d9c0-4a22-8d69-eba0ecf7af49
mode:      txt2img
size:      512 × 512
steps:     10
candidates: 1
status:    done
progress:  1
client:    mcp
```

監督は公式SDKの`StdioClientTransport`で実`src/mcp/server.js`を子process起動し、追加生成を行わず次を再確認しました。

```text
tools/list:
  get_capabilities
  generate_image
  get_generation
  cancel_generation
  get_history

get_capabilities:
  checkpoints 8
  samplers 79
  schedulers 25
  loras 84

get_generation:
  同一jobId
  status done
  progress 1
  同一historyId
  同一imageId
  original／thumbnailはhttp://127.0.0.1:3030配下の絶対URL

get_history?limit=1:
  同一historyId
  同一imageId
```

画像配信:

```text
original:
  HTTP 200
  Content-Type image/png
  300,601 bytes

thumbnail:
  HTTP 200
  Content-Type image/webp
  12,672 bytes
```

API公開DTO確認:

```text
absolute filesystem pathなし
base64／data URLなし
stack traceなし
```

実環境終了状態:

```text
Local Image Chat: 0.0.0.0:3030 / PID 46712（変更なし）
ReForge: 127.0.0.1:7860 / PID 52624（変更なし）
active jobs: 0
ReForge health: OK
active Checkpoint: 開始時と同一
Discord generationAutoSend: false
Favorite: 119件のまま
```

Task 12終了時の基準値からの生成副作用:

```text
原画像: +1
thumbnail: +1
Favorite: 変更なし
History: 新規historyIdが先頭に追加
Checkpoint: 変更なし
Discord通知: なし
storage settings: 変更なし
```

3030／7860の停止・再起動はありません。追加の実機生成も不要です。Task 13のMCP Thin Wrapperは、設計、実装、timeout修正、自動テスト、全回帰テスト、実機stdio→HTTP→Generation Runtime経路まで最終承認済みです。

空き容量確保後の最終再検証も完了しました。

```text
C: free 約51.8 GB
D: free 約686 GB

npm test
  407 passed / 0 failed

git diff --check
  成功（CRLF warningのみ）
```

前回のTask 09保存先テスト6件の失敗は、Cドライブ空き容量0による環境要因だったことが確定しました。空き容量確保後は同じ6件を含む全407件が成功しています。Task 13は実装、レビュー修正、関連テスト、全回帰テストまで最終承認済みです。

次に進めるのは実3030へ接続するMCP Smoke Testです。実生成を含むため、開始前にactive jobs、ReForge health、Discord `generationAutoSend`、Checkpoint、保存先空き容量を再確認し、ユーザーの承認後に最小1件だけ実施してください。

- timeout timerは`fetchImpl()`直後ではなく、`requestJson()`全体を囲む`finally`で解除される。
- response header受信後もAbortSignalが有効である。
- response body読取はAbortSignalとのraceで、body stall時も`LOCAL_IMAGE_CHAT_TIMEOUT`へ変換される。
- timeout後の自動再送はない。
- Backend error mapping、redirect拒否、origin検証は維持されている。
- body stall回帰テストが追加され、request回数1回とabort発火を確認する。

監督再現:

```text
timeout: 1000ms
header: 即時受信
body: 完了しない
結果: 約1000msでLOCAL_IMAGE_CHAT_TIMEOUT
```

監督検証:

```text
npm run check
  成功

node --test test/mcp-client.test.js test/mcp-tools.test.js
  14 passed / 0 failed

git diff --check
  成功（CRLF warningのみ）
```

全テスト再実行時、Task 13とは無関係なTask 09保存先テスト6件が「空き容量不足」で失敗しました。監督確認時点のfilesystem状態は次のとおりです。

```text
C: free 0 bytes
D: free 約686 GB
E: free 0 bytes
```

失敗した6件は、保存先計画・移行fixtureが空き容量判定で400または`STORAGE_PLAN_INVALID`になったものです。MCP関連14件はすべて成功しており、今回のtimeout修正による回帰ではありません。Cドライブのユーザーデータを監督判断で削除せず、環境上の検証制約として扱います。

Task 13のコードは最終承認します。ただし、Cドライブ空き容量0の状態ではHistoryや一時ファイル書込みが失敗する可能性があるため、実3030を使うMCP生成Smoke Testは実施しません。安全な空き容量を確保した後、全テストを再実行し、実機Smoke Testの許可を改めて判断してください。

今回新たに作業ツリーへ現れた`.gitignore`変更と`docs/AI_PROJECT_MEMORY.md`はTask 13レビュー修正の対象外です。内容を削除・変更せず保持し、Task 13をcommitする際は意図した別変更かを確認してください。

## 設計監督のレビュー結果

Task 13の基本構造は指示どおりです。

- 公式MCP SDK v1のstdio別process。
- Toolは指定された5個だけ。
- MCPからBackend API v1へだけHTTP委譲。
- `metadata.client = "mcp"`注入。
- Job status／progress／cursor paginationを維持。
- Job map、Queue、History cache、Prompt結合、ReForge直接通信なし。
- 画像は同一originのHTTP URLだけで、base64／Resourceなし。
- Backend／UIの変更禁止ファイルにTask 13差分なし。
- `npm run check`成功。
- MCP関連テスト`13 passed / 0 failed`。
- 全テスト`406 passed / 0 failed`。
- `git diff --check`成功。

ただし、HTTP timeoutの適用範囲に1件不具合があるため、実機Smoke Testと最終承認の前に次を修正してください。

## 指摘1：response body待機中にtimeoutが解除される

重要度: **高（Toolが無期限に待機し得る）**

対象候補:

```text
src/mcp/local-image-chat-client.js
test/mcp-client.test.js
docs/CURRENT_TASK.md（修正後の状態行のみ）
```

### 原因

現在の`requestJson()`は、timeout timerを作成して`fetchImpl()`へAbortSignalを渡していますが、`fetchImpl()`がresponse headerを返した直後に次の`finally`でtimerを解除しています。

```js
try {
  response = await fetchImpl(url, requestOptions);
} catch (...) {
  ...
} finally {
  clearTimeout(timer);
}

// timer解除後にbodyを読む
const text = await readResponseText(...);
```

そのため、Backendがheaderを返した後、response bodyを完了しない場合、`response.text()`が設定timeoutを超えても待ち続けます。

設計書のtimeoutは「202受付やAPI responseを受け取るHTTP request全体」に対するものであり、header受信だけで解除してはいけません。

### 監督再現結果

`fetchImpl()`が直ちにHTTP 200相当のresponse objectを返し、`text()`だけが完了しないfixtureを使用しました。

```text
client timeout: 1000ms
監督観測: still-pending-after-1500ms
期待: LOCAL_IMAGE_CHAT_TIMEOUTでreject
```

既存のtimeoutテストは`fetchImpl()`自体がresponseを返さない経路だけを確認しているため、このbody stallを検出できません。

### 必須修正

1. timeoutを少なくとも次の全期間へ適用してください。

   ```text
   fetch開始
   → response header受信
   → response body読取
   → JSON parseに必要なresponse取得完了
   ```

2. timerを`fetchImpl()`直後の`finally`で解除しないでください。`requestJson()`全体を囲む単一の`try/finally`等で、成功・失敗を問わず最後に必ず1回解除してください。
3. response body読取中にAbortSignalが発火した場合も、Toolへは次を返せるようにしてください。

   ```text
   code: LOCAL_IMAGE_CHAT_TIMEOUT
   message: 安全な既定文
   stack／内部URL／raw exceptionなし
   ```

4. timeout後に同じ`generate_image` requestを自動再送しないでください。
5. 既存のBackend 400／404／409／500 error mapping、redirect拒否、origin検証、response size上限の意味を変更しないでください。
6. 新規依存を追加しないでください。

実装方法は限定しませんが、AbortControllerとtimerの所有権を`requestJson()`へ一本化し、response body消費完了までsignalを生かす小さな修正を優先してください。

### 必須追加テスト

`test/mcp-client.test.js`へ、header受信後のbody stallを追加してください。

テスト条件:

```text
fetchImplはresponseを即時resolve
response.status = 200
response.ok = true
response.urlは同一origin
response.text()はAbortSignal発火までpending
timeout後にLOCAL_IMAGE_CHAT_TIMEOUT
requestがpendingのまま残らない
自動再送回数 = 0
```

可能なら、body読取中のtimer解除漏れやopen handleが残らないことも確認してください。

### 修正禁止範囲

今回のレビュー修正で次を変更しないでください。

```text
src/mcp/server.js
src/mcp/tools.js
src/mcp/schemas.js
src/api/v1/*
src/services/*
src/server.js
src/job-manager.js
src/history.js
src/reforge.js
public/*
data/*
outputs/*
package.json
package-lock.json
docs/MCP.md
```

別の問題を発見した場合は便乗修正せず、報告してください。

## npm auditのhighについて

今回報告されたhigh severityは、Task 13で追加したMCP SDK／Zod由来ではありません。

監督確認:

```text
package: adm-zip
installed: 0.5.18
advisory: GHSA-xcpc-8h2w-3j85
current range: <0.6.0
usage: src/updater.js
Task 13開始前のHEADにも同じadm-zip 0.5.18が存在
```

したがってTask 13のレビュー修正へ`npm audit fix --force`、adm-zip更新、updater変更を混ぜないでください。別の依存セキュリティTaskとして扱います。Task 13のMCP機能承認をこの既存脆弱性だけで否定しません。

## 修正後の検証

最低限:

```powershell
npm run check
node --test test/mcp-client.test.js test/mcp-tools.test.js
npm test
git diff --check
```

報告:

- timerを解除する新しいタイミング。
- header後body stallテストの結果。
- MCP関連テスト件数。
- 全テスト件数。
- 変更ファイルが上記3ファイル以内であること。
- 3030／7860を停止・再起動していないこと。
- 実3030、実outputs、実Historyを使っていないこと。

この修正が完了するまで、Task 13は「基本実装完了・最終承認保留」です。修正後にCodexが再レビューし、その後に実機MCP Smoke Testの可否を判断します。

---

# Task 12 実機Smoke Test 観測差分

更新日: 2026-08-10
状態: **最終承認（既存500件保持上限どおり・コード修正不要）**

## 設計監督の最終判定

この観測差分は不具合ではありません。Task 12を最終承認します。

- `config.storage.historyLimit`の既定値は500です。
- `createHistoryService()`は新規generationを先頭へ追加した後、`slice(0, limit)`で最新500件を保持します。
- 開始時点ですでに500件だったため、新規1件の追加と同時に最古の1件が保持対象外となり、総件数は500件のままです。
- 対象historyId `47afdafa-4f16-4fab-ba2d-187c3bc106f7`は実ファイルのindex 0に存在します。
- 対象imageId `7d79efa6-47e0-4b2c-9fbb-3d4623962af7`も同generation内に存在します。
- `/api/v1/history?limit=20`でも同じhistoryIdを確認できました。
- HistoryのSHA-256、サイズ、更新時刻が変化し、生成結果とAPI DTOも一致しています。

したがって、History保存の成功条件は次のように解釈します。

```text
開始件数 < historyLimit:
  終了件数 = 開始件数 + 1

開始件数 >= historyLimit:
  終了件数 = historyLimit
  新規historyIdが先頭へ追加される
  最古の1件が保持対象外になる
```

総件数の単純な`+1`は、保持上限未到達時だけ成立します。500件到達時は、新規IDの存在、先頭追加、画像ID一致、API取得、Historyファイル更新をもって保存成功とします。

`src/history.js`、`config.json`、API契約、保持上限は変更しません。以下は解消済みの観測記録として残し、Lunaが修正を実装する必要はありません。

## 観測した差分

- endpoint: `POST /api/v1/generations`、`GET /api/v1/generations/:id`、`GET /api/v1/history?limit=20`
- requestの安全な要約: active Checkpointを指定したtxt2img、512×512、10 steps、cfgScale 4、seed固定、candidateCount 1。任意path、任意URL、base64、LoRA、Hiresは指定していない。
- HTTP status: POSTは202（queued）、pollingは200（done）、Historyは200。
- responseの秘密を除いた要約: `running → done`、progress 1、画像1件、original／thumbnail API URL、秘密情報・絶対path・base64・filename・stackなし。
- jobId: `5357ba7e-4768-465a-80f2-26df1f6be136`
- historyId: `47afdafa-4f16-4fab-ba2d-187c3bc106f7`
- imageId: `7d79efa6-47e0-4b2c-9fbb-3d4623962af7`
- 期待status遷移: POST受付はqueued、最終done、progress 1。
- 実際status遷移: POSTはqueued、pollingではrunning、done、progress 1。
- 初期指示上の期待値: `data/history.json`のgeneration件数が開始時から+1、ファイルサイズとLastWriteTimeUtcが増加・更新する。これは保持上限未到達時だけ成立する条件だった。
- 実際値: `data/history.json`は開始時500件・5,082,551 bytesから、終了時500件・5,074,396 bytesとなった。LastWriteTimeUtcとSHA-256は変更された。新しいhistoryIdはファイル内の先頭（index 0）に存在し、画像IDも一致する。
- 再現手順: active jobsが0、ReForge healthが正常、generationAutoSendがfalseであることを確認し、上記requestを1件だけPOSTする。完了後に`data/history.json`のgenerations件数と対象historyIdを確認する。
- 実環境への副作用: 原画像1件、thumbnail 1件を追加。Favorite 0件、Discord通知なし、Checkpoint変更なし、storage settings・LoRA registry・integration key変更なし。3030／7860の再起動なし。
- 修正対象候補ファイル: なし。`src/history.js`の既存500件保持上限は正常であり、Task 12の判定条件だけを本節の最終判定で明確化した。
- 変更禁止事項: API契約、履歴形式、既存の保持上限、保存先、既存画像、Favorite、Discord、設定データを監督判断なしに変更しない。
- 最終判定: 新規historyIdが先頭へ追加され、対象imageIdとAPI DTOが一致し、総件数が500件を維持する現在の挙動を成功とする。追加の実機生成は不要。

`src/history.js`の`createHistoryService()`は既存の`limit = 500`で追加後に`slice(0, limit)`を行うため、今回の総件数500維持は仕様どおりである。設計監督確認は完了しており、コード修正・再Smoke Testとも不要。

---

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
