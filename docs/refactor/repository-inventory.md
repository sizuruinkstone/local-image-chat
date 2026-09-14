# Repository Surgery Audit — Repository inventory

監査日: 2026-09-06。既存 `C:\AI\local-image-chat`、HEAD `3527a98` と未コミットのPhase 1/2を含むworking treeを対象とする。調査と文書作成のみ。正本は [current-state](../implementation/current-state.md)、[decisions](../implementation/decisions.md)、[Discovery](../implementation/frontend-refactor-discovery.md)、[Phase 1](../implementation/frontend-refactor-phase1.md)、[Phase 2](../implementation/frontend-refactor-phase2.md)、[package.json](../../package.json)。

関連成果物: [file disposition](file-disposition.md)、[target architecture](target-architecture.md)、[surgery plan](surgery-plan.md)。提案先は未作成と明記し、現在存在するpathと区別する。

## 1. Overview / 調査方法

Supervisorが文書・配信・更新境界・最終判断を担当し、Frontend、Backend、Tests/dependency/dead-codeの独立したread-only調査を3 subagentへ委譲した。巨大fileはsymbol/import/対象rangeを読み、generated/local/private artifactの本文は走査しない。rootで集約した現在の数は **src JavaScript 43、public JavaScript 24、test 53 file**。line数は現working treeの参考値で、移動時はsymbolで再検索する。

```text
browser index.html → app.js → public feature/helper modules
                          → legacy HTTP API → server / generation service
MCP stdio → thin client → API v1 ──────────→ shared generation service
                                              → JobManager / runtime providers
                                              → History / storage / integrations
Express public static + outputs/favorites/thumbnail routes → browser images
```

Phase 1はJSON transport、Phase 2はnavigationを抽出済み。backend services/API v1/MCPも既存の分離資産。`public`にはNodeからimportするpure helperもあり、frontend専用と断定できない。root entrypoint、updater allowlist、配信URL、保存rootを伴うため、folder変更は依存関係の変更でもある。

| Top-level | 現在の位置付け |
| --- | --- |
| `public/` | browserへ直接配信するHTML/CSS/native ESM/PWA/assets、一部cross-environment pure logic |
| `src/` | Express composition、legacy/API v1、services、runtime、persistence、integrations、MCP |
| `test/` | Node test runnerのunit/integration/source assertions。実browser automationなし |
| `docs/`, root Markdown | 正本・運用reference・過去task・個人研究成果が混在。下記文書map参照 |
| `package.json`, lockfile, `install.bat`, `start.bat`, `start-lan.bat` | 既存起動/依存/更新contract。buildなし |
| `config.json`, examples | version管理対象の基準と設定例。現在のruntime要件を勝手に初期化しない |
| `.env`, `config.local.json`, `data/` | secrets/ローカル設定/保存正本。本文監査対象外、保護 |
| `outputs/`, `thumbnails/`, `output/`, root PNG | 生成・cache・調査成果。複数形/単数形の類似だけでduplicateとしない |
| `.updates/`, `.obsidian-memory/`, `workbench/`, `.claude/`, `scripts/` | backup/私的memory/作業成果/agent設定/補助script。現在の利用者確認前に整理しない |
| `node_modules/`, `.git/` | installed dependencyとrepository metadata。通常のsource探索・cleanup対象外 |

## 2. Frontend file map

表内のpathは特記しない限り `public/` 相対。A=`app.js`。HTTP/永続化「なし」はそのmodule自身が直接行わない意味で、callerの副作用は別。state ownershipは現状を記し、将来案と混同しない。

| File | 責務 / import → / imported-by ← | DOM・state owner | HTTP / LS・SS / feature依存 |
| --- | --- | --- | --- |
| `app.js` | compositionと全workflow → 下記21 module; ← index | 全elements、form、catalog、選択、cache、timer、初期化順 | legacy API全般 + direct fetch、保存key群。ほぼ全feature |
| `core/http-client.js` | GET/POST/PATCH/DELETE JSON; importなし; ← A | なし | fetchのみ。parse/status/error順を固定、storageなし |
| `features/navigation.js` | createNavigation → view-router; ← A | currentView、注入DOM、nav/hash listener | HTTPなし、hash/history + LS view。gallery/compare entry callback |
| `view-router.js` | view/hash正規化; ← navigation | pure | なし |
| `option-picker.js` | sampler section/preset/recent/favorite計算; ← A | pure | fetch/保存はA |
| `lora-profiles.js` | profile/presetデータと解決; ← A | pure | registry/catalog入力 |
| `checkpoint-profiles.js` | checkpoint推定/LoRA互換; ← A | pure | runtime/form caller |
| `lora-preview.js` | preview URL、weight/filter判定; ← A | pure | URLを組立てるだけ |
| `lora-outfit-selection.js` | outfit/source/trigger → structured-prompt; ← A | pure | Prompt/LoRA選択 |
| `lora-tags.js` | parse/reconcile/weight; ← A、generation-service | pure、cross-environment | generation payload契約 |
| `structured-prompt.js` | section/trigger/Prompt正規化; ← A、prompt-import、outfit、backend prompt/generation services | pure、cross-environment | Prompt契約 |
| `prompt-import.js` | AI出力parse/merge → structured-prompt; ← A | pure | dialog適用/clipboardはcaller |
| `history-title.js` | title/template/表示; ← A、server/history/generation-service | pure、cross-environment | History title正規化契約 |
| `preset-catalog.js` | character/outfit/catalog/tree/count; ← A | pure変換 + DOM生成、resolver callback | API/storageなし、LoRA入力 |
| `civitai-folders.js` | folder正規化/recent/favorite grouping; ← A | pure | LS保存はA |
| `gallery-filter.js` | generation→image、filter/sort/tags; ← A | pure | server pagingとは別 |
| `studio-history.js` | recent entry filter; ← A | pure | History snapshot入力 |
| `metadata-format.js` | copy用Prompt/metadata文字列; ← A | pure | clipboard操作はcaller |
| `image-delivery.js` | thumbnail/original/fallback; ← A、compare-view | img error listener | image URL取得、fallback。JSON/storageなし |
| `queue-view.js` | queue summary/panel; ← A | DOM + 注入handler | poll/API/stateはA |
| `compare-view.js` | diff/comparison/vote modal → ui-kit、image-delivery; ← A | modal DOM | vote callback。直接HTTP/storageなし |
| `lora-editor.js` | metadata dialog → ui-kit; ← A | dialog DOM | save/move callback。直接backend import/HTTPなし |
| `ui-kit.js` | toast/modal/clipboard/busy; ← A、compare-view、lora-editor | document、focus/keydown/toast/modal state | HTTP/storageなし、browser依存 |
| `sw.js` | install/activate/fetch handler; ← Aの登録 | service worker lifetime、CacheStorage | offline cacheなし、activate時cache削除 |
| `index.html` | static shell → style/manifest/app | 全4画面・form・dialogの静的DOM | selectorと入力ownerの契約 |
| `style.css` | 全画面/base/component/responsive | cascade、media/safe-area、fixed/sticky | HTML class/IDとappのdataset |
| `manifest.webmanifest` | install metadata; ← index | start/scope `/` | icon-192宣言 |
| `version.json` | 配信版整合; ← A/test | static version | no-cache fetch、server版と照合 |
| `icons/`, `image-placeholder.svg` | icon/fallback | 静的asset | index/manifest/image-delivery。512系は候補確認が必要 |

publicのstatic importにappへの逆import/cycleは確認されなかった。結合の中心はapp内の暗黙read/writeとcallback順。pure helperをさらに移動するだけではこの結合は減らない。

### Feature map / 現ownerとI/O

| Feature | 主要symbol / state / DOM | HTTP・永続化・横断依存 |
| --- | --- | --- |
| bootstrap/navigation | loadConfig、elements、navigation init、loadInitialView | config/health/catalog初期load、保存値復元。config→SW登録→parallel load→listener順 |
| runtime/checkpoint | runtime選択/active、request token、snapshot/restore、loadSamplerOptions | runtimes/checkpoints/loras/samplers/IP options。LS runtime/lastCheckpoint/profile/autoApply |
| sampler | SAMPLER_STORAGE、syncSamplerLabels、openSamplerPicker | option-picker/ui-kit、samplers API、favorite/recent保存、profile/recipe後form同期 |
| Prompt/raw | structured fields、raw override、trigger/source maps | prompt生成、promptParts/LoRA maps保存。400ms debounce、programmatic更新抑制 |
| LoRA/library | installed/selected/pinned、profiles、outfit/weight/source/disabled | loras/refresh/registry/ensure/move、LS maps・profile version 3、Prompt/Civitai/runtime依存 |
| Civitai | inspected result、folders/root/token | inspect/duplicate/install/register/folders、LS recent/favorite、SS token |
| checkpoint sets | fingerprint、autoApply、set selection | checkpoint-lora-sets CRUD、runtime/form/LoRA |
| img2img/reference | source/mode/resolution | FileReader/Image、upload/history image、denoising/resize保存 |
| inpaint | canvas、mask、paint/erase、undo/redo | reference + pointer/canvas、mask設定保存、PNG mask payload |
| IP-Adapter | options/reference/object URL | ReForge options、recipe復元、runtime capability、URL revoke |
| generation/Hires | activeJobId/busy/result/pendingDerivation | jobs POST/GET/DELETE、recovery、form snapshot、History保存はbackend |
| queue | last snapshot/seen terminal/polling | queue/jobs/experiments cancel、1200ms poll、app lifetime |
| Studio/result | selected generation/image、inspection/recent | thumbnail/original、metadata/title、History正本 |
| Gallery/History | loadHistory/renderHistory、cursor/loading/filter/cache | `/api/history?limit=20&cursor=...`、preferences/rating/delete/recipe、Studio/image-state連携 |
| image Favorite/Discord | ID maps/watch sets、複数data selector | Favoriteとgeneration通知の2系統、History/Discord保存。LoRA favoriteは別 |
| comparison | selection Map、tray/modal、vote | comparisons API、History snapshot/delete連携、2–4枚 |
| experiments | base request/seed、run/entry cache/monitor | experiments CRUD/cancel/history、queue/form snapshot/recovery |
| settings shell/Discord/storage | category/search、safe settings、storage plan/busy | 各settings API。storageはplan→reserveで実移動はbackend |
| AI share/template | manual trigger getter、1500ms CSV debounce、clipboard | AI-share/template API、best effort更新、server保存 |
| version/update | version照合、GitHub token | version.json/update、SS token。updaterはbackend |
| modal/shared/persistence | ui-kit、form値、localImageChatキー群 | appに37個のlocalImageChat key文字列。中央store化の根拠にはしない |

### Mixed responsibility / coupling

- `app.js` 9,939行 / 413,084 bytes: `readSelectedLoras()` は同期・保存・再描画を伴い、`readDerivationPayload()` はpending stateを消費し、`renderHistory()` はimage/Discord state・watcher・Studio recentも更新する。名前だけでpureとして切り出せない。
- runtime切替はrequest token、4 catalog取得、snapshot/rollbackを跨ぐ。selected checkpointとNeo active checkpointは別。Prompt/LoRA/raw/triggerの双方向同期はcoordinatorに順序を残す。
- job poll（850ms）、queue、experiments、Discord2系統、elapsed timerとdebounceはapp lifetime。view disposeに結び付けると生成中の監視が止まる。
- `index.html` 1,250行 / 87,277 bytes: 4画面と全form/modalのDOM ownerが同居。wrapper追加でもfocus・scroll container・selectorに影響する。
- `style.css` 3,584行 / 147,006 bytes: feature/base/responsiveが積層し、360–1400pxの複数breakpointと後段overrideを持つ。CSSをfeatureへmoveする前にcascade順とsafe-area/fixed navをcharacterizeする。
- History loading中の要求破棄、Studio recentのrequest token不在はコード上のrace候補。今回再現・修正していない。抽出とbug fixを分離する。

### Static-delivery constraint

現在のpublic内**全browser-reachable file**（HTML/ESM/CSS/SW/manifest/version/icons/placeholder）は`src/frontend`へ単純move不可。`src/server.js:210`のExpress static、相対import、root URLを揃える必要がある。詳細なbuild/copy/static root比較は[target](target-architecture.md)。

serverは`/outputs/.reference-assets`をstaticより前で遮断し、画像を`/outputs`・`/favorites`とimmutable cacheで配信する。一覧thumbnail、明示操作original、失敗時original→placeholderの順を維持。SWはnetwork素通しでprecache一覧はない。manifestのscope/start URL、登録URL、version整合、updaterのbackup/restoreは別途gateにする。

## 3. Backend module map

pathは `src/` 相対。参照元はproductionの主要import/callback注入を示す（全test importはtest map参照）。S=server、G=generation-service。保護契約を含むKEEPは「削除・挙動変更が安全」を意味しない。

| Module | 責務 / 主な参照元 | 外部contract・state/storage・migration/runtime |
| --- | --- | --- |
| `server.js` | entry/composition、legacy routes、static、startup | root算出、lock→storage/migrations→listen、config、全service注入。EXTRACT候補 |
| `services/generation-service.js` | legacy/v1のvalidate・生成・保存・recovery; ← S | createLegacyJob/generateLegacyNow/createV1Job、payload/DTO、History/JobManager/runtime。EXTRACT候補だが高risk |
| `services/prompt-service.js` | raw/structured/boost; ← S/G | 6-section順、raw/null semantics、public pure helper。KEEP |
| `generation-runtimes.js` | registry/default/ReForge adapter; ← G | reforge/forge-neo-anima、descriptor/features/default、fallback。保護 |
| `forge-neo.js` | provider/config/catalog/activation; ← registry | public checkpoint allowlist、queue内prepareGenerationと検証順、managed-options/preloaded、再送なし。保護 |
| `reforge.js` | provider HTTP/catalog/generate/IP; ← S/G/registry/Civitai/Neo | legacy payload、checkpoint/options/progress、ReForge互換。保護 |
| `job-manager.js` | FIFO/status/cancel/subscription; ← S/experiments | in-memory job寿命、status/progress/retention。保護 |
| `recovery.js` | error分類/retry plan; ← G | MAX_RETRY_COUNT=1、UI確認workflow。保護 |
| `ollama.js` | health/prompt/unload/tags; ← S/G | Ollama adapter、Prompt parsing。KEEP |
| `api/v1/router.js` | mount/error mapping; ← S | error code/message/statusのsafe DTO。保護 |
| `api/v1/assets.js` | raw import/parser; ← S/router | PNG/JPEG/WebP、12MiB、201、JSON parserより前。保護 |
| `api/v1/capabilities.js` | GET bridge; ← router | capabilities DTO、stateなし。KEEP |
| `api/v1/generations.js` | create/get/cancel/serializer; ← router | 202、progress 0–1、安全なjob結果。保護 |
| `api/v1/history.js` | list/detail/regenerate/serializer; ← router | generation ID、field差、safe image IDs。legacy画像cursorと同一視しない |
| `mcp/server.js` | stdio entry; executable | env/base URL、安全なstdout、独立process |
| `mcp/tools.js` | 9 tool登録/content/error; ← MCP server | tool名/input/output/null、省略規則。保護 |
| `mcp/schemas.js` | strict zod input; ← tools | accepted shapes/defaults。保護 |
| `mcp/local-image-chat-client.js` | v1 HTTP/DTO validation/image bytes; ← tools/server | base URL/timeout/error/safety。長いがcohesive、KEEP |
| `mcp/attachment-reader.js` | attachment allowlist/bytes; ← tools/server | local root/path/image safety、任意path読取禁止。保護 |
| `history.js` | CRUD/normalization/paging/preferences; ← S/G | history.json schema v2、画像cursor/merge、rating/runtime fallback/title。migrationsも同じJSON/schemaを更新するが本moduleをimportしない。保護 |
| `migrations.js` | startup migrations; ← S | registry v6/history v2、backup→atomic replace。保護 |
| `json-store.js` | read/update/temp+rename; ← persistence services | serializeされた書込順とatomicity。保護 |
| `storage-settings.js` | validate/plan/reserve/migrate; ← S/startup | storage-settings.json/marker/operation queue/output roots。transaction単位で保護 |
| `reference-assets.js` | registry/image validation/resolver; ← S/v1経由MCP | reference-assets.json、hidden .reference-assets、public ID/path非公開。保護 |
| `ip-adapter.js` | validate/normalize/reference filename; ← G/history/reforge | 参照1種のみ、weight/guidance、保存metadataからdata URL/path除去。保護 |
| `thumbnails.js` | 安全なlazy thumbnail生成; ← S | ID/filename/traversal、WebP、重複生成抑制。KEEP/保護 |
| `content-hash.js` | file-byte SHA256/path safety; ← S/history/integrations/G | 外部同期の安定content identity。KEEP/保護 |
| `experiments.js` | validate/run/jobs subscription; ← S/G | experiments.json、active排他、recovery/status、cancel-before-delete。保護 |
| `checkpoint-sets.js` | CRUD/autoApply; ← S | checkpoint-lora-sets.json。KEEP |
| `discord.js` | webhook/settings/send/state; ← S/history/integrations | discord-settings.json、Favorite/生成通知別state、重複送信抑制、secret非公開。保護 |
| `prompt-template.js` | template CRUD; ← S | prompt-template.json。KEEP |
| `ai-share.js` | CSV parse/build/manual state; ← S | ai-share.json/lora_list.csv、手動trigger優先、best effort。KEEP |
| `civitai.js` | inspect/download/duplicate/install/move/registry; ← S | network+filesystem transaction、registry/manual metadata優先。EXTRACT候補 |
| `civitai-token.js` | request/env token解決; ← S | precedence/non-persistence。KEEP |
| `lora-registry.js` | identity/merge/manual edit/preset; ← Civitai/migrations | schema v6/manualFields優先。UI editorとはcallback/API越しの関係、直接browser importなし |
| `lora-root.js` | root検出/解決; ← S/Civitai | 曖昧root/危険root拒否。KEEP/保護 |
| `lora-folder.js` | install subfolder; ← Civitai | traversal防止。KEEP/保護 |
| `lora-files.js` | sidecar collect/move/collision; ← Civitai | file set整合。KEEP/保護 |
| `lora-weight.js` | HTML clean/weight抽出; ← Civitai | metadata変換、pure。KEEP |
| `integrations.js` | external favorite resolve/sync; ← S | x-local-integration-key、max500、idempotent notify。保護 |
| `instance-lock.js` | root/port lock/stale/release; ← startup | 単一起動とstorage保全。KEEP/保護 |
| `net-info.js` | binding/LAN URL; ← S | loopback既定、公開警告。NULを含むregexがありrgがbinary扱いするsource品質課題、未修正 |
| `updater.js` | GitHub ZIP/version/apply/npm install; ← S | UPDATE_PATHS、backup/restartRequired/rollback。保護 |

### Already-clean / mixed debt

API v1の薄いadapter、services/prompt-service、JobManager、recovery、provider registry、path helpers、thumbnails/content-hash、既存MCP分離はKEEPする価値が高い。Neoは904行でもactivation/config/catalogを同じprovider境界に置く理由があり、長さだけでは分割を推奨しない。

実際の混在はserver（1,491行）のprocess startup/static/legacy routes、generation-service（1,749行）のlegacy/v1 validation・複数生成workflow・保存/recovery、Civitai（991行）のnetwork inspectionとfile install/registry transaction。将来の限定抽出候補。storage-settings（1,052行）、experiments（594行）、MCP client（868行）は長さ/複数内部段階があるが、transaction/protocol境界としての凝集性があり、直ちに分割する根拠は弱い。

最近のcommitは`3527a98`（Neo/MCP）、`2980002`（API v1）、`3746507`（runtime/storage/IP）、`66cb23e`（v3 workflow）とfeature横断単位。legacy/v1併存やReForge adapterとregistryは互換性のためでdead duplicateではない。履歴粒度が粗いためfileごとの将来変更頻度は未測定、頻繁だと断定しない。

## 4. Tests / dependencies / tooling

全53 fileはNode runner。以下は主分類であり、一部は複数性質を持つ。名前は `test/` 相対、列内では `.test.js` を省略。

| 主分類 | Files | 保証範囲・限界 |
| --- | --- | --- |
| frontend/helper/characterization（17） | http-client, navigation, studio-history, structured-prompt, queue-view, prompt-import, preset-catalog, metadata-format, lora-tags, lora-profiles, lora-preview, lora-outfit-selection, image-delivery, compare-view, civitai-folders, checkpoint-profiles, ui-shell | pure + stub DOM。ui-shell後半はsource assertions。Phase1/2は既存behavior characterization |
| backend/service unit（23） | updater, thumbnails, storage-settings, reforge-loras, reference-assets, recovery, ollama, net-info, mcp-client, lora-weight, lora-root, lora-folder, lora-metadata, lora-duplicate, job-manager, instance-lock, history, experiments, discord, content-hash, civitai, checkpoint-sets, ai-share | mock HTTP/temp storage/pure。実provider E2Eとは異なる |
| integration/contract（7） | api-v1, favorite-sync, mcp-tools, server-integration, server-experiments, server-recovery, server-workspace | Express/SDK in-memory transport/子server。最後4件はsrc/server.js spawn |
| provider横断characterization（2） | task20, task22 | Neo runtime/profile/queue/API/MCP + UI source assertion |
| dedicated source/static（4） | ui, image-delivery-ui, layout-overflow, pwa | text/regex/assets。実DOM/CSS/PWA lifecycleを保証しない |

実browser runner/framework/dependencyは0。Phase 2のChrome fixture smokeは実施記録であり常時自動化されたsuiteではない。今回suiteを実行していないため、548 passed等の過去記録を今回の結果にしない。

### Path / source coupling

| Tests / entry | 固定path・source依存 | relocation時の対応 |
| --- | --- | --- |
| ui-shell | package/lock/version、index/app/style、navigation/lora-editor/ui-kit/preset-catalogの文字列 | assertion ownerを新featureへ追従。旧関数名regexを無言削除しない |
| ui | public/app/indexを読みelements/IDをregex抽出 | DOM lookup abstractionでも壊れる。DOM接続契約として整理 |
| image-delivery-ui | app/compare-view/index/image-delivery | original/thumbnail intentのbehaviorと配信pathを分離 |
| pwa | manifest/icons/index/sw/app/ui-kit/compare/style | URL/scope/assetは実contractとして残す |
| layout-overflow | style.cssのtoken/regex | computed layoutの代用にしない。CSS移動とviewport確認を組合せる |
| task20（1201付近〜）、task22（512/541付近〜） | app/sourceのruntime/profile wiring | 新controllerへassert所有者を移す。provider contractは残す |
| server-integration（152付近〜）、civitai（28–42付近） | app/server/package/.env等source | route/startup/設定contractと実装文字列を切分ける |
| server-* 4件 | root cwdから`src/server.js` spawn、workspaceはpackage copy | server entry移動・root算出・fixtureの起動口を揃える |
| 直接importを持つ全tests | `../public/...`、`../src/...` | test自身またはmodule移動時に相対import追従が必要 |

### Package observations

start=`node --env-file-if-exists=.env src/server.js`、mcp=`node src/mcp/server.js`、test=`node --test`、engines Node>=20。checkはfileを明示列挙する長いchain。build/devDependenciesなし。

`node --check`リストにない現在の9 file: `public/sw.js`、`public/studio-history.js`、`public/history-title.js`、`src/storage-settings.js`、`src/reference-assets.js`、`src/mcp/attachment-reader.js`、`src/ip-adapter.js`、`src/instance-lock.js`、`src/api/v1/assets.js`。checkはimportを再帰解析しない。多くはtests/runtimeがimportするが、特にSWはsource readのみ。将来、Windows互換の決定的列挙を別tooling taskとして評価する。今回scriptは変更しない。

| Dependency | 実consumer | 判定 |
| --- | --- | --- |
| express | server/integrations/api assets/router + tests | KEEP |
| sharp | thumbnails/reference-assets + tests | KEEP |
| adm-zip | updater | KEEP |
| @modelcontextprotocol/sdk | MCP server/tools + integration tests | KEEP |
| zod | MCP schemas | KEEP |

全5依存に実利用あり。dependency削除候補なし。脆弱性・version freshnessの監査は今回実施していない。

### Dead/duplicate investigation

| 候補 | Reference / runtime-static / coverage / dynamic確認 | 判断 |
| --- | --- | --- |
| outfit helper `isOutfitChoiceSourceId` | src/public/testで宣言のみ。outfit moduleはstatic ESMで利用。隣接helperのtestはあるが当関数の直接testなし。namespace/外部consumerは完全否定不可 | 最も強いfunction DELETE CANDIDATE。module全体はKEEP、別Phase確認後のみ |
| isAppView / isPromptField / showToast / registerMcpTools | 外部importがなくても各module内部またはtoast API/createMcpServer経由で使用 | 関数はdeadでない。export surfaceのみ確認候補 |
| storage-settingsのemptyStorageSettings / normalizeStorageSettings / normalizeOutputPath | 正確な名前の検索では宣言のみ、直接testなし。公開wrapperとしての意図・外部consumer/動的namespace利用は未確認 | export/API surface確認候補。削除確定ではない |
| net-infoのtest-only export | net-info testsに直接検証あり。runtimeは上位のbinding APIを使用 | pure helper検証用の公開性を保持。削除を推奨しない |
| server-* fixture | 4 suiteに起動/helper類似。各suiteは別契約を検証 | MERGE CANDIDATEはfixtureのみ。suite削除不可 |
| task20/task22 | Neo/queue setupに重複、runtime導入とprofile契約は別 | fixture/同一assertのみ比較候補。契約単位のtestは保持 |
| ui-shell/ui/pwa/layout/image-delivery-ui | source assertの対象が重なる。意味の完全同一性は未比較 | assert owner整理候補。名前が似るだけで削除しない |
| 512px icons | manifestは192のみ、indexは192/apple-touch。static URL/外部ホーム画面consumerは検索不能、PWA test確認が必要 | 低確信DELETE CANDIDATE、実利用調査まで保持 |
| root PNG / output / gallery ZIP / research scripts | tracked/untrackedとpathのみ調査。runtime/static参照・生成元/利用者・再生成性・test網羅は未監査 | 不要物とは断定不可。保護対象、削除許可なし |

バックアップ・生成物は存在するが「staleで再生成可能」を確認できていない。importされないserver/MCP/SW/CLI scriptはentrypointになり得るため、参照0を削除根拠にしていない。

## 5. Documentation map

巨大文書は見出しと関係rangeのみ調査。文書全体の全記述を最新と認定していない。分類はcontent用途であり、archive/deleteを今回実行する意味ではない。

| Path | Disposition | 根拠・読む用途 |
| --- | --- | --- |
| `AGENTS.md` | ACTIVE SOURCE OF TRUTH | 作業範囲/保護/検証/引継ぎ規則 |
| `docs/implementation/current-state.md` | ACTIVE SOURCE OF TRUTH | frontend現在Phaseと次の入口。GPU LabのPhaseと区別 |
| `docs/implementation/decisions.md` | ACTIVE SOURCE OF TRUTH | 継続するcontract/state方針 |
| `DESIGN.md` | ACTIVE SOURCE OF TRUTH | 111行、承認済みUI/viewport/画像配信基準 |
| `docs/implementation/frontend-refactor-discovery.md` | ACTIVE REFERENCE + HISTORICAL baseline | architecture/roadmap。旧行番号と「次はPhase1」は当時の状態 |
| Phase 1/2実施記録 | HISTORICAL + ACTIVE REFERENCE | characterizationと検証範囲の証拠。結果を今回再実行扱いしない |
| `docs/refactor/` 4文書 | ACTIVE REFERENCE | 現監査・提案。次Phaseの承認ではない |
| `README.md` | ACTIVE REFERENCE + STALE / REVIEW REQUIRED | 1,065行。v3現状/起動の入口と旧release説明が混在。将来release履歴はARCHIVE CANDIDATE |
| `TODO.md` | STALE / REVIEW REQUIRED + HISTORICAL | 308行。v2時点の延期案を現在仕様と誤認しない |
| `docs/CURRENT_TASK.md` | ACTIVE REFERENCE（一部別project task）+ HISTORICAL、ARCHIVE CANDIDATEは完了節のみ | 1,937行。先頭はTask28 GPU Lab、frontend正本ではない。進行taskをarchiveしない |
| `docs/REVIEW_FIXES.md` | HISTORICAL + STALE / REVIEW REQUIRED、完了節ARCHIVE CANDIDATE | 3,780行。過去failure/修正/実験が混在。見出しだけで現未修正と判断しない |
| `docs/FORGE_NEO.md` | ACTIVE REFERENCE + STALE / REVIEW REQUIRED（一部） | Task20単一設定とTask22 profile運用が同居。古い実機snapshotはhistorical |
| `docs/MCP.md` | ACTIVE REFERENCE | stdio/tool/API v1/attachment境界とhost entry path |
| `docs/AI_PROJECT_MEMORY.md` | ACTIVE REFERENCE + STALE / REVIEW REQUIRED、MERGE CANDIDATEは入口規則のみ | repository正本を尊重する方針。一方「root AGENTSなし」が現状と矛盾。私的memory本文は未調査 |
| `docs/luna-tasks/01...07...` | HISTORICAL task spec + ACTIVE REFERENCE | Main image/compare/history/Discord/gallery/settingsの要件証拠。全件完了を今回認定しない |
| `docs/luna-tasks/19_OBSIDIAN_GENERATION_KNOWLEDGE.md` | ACTIVE REFERENCE / review required | 個別knowledge作業。frontend extractionとは別、保持 |
| `docs/luna-tasks/25_LORA_UI_READABILITY.md`, `26_CIVITAI_ENV_TOKEN.md` | ACTIVE REFERENCE + status要確認 | 個別仕様。CURRENT_TASKと実装で現状確認してから使用 |
| `docs/luna-tasks/27_GFX1031_ATTENTION_LAB.md` | HISTORICAL + ACTIVE REFERENCE | 完了/NO-GO根拠。削除対象外 |
| `docs/luna-tasks/28_GFX1031_ANIMA_GEMM_TRANSFORMER_LAB.md` | ACTIVE REFERENCE | 別Lab進行仕様、勝手にarchiveしない |
| `docs/artist-catalog/`, `docs/twitter-illustrators.md`, gallery/ZIP | ACTIVE REFERENCE（個人研究、status未監査） | product architectureではない。重複成果物でも保全。無断統合/削除不可 |

具体的なstale箇所:

1. TODO「ギャラリーの並べ替え・ページング」は200件/offset提案。現在`HISTORY_PAGE_SIZE=20`、`historyCursor`、`loadHistory`とserver History routeはcursor方式。旧案を復活させない。
2. README先頭/前提/Checkpoint節はReForge中心で、選択即切替を一般説明している。Neoはqueue内activationで意味が違う。runtime別説明が必要。古いrelease説明そのものを虚偽と扱わず時点を分ける。
3. FORGE_NEO先頭「設定した1つだけ」と後段profile allowlistはscopeの明示が必要。providerは旧単一config互換と複数profileの両方を扱う。
4. AI_PROJECT_MEMORY末尾のAGENTS不在記述は現working treeと矛盾。AGENTS/current-stateの入口と重複する指示は将来リンク集約候補。
5. README旧mobile無overflow説明に対しPhase2 fixtureでは390px gallery 422pxを記録。実iPhoneの現状を今回確定せず、既知条件の差として残す。

## 6. Audit validation / limits

今回の変更allowlistは新規4文書と`docs/implementation/current-state.md`のみ。開始時のtracked/untracked（ignoredを除き、`output/`と`docs/twitter-illustrators-gallery/`を除外）689 fileのSHA-256 snapshotをTEMPへ保存。巨大生成物の全byte比較は行わない。別途`.env`/`config.local.json`は文書作成中から終了時のhashを比較し、本文/値を出力しない。

2026-09-06の検証結果:

- 新規4文書 + current-stateのlocal links **37件**、うちanchor **3件**、抽出可能な完全形current path参照 **63件**が存在し、broken link/path/anchorは0。提案先や省略/複数path表記は機械検証と区別し、module表はsrc/publicの現在file一覧とも照合した。
- baseline 689 fileのうち **688 fileはSHA-256一致**。差がある既存fileは許可対象current-stateだけ。新規fileは指定した4文書だけ、削除0、allowlist外変更0。tracked実装・test・package/configと既存未追跡sourceを保持した。
- `.env`/`config.local.json`の追加hash比較2件も一致。これは開始直後の689件とは別で、文書作成中から終了時の確認。ignored data、巨大output/galleryは全byte比較しておらず、変更toolの対象にもしていない。
- `git diff --check` exit 0。新規文書を含む5文書の末尾whitespace検査も0件。Gitの既存LF/CRLF警告はwhitespace errorではない。
- Backend/Tests担当による文書reviewを反映。migration→history module importとの誤認、storage helper参照の表現、backendを単一serviceへ集約し得る表現を修正した。

実装check/full suite/browser/provider通信は未実施。現在の実装動作の再認定ではなく、文書の整合と許可外変更がないことをgateとする。code/config/test/packageの編集、move/rename/delete、commit/pushはしていない。
