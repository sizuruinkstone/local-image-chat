# Frontend Refactor Phase 8 — Queue monitor

2026-09-06完了。`features/queue-controller.js`がsnapshot、polling loop、panel、terminal Set、取消handler、indicator listenerを所有。appは2 DOM要素、HTTP/UI、History/experiments更新・結果表示・gallery判定・sleep callbackを注入。比較結果workflowはappに残し、先頭でclosePanel portを呼ぶ。

init/disposeはindicator listenerだけ。監視はapp lifetime。1200ms/8 idle、初回terminal抑制、terminal keyごとの通知、failed GETでsnapshot保持とidle進行、panel表示中の継続、cancel後のcallback順序を保持。

旧VM characterization7グループ成功。新controller+queue-view/navigation/job-manager/ui-shell focused73/73、check成功、差分whitespace成功。追加指示によりfull/browser/重複parityは未実施。Backend/JobManager/HTML/CSS変更なし。

Remaining risk: panel中は監視を継続、GET failureもidle tickとして進む既存仕様。次はPhase9 image state、full test必須。
