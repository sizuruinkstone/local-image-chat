# Frontend Full Rebuild — Desktop / Mobile Wireframes

2026-09-07。R0の設計proposal。実装済み画面ではない。[計画・contract・Phase](frontend-full-rebuild-plan.md)と一緒に読む。

## Desktop: 1440 × 900

左側に常設の設定columnを置かない。Canvasを上部の大きな作業面にし、Promptを下部の横長編集dockへ置く。Advanced Inspectorは必要時に右から開く。LibraryはCanvas領域を拡張して使う。

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ LIC   Studio   Assets   Experiments            Engine: Ready   Jobs  Prefs │ 48
├────────────────────────────────────────────────────────────────────────────┤
│ View / Reference / Mask / Compare    Fit 100%       Info    Latest result  │ 40
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│                                                                            │
│                           MAIN CANVAS                                      │
│                     empty / last / progress / result                       │ 500
│                                                                            │
│                    candidate 1  2  3    final                              │
│                                         Favorite  Reuse ▾  Save            │
├────────────────────────────────────────────────────────────────────────────┤
│ Recent  [thumb] [thumb] [thumb] [thumb] [thumb]               Open Library  │ 72
├────────────────────────────────────────────────────────────────────────────┤
│ Prompt   [Sections] [Raw]   Presets   Session edits             Expand ↗  │
│ [Character] [Appearance] [Pose] [Background] [Negative]                      │
│ Describe the next image…                                                   │
│ LoRA:  Portrait 0.7 on  ·  Lighting 0.4 on                       + Browse   │ 192
│ Model ▾    1024 × 1024 ▾    Seed: Random ▾   Inspector     Generate ▾      │
├────────────────────────────────────────────────────────────────────────────┤
│ Draft status / explicit operation error                                     │ 24
└────────────────────────────────────────────────────────────────────────────┘
```

縦寸法は48＋40＋500＋72＋192＋24＋余白24＝900pxを基準とする。Canvasは残余高を取るflexible region。192pxのPrompt dockが不足する長文はExpandで編集し、ページ全体に縦長formを増やさない。1440px時のCanvas面は全幅、Inspectorを開いた場合は320px＋dividerを割り当て、Canvasの残り幅を確保する。狭いDesktopではInspectorをoverlayへ切り替える。

### Inspector open / Prompt expanded

```text
┌──────────────────────────── Canvas ───────────────────────┬──────────────┐
│                                                           │ Inspector  × │
│                       image                               │ Generation   │
│                                                           │ Sampling     │
│                                                           │ Sampler      │
│                                                           │ Scheduler    │
│                                                           │ Steps / CFG  │
│                                                           │ Clip / more  │
├───────────────────────────────────────────────────────────┴──────────────┤
│ Timeline                                                                  │
├───────────────────────────────────────────────────────────────────────────┤
│ Expanded Prompt: section editor          │ Final prompt preview (read only)│
│ Character / Appearance / Pose / …        │ Tags / characters               │
│ editable content                         │ Raw priority indication         │
│ Negative editor                          │ Presets / session edit undo      │
│ Active LoRA composition                                                   │
│ Model / Resolution / Seed                                      Generate   │
└───────────────────────────────────────────────────────────────────────────┘
```

Expanded Promptは作業面の高さを増やすがCanvasを完全に隠さず、縮小previewを残す。Generation InspectorとImage metadataは明確にタブ名を分け、過去画像の値を現在の生成設定だと誤認させない。

### Library mode: Studio内の閲覧

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ Studio / Library   Search loaded images…  Favorite  Sort    Back to Canvas │
├──────────────────────────────────────────────┬────────────────────────────┤
│ [image] [image] [image] [image]               │ selected image preview     │
│ [image] [image] [image] [image]               │ metadata / prompt          │
│ [image] [image] [image] [image]               │ View  Reuse ▾  Compare     │
│ Load more / loading / error                  │                            │
├──────────────────────────────────────────────┴────────────────────────────┤
│ Current draft (collapsed summary)                            Edit  Generate│
└───────────────────────────────────────────────────────────────────────────┘
```

Libraryを開いてもdraftとJobは維持。thumbnail選択は閲覧だけ。「Reuse prompt/settings」は既存Recipeの適用範囲を説明して実行。「Variation」はsame seed、instruction、LoRA派生等の既存actionを選ぶ。原寸は明示選択したimageだけ取得。検索/sortは読み込み済み範囲であることをtoolbarで伝える。

### Assets / LoRA browser

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ Assets   Models / LoRA                 Search…  Favorites   Import   Done │
├──────────────┬────────────────────────────────────┬───────────────────────┤
│ Folders      │ breadcrumb                         │ Selected LoRA         │
│ All          │ [thumbnail] [thumbnail] [thumbnail]│ preview / metadata    │
│ Portraits    │ name / favorite / selected         │ trigger / profile     │
│ Lighting     │ [thumbnail] [thumbnail] [thumbnail]│ Add to composition    │
├──────────────┴────────────────────────────────────┴───────────────────────┤
│ Active:  Portrait [0.70] On ↑ ↓ Remove  | Lighting [0.40] On ↑ ↓ Remove    │
└───────────────────────────────────────────────────────────────────────────┘
```

Addはcoordinatorの既存selection commandへ接続。trigger適用は別操作として表示。reorderは計画に定めたcontract検証後に有効化。Library管理で変更したweightと生成中weightの既存非対称性を勝手に統一しない。

## Mobile: 390 × 844 / 430 × 932

MobileはCanvasをhomeとし、Prompt editor、Library、Inspectorは一つずつsheet/fullscreenで開く。Desktopの全領域を縦積みしない。390と430は同じ情報構造を使い、430の追加領域はCanvasに割り当てる。

```text
┌───────────────────────────────┐
│ LIC Studio        Engine  ⋯   │ 48
├───────────────────────────────┤
│ View ▾             Info       │ 40
│                               │
│                               │
│           CANVAS              │ flexible
│                               │
│                               │
│        Favorite   Reuse ▾     │
├───────────────────────────────┤
│ [thumb] [thumb] [thumb] Library│ 64
├───────────────────────────────┤
│ Prompt summary…       Edit ↗  │ 64
│ LoRA  Portrait .7 · Light .4 + │ 48
│ Model ▾   Size ▾   Seed ▾     │ 48
│          GENERATE ▾           │ 52
└───────────────────────────────┘
                 + safe-area
```

390×844ではchrome/safe-areaを除く残余Canvasを約360px以上の目安にする。高さが低い環境はRecentを畳む。tap targetは44px以上、入力16px以上。横スクロールは明示したthumbnail/LoRA帯だけに限定し、page全体は横overflowさせない。

```text
Prompt fullscreen              Inspector sheet           Library fullscreen
┌────────────────────┐         ┌──────────────────┐      ┌────────────────────┐
│ Done  Prompt       │         │ Canvas glimpse   │      │ Back  Library      │
│ Sections / Raw     │         ├──────────────────┤      │ Search / Filters   │
│ Section ▾          │         │ Settings       × │      │ [thumb] [thumb]    │
│                    │         │ Model / Size     │      │ [thumb] [thumb]    │
│ editor / IME       │         │ Sampling ▾       │      │ Load more          │
│                    │         │ References ▾     │      │                    │
│ Negative ▾         │         │ scroll content   │      │ select → image     │
│ Presets / undo     │         │ Done             │      │ metadata / Reuse   │
└────────────────────┘         └──────────────────┘      └────────────────────┘
```

Prompt fullscreenは同じdraftを編集。keyboard表示時は`dvh`とsafe-areaを使い、Doneと編集中行へ到達できるようにする。sheetを重ねず、次のsheetへ置換して戻り先を保持する。GenerateはCanvas下部に戻って実行する基本導線とし、keyboard下へ固定buttonを埋め込まない。進行中ならheader/Canvasに状態を保持する。

## Common states / acceptance scenarios

| State | Canvas / controlsの挙動 |
| --- | --- |
| Empty | Canvasを消さず「Promptを書く」「過去画像を開く」。成功画像の偽placeholderを置かない |
| Last generation | 最後の結果と現在draftを区別。明示Reuseでのみ設定を上書き |
| Loading | Canvasを維持しphase/progress/cancelを表示。実progressがない場合は不定表示 |
| Candidate / result | 候補選択、final/Hires、Favorite、Reuse、Saveへ接続 |
| Failure | 直前結果とdraftを保持、error詳細と既存recovery commandを表示 |
| Inspecting history | 最新結果へ戻る操作。新Job完了で閲覧中画像を奪わない |
| Runtime changing | selected/active/pendingを区別。ownerの可否に合わせて操作を制御 |

設計受入シナリオ: (1) 起動直後からCanvasが最大の視覚領域、(2) primary controlsだけで生成、(3) 画像を見ながらPrompt変更、(4) Libraryの画像からReuseして同じworkspaceへ戻る、(5) active LoRAを見失わず編集、(6) samplingは必要時だけ開く、(7) 390/430でPrompt/Inspector/Libraryが目的別画面となる、(8) 旧CSS/DOMに依存せず成立する。

このASCII案で構造上の差異は確認できる。色・余白の実見、触り心地、overflow、contrast、browser動作の合格はR2以降のprototype/実装で確認する。
