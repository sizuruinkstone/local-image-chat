# Repository Surgery Audit — Target architecture

監査日: 2026-09-06。対象は既存checkoutのPhase 2完了working tree。これは将来の提案であり実装許可ではない。[inventory](repository-inventory.md) / [disposition](file-disposition.md) / [実行順序](surgery-plan.md)。現在の契約は [decisions](../implementation/decisions.md) を維持する。

## 第一推奨: public内のfeature-oriented native ESM

責務抽出を先行し、配信方式とbackendの位置は維持する。ディレクトリ名の対称性より、変更対象featureと狭い契約だけ読めることを優先する。以下は**提案先（未作成）**。既存helperは対応controllerが安定した時点で移動を検討し、同時に全fileをこの形へ変えない。

```text
public/
  index.html                 # shell / 静的DOMを段階的に整理
  app.js                     # composition / bootstrap
  core/http-client.js        # transport semanticsのみ
  features/
    navigation.js            # 既存Phase 2をそのまま使用
    sampler-picker.js        # 次の独立抽出候補
    settings/                # navigation, discord, storage, update
    generation/              # request orchestration（後半）
    runtime/                 # selected/active, catalog, snapshot ports
    prompt/                  # structured/raw coordinator
    lora/                    # library, selection, profiles, views
    civitai/                 # import workflow; libraryへの更新port
    history/                 # retrieval, cursor/merge, recipe ports
    gallery/                 # filters, cards, presentation
    comparison/              # selection, vote, comparison view
    experiments/             # workflow / monitor
    studio/                  # result / image modal
    reference/               # upload, inpaint, IP-Adapter
    ai-share/                # CSV/template/clipboard workflow
    queue/                   # app-lifetime monitor
  components/                # modal/toast/picker、domainを知らないUI
  styles/                    # tokens/base/shell; feature CSSは後でco-locate
  sw.js, manifest.webmanifest, icons/, version.json
src/
  server.js                  # 当面既存位置; compositionとlegacy route抽出は別判断
  api/v1/, services/, mcp/    # 既存境界を維持
  generation-runtimes.js, forge-neo.js, reforge.js
  history.js, job-manager.js, migrations.js, ... # 現在の安定moduleを維持
test/                        # domain別分類は将来。まずassertの契約を固定
docs/implementation/         # 現在状態とPhase証拠
docs/refactor/               # この監査と将来計画
```

## Feature co-locationと依存方向

LoRAのcontroller/view/model/helpers/CSSを常に5分割する規約は設けない。まずlibrary管理と選択・Prompt同期を区別し、既存profile/outfit/preset helperを再利用する。viewがDOMを作り、controllerが通信・listener・更新順を持ち、既存pure helperが変換を担当する形が有効。modelは独立した正本が実際にある場合だけ置く。LoRA選択とPromptの循環更新はPhase 17のcoordinatorへ残し、移動だけで両者を相互importにしない。

| 境界 | 許す方向 | 禁止・避ける方向 |
| --- | --- | --- |
| composition | app → controller、DOM subset、callbackを接続 | feature → appの逆import、巨大app context注入 |
| feature | controller → 自feature helper/view、core、明示port | gallery → generation内部stateの直接変更 |
| UI component | DOMと与えられたcallbackだけ | ui-kit → History/runtime API |
| transport | feature → HTTP helper → 同一origin API | browser → filesystem/provider直結 |
| backend | API/legacy adapter → 適切なapplication/domain service → runtimeまたはpersistence port。composition rootで接続 | 全domainをgeneration-serviceへ集約する変更、frontend配置の都合によるAPI v1や保存schema変更 |
| cross-environment pure logic | frontend/backend → 副作用なしhelper | Node専用依存やcredentialをbrowser staticに置く |

`structured-prompt.js`、`lora-tags.js`、`history-title.js`はbackendにも利用者がある。現状のpublic配置は美しくなくても機能しており、当面KEEP。将来sharedへ移すならbrowser向け明示配信・copy・bundleのいずれかとNode import更新を同じ配信Phaseで設計する。`src/`全体をstatic公開して解決しない。

legacy routeがHistory/Civitai/Discord/storage/updater等の各domain serviceへ直接委譲する既存分離は維持する。catalog/checkpoint用のprovider/registryアクセスもgeneration orchestrationへ無理に集約しない。

## State ownershipと寿命

中央storeの導入を支持する根拠は現時点でない。DOMが保持するform値はDOMを正本とし、read/apply/snapshot/restore portを用意する。localStorage/sessionStorageのキー、文字列・JSON・Map変換、profile version、復元順を保持する。

| State | Owner / 外部からの操作 |
| --- | --- |
| currentView、nav/hash listener | 既存navigation。gallery/compare entry callbackだけを通知 |
| form、raw/structured Prompt | 現DOMとPrompt coordinator。生成・recipeはread/apply port |
| selected LoRA / trigger / source / disabled | selection coordinator。libraryはcatalog更新portのみ |
| selected runtime と active runtime | runtime coordinator。UI選択をprovider activationと混同しない |
| History cursor/cache/loading | history controller。galleryへsnapshot/append結果を渡す |
| comparison selection | comparison controller。History delete時の調整port |
| 画像Favorite / Discord送信state | image-state owner。gallery/detail/studio/候補へID単位に反映 |
| reference/canvas/object URL | reference各controller。disposeと画像交換の資源解放を明示 |
| Queue / experiment監視 | app lifetime。画面切替で停止しない |

runtime切替とrecipe復元は複数ownerを跨ぐため、狭いportで**順序を一箇所に保持するcoordinator**が必要。各featureへstateを複製して整合を取る方式は採らない。coordinatorで不足する証拠が出た場合だけstore案を再審議する。

## Static delivery / build選択

現状は `src/server.js` がproject rootの`public`をExpress staticで公開し、HTMLのmodule scriptから相対importを辿る。Node側serverは`__dirname`の1階層上をrootとするためbackend移動もpath-only変更ではない。`src/updater.js` の `UPDATE_PATHS` はpublic/src/test等をbackup・置換・rollbackする。新しいroot直下build directoryは現在の更新対象ではない。

| 案 | 必要な変更 | 評価 |
| --- | --- | --- |
| public内ESM抽出 | 新module、caller import、check列挙、対象test | **今の第一推奨**。build不要。URLと配信は同じ境界 |
| public内feature再配置 | 相対import、HTML/CSS参照、source-test、配信確認 | controller境界安定後の小単位move。独立Stage D |
| src/frontendを専用static rootにする | Express root、HTML/assets/ESM URL、shared helper境界、PWAとupdater検証 | copy/bundlerは必須でないがserver配信設計変更は必須。src全体公開は禁止 |
| src/frontend → publicへcopy | 決定的copy/clean手順、起動前生成、配布物、更新/rollback、二重正本防止 | runtime URLを保てるが未copyの古いassetと保護対象削除のリスク。今は利益未証明 |
| src/frontend → build outputへbundle | bundler/deps/scripts、static root、source maps、asset URL、配布と更新/rollback | native ESM request数・load時間等で課題が確認された場合だけ評価。名前の整理には過剰 |

`src/frontend`へ移す価値は、source/output分離や配布工程を必要とする段階で生じる。feature単位で読む範囲を減らすだけならpublic内で達成できる。現時点でbuildを導入する測定根拠はない。copyはbuildの代替運用であり「無料のmove」ではない。bundlerは必須ではない。

`sw.js`はoffline asset cacheを持たず、activateで既存CacheStorageを削除しnetworkへ通す。存在するprecache manifestの書換えが必要だとは扱わない。ただし登録URL・scope、manifest・icons、version取得、旧ページが保持するmodule graphは配信変更時の確認対象。`/outputs`・`/favorites`・thumbnail/API assetのURL・security/cache semanticsはfrontend出力とは別の契約として維持する。

## 意図的に維持するもの

API v1、services、MCPの既存directoryはKEEP。runtime ID、Neo activation、ReForge互換、History normalization/merge、JobManager、migration、reference security、Discord送信stateは整理の副次変更から保護する。`.env`、local config、data、画像、backup、workbench等はsource treeの対称化のために動かさない。`src/backend`への一括移動は今の課題を解決せず、entrypoint・root計算・MCP host登録・tests・docsを同時に壊すため推奨しない。

## AIが読む範囲の改善見込み

数値は目標の概算でありtoken測定値ではない。複雑な横断変更では元の契約調査が引き続き必要。

| 変更 | Before | After（境界安定後） | 残す外部依存・注意 |
| --- | --- | --- | --- |
| Sampler | app巨大file + option-picker + ui-kit + tests | controller + helper + 対象test、約3–4 file | runtime catalog / form同期port。file数以上にapp全域探索を除ける |
| LoRA library | app + index + style + profiles/outfit/editor/tags/preset等、8 file以上 | features/lora内の該当2–4 file + 契約/test | Prompt coordinator、runtime、Civitai。跨ぐ変更は狭くならない |
| Gallery表示 | app + index + style + gallery-filter + image-delivery + tests | galleryのview/CSS/filter + history/image-state port、約4–6 file | paging/merge ownerはhistory。renderに永続化を混ぜない |
| Discord設定 | app全域 + ui-kit + src/discord + tests | settings controller/view + HTTP契約/test、約3–4 file | backend secret・送信状態の意味は維持 |
| Runtime | app + helpers + provider/services/API tests | runtime coordinator + ports + provider契約 | 高risk横断領域なので読む総量削減を過大評価しない |

抽出だけではindex/styleを読む必要は残る。JS責務安定後のfeature CSS/view co-locationで初めてUI変更の探索範囲も減る。sharedを万能utility集積場にせず、cross-feature importと暗黙read/writeが増えていないことを各Phaseでreviewする。
