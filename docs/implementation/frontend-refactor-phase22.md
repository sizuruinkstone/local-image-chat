# Frontend Refactor Phase 22 — Generation Orchestration

2026-09-07。開始HEADはPhase 21 checkpoint `5f12f91`。同checkpointと既存dirty/untracked成果物を保持し、stage/commit/push/reset/restore/cleanなし。Phase 23 Persistence / Bootstrapは対象外。

## Changed

**Phase 22完了。** 実装、Astra統合review修正、focused/check/full、mock backendによる実Chrome Browser Smokeが完了した。Phase 23には進んでいない。

`public/features/generation-controller.js`（305行）へ通常生成とHiresのrequest構築、active Jobの実行・回復・取消、結果ownerへの接続を抽出した。各featureのstateは既存ownerへ残した。appはcomposition、form/read/render/persistence adapter、Recipe・派生フォーム準備を保持する。`app.js` は **4,727 → 4,479行（248行減）**。

他の変更は `package.json` のprecheck登録、新規 `test/generation-controller.test.js`、移動先へ同じHires runtime assertionを追従した `test/task20.test.js`、本書・current-state・decisions。HTML/CSS、既存owner controller、backend/API/schema、保存設定は変更しない。Browserのfixtureはignored `workbench/ui-mocks/phase22/` のみ。

## Generation entry points

| 入口 | Requestの正本 / 分岐 |
| --- | --- |
| 通常Generate | 現在フォームと各ownerのpayload。Promptが無ければ既存日本語Prompt作成を先行。candidateCountを数値化し、Hiresはfalse |
| same-seed | Recipe復元成功→composition lock→pending same-seed。送信は後の通常Generate。元imageのseedと元generation IDを使用する |
| duplicate | Recipe復元成功→seed=-1→lock解除→pending duplicate。送信は後の通常Generate |
| LoRA / instruction派生 | Recipeとフォームを準備してpendingを設定し、後の通常Generateへ渡す。LoRA変更はdialog前にpendingを設定し、cancelでも保持する既存挙動 |
| Retry / recovery resend | 独立した失敗Jobのフォーム再読込Retry入口はない。既存の承認付きrecoveryが確定requestを1回再送する。失敗後に通常Generateを押す操作は現在フォームを改めて読む |
| 選択画像Hires | Studioの元generation/runtime/prompt/LoRA/settingsと選択imageのseed/parent ID。元modeがimg2img/inpaintならそのmodeとinitImageId。title、Hires指定値、IPは現在フォーム/owner |
| Gallery Hires | 元generation/runtime/prompt/LoRA/settings/IP、image IDとseed。常にimg2img、倍率1.5/steps12/denoising0.28。確認dialog後に送信 |
| Experiment baseRequest / run | experiment-controllerの独立workflow。同じform readerを利用するが、独立したbaseRequest構築、candidateCount=1、固定seed方針、POST /api/experiments。derivationを読まずconsumeしない |

## Request build order / validation

通常生成の既存順序を維持する。Runtimeのactive値取得→error消去→description/positive Prompt不足検査→mode別Reference不足検査→Inpaint mask不足検査→Prompt/LoRA同期→結果UI準備→candidateCount読取→busy→必要時だけ非同期Prompt作成。

request objectの評価順は **runtime payload → mode/rating/description → title → Prompt → selected LoRA → boosts → Reference → Inpaint → IP-Adapter → derivation consume → settings**。`readSelectedLoras` 内でもcoordinatorへ同期する。settingsを先へ移す、Runtime switch待機やNeo activationを新たに追加する、といった順序変更はしない。

UIの既存error文言はPrompt不足、Reference不足、mask不足を保持。IP ownerはunsupported/disabled/referenceなしなら空payloadを返す。IP不足を新しいgeneration validation errorへ変更しない。candidateCount UI gateとbackendのsettings/capability/schema検証は既存境界のまま。

## One-shot consume boundary

`readDerivationPayload()` は **readした瞬間にpendingDerivationをnullにする**。payloadのderivation/type/instructionとparentGenerationIdを返す。request確定後やJob作成成功時のconsumeではない。これをtransaction的なprepare/commitへ変更しない。

| Failure / boundary | pendingDerivation |
| --- | --- |
| click時のPrompt/Reference/mask validation failure | 保持 |
| 日本語Prompt作成、Prompt/LoRA/Reference/Inpaint/IP等、consume前readerのfailure | 保持 |
| derivation reader到達 | その場で消費 |
| 後続settings readerのfailure | 消費済み。復元しない |
| POST failure / backend create validation拒否 | 消費済み。復元しない |
| Job成功 / running failure / cancellation | 消費済み。復元しない |
| recovery再送 | pendingを再読しない。確定request中のderivation/parentを再利用 |
| Experiment / Hires | 通常生成のderivation readerを呼ばず、pendingを保持 |

したがって「failed prepareでは常にone-shotを失わない」という新しい保証は追加しない。consume前の失敗は保持するという既存契約を固定する。prepareはrequest構築、submitは確定payloadからJobを作る境界として内部で分離するが、Job成功をone-shot commitにしない。

composition lockは実行mutexではなく、Recipeと選択imageを保持するフォーム側のSeed/構図固定表示。Recipe成功後に取得し、生成成功/失敗/recovery/Experimentでは解除しない。明示unlock、関連Seed操作、duplicateが解除する。controllerの短命な実行予約とは別ownerである。

## Job boundary / Recovery / retry

frontendは既存 `POST /api/jobs`、850ms間隔のactive Job `GET /api/jobs/:id`、取消 `DELETE /api/jobs/:id` を利用する。queued/running/done/failed/cancelledの意味やbackend AbortControllerへ新しい状態・abort方式を追加しない。

queue-controllerは全Jobの `/api/queue` polling、terminal通知とHistory refreshのowner。Generationは自分が作成したactive Jobだけを観測し、Job作成時に既存 `startPolling()` を呼ぶ。全Job pollerを新設しない。画面移動によって生成監視を停止しない。

recoveryはserverから提案がある失敗に限り、既存dialogで承認後に1回再送する。元requestのPrompt、LoRA、Runtime、Reference、mask、IP、derivation、parent、seedを再利用し、提案settingsをmergeしretryInfoを付ける。提案settingsにseedがあれば既存spread規則でoverrideされる。`autoRetry` checkboxは従来どおり各POST時に読む。backendのautoRetry方針は変更しない。汎用HTTP retryや全POST retryは追加しない。

## Controller ports / Result ownership

`createGenerationController({ form, owners, ui, transport, timing })` は `generateCandidates()` / `finishSelected()` / `hiresFromGallery(generation,image)` / `cancel()` / `buildPrompt()` / `getState()` / `isBusy()` を返す。`getState()` は `{ activeJobId, busy }` のsnapshot。buildPromptは既存のPrompt単独workflowを同じbusy境界へ移したportで、新たなUI入口は追加しない。

- form: Runtime context/payload/capability、現在mode/description/Prompt/title/LoRA/boosts、Reference/Inpaint/IP payload、one-shot reader、settings/Hires/autoRetryの明示reader。
- owners: Prompt作成とreconciliation、Studio query/result、IP metadata、History refresh、Queue start。
- ui: error、候補表示準備、進捗、busy表示、Gallery/recovery確認、結果表示。確認はbooleanだけを返し、recovery requestの再構築はcontroller。
- transport/timing: 既存POST/GET/fetchとsleep/deferred hide。HTTP client全体を変更しない。testsだけが時間を制御する。

controllerは最初のawaitより前にoperationを予約する。Prompt生成待ち、POST応答待ち、Gallery確認dialog待ちを含め、二つ目の生成は追加reader/consume/POST前に拒否する。Gallery確認中もbusyにすることは明示的なrace対策。busy通知の例外もreservationを解放する。recoveryは同じ予約のloop内で1回だけ実行し、旧再帰finallyが再送Jobを消す問題を除いた。

cancelはクリック時のoperationとJob IDをcaptureし、遅いresponseは両者一致時だけ反映する。cancel API応答だけでは予約を解放せず、Job terminal観測を待つ。遅延job-bar hideはoperation versionが一致するときだけ行い、次Job完了後の古いtimerも拒否する。terminalでCancelを無効化する。busyの正本はcontroller一箇所で、appにgenerationBusyの複製は置かない。

Studioはcandidate/selected/final resultの正本。Generationはresult snapshotを構築して `setCandidates` / `presentFinal` へ渡す。IP metadataはIP owner、生成後Promptは既存form adapter、History refreshは既存history-controller wrapperへ接続する。History schemaや永続化はbackendのまま。queueのterminal refreshと生成成功のrefreshが併存する既存挙動を保持する。

image-stateのFavorite/Discord notification presentation、backend Discord送信は変更しない。Forge Neoのoptions/catalog/modules取得→allowlist検証→必要時のみmanaged-options POST→options再検証→txt2imgはbackend共有JobManager実行境界に残す。

## Focused tests / Full tests / Browser smoke

2026-09-07、統合review修正後:

- 新規controller test: **28 passed / 0 failed / 0 skipped**。通常payloadと全reader順序、mode/IP/multi、same-seed/duplicate metadata、failure前後のconsume、Prompt/POST/dialog待ちの排他、recovery承認/拒否と上限、DELETE targetとstale応答、遅延hide、Hires、busy通知failure、実appのRuntime/count/button gateを固定。
- 広域focused: **214 passed / 0 failed / 0 skipped、exit 0**、2.651秒。generation、experiment、queue、studio、history、runtime、prompt-lora（coordinator/form）、reference、inpaint、IP、recipe（workflow/runtime）、job-manager、recovery/server-recovery、Discord、Task20/22の19 test file。後述のtimer修正後はaffected focused（Generation + Task20）**56 passed / 0 failed / 0 skipped、exit 0**、2.145秒。
- `npm.cmd run check`: **exit 0**。
- ログはrepository外 `%TEMP%/local-image-chat-phase22-final-focused.log` と `local-image-chat-phase22-final-check.log`。
- 最終 `npm.cmd test`: **759 total / 757 passed / 0 failed / 2 existing skips / 0 todo、exit 0**、runner 11.339秒。最初のfullは758 total / 756 passed / 0 failed / 2 skips（10.900秒）。その後、同review cycleでterminal barを表示中にGallery確認をcancelするとhide timerを失うケースを修正し、回帰testを1件追加したため、依頼のproduction修正時gateに従って **affected focused→check→fullを再確認**した。fullは計2回。最終ログは `%TEMP%/local-image-chat-phase22-corrected-{focused,check,full}.log`。最終full後は文書だけを更新した。
- `git diff --check`、新規fileのwhitespace、文書の相対リンクを確認。既存LF/CRLF warning以外のwhitespace errorなし。

### Browser smoke

実headless Chrome **152.0.7977.77** とloopback **41722** のin-memory fixtureを使用。1回の検証cycle内でfixtureを修正し、最終corrected sequenceは約23.5秒、全scenario PASS。実providerへは接続せず、専用fixture serverは終了した。

normal queued/running/done→Studio→History refresh、画面遷移中completion、validation時pending保持、same-seed/duplicate、実instruction dialogの派生、browser Fileのimg2img、実Canvas strokeのInpaint mask、ReForge IP payload、unsupported NeoのIP field省略、承認付きrecoveryのsnapshot再利用と1回制限、選択/Gallery Hires、Experiment baseRequestとpending非消費、同時Generateの1件だけのPOST、active JobのCancelを確認した。

fixture request captureは **Job 12件、derivation付き7件、Hires 2件、img2img 2件、inpaint 1件、IP付き7件、retryInfo付き1件、Cancel 1件、Experiment 1件**。同じrequestは複数分類に含まれる。Console error/warning、uncaught、unhandled rejection、外部request、予期しないHTTP failureは **すべて0**。

初回はfixture bridgeの削除済みgenerationBusy参照、2回目はIP checkboxのsynthetic操作がownerを有効化しないassertionで停止した。両方ともfixtureだけを修正し、3回目の最終sequenceがPASS。途中の失敗を初回成功とは報告しない。Browserで要求されたproduction修正はない。その後の上記timer後始末だけのproduction修正はaffected focused/fullで再確認し、Browserは追加実行していない。Job create failureの消費契約はfocused testで検証し、clean-console Browserでは意図的なHTTP failureを起こしていない。

ignored `workbench/ui-mocks/phase22/result.json` に結果・件数・試行記録、`smoke.png` に最終Cancel後の画面、`server.mjs` / `smoke.cjs` に再現fixtureを保持する。最終画面のCancel error表示とrecovery failure通知は検証した失敗経路の表示で、console errorとは区別する。

## Remaining risk / Architecture review

Astraの統合architecture reviewは1回の修正確認cycleで実施。旧workflowの残存、terminal Cancel無効化、busy通知例外による予約残存、Runtime gateをbusy表示callbackが上書きする接続を修正し、focusedで確認した。実装中に指摘したconsume順序、normal Runtime fallback、recovery requestのowner、stale hide guardも最終差分で確認した。backend activation、queue二重所有、Studio/History/Experiment state複製、全POST retry、Phase 23先取りはなし。最終focused/check/full/Browserはgreen、未解決の重大findingなし。

form/cache/persistence、派生フォーム準備、composition lock、owner用readerの結合はappに残す。localStorage、startup restore、listener boot order、PWA/bootstrapの整理はPhase 23へ残す。consume後のprepare失敗でmetadataを復元しない既存semanticsも維持する。実provider generationは今回実施しない。
