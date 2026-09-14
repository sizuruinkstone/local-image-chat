# Repository Surgery Audit — Surgery plan

監査日: 2026-09-06。文書のみ。Phase 2までの未コミット実装を保持し、Phase 3以降・cleanup・move・UI変更は実施していない。[inventory](repository-inventory.md) / [disposition](file-disposition.md) / [target](target-architecture.md)。

## Supervisorの判断

1. **Phase 3–13の責務抽出は継続する。ただし無条件に連続実施しない。** 元の順序は概ね妥当。各featureのcharacterizationとport設計をgateにし、Phase 11–13は関連ownerが安定したことを再確認する。
2. **Phase 3前の一括cleanupは不要。** 削除確定のproduction moduleはない。stale TODOを実装要件と誤認しない文書入口整理はこの監査で行い、候補確認は抽出後に独立実施する。
3. physical relocationは該当featureのcontroller/owner・import・testが安定した後。全feature抽出完了は必要ないが、moveと責務変更を別差分にする。
4. `src/frontend`は今は採用しない。public内feature-oriented配置で主目的を達成できる。配布元/生成物分離が必要になった場合に再評価する。
5. build stepは今は不要。bundle/copyの運用負荷を上回る測定済みの利益がない。
6. backend一括再配置は不要。既存api/services/mcpは維持。serverのlegacy route/service composition等は依存と変更理由がある箇所だけ独立抽出候補。
7. **最短の実UI着手点は対象featureの抽出・characterization直後。** 例えばPhase 4完了後のsettings shellは限定UI変更を別タスクで開始できる。全面UI新築はPhase 13だけでは不足し、runtime/Prompt/LoRA/reference/recipe/generationのportsとlifetimesの安定が必要。mockupのみなら先行可能だが実装移植の完了とは異なる。
8. 全面rewriteを必要とする合理的根拠は今回確認できない。再利用できるpure helpers、backend契約、fixtureがあり、最大の問題はapp内の暗黙結合。未測定の将来要件からrewriteを正当化しない。
9. Astra supervisionはruntime rollback、Prompt/LoRA協調、History merge/recipe、generation/recovery、static/updater変更、substantial change最終reviewに集中する。
10. 明確な境界の抽出はSol、小規模listener/UI shellはTerra、検索・path検証・check/testログはLunaへ委譲できる。rootが設計・統合・完了判定を持つ。

## 推奨Stageと順序

基本順序は **A → B（確認できた候補のみ）→ C → D**。Eは任意の別判断であり、public外へ移す場合は **Eの設計・配信準備をDより先** に置く。Fは対象featureのAのgate後から限定的に可能。全Stageを一括承認しない。

| Stage | 作業 / expected benefit | prerequisite・gate | regression risk | rollback ease | AI context削減 |
| --- | --- | --- | --- | --- | --- |
| A: 責務抽出 | public内controllerとportsを作る。暗黙state/順序を限定 | 旧実装characterization→対象tests→check/full suite、該当browser確認。保存/API差なし | 低〜最高、owner横断度による | 1 feature単位の差分revert。data復元不要 | 最大。巨大app探索を狭いmoduleに置換 |
| B: 候補確認・cleanup | dead/duplicateを証拠付きで減らす。docsの旧記述を別taskで整理 | reference + static/dynamic usage + coverage + owner確認。0参照だけでは不可。各候補独立承認範囲 | 低〜高。local/private artifactは対象外 | tracked codeは容易。未追跡成果物削除は戻せないため別承認と保全が必要 | 小〜中。誤った入口とduplicate探索を削減 |
| C: Path-sensitive test整理 | behavior assertionと配置/配信contract assertionを分ける | 現assert一覧・意味を保持。移動対応だけでassert削除しない。必要なpublic URL検証は残す | 中。testが通るだけの弱体化に注意 | test差分のみで容易 | 中。移動のたび巨大regexを調べる負担軽減 |
| D: Physical relocation | 安定featureのhelper/controllerをco-locate | import graph、package check、tests、HTML/CSS/URL、Node shared consumer、updaterを確認。move-only差分と配信smoke | 中。public外移動は高 | 旧asset graphとentrypointへ戻せる配布物が必要。data操作なし | 中。file局所性向上、責務抽出なしのmoveは効果小 |
| E: 任意のbuild/static変更 | source/output分離や測定済みload問題に対応 | 必要性/代替比較、完全asset graph、clean checkout配布/起動、update failure/rollback、PWA、秘密情報非公開を検証 | 高。全frontendへ波及 | release/asset/static root一式を戻す。新旧混在を防ぐ | 小〜中。buildだけではfeature contextは減らない |
| F: UI redesign/rebuild | 独立view/CSSを差し替え、feature責務を再利用 | 対象A完了、DESIGNの明示変更範囲、desktop/mobile、生成中遷移、画像配送、失敗状態検証 | 対象shellは中、全体は最高 | feature view/CSS単位なら容易。新旧form二重ownerは避ける | 中。view/controller契約が明瞭になる |

Stage A中のsource-test移設は各抽出の必要最小限で行う。Stage Cまで壊れたtestsを放置する意味ではない。Stage Cは後の再配置を容易にする包括的な整理。Stage Bで有効候補が確定しなければskipし、Aの前提にしない。

## Phase 3–13ロードマップへの差分提案

正本の [Discovery section 7](../implementation/frontend-refactor-discovery.md#7-refactor-phases) はhistorical baselineとして改変していない。以下は次回の実装依頼を切る際に適用する提案。

| Phase | 判断 / 追加gate |
| --- | --- |
| 3 Sampler | **次の1作業として維持。** runtime catalogは入力port、保存キーとprofile/recipe後のform→label同期を固定。folder大移動はしない |
| 4 Settings shell | 維持。settings値の保存ownerを巻き込まない。完了後、限定shell UIを別承認単位にできる |
| 5 Discord settings | 維持。safe settings/clear/testのmock。実Webhook送信を検証手順に混ぜない |
| 6 Storage settings | 維持。plan/reserve/cancel UIだけ。backend migrationのリファクタを同時にしない |
| 7 AI share/template | 維持。CSV更新debounce、manual trigger優先、clipboard failure。Prompt選択coordinator抽出を先取りしない |
| 8 Queue monitor | 維持。timerはapp lifetime。初回terminal通知抑制、failure snapshot、navigation跨ぎをgate |
| 9 画像state | 維持。画像FavoriteとLoRA Favoriteを分離。全カード/詳細/StudioのID同期、Discord2系統を確認 |
| 10 Studio | 維持。result表示とmodalは小単位review可能。form/canvas workflowと分離し、原寸取得は明示操作時のみ |
| 11 Gallery/History | **開始前にowner reviewを挿入。** paging/cache/mergeのhistory責務とgallery描画/filterを明示port化。既知race修正は別Phase。小単位に切ってもcursor/merge契約を途中で変えない |
| 12 Compare | 11のsnapshot/delete通知port安定後。選択Mapを所有しgalleryを直接書換えない。2–4枚/vote/original intentを固定 |
| 13 Experiments | 8の監視、11のcacheとform snapshot portをgate。workflowと描画を必要に応じ別reviewにし、seed/baseRequest/recovery/取消順を保持 |

Phase 14以降は削除しない。runtime/LoRA/Prompt/reference/recipe/generationに高い結合が残るので、Phase 13完了を「全UI移植準備完了」としない。各完了時にimport/state mapを更新し、実際に読む範囲が減ったか確認する。

## Rollback / delegated work

未コミットのPhase 1/2と既存local成果物を含むworking treeから開始する。次作業は開始snapshotと対象pathを明示し、対象差分だけ取り消せる状態にする。`reset --hard`、`clean`、一括削除は使わない。data/config/outputに復元操作が必要になる設計はextractionのscope外。

- Luna: scoped symbol/reference search、local links/path/hash、対象tests/full suiteの外部log保存と集計。調査担当はread-only。
- Terra: 既に決まった小規模shell/listener抽出、文書訂正、確定したpathだけのmove。重なるfileを複数agentへ渡さない。
- Sol: 中規模feature controller、characterization、integration ports、reasoned review。
- Astra: API/storage/runtime/security等の境界変更判断、難しい非同期rollback、跨るcoordinator、substantial change最終統合review。

## 次の1つの作業と停止条件

**第一推奨はPhase 3「Sampler pickerのbehavior-preserving extraction」だけ。** [current-state](../implementation/current-state.md) とDiscoveryのSampler節、`public/app.js` の `SAMPLER_STORAGE` / `readOptionList` / `writeOptionList` / `loadSamplerOptions` / `syncSamplerLabels` / `renderSamplerPresets` / `applySamplerValue` / `openSamplerPicker`、option-picker/ui-kitとcallerを入口にする。新module候補は`public/features/sampler-picker.js`。

完了条件: current/favorite/recent/search/preset、空・古いcatalog、runtime切替、profile/recipe適用後のlabel、保存キー、listener寿命の既存挙動をcharacterizeし保持する。対象tests、`npm.cmd run check`、`npm.cmd test`、必要なbrowser picker操作を確認する。HTML/CSS/API/runtime/storageの仕様変更、cleanup、他feature抽出、commit/pushを同時に行わない。

**今回の停止位置はAudit文書作成と検証まで。上記作業は未着手・未承認。** 実装suite・実provider・実送信はこの監査では動かしていない。今回の文書検証結果は [inventory](repository-inventory.md) に記録する。
