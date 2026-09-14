# Frontend Refactor Phase 2 — Navigation Extraction

実施日: 2026-09-06。**Phase 2のみ完了。Phase 3以降は未実装。**

基準: [Discovery](frontend-refactor-discovery.md)、[Phase 1](frontend-refactor-phase1.md)、[DESIGN](../../DESIGN.md)。既存のPhase 1差分を保持し、これらの文書とCURRENT_TASK/REVIEW_FIXESは変更していない。

## 変更ファイル

| ファイル | Phase 2での変更 |
| --- | --- |
| `public/features/navigation.js` | navigation controllerを追加。唯一のimportは既存view-router |
| `public/app.js` | controller生成とDOM/callback注入、init、現在viewの読取を接続。旧navigation実装を削除 |
| `package.json` | checkの明示対象へ新moduleを1つ追加 |
| `test/navigation.test.js` | characterizationとcontrollerテスト18件 |
| `test/ui-shell.test.js` | body datasetのsource assertionを移動先へ追従し、appからbodyを渡すことも確認 |
| 本文書 | 実施結果と検証範囲 |

## 抽出内容とinterface

抽出前のappで確認した位置は `currentView` L452、nav click L594、hashchange L616、`showView` L1490、`loadInitialView` L1809。VIEW_ELEMENTSのID対応はcontroller生成時のDOM subsetへ置き換えた。`setResultTab`等のfeature側workflowはappに残す。

`createNavigation({body, mainNav, views, browser = window, storage = localStorage, onGalleryEnter, onCompareEnter})` は次を返す。

- `getCurrentView()`：controller所有stateを読む。
- `showView(view, {remember = true} = {})`：既存の表示切替・nav・保存・URL更新。
- `loadInitialView()`：既存の初期view決定のみ。
- `init()`：nav clickとhashchangeを登録。複数回呼んでも重複しない。
- `dispose()`：上記2 listenerだけを解除。state/DOM/formを消去せず、job cancel・monitor停止を呼ばない。再init可能。

import/controller生成時にlistener登録・通信・初期表示を行わない。appは従来のlistener登録ブロックでinitし、従来どおり設定カテゴリ初期化の直後に `showView(loadInitialView(), {remember:false})` を呼ぶ。hash listenerはinitに集約したため、同じ同期listener登録ブロック内のnav listener直後へ移動している。初期画面復元を前倒ししていない。

## appに残したcallback

- gallery: `!lastHistoryGenerations.length && !historyLoading` の場合だけ `void loadHistory()`。cacheとloadingのownerはapp。
- compare: `renderImageCompareEntry()` → `renderExperimentCards()` の順で同期呼出。
- generate/settings: navigation固有のentry処理なし。既存の設定カテゴリ管理やstudio処理はappに残す。
- queue通知のgallery判定は `navigation.getCurrentView()` を読むだけ。navigationからHistory/Compare/Queue/appをimportしない。

## 維持したbehavior

- viewはgenerate/gallery/compare/settings。label/hash/HTML/CSS/既存view-router exportは不変。
- 初期表示は有効hash優先。空/unknown hashはlocalStorage、unknown/missing保存値はgenerate。初期復元はURLと保存値を書き換えない。
- 通常showViewは `localImageChat.view` へ保存し、正規化したhashが異なる場合だけ `history.replaceState(null, "", hashForView(...))`。pushStateは使わない。同じviewへの明示呼出は従来どおり保存とentry処理を行う。
- hashchangeは有効かつ現在と異なるviewのみremember:falseで復元。同じhash/unknown/空hashへの変更を無視し、storageへ書き戻さない。
- 表示は既存DOMのhidden/active/aria-currentとbody datasetだけを更新。formやfeature stateを再作成しない。Back/Forwardはhashchange経由、独自popstate listenerは追加しない。
- init/disposeにはnavigation以外のlistener、timer、cancel API、storage resetへの依存を渡していない。

## テスト結果

| 検証 | 結果 |
| --- | --- |
| 抽出前appの関数/listenerを読み出したcharacterization | 16 passed / 0 failed |
| 新moduleへ同じassertを適用 | 16 passed / 0 failed |
| lifecycle・状態保持fixtureを追加した最終navigation suite | 18 passed / 0 failed |
| `npm.cmd run check` | 成功 |
| `npm.cmd test` | 548 passed / 0 failed / 0 skipped |
| 差分レビュー | appのPhase 1完了時snapshotと比較。navigation以外の実装変更なし |

テストでは初期fallback、4画面、active/aria/current/hidden、URL/storage更新、hashchange/Back相当/Forward相当、同じview再選択、entry呼出順・回数、cache/loading guard、init重複防止、dispose/reinit、fixtureのform/reference/result等と別listenerの保持を確認した。stubでのstate保持検証は実行中job全体のE2E保証ではない。

## Browser Smoke Test

Chromeで、実際のindex.html/style.css/app.jsと新moduleを**隔離したlocalhost fixture**から配信して確認した。fixtureはAPIに固定responseを返し、GET以外を拒否する。実serverを起動せず、Forge Neo/ReForge/Discord/Civitaiへ接続しない。fixture用scriptと抽出前app snapshotはTEMPに置き、repositoryのHTML/CSS/backendは変更していない。

- 初期generate表示、4画面のnav操作、正しい画面だけ表示・active nav、Prompt入力後の往復保持を確認。
- direct hashでgallery→compare、実ブラウザBackでgallery、Forwardでcompareへ復元。Promptは保持された。
- 1247pxの通常viewportと1366×768では4画面ともdocumentの横overflowなし。
- 390×844ではgenerate/compare/settingsに横overflowなし。galleryだけdocument scrollWidth=422px。
- このgalleryの横はみ出しは、同じfixtureで**Phase 2抽出前app.js**へ切り替えても422px、再度抽出後へ戻しても422pxだった。既存CSS/表示課題として記録し、このPhaseでは修正していない。
- desktop/mobile生成画面とmobile galleryをスクリーンショットで目視確認。全DESIGN viewport・iPhone Safariの網羅検証ではない。
- テスト後はviewport overrideを解除し、作成したtabとfixture serverを終了した。

## 残ったrisk / 次Phase

実生成・実行中job/Discord送信のE2E Smoke Testは行っていない。navigationにはそれらの停止/取消依存がなく、既存backend testsも通過している。空catalog/空Historyのfixtureなので、大量画像・長い実モデル名を含む画面は未検証。390px galleryの既存横はみ出しは別UIタスク候補。

Phase 2の完了条件を満たし、Phase 3を別タスクとして検討できる状態。新しいnavigation assetの配信を含める必要がある。Phase 3のSampler picker、History/Queue/runtimeの分割には進んでいない。
