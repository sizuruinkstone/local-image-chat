# Local Image Chat — UI Phase Roadmap

> 2026-09-07追補: 本人がB＋Pearl Glass、A相当の小型LoRA画像、Gallery拡大metadataを採用。解像度プリセット・Sampler・Schedulerは主要設定の選択式。Production実装GOとAstra単独実施の指示あり。[実装記録](ui-glass-implementation.md)と[現行DESIGN](../../DESIGN.md)が現在状態。本書の未選択/未着手という記述は初回計画時点の記録であり、未確定の場面保存等まで実装済みを意味しない。


作成: 2026-09-07。入力: [確認済み要件](user-ui-requirements.md)、[Master Plan](ui-renovation-master-plan.md)、[Design System Plan](design-system-plan.md)、[UI boundaries](../refactor/ui-renovation-boundaries.md)。

**本書は実行計画であり実装GOではない。現在完了しているのはヒアリング・要件確認・計画文書作成。コード/CSS/HTML/test/packageは変更していない。** Refactor Phase 1–23と区別するため、以下はUI-R番号を使う。

## 1. 実行原則と依存

- 本人の最重要領域に早く価値を届ける。Settings shell先行は必須にしない。
- Mobileを最終Phaseに寄せず、Generate/Gallery/LoRAの各gateへ組み込む。
- correctness修正と見た目変更を別のレビュー可能な差分にする。既知bugがある関連UIだけを止める。
- UI-R0 → UI-R2。UI-R1G → UI-R5、UI-R1S → UI-R2の関連Recent部分、UI-R1C → UI-R2/UI-R6のsummary部分。
- UI-R2の共通部品を基礎にUI-R3/4/5を進める。UI-R6の適合設計はUI-R0と並行可能で、contract検討が長引いても表示工事を止めない。
- 各番号は単独の巨大patchを意味しない。ownerが異なる作業は以下の子taskに分け、同一fileの並行編集を避ける。
- 以下の担当は将来の目安。Lunaは探索/検証、Terraは小さいCSS/部品、Solは実装、Astraは横断設計と最終review。実装時は実際の範囲に応じる。

## 2. Phaseと完了条件

| Phase | 範囲・主担当 | 成果と完了条件 | 除外 |
| --- | --- | --- | --- |
| UI-R0 視覚/操作比較 | Astra設計、Terra等で限定モック | A/BでGenerate/Gallery/LoRAを同条件比較。desktop/狭いPC/390px、現状の操作数・scroll・画像面積を記録。本人の方向選択を受け、DESIGN変更候補を明示 | Production、全画面実装、未承認token採択 |
| UI-R1G Gallery prerequisite | Sol、Luna検証 | old/new filter遅延、append/reset、失敗後最新要求を再現し独立fix。20枚問題のserver/client適用範囲を説明 | redesign、Studio別race、paging schema変更 |
| UI-R1S Studio recent prerequisite | Sol | recent all/favoriteの旧応答が新表示を上書きしない。対象経路だけfix | Gallery raceへの自動合流 |
| UI-R1C summary prerequisite | Sol/Terra | Checkpoint Set適用後のフォーム/折りたたみsummary/Studio stats一致 | 推奨値変更、autoApply条件変更 |
| UI-R2 Generate / Studio shell | Sol、Astra境界review | R2a: layout/scroll/主要設定/Generate位置、R2b: 結果/Recent/status。画像優先、狭いPCで操作可能、mobile keyboard状態、生成中遷移でJob継続 | Prompt semantics、Runtime/Generation transaction、新router |
| UI-R3 Prompt / reuse | Sol | R3a: Structured/import/拡大編集/Negative、R3b: 既存全設定読込→Prompt focus、R3c: 適合確認済み部分コピー/チップだけ。Raw優先、保存/undo/LoRA同期を維持 | 新schema、AI自動補正、根拠のない履歴分割 |
| UI-R4 LoRA | Sol、Terra表示、Astra統合review | R4a Selection tree/位置/±、R4b Management folder/分類/reload、R4c Civitai入口。選択と管理の責務分離、mobile全画面、名前/衣装/weight/disabled整合 | catalog/selection統合、実install、永続recent storeの無断追加 |
| UI-R5 Gallery / detail | Sol | 高密度・通常/NSFW/Favorite、正しいfilter/paging、自動追加とretry、戻り位置、拡大metadata/前後移動。390px overflow解消。Favorite同ID同期 | 原寸先読み、独自全件cache、Compare削除 |
| UI-R6 場面とCheckpoint設定 | Astra適合設計、承認済み範囲をSol | R6a: Master Planの静的適合表を基に役割/優先順/保存契約の具体案、R6b: Profile/Set自動適用の既存contract内の設定UI、R6c: 保存場面の独立contract提案と承認後の別実装。保存場面とキャラ保持の実例を検証して初めて機能完了 | 仕様未確定の場面store、既存Recipe改変、外部推奨値の無断取得 |
| UI-R7 Settings / Inpaint / IP | Sol、Canvas境界はAstra | R7a Settings shell/問題表示、R7b Inpaint toolbar/stage、R7c IP controls/availability。各owner別差分。PC操作と関連mobile表示を確認 | provider対応追加、mask/schema変更、実storage/update/Discord送信 |
| UI-R8 統合release判定 | Astra review、Luna検証 | 共通journey、実Safari、視覚一貫性、長い値、既存機能の到達を確認。未実施/残課題/contract追加分を分けて報告 | 新feature、惰性的な全suite反復、未承認deploy/commit/push |

Compare/Experiments/Referenceの専用刷新Phaseは設けない。ただし共通shell変更に伴う回帰防止と既存入口の保持はR2/R8で確認する。Hiresの性能改善は別候補。

## 3. 着手時の最小task契約

各子taskは、対象path/owner、許可する表示変更、保護contract、既存dirty、affected test、browser scenario、完了条件を短いtask文書へ固定してから始める。実際のDOM差分が分かる前に全filesを編集対象と宣言しない。

変更対象の原則:

- 共通view: `public/index.html` / `public/style.css` の対象section、該当DOM injection、必要最小のrender。
- `public/app.js` は該当form adapter/composition接続だけ。全分解・汎用appContext導入はしない。
- controllerの表示部を変更する場合も、stateや非同期処理までUI扱いにしない。
- CSS/HTMLの更新時にID/class/data selector、event委譲、source assertionを同じ対象差分で追従。
- Production変更の許可は対象PhaseのGOで確認する。UI工事のGOが別contract変更の承認を兼ねるとは推定しない。

## 4. 検証gate

| 対象 | 優先する既存test / 根拠 | browserの重点 |
| --- | --- | --- |
| R1G / R5 | history-controller、ui-shell、image-delivery-ui、layout-overflow、影響時favorite-sync | rapid filter、遅い応答、append/reset、error/retry、20枚より先、detail復帰、390px |
| R1S / R2 | studio-controller、generation-controller、navigation、queue-controller/view、影響時bootstrap | generate→navigate→result、連打/cancel、Recent freshness、MCP由来fixture Job、狭いPC |
| R1C / R6 | checkpoint-sets-controller、runtime-controller、recipe-runtime-boundary、prompt-lora-form-characterization | Set適用/手動値/Runtime切替・失敗、form/summary一致 |
| R3 | prompt-lora-form-characterization、prompt-lora-coordinator、recipe-workflow、影響時lora-tags | import、Raw override、部分置換、undo、全設定読込、iPhone keyboard/paste |
| R4 | lora-library-controller、prompt-lora-coordinator、lora-outfit-selection、preset-catalog、対象Civitai tests | folder再開、長い名前、衣装、weight/disabled、reload中Runtime、mock URL導入 |
| R7 | settings-navigation、対象settings、inpaint-editor、ip-adapter-controller、影響時reference/Recipe | search/focus、実Canvas paint/erase/undo/resize/DPR、supported→unsupported→戻る |

test名は[UI boundaries](../refactor/ui-renovation-boundaries.md)の候補と突き合わせて実行時にpathを確認する。表全体を毎回実行する指示ではない。

1. 変更中はaffected focused。bugは先に挙動を再現する。低影響の表示変更を写すだけの新testを増やさない。
2. feature統合後に正常・主要な失敗/非同期・入退場を含むbrowser sequenceを完走する。fixture失敗とproduction失敗を区別する。
3. 最終production差分後に `npm.cmd run check` と `npm.cmd test` を各1回。green後は新変更/失敗/未解決懸念がなければ反復しない。
4. UI変更では1366×768 100%/125%、390pxを基本。共通layoutは1920/2560/430px、実ユーザーの狭いPC幅と実Safariを追加。
5. 実Safariが使えない場合は未確認と明記し、Chrome device emulationを実機PASSとしない。生成/provider/実送信は独立範囲。
6. 文書だけの変更はリンク・内容・差分・whitespace。今回check/full/browserは実行しない。

## 5. Before / after measurement

同一fixture、同一viewport、同一開始stateで測る。元の数値は未計測であり、現時点で高速化率や画像面積増加を主張しない。

| journey | 測るもの / 達成の見方 |
| --- | --- |
| 過去画像→設定読込→Prompt編集 | クリック数、focus先、scroll距離。submitが勝手に始まらない |
| LoRA picker再開 | 前回folderまでの追加操作数。位置保持により階層をたどり直さない |
| 主要設定変更 | 対象項目に触れるまでの展開/scroll、±/数値の押しやすさ |
| Gallery探索 | viewport内画像数と操作target、filterが履歴全体に効くこと、追加/戻り位置 |
| 狭いPC | 画像面積、Prompt可視範囲、scrollWidthと操作不能領域。アコーディオンで修理しなくてよい |
| iPhone入力 | keyboard遮蔽、paste、意図しないzoom、Generate/navの干渉 |

「AIっぽくない」は機械測定でPASSにしない。R0の本人の視覚判断と、実操作の確認を別に残す。

## 6. Contract衝突時の扱い

R6aの具体案の完了条件は、保持/置換するStructured欄とキャラタグ、未分類/欠損/重複LoRA、画風/Turboの置換、Trigger Words、Raw override、分割情報のない旧History、Profile→Set→手動編集と場面適用の優先順を明示すること。加えてpreview参照のowner/lifetime、通常/NSFW・ポーズ分類、schema version、migration/backward compatibilityを定義する。未決定の項目が残れば契約設計完了とは扱わない。

R6cの将来の実装が別途承認された場合、上記の保持/置換、Raw/旧History、LoRA例外、preview/分類の保存と再読込、migration、auto/manual優先順を対象にfocused regressionを定義して実行する。R1C/R6の表は既存Profile/Set表示のgateであり、新しい場面機能の検証を代替しない。今回testは作成・実行しない。

自動推奨/場面保存、部分Prompt適用、recent永続化、server filter能力などで既存contractと衝突した場合は、その関連子taskを分離する。要望、現制約、変更risk、contract維持の代替案を具体化して説明する。明示承認が必要な変更は、その返答を待ってから実行する。他の独立した承認済みUIは進められる。

Recipeの対象外checkpoint/source/maskを新UIの読込で暗黙適用しない。Raw優先・LoRA source/disabled・Runtime成功commit・Generation one-shotを変更して見た目の統一を図らない。

## 7. 引き継ぎと停止

各子taskの最後に変更files、何を維持したか、実行command/exit/pass-fail、browser条件、未確認/関連bug、保持dirtyを記録する。current-stateを短いsnapshotに更新し、長い証拠は個別Phase記録へ置く。durableなcontract判断だけdecisionsへ記録する。

現在の次候補は **UI-R0の2方向の視覚モック比較** と **UI-R6aの機能適合設計**。ユーザーへの長い追加質問は行わず、具体的な成果物を作って判断できる形にする。今回は3計画文書の作成までで停止し、Production実装は別途GOを待つ。
