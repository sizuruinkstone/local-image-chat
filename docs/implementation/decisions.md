# Frontend refactor — 継続する設計判断

基準: [Discovery](frontend-refactor-discovery.md)。進捗・検証結果は [current-state](current-state.md) と各Phase記録を参照する。ここは現在採用する判断だけを置き、将来案の実装許可とはしない。

| 判断 | 理由・維持する境界 |
| --- | --- |
| Vanilla frontendをnative ESMで段階的に抽出する | 既存資産とbehaviorを維持し、1 Phaseを1責務または強く関連する少数責務に限定する。frontend frameworkへの置換・repository rewriteは採用しない |
| UI redesign/API変更とmodule抽出を分ける | regression原因を限定する。HTML/CSS・表示仕様・永続化仕様を分割の都合で変更しない |
| backend contractを維持する | API v1 request/response、MCP contract、runtime ID（`reforge`, `forge-neo-anima`）、checkpoint public ID、History schema/storage形式、JobManager/recovery、Forge Neo activation semanticsを保持。legacy frontend APIも抽出だけを理由に変更しない |
| HTTP helperは既存semanticsのまま | GET/POST/PATCH/DELETEのnamed exports、JSON parse順序、legacy error fallback、network rejectionを保持。汎用automatic retry・timeoutを追加しない。generation固有recoveryは既存ownerに残す |
| featureの依存は小さな明示的interfaceで渡す | appをcomposition rootとして段階的に整理。navigationへDOM subsetとentry callbackを注入し、巨大なapp contextやappへの逆importを渡さない。History cache/loading等は元のownerに残す |
| navigationの寿命とgenerationの寿命を分ける | navigationのinit/disposeは自身のlistenerだけを管理する。画面遷移・disposeでformを再生成したり、job/monitorを停止したりしない。hash/localStorageの既存復元規則を保持する |
| repository内に引き継ぎを残す | AGENTSは作業ルール、current-stateは現在snapshot、各Phase文書は検証根拠。過去の会話を再読しなくても次の依頼範囲から再開できるようにする |
| generation LoRA selectionとactive Prompt tag同期はcoordinatorが単独所有 | Raw override中はRaw、その他はStructuredをform portから読む。UI追加はtagを挿入せず、weight操作は既存tagのみ更新。selection/source/disabledとcatalogを分離し、recipe/Checkpoint Setはsnapshot portへ接続。trigger/profile/outfit保存mapとフォームpriorityはapp adapterに残す。既存の非対称性と更新順はPhase 17記録を参照 |
| Runtime切替成功とRecipe後続restoreは別transaction境界 | Runtime controllerは成功時に切替snapshotを破棄し、instruction dialog cancel後も成功した切替を維持する。Recipeのcritical rollbackはRuntime readiness成功後の非Runtime owner snapshotを基準にする。旧Runtime用のform/LoRAを新Runtimeへ戻さない。checkpoint/source/maskの現行Recipe非適用と保存例外のprefix保持はPhase 21 gate記録を参照 |
| Generationの実行予約とone-shot consumeは別境界 | controllerがawait前から結果接続までの予約/active Jobを所有する。derivationは従来どおりIP読取後・settings前にread-and-clearし、後続失敗では復元しない。承認付きrecoveryは確定requestを1回だけ再送する。composition lockはフォーム側、全Job queueとExperiment lifecycleは各既存owner。詳細はPhase 22記録 |
| Full Rebuildの新Generate entryはDOM非依存contractを使用する | R1でRuntime/request/settings/Recentを新旧共通coreへ抽出。新entryのcanonical JS draftは既存Prompt-LoRA coordinatorを利用し、旧DOMとの同期を行わない。旧UIは旧form adapterで継続。新旧entryの同時bootstrapはしない。新workspaceはtxt2img＋限定metadata reuseで、高度機能の完全接続とは分ける。詳細は[R1](frontend-full-rebuild-r1.md) |
| R4 LoRA Browserはcanonical compositionと既存registryを使用 | UI側はfolder/query/detail選択だけを持ち、Active LoRAはR1/coordinator Map、Favoriteは既存backend registryに置く。新規favorite storageや旧DOM同期を作らない。Add時のtriggerは明示挿入のみ。上下移動はcanonical順序を変更し、新draftだけPrompt reconciliation時に順序を維持する。legacy既定動作は保持。[R4](frontend-full-rebuild-r4.md) |

これらと異なる変更が明示依頼された場合は、その対象・contract影響を確認し、実際に採用した判断だけ更新する。既存機能・データを古いという理由だけで削除しない。
# Structured Prompt primary workflow (2026-09-07)

新Studioでは既存Structured Promptの6sectionをPrimary Workflowとする。通常Dockはsection summary、展開先の専用Prompt Workspaceで独立編集し、Raw・Negative・Final Prompt previewを同じ制作フローへ置く。単一Positive textareaを最終UXにしない。Final previewはR1 canonical promptを読み、UIで別の結合規則を持たない。Structured / Raw切替は双方の編集を保持する。Production切替の許可とは別の要件として継続する。
