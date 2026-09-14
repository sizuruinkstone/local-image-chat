# Frontend Refactor Phase 13 — Experiment Workflow

2026-09-07完了。Phase 14以降は未着手。commit/pushなし。

## Changed

`public/features/experiment-controller.js`を追加し、`app.js`からExperiment frontend workflow、active state、単一monitor、entry cache、form snapshotからのbaseRequest構築、fixed seed、run/card/detail/progress/recovery表示、cancel/rename/delete/result entryを抽出した。`package.json`のsyntax checkへ新moduleを追加し、frontend controller testを追加した。

## Ownership

controllerはexperiments/parameters/limits、active experiment ID、Experiment固有polling guard、Experiment history entry cache、run request、表示stateを所有する。backendのpersistent run state、同時active 1本、JobManager subscribe、missing-job正規化、DELETE内のstop-before-history-deleteは変更していない。

`queue-controller`は全jobのqueue監視owner、`history-controller`はGallery/History cache owner、`comparison-controller`はCompare selection ownerのまま。ExperimentはQueue polling開始callback、History snapshot/reload、Compare `openEntries`だけを利用し、queue monitor、History cache、selection Mapを複製しない。

## Interface

主なinterfaceは`init` / `dispose`、`load`、`run` / `poll` / `cancel`、`openGallery` / `openResult`、`renderCards` / `renderProgress`、`syncTargetVisibility`、`ensureEntries` / `compare` / `openDetail`、`rename` / `remove`とread-only state getter。

appからruntime/title/prompt/LoRA/reference/IP-Adapter/settingsの狭いread callbackを受け、controllerがbaseRequestを構築する。run開始順はExperiment POST、queue polling開始、Experiment固有poll。terminal時はHistory、Experimentsの順に再取得する。

## Gate result

- focused Experiment suite: **68 passed / 0 failed**
- `npm.cmd run check`: **exit 0**
- Phase単独のfull suite / Browser Smoke: Lean Run指定により未実施

## Remaining risk

Experiment pollは既存どおり1秒間隔のfrontend status取得であり、queue-controllerのpollとは目的が異なる。filter/request raceなどPhase 11の既知事項は変更していない。最終gateでGallery→Compare→Experiment→Gallery/Studioの接続とlistener/poll lifetimeを一度だけ確認すること。

最終architecture reviewのfollow-upでpollへlifecycle generationを追加した。`dispose`は進行中monitorを無効化し、await中の応答後もUI・callbackを更新しない。再`init`後の`load`はrunning experimentを新しいgenerationで監視できる。
