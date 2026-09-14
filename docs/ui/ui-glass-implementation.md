# UI Renovation — approved Glass implementation

2026-09-07。ユーザー「作っていい」「サブエージェント使わずAstraだけ」のGO。Astra単独。

対象: 承認済みB/Pearl GlassのProduction表示、主要設定の選択、LoRA小型一覧、Gallery拡大metadata。付随する既知Gallery/Recent raceとSet summaryを先に修正。public/index.html/style.css/app.js、history-controller、必要なview CSS、affected tests。既存owner/IDを維持する。未確定の場面保存、新schema/API、provider、送信、commit/pushは対象外。

既存dirty: CURRENT_TASK/REVIEW_FIXES/current-state、未追跡docs/ui/refactor等を保持。開始時Productionはtracked mock baselineと一致。

検証: raceのbehavior testを先行。History/Studio/Prompt-LoRA/Navigation/Queueのaffected tests、Chrome fixture表示1366/1920/390/430、最終check/full suite。実Safari/実生成は別証拠であり推定しない。

## 実装内容と保護した契約

- public/index.html / style.css: B/Pearl Glass。既存DOM IDを保持してRuntime/Checkpointを開閉へ移動。Sampler/Schedulerは既存Option Pickerを再利用。390px Gallery overflow解消、モバイル下部nav、入力focus時Generateを隠し16px入力を採用。
- public/app.js: Set適用後summary/stats同期、Schedulerをsummaryへ追加、同一セッションのLoRA picker folder保持、既存change handlerを呼ぶweight±、生成画像設定読込成功後GenerateとRaw/Structuredの適切なeditorへfocus。
- history-controller: 最新Gallery要求だけをcommitし、旧append失敗を無視。Studio recentも独立revision。Gallery画像クリックは既存detailの画像＋metadataへ。前後画像は読込済み順を使用、originalは開いた画像だけ。キーボード左右/Escape/Tab循環/閉じる時focus復帰。loadMore sentinelの自動追加、失敗時手動再試行を保持。
- studio-controller: 情報ボタンから既存metadata面を開閉。queue/jobのlifetimeは変更なし。
- tests: Gallery/Recent raceを3件でred→green。Gallery detailとPWA配色の旧source assertionを新しい仕様へ更新。

API、storage、History schema/cursor、Runtime適用、Recipe rollback、Generation予約/one-shot、画像配信/PWAキャッシュ方針、packageは変更なし。インタビュー中の新しい場面保存・キャラ保持の契約は今回未実装。Compare/Experiments/Settings/Inpaint/IPの入口を保持し、共通paletteを適用した。各専門画面の全操作刷新を完了したとはしない。

## ブラウザー証拠

隔離serverは現在のpublicを無変換で配信しAPIをfixtureで代替。private画像/実providerは使わない。workbench/ui-renovation/productionへserver・logs・screenshotsを隔離。

Chrome: 1366×768、1920×1080、2560×1440、1093×614相当（1366の125%に近いCSS幅。実ブラウザーzoom操作とは区別）、390×844、430×932。最終DOM測定はviewportとscrollWidth一致（狭いPCはブラウザー丸めで1094）。Generateボタン全体とmobile navが画面内。

実操作: Runtime由来Scheduler候補→Normal選択、解像度1024×1024の幅高さ反映、LoRA追加→folder再開、Gallery画像→次画像とSeed切替、同じSeed読込→Generate/Raw field focus、生成→Galleryへ移動→COMPLETE/履歴追加。390/430 detailは画像上/metadata下で画面内。

未確認: 実iPhone Safari/キーボード、実provider生成、実install/storage/update/Discord。既存Galleryのquery・checkpoint・LoRA・oldest sortは取得済みページに適用する制約を維持。通常/NSFW/Favoriteのサーバー絞り込みとは区別する。APIを変更せず全履歴sortが完成したとは主張しない。

## 最終検証（2026-09-07）

- `npm.cmd run check`: exit 0。
- `npm.cmd test`: exit 0、784 tests / 782 pass / 0 fail / 2 skipped。logs: workbench/ui-renovation/production/check-final.log / full-final.log。
- `git diff --check`: exit 0。CRLF警告のみ、whitespace errorなし。
- 更新文書7件のローカルリンク切れ0。
- Chrome最終pass console error 0。LoRA Weight 0.75→0.80、再開breadcrumb Characters、picker thumbnail 54×54pxを実測。
- 生成→Gallery移動後にCOMPLETEと履歴24→26件（テスト生成2回）を確認。旧HistoryのRaw復元時はRawタブを開いてPromptへfocus。自動submitは追加していない。

この完了は承認済みGlass表示と対象操作のProduction接続。全ロードマップ完了や実機release承認とは区別する。実ユーザーの設定・画像を変更する動作確認は行わず、既存dirtyを保持しcommit/pushなし。
