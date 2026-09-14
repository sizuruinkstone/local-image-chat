# Frontend Refactor Phase 23 — Persistence / Bootstrap

2026-09-07。開始HEAD / Phase 22 checkpointは `2e37ec9`。同checkpointと開始時からのdirty/untracked成果物を保持し、stage/commit/push/reset/restore/cleanなし。Phase 23だけを実施した。

## Changed

Phase 23では、`public/core/preferences.js`、`public/features/settings-update.js`、`public/app/bootstrap.js`を追加した。`public/app.js`に散在していたapp-owned local/session storage access、version/update、PWA登録、起動phase、static listener lifecycle、page teardownを各ownerへ接続した。

既存controller stateをappへ戻さず、DOM/form、Runtime、Prompt/LoRA、Reference/Inpaint/IP、History/Studio、Queue、Experiment、Generation、Recipeの既存ownerを維持した。HTML/CSS、backend/API、History、storage schema、Service Worker、manifest、cache/update strategy、Runtime/Recipe/Generation semantics、framework/build systemは変更していない。

`package.json`は新3moduleのsyntax check登録に合わせ、監査で既知だった既存9 JS file（`public/sw.js`、`public/studio-history.js`、`public/history-title.js`、`src/storage-settings.js`、`src/reference-assets.js`、`src/mcp/attachment-reader.js`、`src/ip-adapter.js`、`src/instance-lock.js`、`src/api/v1/assets.js`）も既存`check`列挙へ追加した。check方式自体は変更していない。

## Bootstrap order

`createAppBootstrap()`はimport時に通信やlistener登録を行わず、appが`start()`を1回呼ぶ。既存実順序を次の名前付きphaseとして固定した。

1. pre-config owner init: Runtime → Checkpoint Set → LoRA Library → Civitai。
2. `loadConfig()`: `/api/config` → `/api/runtimes`、Runtime option/config defaults、candidate count/content rating/auto retry restore。static/server version比較は従来どおりfire-and-forget。
3. startup preferences: title → checkpoint control → img2img → Inpaint → Prompt部品 → GitHub session token。
4. PWA registration: `/sw.js`。失敗はwarningだけでbootstrapを止めない。
5. initial UI preparation: Prompt accordion/mode/trigger/Raw同期。
6. initial fetch `Promise.all`: health、Runtime checkpoint catalog、LoRA catalog、History/preferences、Civitai folders、LoRA root、Experiment、Checkpoint Set、Discord settings、Prompt template、AI share、Sampler、Storage settings、IP options。
7. initial render/sync: settings applied marker、txt2img、Generate control、Studio stats、clear buttons、IP UI。
8. app-lifetime Queue monitor開始。
9. primary app listeners。
10. controller init list。
11. remaining feature/app listeners。
12. settings general activation → hash/localStorage saved view restore → Comparison sync。
13. late Prompt preference listeners → single `beforeunload` teardown listener。

DOMは従来どおり`index.html`末尾のmodule script評価時点で取得するため、DOMContentLoaded待ちを新設していない。startのPromiseは再利用し、二重startによるlistener/fetch/monitor重複を防ぐ。

## Persistence ownership

`core/preferences.js`はapp-owned keyの定数と既存変換だけを持つ。domain横断storeではなく、feature stateを保持しない。

- scalar string / string boolean / number-like stringは従来の文字列のまま。
- JSON valueは破損・missing・`null`で既存fallback。
- LoRA/profile/outfitはJSON object ⇄ `Map`（保存は`JSON.stringify(Object.fromEntries(map))`）。
- LoRA weightは`Number`化し`0.05..2`、triggerは非空文字列・500文字上限、string mapは非空stringだけを採用。
- JSON arrayはgeneric readerでarrayのまま。Sampler controllerは従来どおりarrayからfavorite/recent `Set`を構築・arrayとして保存する。
- titleだけは既存どおりstorage access failureをbest-effortで無視し、mode→templateを同じtry単位で順次read/writeする。先行access failure後に後続keyへ触れないfallback境界も維持した。Recipe中の対象write failureだけは引き続き`RecipePersistenceError`へ変換する。
- `localImageChat.githubToken`と`localImageChat.civitaiToken`はsessionStorageだけ。Discord webhookはbrowser storageへ置かない。

Navigation、Runtime、Sampler、LoRA Library、Civitai、Inpaintは既存controllerが各feature keyを所有する。appはそれらへ明示storage portを渡し、key/schemaを統合・移行していない。

## Controller init order

pre-config:

```text
Runtime → Checkpoint Set → LoRA Library → Civitai
```

initial fetch/restore後のlistener init:

```text
Navigation → Sampler → Settings Navigation → Discord Settings → Storage Settings
→ AI Share → Queue → Image State → Studio → Comparison → History → Experiment
→ Reference Image → Inpaint → IP-Adapter
```

Settings Updateは旧app listener位置でinitする。Generation / Prompt-LoRA coordinator / Recipe workflow / Image Modalは従来どおりstartup `init()`を持たず、composition portまたは必要時生成で動く。Runtime→dependent availability、Prompt/LoRA→Checkpoint Set/Recipe、Image State→Studio/Gallery、Queue→Generation terminal observationのowner境界を変えていない。

## Listener / monitor lifecycle

Bootstrap-owned static listenerは単一registryで登録し、page teardown時に解除する。各controllerのidempotent `init()` / `dispose()`を維持し、旧app listenerとcontroller listenerの二重登録は追加していない。

QueueとExperiment monitorはapplication lifetimeであり、navigation/view切替ではdisposeしない。Queueは従来どおりinitial restore後・Queue indicator listener init前に開始する。page `beforeunload`時だけlifecycle generationを無効化し、sleep待機だけでなくin-flight GET応答もsnapshot/render/通知/History refreshより前に破棄する。

Reference/IP controllerは単体利用時の従来`beforeunload`管理をdefaultで維持する。app compositionでは`managePageLifecycle:false`として個別listenerを抑止し、bootstrapの1つのteardownからdisposeしてobject URLとpending readを一度だけ破棄する。navigation disposeとJob cancelは接続していない。

## Dead bridge cleanup

抽出後にreferenceを確認し、app内の旧storage JSON/Map loader、GitHub session helper、version/update handler、version renderer、Service Worker registrationを削除した。単一callerだけだった`configureRuntimeOptions()`、`loadCivitaiFolders()`、`loadLoraRoot()` wrapperは明示owner callへ置換した。

`loadLoras()`、`loadExperiments()`、`setResultTab()`、Recipe/Runtime/Form bridge等は実callerまたはowner境界があるため保持した。0-reference推測による削除は行っていない。

## Focused tests

新規:

- `test/preferences.test.js`: exact keys、version 3、missing/corrupt JSON、array/Map変換、weight/trigger/outfit validation、grouped title access failure、session-only GitHub token。
- `test/bootstrap.test.js`: exact startup/init/fetch order、start idempotence、listener/monitor重複なし、page teardown、PWA登録、実app composition wiring。
- `test/settings-update.test.js`: version一致/不一致/fallback、manual check/apply、session token、listener lifecycle、retryなし。

更新: Queue page teardownとin-flight応答guard、Reference/IP central lifecycle opt-out、既存source ownership assertionを追加・追従した。

architecture review修正後のaffected focused 8 files: **101 total / 100 passed / 0 failed / 1 existing skip、exit 0**。最終広域focused 33 files: **350 total / 348 passed / 0 failed / 2 existing skips、exit 0**。対象はPersistence/Bootstrapに加えUI shell、Runtime、Recipe、Prompt/LoRA、Navigation、Queue、Settings、Reference/Inpaint/IP、History/Studio/Experiment/Generation、PWA/Updater、Task20/22。後述のtitle部分成功fallback補正後はaffected 4 filesを **54 passed / 0 failed / 0 skipped、exit 0**で再確認した。

`npm.cmd run check`: **exit 0**。新3moduleと既知9漏れを含む。

## Full tests

architecture reviewで指摘されたQueue in-flight teardownとtitle grouped fallbackを修正し、affected/focused/checkがgreenになった後に`npm.cmd test`を実行: **778 total / 776 passed / 0 failed / 2 existing skips / 0 todo、exit 0**。その後の厳密なfallback auditで、template readだけが失敗した場合に先に取得済みのmodeを保持する旧挙動を補正したため、ユーザー指定のpost-review production修正例外としてaffected/check/fullを再実行した。最終full: **779 total / 777 passed / 0 failed / 2 existing skips / 0 todo、exit 0**。以後は文書だけを更新した。

## Browser smoke

最終production差分確定後、loopback fixture/mock backendと実Chrome **152.0.7977.77**で、最後まで完走するvalidation cycleを1回実行して **PASS**。fresh load / initial render、config/runtimes/versionと14 initial owner loadのassert対象path各1回、Runtime/catalog、Prompt/settings/profile保存、Gallery↔Generate、保存→reload restore、破損`loraWeights`/`promptParts` fallback、fixture generationを確認した。console error/warning、uncaught、unhandled rejection、予期しないHTTP failure、外部requestはすべて **0**。fixture serverは停止済み。

完走前のharness調整では、hidden settingsの`runtimeSelect`を可視要素として操作したtimeout、有効でないfixture profile idが既存reconciliationで正規profileへ直されたassert mismatch、hidden legacy `prompt`への可視fill timeoutの3回で途中停止した。いずれもapp console/network failureではなく、ignored smoke scriptだけを既存controller/event bridge方式へ修正した。production codeは変更せず、修正後のcomplete cycleだけが最後まで到達した。その後のtitle部分成功fallback補正はnormal browser pathを変更しないためBrowserを反復せず、affected/check/fullで確認した。実provider/実generation/update applyは行っていない。

## Remaining risk

`app.js`にはDOM cache、form/read/render/persistence adapter、Prompt/LoRA profile適用、Runtime/Recipe port、派生フォーム準備とcomposition lockが残る。これはPhase 1–22 owner間のcompositionであり、Phase 23で中央storeや逆importへ置換していない。

History初期結果が空のままinitial Galleryへ入る場合の再fetch、healthによるRuntime fallback時のcatalog/external resource再取得、Queue terminal/Generation完了双方からのHistory refreshは既存semanticsである。各ownerのloading/token/generation guardを維持し、bootstrap global tokenやfetch deduplicationは追加していない。

## Architecture review

最終差分をAstraでread-only review 1回実施。**P1なし**。startup/14-load順、storage key/version/serialization、PWA/update、owner境界、Reference/IP central teardown、tooling追加を確認した。P2のQueue in-flight teardown後副作用とP3のtitle storage try単位を指摘され、production修正と回帰testを追加した後にaffected focused → broad focused → check → fullを実行し、上記のとおりgreen。重大findingは残っていない。
