# Frontend Full Rebuild — R5 / R6 / R7 completion

検証日: 2026-09-08。ユーザーのAutonomous Completion Runに基づき、既存repository・単一agentで実装。stage / commit / pushなし。開始時のR1–R4・legacy・文書・private/generatedの未コミット差分を保持。

## Production entry

- 通常URL: `http://127.0.0.1:3030/` → New Studio。
- `/index.html`・`/studio-next/`・`/frontend/index.html`もNew Studio。`?fixture=r2`はProductionで無効。
- 明示rollback: `http://127.0.0.1:3030/?legacy=1` → 既存Production HTML/JS/CSS。新旧を同時bootstrapしない。
- `src/frontend-entry.js`がentry選択とHTML/JS/CSS/manifestの再検証headerを担当。画像のimmutable cacheは維持。
- `public/frontend/app/boot.js`はnative ESMの本番bootstrap。dev server/fixture transportに依存しない。
- SWはnetwork-onlyのままrevisionを更新。旧CacheStorageをactivation時に除去し、`updateViaCache:none`で更新。manifestの起動先は既存 `/`。
- updaterの既存UPDATE_PATHSはpublic/srcを再帰配布するため、新entry/moduleを含む。実更新の実行はしていない。
- backend再起動前にactive Jobなし、pending storage migrationなしを確認。Providerの再起動はしていない。

## R5 — Library / History

新しい画像中心のFull Library、40画像ずつのincremental load、全履歴search、Newest/Oldest、Favorite filter、Recent、Viewer、Fit/Zoom、Previous/Next、Result Metadata、明示Reuseを実装。

`GET /api/history`に任意の`search`と`sort=newest|oldest`を追加。既存永続化形式・cursor・rating/favorite semanticsは維持。保存済み全世代を絞り込み/整列してから画像単位でページ分割する。queryは最大2000文字、空白区切りAND・大文字小文字を区別しない部分一致。title/description/Positive/Negative/Runtime label/checkpoint/LoRA名/image ID/Seedを検索する。Newestは既存保存順、Oldestはその逆順。保持対象は既存retention内の履歴（既定500世代）であり、削除済み履歴や画像ディレクトリ全体ではない。

`createLibraryService`がquery/page/async epochを所有。途中のappendや古いquery responseは現queryを上書きしない。新しいworkspace生成完了時にheadをrefresh。Viewer閲覧/CompareはDraft非変更。ReuseはR1 `reuseImage` / `reuseMetadata`へ委譲し、既存scope（Prompt/parameters/LoRA、Runtime復元、checkpoint/source/mask等は非適用）を維持。

## R6 — Advanced Creation / session

ToolsとInspectorのAdvanced creationから既存機能へ接続。Prompt Dockを設定一覧に変更していない。

| 機能 | 接続・確認 |
| --- | --- |
| Hires | Current resultから既存generation controllerのfinishSelected。Seed/Prompt/parentImage/request互換を維持。scale/steps/denoising/upscalerはsecondary dialog |
| Inpaint / img2img | Canvas編集mode、履歴またはupload source、brush/full-mask/clear、denoising/mask blur/fill、canonical Prompt、実request、Resultへの復帰 |
| IP-Adapter | 既存capability endpoint、Current result/upload reference、enable/weight/start/end。Runtime/async guardを維持 |
| Compare | ViewerからA/Bを選び、画像比較・A/B/drawを既存comparisons endpointへ明示保存。Draft非変更 |
| Experiments | 既存parameter definitions、値列、固定Seed、Current Draft requestで開始、実状態poll、cancel、当該実験画像をViewerへ |
| Civitai | URL inspect、既存install folders/category、明示install、LoRA catalog refresh。credentialは既存backend設定を使用。外部installの実実行はしていない |
| Profiles / Checkpoint Sets | 既存profile settings、Set保存/明示適用。同一checkpointにも適用。checkpoint成功後のDraft変更失敗はDraftだけrollback |
| LoRA outfit / profile | Browser Detailsで既存選択肢を読み、現在modeの明示targetへPrompt挿入。左folder treeとcanonical compositionを維持 |

利用可能な実Forge Neo / Animaはtxt2img対応。Hires/img2img/Inpaint/IP-Adapterは既存providerの非対応仕様をそのまま表示し、実生成を強制しない。対応ReForge contractはintegration environmentでHires/Inpaint/IP requestとCanvas maskを確認。

`localImageChat.studioSession.v1`は新規の追加保存。Structured/Rawの独立draft、Negative、parameters、model/runtime、LoRA weight/order/enabled、completed/current imageを保存。Library query/sort/favoriteとProduction viewは別の小さなkeyで復元。旧preset IDの`promptParts`をStructured本文と誤解釈するmigrationは行わない。local upload/base64/maskはsession storageへ保存せず、reload後の編集modeはtxt2imgへ戻る。歴史画像IDのreferenceは保持する。

実行中の保存Job IDだけにGETでreattachし、POSTや自動recovery resendを行わない。終端Jobは保存対象から除外。pagehideでbfcacheを壊さない。保存容量不足は新UIのエラーsurfaceに表示。

## Backend changes

1. History全履歴search/sortの任意query extension。
2. frontend entry routing / static revalidation。
3. 実データで発見したExperimentのstale集計status修正。すべてのrunsがterminalなら古い`status:running`だけで新実験を拒否しない。実行中runおよび作成予約中の空runsは引き続き排他対象。回帰test追加。

Job/API v1/MCP/request schema/storage formatのrewriteなし。既存画像・registry・設定を削除/移行しない。

## Verification

- `npm.cmd run check`: PASS。
- `npm.cmd test`: **832 total / 830 pass / 0 fail / 2 intentional skips**、約13.34秒。
- skipsは従来のsaved-baseline parity: SAMPLER_LEGACY_APP_PATH / SETTINGS_LEGACY_APP_PATH未指定。
- `git diff --check`: PASS。indexへstageなし。
- R1/new contract testsを含む全体test、R2 shell、R3 generation integration、R4 LoRA、R5 Library、R6 Advanced/Compare/session browser: PASS。
- R6 real experiment `4317f40b-5250-4008-b00d-a51fe7bb889e`: Forge Neo / Anima、512×512、Steps 8/10、Seed 515000、2実画像完成・新Viewer確認。
- Production real E2E: Structured 6 sections + Negative + `anima-base-1-flat-color-v3` weight .55 → 768×768 /16 Steps /Seed515101生成。Final Preview=request Prompt一致。生成中reload→同一Job再接続→Canvas完成。
- Production Job `00d806fd-9932-4ac5-97eb-3495808094ea`: done。Historical metadataの明示Reuse→Seed515102→`afeb6370-e8c9-433c-9dad-ca77ad989f5d`: done。再Generate→`b4d164e4-5ebf-421d-9073-e1e6582f4064`: cancelled。
- Production 390pxからも実Generate/Cancel: PASS。生成済み画像とDraftを保持。
- Production browser: console/page error **0**、unexpected HTTP status failures **0**、横overflow **0**、broken imageなし。旧cacheを試験用に作成→SW activationで除去→refresh後New Studio、明示legacy画面loadもPASS。
- Production全5幅でStudio/Prompt/Inspector/Model/LoRA/Library/Viewer確認。390/430ではRaw/Structured切替と440px viewportでsoft-keyboard相当の編集領域を確認。実iPhone Safari/実soft keyboardは未検証。
- 実測例: Production ready **523ms**、実LoRA catalog open **114ms**、reload reattachを含む768px生成完了 **31.9秒**。この環境の単発計測であり一般的な性能保証ではない。

| viewport | Canvas height | Prompt Dock height | R2–R4比 |
| --- | ---: | ---: | --- |
| 1280×900 | 624 | 178 | 維持 |
| 1440×900 | 624 | 178 | 維持 |
| 1920×1080 | 782 | 196 | 維持 |
| 390×844 | 496 | 202 | 維持 |
| 430×932 | 584 | 202 | 維持 |

Viewer Fitの画像がviewportから切れないことも追加確認。Canvas中心/compact Dock/6section Primary/secondary Inspector/画像中心Library/左だけのLoRA folder操作を維持。

証拠: ignored `workbench/final/production-report.json`, `mobile-job-report.json`, `cache-legacy-report.json`、同directoryのDesktop/Mobile PNG。実R6は`workbench/r6/real-experiment.json`。browser locator/待機条件の失敗を修正し、保存済みbrowser sessionからProduction surface検証を継続した（再開時に実生成を重複送信しない）。最終5幅のsurface確認とFit修正は再実行PASS。スクリーンショットは会話へ画像データで提示。

## Changed files (this completion run)

- Backend: `src/frontend-entry.js`, `server.js`, `history.js`, `experiments.js`。
- Shared/workspace: `public/core/library-service.js`, `studio-session.js`, `public/features/generate-workspace.js`, `generation-controller.js`。
- Production: `public/frontend/index.html`, `app/boot.js`, `app/app-shell.js`, `components/shell/app-bar.js`, `public/sw.js`, `manifest.webmanifest`。
- UI: `components/library/image-library.js`, `canvas/canvas-editor.js`, `canvas/compare-dialog.js`, `inspector/advanced-dialog.js`, `settings/dialog.js`, `settings/model-picker.js`, `prompt/prompt-workspace.js`, `lora/lora-browser.js`, `lora/lora-details.js`（component pathsはpublic/frontend配下）。`styles/shell.css`, `image-library.css`, `advanced.css`。
- Tests: `test/library-service.test.js`, `studio-advanced.test.js`, `frontend-production.test.js`, `experiments.test.js`。
- Dev verification: `dev/studio/boot.js`, `server.mjs`, `library-smoke.mjs`, `advanced-smoke.mjs`, `real-advanced-smoke.mjs`, `production-smoke.mjs`, `production-mobile-job.mjs`, `production-cache-smoke.mjs`; package check script。
- Docs: current-state / decisions / this final record。

開始時の巨大なdirty tree全体を今回の変更として扱わない。R1–R4実装とlegacy/文書の既存差分はそのまま残っている。

## Legacy classification / limitations

- Delete Now: なし。rollbackを壊す削除はしない。
- Keep Temporarily: `public/index.html`, `app.js`, `style.css`と旧UI専用controller/rendering/modal。明示legacy routeおよび歴史的testが必要とする。旧global Settings/管理画面もfallbackに残る。
- Shared Core: Runtime/request/Prompt-LoRA coordinator/generation controller/metadata/history/image delivery/backend contracts。New Studioから旧DOM/CSS/modal/rendering functionへの依存なし。
- 実Providerで非対応のHires/Inpaint/IPの品質・速度は未検証。Civitai実download/installは未実行。local mask/file reload復元は対象外。旧UIから新UIへの制作draft一括migrationはしない。
- ReuseはR1の限定scope、Checkpoint Setは既存schemaの範囲。履歴保持件数・retention設定は変更していない。
- 完了。追加Phase・commit/pushは実行せず停止。

## Checkpoint split — 2026-09-08

ユーザーGOによりR1–R7だけを3commitへ分割。共通contract `a38f3b3`、New Studio workflows `b7583c6`、Production切替は本記録を含むcommit。Pearl Glass/旧Gallery、Lab、Artist catalog、検証画像・browser sessionは未commitで保持。pushなし。

各index treeをTEMPへ独立展開して検証。Git archiveの改行変換を無効にして保存内容どおりのLFで実行し、checkとfull suiteはそれぞれ814/812 pass、825/823 pass、827/825 pass（全てfail 0、既存skip 2）。832件の過去working-tree gateとの差5件は、除外した旧Gallery改修test。New Studioのfixture browser5本を候補treeで確認。Library smokeはviewport切替直後のoverflow assertionが一度失敗し、同一tree再実行でPASSした。実Provider生成・Production再起動はcheckpoint作成では再実施していない。
