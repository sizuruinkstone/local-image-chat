# Frontend Refactor Phase 7 — AI share / template

2026-09-06完了。`public/features/ai-share.js`へ13関数、6 listener、1500ms debounce timerを抽出。11 DOM subset、HTTP/UI/clipboard/timer、最新manual Trigger Words getterを注入。手入力の正本はappのLoRA map、template値はDOMのまま。

保持: quiet failureはwarnのみ/retryなし、CSV相違時のみtemplate PATCHとbest-effort failure、clipboard→flash→save、reset cancelで無変更。disposeは自身のlistenerとpending debounceだけ解除、navigationから呼ばない。

検証: 抽出前6 scenario成功、新controller+関連focused67/67、check成功、full584 passed/0 failed/2 opt-in snapshot parity skips。実ブラウザfixtureでCSV更新とclipboardコピー成功を確認。HTTP/保存形式/HTML/CSS/backend変更なし。

変更: app/package、新moduleとai-share-controller test、ui-shellのowner追従。残るcouplingはLoRA読取callbackと2箇所のschedule呼出。次はPhase8 Queue、追加ユーザー指示によりfocused+check gate、fullはPhase9/10に実施。
