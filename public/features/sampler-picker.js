import {
  SAMPLER_PRESETS, buildOptionSections, describeSamplerPreset, isActivePreset,
  isFavoriteOption, rememberRecentOption, toggleFavoriteOption
} from "../option-picker.js";

const STORAGE_KEYS = {
  sampler: { favorites: "localImageChat.samplerFavorites", recent: "localImageChat.samplerRecent" },
  scheduler: { favorites: "localImageChat.schedulerFavorites", recent: "localImageChat.schedulerRecent" }
};

export function createSamplerPicker({ elements, document, storage, getJson, openModal,
  runtimeApiUrl, runtimeRequestContext, isRuntimeContextCurrent }) {
  let options = { samplers: [], schedulers: [] };
  let initialized = false;
  const readList = (key) => {
    try {
      const value = JSON.parse(storage.getItem(key) ?? "null") ?? [];
      return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : [];
    } catch { return []; }
  };
  const writeList = (key, value) => storage.setItem(key, JSON.stringify(value));

  function renderPresets() {
    elements.samplerPresets.replaceChildren();
    for (const preset of SAMPLER_PRESETS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "samplerPreset";
      button.textContent = describeSamplerPreset(preset);
      button.classList.toggle("active", isActivePreset(preset, elements.samplerName.value, elements.scheduler.value));
      button.addEventListener("click", () => {
        applyValue("sampler", preset.sampler);
        applyValue("scheduler", preset.scheduler);
      });
      elements.samplerPresets.append(button);
    }
  }

  function syncLabels() {
    elements.samplerPickerValue.textContent = elements.samplerName.value || "未設定";
    elements.schedulerPickerValue.textContent = elements.scheduler.value || "未設定";
    renderPresets();
  }

  function applyValue(kind, value) {
    const input = kind === "sampler" ? elements.samplerName : elements.scheduler;
    input.value = value;
    const key = STORAGE_KEYS[kind].recent;
    writeList(key, rememberRecentOption(readList(key), value));
    syncLabels();
  }

  async function loadOptions(context = runtimeRequestContext()) {
    try {
      const data = await getJson(runtimeApiUrl("/api/samplers"));
      if (!isRuntimeContextCurrent(context)) return false;
      options = {
        samplers: Array.isArray(data.samplers) ? data.samplers : [],
        schedulers: Array.isArray(data.schedulers) ? data.schedulers : []
      };
    } catch {
      if (!isRuntimeContextCurrent(context)) return false;
      options = { samplers: [], schedulers: [] };
    }
    renderPresets();
    syncLabels();
    return true;
  }

  async function openPicker(kind) {
    const label = kind === "sampler" ? "Sampler" : "Scheduler";
    const all = kind === "sampler" ? options.samplers : options.schedulers;
    const input = kind === "sampler" ? elements.samplerName : elements.scheduler;
    let favorites = readList(STORAGE_KEYS[kind].favorites);
    let query = "";
    await openModal({
      title: `${label}を選ぶ`, subtitle: "★でお気に入り。検索でも絞り込めます",
      size: "small", dismissValue: null,
      build: (body, close) => {
        const search = document.createElement("input");
        search.type = "search";
        search.className = "optionPickerSearch";
        search.placeholder = `${label}を検索`;
        search.setAttribute("data-autofocus", "true");
        const list = document.createElement("div");
        list.className = "optionPickerList";
        const createRow = (option) => {
          const row = document.createElement("div");
          row.className = "optionPickerRow";
          row.classList.toggle("current", option === input.value);
          const choose = document.createElement("button");
          choose.type = "button";
          choose.className = "optionPickerChoice";
          choose.textContent = option;
          choose.addEventListener("click", () => { applyValue(kind, option); close(option); });
          const star = document.createElement("button");
          star.type = "button";
          star.className = "optionPickerStar";
          star.textContent = isFavoriteOption(favorites, option) ? "★" : "☆";
          star.title = "お気に入り";
          star.addEventListener("click", () => {
            favorites = toggleFavoriteOption(favorites, option);
            writeList(STORAGE_KEYS[kind].favorites, favorites);
            render();
          });
          row.append(choose, star);
          return row;
        };
        const render = () => {
          list.replaceChildren();
          const sections = buildOptionSections({ all, favorites,
            recent: readList(STORAGE_KEYS[kind].recent), query, current: input.value });
          if (!sections.length) {
            const empty = document.createElement("p");
            empty.className = "hint";
            empty.textContent = "候補が見つかりません";
            list.append(empty);
            return;
          }
          for (const section of sections) {
            const heading = document.createElement("p");
            heading.className = "optionPickerHeading";
            heading.textContent = section.label;
            list.append(heading);
            for (const option of section.items) list.append(createRow(option));
          }
        };
        search.addEventListener("input", () => { query = search.value; render(); });
        render();
        body.append(search, list);
      },
      actions: [{ label: "閉じる", value: null, variant: "secondary" }]
    }).promise;
  }

  const onSamplerClick = () => void openPicker("sampler");
  const onSchedulerClick = () => void openPicker("scheduler");
  return {
    loadOptions, syncLabels, applyValue, openPicker,
    getOptions: () => ({ samplers: [...options.samplers], schedulers: [...options.schedulers] }),
    setOptions(next) {
      options = { samplers: [...(next?.samplers ?? [])], schedulers: [...(next?.schedulers ?? [])] };
    },
    init() {
      if (initialized) return;
      elements.samplerPickerButton.addEventListener("click", onSamplerClick);
      elements.schedulerPickerButton.addEventListener("click", onSchedulerClick);
      initialized = true;
    },
    dispose() {
      if (!initialized) return;
      elements.samplerPickerButton.removeEventListener("click", onSamplerClick);
      elements.schedulerPickerButton.removeEventListener("click", onSchedulerClick);
      initialized = false;
    }
  };
}
