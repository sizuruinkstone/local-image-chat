# Frontend Full Rebuild R1 — Functional Contract / Adapter Boundary

完了: 2026-09-07。ユーザー承認済みR1を単独実装。R2・Production entry切替は未実施。計画追加ではなく、共有core抽出＋DOM非依存Generate workspaceの実装。

## 公開入口と実装したboundary

[createGenerateWorkspace](../../public/features/generate-workspace.js)を新entryから一度生成する。新UIはsnapshotとcommandだけを使用し、旧app、旧DOM、旧modal、旧render、page stateを参照しない。

| Module | 実装内容・共有範囲 |
| --- | --- |
| [runtime-service](../../public/core/runtime-service.js) | 既存Runtime controllerからstate、catalog、選択、health、context/token、rollbackを抽出。旧/newとも同じserviceを利用 |
| [runtime-controller](../../public/features/runtime-controller.js) | 旧UI用の58行adapter。Option生成・element更新・event登録だけを担当。既存呼出interface維持 |
| [generation-request](../../public/core/generation-request.js) | `buildGenerationRequest(form, description, count)`。既存Generationと新workspace共通の組立処理。IP→one-shot→settingsの読取順を維持 |
| [generation-settings](../../public/core/generation-settings.js) | `settingsWithCheckpoint`と`recipeParameterPatch`。旧appと新draftが同じcheckpoint payload／metadata復元対象を使用 |
| [recent-history-service](../../public/core/recent-history-service.js) | 最新20件、all/favorite、loading/error、最新応答guard。旧HistoryのRecent取得と新workspaceが共有 |
| [generation-draft](../../public/features/generation-draft.js) | 新entry用canonical JS draft。Prompt、Negative、Structured/Raw、parameter、description、LoRA payload annotation。選択/source/disabledは既存Prompt-LoRA coordinatorが所有 |
| [generate-workspace](../../public/features/generate-workspace.js) | 上記と既存Generation controllerを合成。catalog/init、編集command、生成、状態通知、結果画像、Recent、metadata reuseを公開 |

新旧entryは同じfactory／契約を利用するが、同時に起動してstateを双方向同期する方式ではない。旧formの読取は旧app adapterに残る。新entryのPrompt/Parameters/LoRAはJSを正本とし、DOMは存在しなくてもよい。Runtime/modelとgeneration予約は各既存ownerのstateをsnapshotへ投影する。

## R2から利用するAPI

```js
import { createGenerateWorkspace } from "/features/generate-workspace.js";

const workspace = createGenerateWorkspace();
if (!await workspace.initialize()) throw new Error("Workspace initialization failed");
const unsubscribe = workspace.subscribe((snapshot) => render(snapshot));
render(workspace.getSnapshot());

workspace.setPrompt({ positive: "a cat in a garden", negative: "blur" });
workspace.setParameters({ width: 768, height: 1024, seed: 42 });
await workspace.selectModel(modelTitle); // installedCheckpoints[].title
workspace.addLora(loraName, 0.7);
const requestPreview = workspace.buildRequest(); // POSTしない
await workspace.generate();

// app終了時だけ。panel切替やInspector開閉ではdisposeしない。
unsubscribe();
workspace.dispose();
```

| API | 意味 |
| --- | --- |
| `initialize()` | config/live runtimes（失敗時config fallback）、checkpoints、LoRA、sampler/scheduler、Recent取得。一度成功したinitは再実行しない。失敗時は再試行可 |
| `getSnapshot()` / `subscribe(fn)` | cloneした状態の取得／変更通知。subscribeは初期通知を行わない。購読解除functionを返す |
| `setPrompt({positive, negative, sections})` | positiveはRaw編集、sectionsはStructuredへ切替。片方だけの変更でNegativeを消さない |
| `setParameters(patch)` | resolution、seed、samplerName、scheduler、steps、cfgScale、candidateCount等。checkpointは`selectModel`を使う |
| `setDescription(text)` / `setAutoRetry(bool)` | 説明文と既存autoRetry。説明だけで生成した場合は既存`/api/prompt`からJobへ接続 |
| `selectRuntime(id)` / `selectModel(title)` | DOM値を読まず明示引数で選択。active/selectedを区別し、生成中・model選択中は編集を禁止 |
| `addLora` / `setLoraWeight` / `removeLora` / `toggleLora` | 既存coordinatorに委譲。UI追加でtagを挿入しない。weightは既存tag更新、removeはtagも除去 |
| `buildRequest()` | shared assemblerでtxt2img payloadを返す。送信なし。autoRetryは既存Generation controllerがPOST時に追加 |
| `generate()` / `cancel()` | 既存Job POST/poll/DELETE、排他、承認付きrecovery一回を利用。成功/失敗はsnapshotで観測（既存controllerは生成errorをthrowせず表示portへ渡す） |
| `selectImage(id)` | completed.imagesから表示中画像を選択 |
| `loadRecent("all" \| "favorite")` | latest 20 generations。全Gallery検索・paginationを新実装したものではない |
| `reuseMetadata(recipe, image)` / `reuseImage(imageId)` | Runtime readiness後にPrompt/Parameters/LoRAを適用。後者は現行recipe endpointの`selectedImage`を利用 |
| `dispose()` | appの監視をdetach。backend Jobをcancelしない。遅い応答／recovery確認後の再POSTを防止 |

snapshot: `ready`, `runtime`, `catalogs`, `prompt`, `parameters`, `loras`, `description`, `title`, `contentRating`, `autoRetry`, `generation`, `completed`, `currentImage`, `recent`, `reusing`, `selectingModel`。

`generation`はphase（idle/preparing/running/succeeded/failed/cancelled）、job、error、busy、activeJobId。生成失敗でもdraftと前回完成画像を保持。view購読者の例外はJob/Runtime transactionを壊さない。UIはsnapshot内objectを変更してcommandの代わりにしない。

## Metadata reuseの範囲と未移行機能

R1のreuseは`{applied:true, scope:"prompt-parameters-loras", excluded:[...]}`を返す。seedは選択imageから、candidateCountは1へ。checkpoint/source/maskを復元しない既存規則を維持し、Runtime切替成功後にdraft適用が失敗してもRuntimeを巻き戻さない。取得中のmetadataは新しい編集／reuse／生成開始で無効化する。

旧Production側では従来のRecipe workflow、保存、Checkpoint Set自動適用、profile/outfit/trigger編集、Title設定、Reference、Inpaint、IP、Hires、Compare、Experiments、Queue、Civitai、Gallery管理、Preferencesが動作し続ける。

新workspaceはR1のtxt2imgに限定。次はまだ接続していない:

- Hires、Reference/Inpaint/IPの入力owner、派生one-shot、全Queue・Experiments。request reader portsは共有assemblerに保持しているが新workspaceから有効化していない。
- Checkpoint Set自動適用、LoRA profile/outfit編集・永続設定。R1はcatalogからの基本追加と、reuse済みLoRA annotationを扱う。全profile機能のparityではない。
- 新draftの永続保存・旧保存設定の全restore。Runtime/lastCheckpointは既存storage key、draftはsession中のJS state。旧UIの保存を変更していない。
- 全Galleryのpaging/filter、Favorite更新、Library管理。Recentは限定read contract。

R2のNew Shell＋基本Generate接続を阻害するlegacy DOM依存はない。ただし上記高度機能の新shell接続完了やproduction全面切替の条件を満たしたとはしない。

## Characterization / 検証

実施日: 2026-09-07。

| 検証 | 結果 |
| --- | --- |
| 開始baseline `npm.cmd test` | 784 total / 782 pass / 0 fail / 2 skips |
| Runtime/Generation抽出直後 | 38 pass / 0 fail |
| shared境界の既存focused（5 files） | 68 pass / 0 fail |
| 新[workspace test](../../test/generate-workspace.test.js) | 21 pass / 0 fail。DOMなし、Prompt/Negative、Model、全primary parameter、LoRA操作、request、busy/success/failure/cancel、reuse、rollback、stale/dispose、依存closure |
| 最終affected（task20/task22/workspace） | 63 pass / 0 fail |
| `npm.cmd run check` | exit 0。新6moduleを既存precheckへ追加 |
| 最終 `npm.cmd test` | **805 total / 803 pass / 0 fail / 2 existing skips / exit 0** |
| Node dev smoke | PASS。DOMも実APIも使わずmodel一覧、Prompt編集、LoRA取得、request生成 |
| Chrome fixture | PASS。旧UI生成→Gallery metadata→同Seed読込、1440/390/430 overflowなし。空documentで新workspace生成・reuse、旧input/textarea/select数0 |
| Browser errors / HTTP failures | 0 / 0。fixture serverはpublicを無変換配信、実provider/外部APIなし |

全suite初回は旧Runtime source位置を固定した3件だけ失敗（805 total / 800 pass / 3 fail / 2 skips）。task20はservice/adapterへ検査先を追従、task22の2件はLocal API呼出とNeo selected/active保持のbehavior testへ置換した。テストを削除・skipしていない。再実行で全green。

Browser harnessは途中で2回修正した: 折り畳みNegative欄を開く操作、Gallery先頭の既存fixtureを選択した時の期待Prompt。いずれもproduction修正なし。最終complete cycleのみPASS証拠として扱う。1440 screenshotは目視確認済み。実Safari・実provider生成・実保存データmigration等は未実施。

logsはrepository外の`%TEMP%/local-image-chat-r1-*.log`。ignored [Node smoke](../../workbench/r1/smoke.mjs)、[browser smoke](../../workbench/r1/browser-smoke.cjs)、[1440 screenshot](../../workbench/r1/legacy-1440.png)を保持。Node smoke実行: `node workbench/r1/smoke.mjs`。Browser fixtureは`browser-server.mjs`（loopback 41971）＋browser-smoke、検証後停止。

## 変更file / 保持

新規production 6: `public/core/{runtime-service,generation-request,generation-settings,recent-history-service}.js`、`public/features/{generation-draft,generate-workspace}.js`。

既存production変更4: `public/app.js`、`public/features/{runtime-controller,generation-controller,history-controller}.js`。加えて`package.json`、test3 files（workspace新規、task20/task22更新）、本書、current-state、decisions。

HTML/CSS、backend、API/schema、既存storage、Production entryは変更していない。開始時のDESIGN/CURRENT_TASK/REVIEW_FIXES、既存app/History/Studio/HTML/CSS/test差分、未追跡docs/output/scripts等を保持。stage/commit/pushなし。R1完了で停止し、R2は未着手。
