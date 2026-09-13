# Scenes 初回実装 — 2026-09-11

## 範囲と状態

ユーザーの明示的な実装GOに基づき、[要件S01–S23](../ui/scenes-requirements.md)と[設計](../ui/scenes-design.md)の初回範囲を実装。Astra単独で調査・実装・テスト・レビューを実施し、委譲・モデル切替なし。

Studio / Library / Scenesの3画面、共有一覧、Libraryからの保存、共通編集フォーム、上書き・別名保存・削除、Library代表画像picker、独立画像保持、専用workspace/draft適用と例外操作を接続した。生成を自動開始しない。新規依存・framework・repository・commit/push・稼働server再起動は実施していない。

## 実装ファイル

| 区分 | ファイルと責務 |
| --- | --- |
| 共通ロジック（新規） | `public/scenes.js`: 5欄allowlist、保存validation、履歴抽出、LoRA分類・同一性解決、trigger source変換、純粋適用plan |
| 共有保存（新規） | `src/scenes.js`: JsonStore CRUD、revision、検索cursor、冪等create/copy、独立原画像と384px WebP、起動時回収 |
| 一覧取得（新規） | `public/core/scene-library.js`: query・mutation世代、cache、paging、stale応答抑止 |
| UI（新規） | `public/frontend/components/scenes/{scene-library,scene-editor,scene-image-picker}.js`、`public/frontend/styles/scenes.css` |
| 適用 | `public/features/{generate-workspace,generation-draft,prompt-lora-coordinator}.js` |
| 画面接続 | `public/frontend/app/{app-shell,shell-state}.js`、`public/frontend/components/shell/workspace-nav.js`、`public/frontend/components/library/image-library.js`、`public/frontend/styles/shell.css` |
| API接続 | `src/server.js`、`src/api/v1/router.js` |
| weight 0の整合 | `public/lora-tags.js`、`src/services/generation-service.js`: 明示選択0をProvider request・履歴まで保持 |
| 検証 | 新規`test/scenes.test.js`、`dev/studio/scenes-smoke.mjs`。追記`test/{generate-workspace,api-v1}.test.js`、`dev/studio/library-smoke.mjs`の失敗診断 |
| 配布・check | `dev/studio/server.mjs`のScenes proxy allowlist、`package.json`の`check:scenes`とprecheck接続 |

上記の既存ファイルには開始前からの未コミット変更を含む。GitのHEADとの差分全体を今回のScenes差分とは扱わない。既存未追跡の要件・設計・部分profile・Checkpoint Styleなども保持した。

## 保存・適用の契約

- 保存はLibrary画像IDから開始する。serverが出典を取得し、元Checkpoint名を参考snapshotとして固定する。代表画像変更で出典・Promptを入れ替えない。
- Promptは`appearance/composition/situation/style/extra`のみ。Structured履歴では有効な部分profileを共通helperで合成し、Raw/旧履歴では参考本文を見ながら手動入力する。Character欄を保存しない。
- Negativeは`userNegativePrompt`の存在を区別する。明示空文字・未保存をFinal Negativeで補完しない。
- 有効な非キャラクターLoRAを初期選択。全行で場面用/キャラクター用へ訂正可能。registryを変更しない。履歴にUID/full hashがなければ名前だけで強い同一性を作らず、保存時の明示確認、または適用時の手動選択に進む。
- UIDを優先し、既知hash衝突を拒否。UID不一致/なしはfull SHA-256で照合。曖昧一致・不足・衝突を表示する。弱い記録の手動解決はその適用だけに限定する。
- 保存管理Triggerは選択した場面LoRAのidentityとbase/outfit choiceへ変換する。Checkpoint/Character専用sourceを除外する。適用時に現在catalog名へ再構築し、削除対象LoRAのsourceだけ外す。共有sourceと保持キャラクターを残す。
- 空欄・LoRA保存0件・全件不足は現在値を維持。非空の置換対象sectionだけ旧profile snapshotを解除する。対象外profile・Checkpoint・生成設定・サイズ・creation source/mask/IP・title・完成画像を維持する。生成分類は場面へ合わせる。
- workspaceはbusy、Runtime context、catalog revision、recipe revision、最新scene内容を検査する。例外dialog中の変更で古い判断を拒否。planのpublic object改変でも検証を迂回できない。同期commitはdraftと分類をcapture/restoreし、成功時だけ1回emitする。
- RawのPositive適用は手動6欄分割を要求する。古いStructuredを初期値にせず、元Rawを非アクティブ側に残す。profileと管理Triggerは転記不要の補助表示。矛盾するinline LoRAは手動整理へ誘導し、保持するキャラクターと同じweightのinline指定は例外を増やさず維持する。
- 場面の本文置換によって元のinline指定が消えても、LoRA対象外/0件の現在選択が次の生成同期で消えないよう、Scene commit時に選択をcoordinatorへ確定する。

### weight 0の実装時調整

設計の「weight 0は空扱いしない」を検証したところ、既存coordinatorの再同期と生成履歴用の解析が0を0.05へ変える境界を確認した。新draftのcoordinator optionで明示0を保持し、Generation Runtime/API v1では0を追加の有効値として受ける。非zero範囲は従来の0.05〜2。旧inline parserの0→0.05規則は変更せず、serverが明示0選択から付加したタグについてのみ履歴weightも0へ揃える。request/responseの形・Job/History所有者は変更しない。fixture Providerへの実際のrequest文字列と保存履歴で0を検証した。

## 保存領域とAPI

`dataDir/scenes.json`と`dataDir/scenes-images/`を新設。原寸bytesとthumbnailはscene専用の不変asset IDで保存する。別名保存も独立複製。元Library画像を削除した後の編集・copyにHistoryを要求しない。

APIは設計の`/api/v1/scenes`一覧/作成、`/source/:imageId`、`/:id`取得/更新/削除、`/:id/copy`、`/:id/preview`。PATCH/copy/deleteのrevisionはJSON更新queue内で照合し409にする。create/copyのmutation IDはpayload fingerprintと一緒に記録し、応答喪失後の同一再送を重複保存しない。

画像は安全なHistory filenameからtempへ複製→thumbnail生成→rename→JSON commit。書込失敗は新assetを回収。削除はJSON commit後にscene assetだけを削除。起動前のrecoverはScenes専用領域の未参照asset/tempだけを対象にする。単一Node serverの複数clientを対象とし、複数server processが同じJSONへ同時書込する構成は保証しない。

## 検証結果

2026-09-11 JST。fixture serverは一意TEMP領域・動的loopback portで起動し終了済み。実データをfixtureに使用していない。

| 検証 | 結果 |
| --- | --- |
| Scenes/workspace/coordinator/LoRA tags/API v1/PWA/旧UI focused | 147 PASS、失敗0、exit 0 |
| `npm.cmd run check`（Scenes新規moduleを含む） | 02:39 JST PASS、exit 0 |
| `git diff --check` / 新規file whitespace / 文書リンク | PASS、exit 0 |
| `npm.cmd test` | 02:39 JSTの最新実行は882件中879 PASS / 1 FAIL / 既存skip 2。下記の並行変更によるHistory期待値不一致 |
| Scenes browser | PASS。1440/390/430pxで保存・上書き・copy・delete・画像picker・検索・分類・適用、原画像contain、横overflowなし |
| Scenes例外・共有 | browserでRaw分割/元Raw保持、不足LoRA取消/残り適用、NSFW適用、キャンセル後focus、別browser contextで共有、競合後未保存内容保持と別名保存 |
| 独立画像 | unit/HTTP/browserで元ファイル削除後の表示、編集/copy、別asset、JSON失敗時回収、起動回収を確認 |
| 既存Library browser | PASS。1280/1440/1920/390/430px。並列実行時にviewport即時判定が1度失敗し、幅とoverflow要素の診断を加えた単独再実行2回はPASS |
| Preview / Studio integration | 既存`smoke.mjs`と`integration-smoke.mjs` PASS。Previewは1280/1440/1920/390/430px・5状態 |
| 静的配布/legacy/PWA | 新module/CSSのHTTP配信、通常Production entryと`?legacy=1`のentry配信、既存PWA/unit回帰PASS。service workerのnetwork-only方針は維持 |

### 並行変更と最新full gate

02:29頃までの直前full suiteは877 total / 875 PASS / 0 FAIL / skip 2。その後、今回編集対象にしていない`public/section-profiles.js`が02:32:01 JSTに更新され、`normalizeSectionProfiles`の出力へ`disabledTriggerKeys: []`が追加された。最新fullの唯一の失敗は`test/history.test.js`の`section profile snapshots survive stored history and image recipe reads`で、期待値にそのキーがない差分。`src/history.js`と`test/history.test.js`は今回変更していない。

外部差分を戻したり、このタスクから別機能の期待値を更新したりしていない。Scenesは現在の共通profile helperを利用するため追加のsnapshot情報も保持する。最新workspace全体のcompletion gateはこの不一致の解消待ちとして区別する。

ログは`%TEMP%/lic-scenes-{final-focused,check,full,browser,library-regression,preview-regression,integration-regression}.log`。画像は`workbench/scenes/{editor,list}-{1440,390,430}.png`。代表例: [390px一覧](../../workbench/scenes/list-390.png)、[390px保存](../../workbench/scenes/editor-390.png)、[Desktop一覧](../../workbench/scenes/list-1440.png)。

## 残存する運用・検証条件

- 稼働Web serverは再起動していない。新APIを実運用へ反映する際はWeb server再起動とページ再読込が必要。今回の完了作業には含めない。
- 実Providerでの画像生成、実PCと実スマートフォンのLAN往復、実iPhone Safariは未実施。browserはローカルChromeのfixtureであり実機成功として扱わない。
- 実際のプロセス強制終了によるcrash試験は未実施。異常時の回収は未参照asset/tempを置くfixtureと書込失敗注入で確認した。
- Studioからの新規保存、適用取消、upload、タグ/folder、Checkpoint filter、Scenes MCP操作は追加していない。

次に読む入口は本書→[要件](../ui/scenes-requirements.md)→[設計](../ui/scenes-design.md)→`public/scenes.js`→`src/scenes.js`。別タスクのprofile変更が完了した後、History期待値とfull suiteの結果を更新する。
