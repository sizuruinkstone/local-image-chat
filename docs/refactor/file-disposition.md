# Repository Surgery Audit — File disposition

監査日: 2026-09-06。対象はPhase 2完了working tree。**今回の分類は今後の判断材料で、move/delete/mergeの実行許可ではない。** [inventory](repository-inventory.md) の実コード調査と [target](target-architecture.md)、[plan](surgery-plan.md) を併読する。

KEEP=現在の責務/位置を維持、EXTRACT=責務を抽出、MOVE LATER=境界安定後に再配置を検討、DELETE CANDIDATE=別確認を要する不要候補、MERGE CANDIDATE=重複の確認候補、DO NOT TOUCH=契約/保存/安全境界を不用意な整理から保護。DO NOT TOUCHは将来の明示されたbug fixまで禁止する意味ではない。同じfileの実装責務をEXTRACTとし、そのcontractを保護することは両立する。

## Frontend

pathは `public/` 相対。共通のMOVE LATER条件はStage Aでownerを安定→Cのpath/assert整理→Dのmove-only。public外へ出るなら先にEの配信設計が必要。

| Path | Current responsibility | Disposition | Reason | Dependencies | Risk | Recommended timing |
| --- | --- | --- | --- | --- | --- | --- |
| `app.js` | bootstrap/DOM/state/全workflow | EXTRACT | 最大の暗黙結合。狭いcontroller/portを作る | 全feature/API/LS/SS/timer | 高〜最高 | A、Phase3から小単位 |
| `index.html` | 全画面/form/modal shell | EXTRACT | view責務を将来分ける価値。今はDOM owner維持 | app selector、CSS、focus | 高 | 対象controller完了後F。Aと混ぜない |
| `style.css` | tokens/base/全feature/responsive | EXTRACT | feature UI変更時の探索削減 | cascade/後段override、HTML、safe-area | 高 | JS owner安定後、Fでcomputed layout確認 |
| `core/http-client.js` | JSON transport | KEEP | Phase1で狭い純粋境界 | fetch/error semantics、app/tests | 低（挙動変更は別） | 維持 |
| `features/navigation.js` | currentView/hash/lifecycle | KEEP | Phase2完了、十分狭い | view-router、DOM/callback/storage | 中 | 維持、再抽出しない |
| `view-router.js` | pure view/hash | KEEP | 30行、位置変更の即時利益が小さい | navigation/tests | 低 | 必要になったfeature move時だけ再評価 |
| `option-picker.js` | sampler pure helpers | MOVE LATER | samplerとco-location可能 | app→sampler controller、tests | 中 | Phase3完了後、抽出と別差分 |
| `lora-profiles.js`, `lora-preview.js`, `lora-outfit-selection.js` | LoRA profile/preview/outfit | MOVE LATER | feature単位探索に適する | app、structured-prompt、LoRA tests | 中〜高 | LoRA責務境界確定後D |
| `checkpoint-profiles.js` | checkpoint/compatibility | MOVE LATER | runtime feature近傍が適する | runtime/LoRA/form/tests | 高 | runtime/profile owner確定後 |
| `structured-prompt.js`, `lora-tags.js`, `history-title.js` | cross-environment pure contract | DO NOT TOUCH | Nodeからもimport。frontend-only移動不可 | backend services/history/server + browser | 高 | 当面位置/export維持、shared配信設計後のみ |
| `prompt-import.js` | Prompt parse/merge | MOVE LATER | Promptの局所性向上 | structured-prompt、app/tests | 中 | Prompt coordinator安定後 |
| `preset-catalog.js` | catalog/tree/count/DOM nodes | MOVE LATER | LoRA/preset近傍へ。pureとDOMを無理にshared扱いしない | app callbacks、LoRA/preset tests | 中 | library/selection境界確定後 |
| `civitai-folders.js` | folder grouping | MOVE LATER | Civitai workflow近傍へ | app/LS caller/tests | 中 | Civitai抽出後 |
| `gallery-filter.js` | pure image/filter/sort | MOVE LATER | gallery表示へco-locate | app/history shape/tests | 中 | Phase11後 |
| `studio-history.js` | recent filter | MOVE LATER | Studio近傍へ | app/History/tests | 低〜中 | Phase10後 |
| `metadata-format.js` | metadata text | KEEP | 複数viewの表示helperとして狭い | app、History metadata/tests | 低 | consumerが増減した時再評価 |
| `image-delivery.js` | thumbnail/original/fallback | KEEP | 横断配送contractを一本化済み | app/compare、image routes/tests | 中〜高 | URL/cache/intent維持 |
| `queue-view.js` | Queue DOM | MOVE LATER | monitor/controllerとco-locate | app callbacks/tests | 中 | Phase8後、lifetime維持 |
| `compare-view.js` | diff/modal/vote UI | MOVE LATER | comparison featureへ | ui-kit/image-delivery/tests | 中 | Phase12後 |
| `lora-editor.js` | metadata dialog | MOVE LATER | library featureへ | ui-kit/save/move callbacks/tests | 中 | LoRA library抽出後 |
| `ui-kit.js` | modal/toast/clipboard/busy | KEEP | shared UI境界として有効 | document、各view、focus/listeners | 中 | components移動は必要時のみ |
| `sw.js`, `manifest.webmanifest`, `version.json` | PWA/配信版 | DO NOT TOUCH | scope/registration/version配布契約 | app/index/static/updater/tests | 高 | E専用gate |
| `icons/icon-192.png`, `icons/apple-touch-icon.png`, `image-placeholder.svg` | 現役static assets | KEEP | manifest/index/fallbackに参照あり | browser/PWA/image-delivery | 低〜中 | 維持 |
| `icons/icon-512.png`, `icons/icon-maskable-512.png` | 宣言外PWA候補asset | DELETE CANDIDATE | 現manifest/indexは未参照、ただしstatic URL利用は否定不可 | 外部shortcut、過去install、tests要確認 | 中 | Bで利用履歴確認するまで保持 |

## Backend

pathは `src/` 相対。大規模`src/backend` moveは推奨しない。KEEP directory内のcontract-critical部分は下表で明示保護する。

| Path | Current responsibility | Disposition | Reason | Dependencies | Risk | Recommended timing |
| --- | --- | --- | --- | --- | --- | --- |
| `server.js` | process composition/legacy routes/static | EXTRACT | route registrationとstartupの変更理由が異なる | 全services、root計算、entrypoints、tests | 高 | frontendとは別backend Phase、今の次作業ではない |
| `services/generation-service.js` | legacy/v1生成/validation/保存/recovery | EXTRACT | 複数workflow、順序の暗黙依存 | runtime/JobManager/History/Prompt/asset | 最高 | payload/失敗順characterization後の専用Phase |
| `civitai.js` | inspect/download/install/registry | EXTRACT | networkとfilesystem transactionを明示化する余地 | roots/folders/files/registry/manual metadata | 高 | install rollback/duplicate test確保後 |
| `services/prompt-service.js` | pure Prompt orchestration | KEEP | 既に狭い | public structured-prompt、G/S | 中 | 維持 |
| `api/v1/`（router/assets/capabilities/generations/history） | API adapter/DTO/error | DO NOT TOUCH | 既存の良い分離。parser順とsafe DTOは公開契約 | service注入、MCP、Express/tests | 高 | 位置維持、API明示taskのみ変更 |
| `generation-runtimes.js`, `forge-neo.js`, `reforge.js` | provider/registry | DO NOT TOUCH | IDs、activation、legacy互換 | G/server、catalog/options/queue | 最高 | 抽出の副次変更禁止 |
| `job-manager.js`, `recovery.js` | job寿命/retry plan | DO NOT TOUCH | in-memory lifecycle/一度のrecovery | generation/experiments/UI | 最高 | 専用契約変更taskのみ |
| `history.js`, `ip-adapter.js` | 保存normalization/paging/reference metadata | DO NOT TOUCH | schema/cursor/merge/legacy復元/security | G/API/MCP/reference/runtime | 最高 | 専用test+fixture、move目的では触らない |
| `storage-settings.js`, `migrations.js`, `json-store.js` | transaction/migration/atomic write | DO NOT TOUCH | marker/backup/書込順が保全境界 | config/data/output/instance lock | 最高 | storage専用Phaseのみ |
| `reference-assets.js`, `mcp/attachment-reader.js` | asset/attachment security | DO NOT TOUCH | allowlist/public ID/hidden path | raw parser、MCP、static遮断 | 最高 | security境界を維持 |
| `mcp/server.js`, `mcp/tools.js`, `mcp/schemas.js`, `mcp/local-image-chat-client.js` | stdio tools/v1 thin client | DO NOT TOUCH | 既に明確な境界。長さだけで分割しない | SDK/zod/v1/host絶対entry path | 高 | protocol変更とfile整理を分ける |
| `experiments.js` | persisted workflow/jobs subscription | DO NOT TOUCH | active排他/cancel/delete/recovery順 | JsonStore/JobManager/G/UI | 最高 | Phase13 frontend抽出でbackendを触らない |
| `discord.js`, `integrations.js` | webhook state/external sync | DO NOT TOUCH | secret、auth、通知2系統/idempotence | History/content hash/server | 高 | settings UI抽出と分離 |
| `lora-registry.js`, `lora-root.js`, `lora-folder.js`, `lora-files.js` | identity/manual precedence/path/sidecars | DO NOT TOUCH | security/migration/file set契約 | Civitai/migrations/server | 高 | 専用fixtureを伴う変更のみ |
| `thumbnails.js`, `content-hash.js` | safe thumbnails/content ID | KEEP | 狭い再利用service | History/static/integrations/sharp | 中〜高 | URL/ID/cache契約維持 |
| `checkpoint-sets.js`, `prompt-template.js`, `ai-share.js` | 各domain保存/CSV | KEEP | 現位置で責務が明確 | JsonStore/手動優先/UI/API | 中 | 維持 |
| `ollama.js`, `civitai-token.js`, `lora-weight.js`, `net-info.js` | adapters/narrow helpers | KEEP | 独立した変更理由を持つ | caller/tests、net-info NUL検索注意 | 低〜中 | NUL表記整理は別小task候補 |
| `instance-lock.js`, `updater.js` | 起動保全/更新rollback | DO NOT TOUCH | root依存/更新allowlistが移動に影響 | server/paths/start scripts/npm | 高 | E/D設計時に専用検証 |

## Tests / tooling / docs / artifacts

| Path | Current responsibility | Disposition | Reason | Dependencies | Risk | Recommended timing |
| --- | --- | --- | --- | --- | --- | --- |
| `test/` | 53 unit/contract/static files | KEEP | 契約の再利用資産 | src/public/cwd/source | 中〜高 | 各Aで必要な追従、Cで包括整理 |
| `test/server-*.test.js`の起動fixture | 子server/setup | MERGE CANDIDATE | 重複helper、各suiteの契約は異なる | cwd/src/server/package/temp dirs | 中 | C、fixtureのみ。suiteは削除しない |
| `test/task20.test.js`, `test/task22.test.js`のfixture | runtime/profile検証 | MERGE CANDIDATE | setup類似、後方互換coverageは必要 | Neo/API/MCP/UI | 高 | assertion意味を比較後 |
| UI source assertions（ui/ui-shell/pwa/layout/image-delivery-ui等） | DOM/CSS/配信の文字列契約 | MERGE CANDIDATE | 重複とpath coupling | HTML/CSS/ESM/DOM identifiers | 中〜高 | C、behavior/staticの適切なownerへ |
| `package.json`, `package-lock.json` | ESM/start/mcp/check/test/deps | KEEP | 全依存にconsumer、build不要 | entrypoints、9 check漏れ、Node>=20 | 中 | check列挙改善は別tooling task |
| `install.bat`, `start.bat`, `start-lan.bat` | local起動 | KEEP | entrypoint/環境の運用契約 | src/server、cwd、env | 中 | backend entry move時だけreview |
| `config.json`, `.env.example`, `config.local.example.json` | tracked基準/設定例 | KEEP | 移動や初期化の利益なし | runtime/startup/docs | 高 | 設定仕様変更taskのみ |
| `AGENTS.md`, `DESIGN.md`, `docs/implementation/current-state.md`, `decisions.md` | 正本/作業入口 | KEEP | 現在のsource of truth | source/Phase記録 | 低 | current-stateだけ今回snapshot更新 |
| Discovery、Phase1/2文書 | baseline/完了証拠 | KEEP | 旧行番号はsymbolで確認 | current-state/tests | 低 | 内容の全面上書き不要 |
| `README.md`, `TODO.md` | 利用入口+過去release/延期 | MERGE CANDIDATE | 完了履歴と現仕様を将来分離、stale修正が必要 | runtime/paging/DESIGN | 中 | 別docs Phase。全体削除不可 |
| `docs/CURRENT_TASK.md`, `docs/REVIEW_FIXES.md` | 複数task/handoff履歴 | MERGE CANDIDATE | 完了節のarchiveと索引化候補、進行Lab節は保全 | 別project作業/過去証拠 | 中〜高 | owner/status確認後。今回既存差分不変 |
| `docs/FORGE_NEO.md`, `docs/MCP.md`, `docs/luna-tasks/` | 運用/個別task仕様 | KEEP | 契約/検証の参照元 | runtime/API/外部Lab | 中 | staleなscope/statusだけ別docs task |
| `docs/AI_PROJECT_MEMORY.md` | 私的memory運用の入口 | MERGE CANDIDATE | AGENTS不在記述stale、入口指示が重複 | AGENTS/current-state/私的memory | 中 | 指示をリンク集約。本文削除不要 |
| `.env`, `config.local.json`, `data/` | secret/config/永続正本 | DO NOT TOUCH | private、schema/運用保全 | 全runtime/storage | 最高 | cleanup/配布から除外 |
| `outputs/`, `thumbnails/`, `.updates/` | 画像/cache/backup | DO NOT TOUCH | 名前だけでstale扱い不可 | 設定済みstorage root、History、rollback | 高 | 再生成性・参照・保持方針を別確認 |
| `output/`, root `malice_*.png` | 未追跡生成/調査成果 | DO NOT TOUCH | user成果物、用途/再生成性未監査 | 私的作業/外部参照不明 | 高 | 削除許可なし |
| `docs/artist-catalog/`, twitter文書/gallery/ZIP、`scripts/update-artist-catalog.js` | 個人研究と再生成script | DO NOT TOUCH | generatedだから不要とは言えない | 元データ/利用者/外部参照 | 高 | 製品source整理と別扱い |
| `.obsidian-memory/`, `workbench/`, `.claude/` | 私的memory/成果/agent設定 | DO NOT TOUCH | 履歴とuser作業保護 | local workflow | 高 | 本文未調査、無断整理不可 |
| `.git/`, `node_modules/` | VCS/installed deps | KEEP | auditのsource手術対象外 | repository/npm | 高 | 今回操作なし |

## Narrow deletion / export候補の安全条件

`public/lora-outfit-selection.js` の **`isOutfitChoiceSourceId`だけをDELETE CANDIDATE** とする。検索範囲src/public/testでは宣言以外0件、直接testなし、module自体はappが使う。削除前にdynamic module namespace/外部利用・意図したexport契約を再確認し、対象LoRA/outfit testsと全体gateを通す。参照0のみで削除しない。

`isAppView`、`isPromptField`、`showToast`、`registerMcpTools`等は内部使用があり、function削除候補ではない。不要なexportかどうかの確認に留める。test-only exportはpure helper検証のために意図的な場合がある。module全体・dependency・test fileについて、今回削除確定のものはない。

backup/temp/stale generated outputについて安全な削除根拠は得られていない。未追跡/local artifactをDELETE CANDIDATEへ機械分類しない。各候補のreference/runtime/static/test/dynamic評価は[inventory](repository-inventory.md#deadduplicate-investigation)参照。
