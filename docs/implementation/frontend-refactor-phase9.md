# Frontend Refactor Phase 9 — Image Favorite / notification state

2026-09-06完了。ユーザーの最新指示により、このPhase完了後に一時停止。Phase10/11未着手。

`public/features/image-state.js`へFavorite Map、Favorite通知/生成通知それぞれのMapとwatcher Set、ID単位のボタン/badge同期、toggle、watch/retry、最終Favorite listenerを抽出。Mapsを公開せず、History取込み、resolveImageFavorite、bindPresentationなどのportで接続。preferences更新とHistory→Studio再読込はapp callback、選択/描画/pagingはappに保持。

維持: 同じ画像objectの更新、Favorite解除はPATCHのみ、not_sent/sending/sent/failedと通知2系統の独立、watch重複抑制、50回×1200ms、取得失敗時state保持、failed UIの手動再送。最終結果bindPresentationはseed/renderのみ。reviewで見つけた余分なwatch開始2箇所を除去し、ここからsleep/GETが発生しないtestを追加。監視開始は従来のHistory取込み/state適用側。

検証: 抽出前6/6、関連focused78/78、上記修正後image-state7/7、check成功。修正後の必須full testは **599 passed / 0 failed / 2 opt-in saved-baseline parity skips（全601）**。修正前のgreen結果は最終gateに使用しない。browserはコスト指示により省略。

変更: app/package、新moduleとimage-state test、ui-shellのowner追従。backend/History schema/Discord送信contract/HTML/CSS変更なし。Remaining coupling: appのHistoryとStudio再描画callback、getFinalImage、Studioの選択state。再開時はPhase10 Studio displayの範囲を確認し、今回のimage-state portを再利用する。
