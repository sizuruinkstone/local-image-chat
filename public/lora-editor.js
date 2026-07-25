import { confirmModal, openModal, toast } from "./ui-kit.js";

// LoRAメタデータ編集モーダル。保存はサーバー（data/lora-registry.json）へ、
// 保存先の変更だけは実ファイル移動を伴うので個別に確認する。

const SUBCATEGORY_OPTIONS = [
  ["character", "キャラクター"],
  ["style", "画風"],
  ["body", "体型"],
  ["pose", "構図・ポーズ"],
  ["utility", "ユーティリティ"],
  ["other", "その他"]
];

const CHECKPOINT_FAMILY_OPTIONS = ["illustrious", "noobai", "pony", "sdxl", "sd15"];

export function openLoraEditor({
  lora,
  entry,
  folders = [],
  onSave,
  onMove
}) {
  const fields = {};
  const currentFolder = folderOf(entry?.relativeName ?? lora?.name ?? "");

  return openModal({
    title: "LoRAの情報を編集",
    subtitle: entry?.relativeName ?? lora?.name ?? "",
    size: "medium",
    dismissValue: null,
    build: (body) => {
      const grid = document.createElement("div");
      grid.className = "uiFormGrid";

      fields.displayName = addInput(grid, "表示名", "text", entry?.displayName ?? lora?.displayName ?? "", { autofocus: true });
      fields.subcategory = addSelect(grid, "分類", SUBCATEGORY_OPTIONS, entry?.subcategory ?? "other");
      fields.detailCategory = addInput(grid, "サブ分類（自由入力）", "text", entry?.detailCategory ?? "");
      fields.recommendedWeight = addInput(grid, "推奨weight", "number", entry?.recommendedWeight ?? "", { step: "0.05", min: "0.05", max: "2" });
      fields.recommendedWeightMin = addInput(grid, "推奨weight 最小", "number", entry?.recommendedWeightMin ?? "", { step: "0.05", min: "0.05", max: "2" });
      fields.recommendedWeightMax = addInput(grid, "推奨weight 最大", "number", entry?.recommendedWeightMax ?? "", { step: "0.05", min: "0.05", max: "2" });
      fields.triggerWords = addTextarea(grid, "Trigger Words", entry?.triggerWords ?? "");
      fields.negativeWords = addTextarea(grid, "Negative Words", entry?.negativeWords ?? "");
      fields.checkpointFamilies = addInput(
        grid,
        "対応Checkpointファミリー（カンマ区切り）",
        "text",
        (entry?.checkpointFamilies ?? []).join(", "),
        { fullWidth: true, placeholder: CHECKPOINT_FAMILY_OPTIONS.join(", ") }
      );
      fields.previewUrl = addInput(grid, "プレビュー画像URL", "url", entry?.previewUrl ?? "", { fullWidth: true });
      fields.note = addTextarea(grid, "メモ", entry?.note ?? "", { fullWidth: true });

      const favoriteWrap = document.createElement("label");
      favoriteWrap.className = "fullWidthField uiCheckboxField";
      fields.favorite = document.createElement("input");
      fields.favorite.type = "checkbox";
      fields.favorite.checked = entry?.favorite === true;
      const favoriteText = document.createElement("span");
      favoriteText.textContent = "お気に入りにする";
      favoriteWrap.append(fields.favorite, favoriteText);
      grid.append(favoriteWrap);

      const folderWrap = document.createElement("label");
      folderWrap.className = "fullWidthField";
      const folderLabel = document.createElement("span");
      folderLabel.textContent = "保存先（変更すると実ファイルを移動します）";
      fields.folder = document.createElement("select");
      // 現在地（ルート直下を含む）を必ず先頭へ入れ、既定で選択しておく。
      // これを省くと、ルート直下のLoRAで意図しない移動が提案されてしまう。
      const folderValues = [...new Set([currentFolder, ...folders])];
      for (const folder of folderValues) fields.folder.append(new Option(folder || "（ルート直下）", folder));
      fields.folder.value = currentFolder;
      folderWrap.append(folderLabel, fields.folder);
      grid.append(folderWrap);

      body.append(grid);

      if (Array.isArray(entry?.manualFields) && entry.manualFields.length) {
        const note = document.createElement("p");
        note.className = "uiFieldNote";
        note.textContent = `手動編集済み（Civitai再解析でも上書きしません）: ${entry.manualFields.join(", ")}`;
        body.append(note);
      }
    },
    actions: [
      { label: "閉じる", value: null, variant: "secondary" },
      {
        label: "保存",
        primary: true,
        keepOpen: true,
        onSelect: async (close) => {
          const patch = {
            displayName: fields.displayName.value,
            subcategory: fields.subcategory.value,
            detailCategory: fields.detailCategory.value,
            triggerWords: fields.triggerWords.value,
            negativeWords: fields.negativeWords.value,
            recommendedWeight: emptyToNull(fields.recommendedWeight.value),
            recommendedWeightMin: emptyToNull(fields.recommendedWeightMin.value),
            recommendedWeightMax: emptyToNull(fields.recommendedWeightMax.value),
            checkpointFamilies: fields.checkpointFamilies.value,
            note: fields.note.value,
            favorite: fields.favorite.checked,
            previewUrl: fields.previewUrl.value
          };
          try {
            await onSave(patch);
          } catch (error) {
            toast.error(`保存できませんでした: ${error.message}`);
            return false;
          }

          const nextFolder = fields.folder.value;
          if (!nextFolder && nextFolder !== currentFolder) {
            toast.warning("LoRAルート直下への移動には対応していません");
          } else if (nextFolder && nextFolder !== currentFolder) {
            const confirmed = await confirmModal(
              `LoRAの保存先を「${currentFolder || "（ルート直下）"}」から「${nextFolder}」へ移動します。`,
              {
                title: "保存先の移動",
                detail: ".safetensors と、存在する .preview.png / .png / .json も一緒に移動します。",
                confirmText: "移動する",
                danger: true
              }
            );
            if (confirmed) {
              try {
                await onMove(nextFolder);
              } catch (error) {
                toast.error(`移動できませんでした: ${error.message}`);
                return false;
              }
            }
          }
          close(true);
        }
      }
    ]
  }).promise;
}

function folderOf(relativeName) {
  const normalized = String(relativeName ?? "").replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function emptyToNull(value) {
  return String(value ?? "").trim() === "" ? null : value;
}

function addInput(grid, label, type, value, { step, min, max, fullWidth = false, placeholder = "", autofocus = false } = {}) {
  const wrap = document.createElement("label");
  if (fullWidth) wrap.className = "fullWidthField";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = type;
  input.value = value ?? "";
  if (step) input.step = step;
  if (min) input.min = min;
  if (max) input.max = max;
  if (placeholder) input.placeholder = placeholder;
  if (autofocus) input.setAttribute("data-autofocus", "true");
  wrap.append(text, input);
  grid.append(wrap);
  return input;
}

function addTextarea(grid, label, value, { fullWidth = false } = {}) {
  const wrap = document.createElement("label");
  if (fullWidth) wrap.className = "fullWidthField";
  const text = document.createElement("span");
  text.textContent = label;
  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.value = value ?? "";
  wrap.append(text, textarea);
  grid.append(wrap);
  return textarea;
}

function addSelect(grid, label, options, value) {
  const wrap = document.createElement("label");
  const text = document.createElement("span");
  text.textContent = label;
  const select = document.createElement("select");
  for (const [optionValue, optionLabel] of options) select.append(new Option(optionLabel, optionValue));
  select.value = value;
  wrap.append(text, select);
  grid.append(wrap);
  return select;
}
