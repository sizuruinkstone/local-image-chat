# Frontend Refactor Phase 17 — Prompt / LoRA Coordinator

2026-09-07。開始HEAD `55d7bba`（Phase 14–16 checkpoint）。Phase 17のみ。commit/pushなし。

## Implementation-before characterization

以下は変更前の `app.js` の対象関数と既存pure helpersを読んで固定した更新グラフ。見た目を整えるための新しい双方向bindingは導入しない。

| Event / authoritative input | Derived updates → render → persistence（実際の順序） |
| --- | --- |
| UI add / UI name+weight | `setLoraSelected`: selectionに追加、prompt/bothならboth、それ以外ui → callerのsummaryでoutfit補完、trigger同期、Raw mirror、使用一覧。**タグは挿入しない**。outfit初期化時だけ保存 |
| UI remove / name | selected/source/disabled削除 → active Prompt sourceの同名タグ削除 → Raw mirror/clear button → callerのsummary/library再描画。非active側のPromptは変更しない |
| 使用中UI weight / number | cache+selection → weight保存 → active sourceの**既存タグだけ**置換 → Raw mirror → summary → library。library sliderはcache保存→selected更新→summaryの順で、タグ置換しない既存経路もある |
| Raw tag / Raw weight手編集 | Raw override=true/manual → mode表示 → 400ms debounce → active source解析 → notice → changed時selection/source/cache置換 → weight保存 → library → summary。タグweightが正本 |
| Structured入力 | field DOM → Raw overrideが無ければRaw mirror → preview → debounce。Raw override中は入力を保持するが生成/LoRA解析はRawを参照 |
| Manual trigger / library入力 | trigger mapへtrim値設定/空なら削除 → 保存 → share予約 → selectedならsummary → trigger source再構築 → Raw mirror。registry.characterTriggerWordsがstringならその値が手入力より優先する |
| Metadata default / catalog publish | profile検出/default登録 → 未保存値のみCivitai default → profile version migration → missing selection除去 → summary → share予約。profile defaultはCivitai推奨より先。catalogはlibraryだけが所有 |
| Outfit apply/remove / choice ID | outfit selection保存 → applied trigger同期（base/choice/state markerのsourceを分離）→ Raw mirror → field preview。空choiceは衣装だけ除く。既存triggerのweight/enabledを保持 |
| Profile/preset/addon / selected IDs | cache weight/trigger/negative、selected weight更新 → weight/trigger/negative/profile保存 → callerのsummary。既存Promptタグは置換しないため次の同期でタグweightが勝つ |
| Character/outfit picker preset / append or replace | 対象fieldだけmerge → related LoRA追加（max制限あり）→ filled field表示 → structured input処理 → summary → library。Raw overrideは解除しない |
| Import append/replace / parsed fields | 非空の該当sectionだけmerge、またはRaw fallback → negative merge → import trigger由来をmerge/replace → trigger同期 → structured input処理 → clear button → 表示tab。structured importでも既存Raw overrideを解除しない |
| Recipe restore / recipe | Prompt/trigger/sections復元 → IP/settings/seed等の既存app workflow → selected/source/disabledを全置換（installed exact nameのみ）→ outfit復元 → cache保存 → library → summary → Prompt同期。最終weight/sourceはactive Promptに従う |
| Checkpoint Set / saved set | settings適用 → selectedのみ置換（missing列挙）、cache非空trigger/negative適用・保存 → 保存PromptがあればRaw設定 → library/summary → fingerprint。source/disabledをclearしない、即時Prompt同期しない。後のgeneration/readで同期。保存boost非適用も維持 |
| Catalog missing / installed names | selectedだけ除去、source/disabledの残存は旧挙動 → summaryでtrigger再計算 → share予約。空catalog時はPrompt同期自体をskip |
| Clear + Undo / current form snapshot | sectionクリア → 空setPromptFieldsでRaw override解除 → selectedに従うtriggerは残る。Undoはsection/Raw/negative/descriptionを復元。selection/source/disabledをsnapshot/巻戻ししない |
| Replace/generated Prompt / string | 非空setPromptFieldsはRaw override、空は解除してStructured mirror。生成結果は元がStructuredならpositiveを書戻さずnegativeだけ更新 |

## State and identities

- Selection identityはinstalled `name`。tag解決はnormalize完全一致優先、basenameは一意な場合だけ。重複タグは最後のweight、曖昧/未導入は本文を保持してnoticeにする。pure `lora-tags.js` を共有し解析規則を複製しない。
- `ui` / `prompt` / `both` は選択の存続規則。recipe/profile/outfit/importという操作名を新source enumへ追加しない。prompt-onlyはタグ削除で外れ、bothはuiへ戻る。
- Trigger sourceはLoRA名、encoded outfit choice/state ID、`import:field`。selection source enumともregistry UIDとも別物。import triggerはLoRA非選択でも保持。
- disabledはselectedのまま。source Promptのタグは残し、生成positiveからだけ除去、対応する自動triggerを無効化し、payloadはenabled:falseを保持。missingとは別。
- Raw/Structured値の正本はフォームDOM、priorityは既存Raw override。boostは既存checkbox/settings読取、negative triggerは保存mapでありpositive tag reconciliation対象外。

## Implementation / interface

Phase 17完了。`public/features/prompt-lora-coordinator.js`（246行）を追加し、`app.js` は **5,392 → 5,292行（100行減）**。行数削減より、generation selectionとタグ同期の単一owner化を目的とした。

| State | Owner / read-write ports / callers |
| --- | --- |
| selected LoRA、generation weight | coordinator private Map。`setSelected` / `setWeight` / `updateSelectedWeight` / `replaceSelection`。library操作、使用中一覧、profile適用、LoRA変更dialogが利用 |
| selection source、disabled | coordinator private Map/Set。`getSource` / `toggleDisabled` / `isDisabled`、recipe/runtimeのsnapshot ports。UI/payload/trigger active判定がqueryを利用 |
| tag解析・reconciliation・notices・debounce | coordinator。`syncFromPrompt` / `scheduleSync` / `rewriteWeightToPrompt` / `removeDisabledTags`。入力、generation前、recipe復元、experimentが呼ぶ |
| Raw / Structured、override、applied trigger frames | appのフォームadapter。`positivePromptSources` / `writePromptSource` と描画callbackでcoordinatorへ接続。フォームDOMを複製しない |
| cached default weight、manual trigger、negative、profile/preset/addon、outfit choices | appの既存保存map。catalog default/migration、library編集、trigger sourceのlifecycleを維持。selected weightの正本はcoordinatorでありcacheではない |
| boosts | appの既存checkboxと `readPromptBoosts` / 保存callback。tag同期に含めない |
| installed catalog | `lora-library`。coordinatorは `getCatalog()` を操作ごとに読むだけ。registry UID/profile ID/trigger source IDをselection identityへ置き換えない |

Factoryはcatalog読取、active Prompt source読書き、Prompt書換え後のmirror、cached weight更新/保存、library/selection/notice描画、Prompt snapshot適用/復元を明示callbackとして受ける。DOM一式やapp context、Runtime/History内部stateは受けない。逆import、global store、event bus、非同期通信を追加しない。

Collection queryはコピーした配列。`getNotices()` はweights/candidatesもコピーする。runtimeの `captureState` / `restoreState` はselected/source/disabledのみを保持し、以前と同じくnoticeやdefault cacheをrollbackしない。

Checkpoint Setの正式portはcoordinatorの `restoreCheckpointSelection` と `applyPromptSnapshot`。app adapterが従来の非空trigger/negative適用と保存を繋ぎ、Set controllerはMapを操作しない。Recipeは `restorePromptSnapshot` → 既存appのsettings等復元 → `restoreRecipeSelection` → outfit/cache保存/描画 → `syncFromPrompt`。2段階portにすることで、Phase 21のworkflowを先取りせず順序を維持した。

Prompt rewriteとreconciliationは同期guardで再入を抑止し、`finally`で解除する。400ms debounceはcoordinatorが所有し、明示restoreでpending timerを取消す。元のlistener配置と登録数を維持し、新listenerを登録しない。非同期recipe/runtime workflowは従来のcontrollerとappに残す。

## Verification

2026-09-07の今回の実行結果:

- 実装前baseline: structured prompt、tags、outfit、import、profiles、checkpoint profiles/sets/controller、history controller、studio historyの10file。**100 passed / 0 failed / 0 skipped**、exit 0。
- 新規test: coordinator **17件**、実appフォームadapterのcharacterization **7件**。UI追加/削除、既存tag weight、Raw優先、import append/replace、recipe、Checkpoint、outfit、manual trigger、disabled、missing、曖昧/重複、clear/undo、再入/複数field書換え、debounce取消、snapshot isolationを検証。
- 最終focused: 上記baseline10file + 新規2file + `ui-shell` / `lora-library-controller` / `runtime-controller` / `experiment-controller`。**184 passed / 0 failed / 0 skipped**、exit 0、0.795s。
- `npm.cmd run check`: **exit 0**。既存check列挙へ新moduleを登録。
- `npm.cmd test`: **680 total / 678 passed / 0 failed / 2 existing opt-in skips**、exit 0、Node duration 12.919s。最終full suiteは**1回**。以後production/testコード変更なし。
- `test/ui-shell.test.js` のdisabled assertionは旧Map名から同じ意味のcoordinator queryへ追従。assertion削除なし。
- `git diff --check`: exit 0。新規fileのwhitespaceと文書リンクも確認。

全test logはrepository外 `%TEMP%/local-image-chat-phase17-{baseline,final-focused,final-check,final-full}-20260907.log`。新規form characterizationはappの対象関数をVMで実行し、無関係なbootstrap/providerと描画だけをstub化する。pure helperの再実装をtestへ埋め込まない。

## Browser smoke

2026-09-07、Chromeの専用tabで**1回のsmoke sequence**を実施。in-app tab作成は接続timeoutで開始できずChromeへ切替。ignored `workbench/ui-mocks/phase17/server.mjs`、loopback port 41717、in-memory backendを使用。

1. LoRA追加でUI選択/triggerが表示され、tagを自動追加しない。
2. Structuredへtag 0.60を入力 → 使用中weight 0.60、UI+プロンプト。
3. 使用中weight 0.85 → Structured tagも0.85。ブラウザ操作toolは浮動小数値確認で一度errorを返したが、再取得した実フォームは0.85とtag更新を確認。
4. Fixture Dress適用 → 結合結果にred dress。manual Trigger入力 → previewに手入力値。Preset再適用でtriggerがpreset値、UI weightが0.75へ戻る一方、既存tagは0.85を保持。
5. Rawを0.45 tagへ直接編集 → Structured欄は元の0.85を保持。生成PREVIEWはRaw本文+0.45 tag+自動trigger、使用中weightも0.45。
6. Recipe設定読込 → Structuredはrecipe structured、Rawの0.65 tagが保存selection weight 0.80より優先、UI+プロンプト、衣装復元。
7. Checkpoint Set読込 → Rawはfixture portrait、selected weight 0.75、実フォーム896×1152 / 30 steps / CFG 5.5 / Karras。
8. Library再読込でfixture characterをmissingにする → catalogから除去、選択中0、LoRAなし。

`tab.dev.logs` のerror/warnは **0件**。fixtureのerror/unhandledrejection beaconも **0件**。実generation、実runtime、Civitai、Discordへの通信/送信なし。

Checkpoint Set適用後の折りたたみsummary/Studio statsには旧値が残ることを観測した。実フォーム値は適用済み。旧 `applyCheckpointSetSettings` がlabel以外のsummaryを同期しない既存経路で、Phase 17差分ではその関数を変更していない。今回の修正対象に追加しない。

## Architecture review / remaining coupling

Astraが統合architecture reviewを1回実施。抽出案にあったlibrary weight保存前のselection更新、LoRA変更dialog受諾時の新catalog再filterを修正し、旧順序/受諾規則を保持。notice nested arrayのaliasも遮断。上記最終focused/full/browserは修正後に実施。**未解決の重大findingなし**。

selection/source/disabledのmutable ownerはcoordinatorだけ。active Promptに限定した解析と書換えを同じownerに封じ込め、catalogコピー、library責務逆流、Runtime内部侵入、listener二重化を認めない。

Raw overrideとtrigger/profile/outfit stateの完全移動は行っていない。metadata/default migration、manual保存map、trigger frame編集、import/clearのフォームlifecycleが同じapp関数群に接続しているため、それらまで一括移動すると大きなform contextが必要になる。今回のselection/タグ境界は狭いread/write/render portで確立し、これらの既存ownerを明記した。generation payload組立、フォーム描画と永続化callbackもappに残る。

Phase 18 Reference Image、19 Inpaint、20 IP-Adapter、21 Recipe workflow、22 Generation orchestration、23 Persistence/Bootstrapは未着手。backend/API/History/storage/registry schema、UI redesign、既知Gallery問題、runtime activationは変更しない。

開始時の `docs/CURRENT_TASK.md` / `docs/REVIEW_FIXES.md` と未追跡の文書・画像・output/scripts等を保持。HEAD `55d7bba` / `22beecf` を変更せず、stage/commit/pushなし。
