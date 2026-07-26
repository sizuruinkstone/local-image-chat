import path from "node:path";
import { JsonStore } from "./json-store.js";

// Grokなどへ渡す指示テンプレートと環境情報の保管。
// 中身はユーザーが書いた文章そのままで、アプリ側で解釈・整形はしない。

const LIMITS = { instructions: 20000, setupDoc: 40000, loraCsv: 200000 };

export function createPromptTemplateService(dataDir) {
  const store = new JsonStore(path.join(dataDir, "prompt-template.json"), {
    schemaVersion: 1,
    template: { instructions: "", setupDoc: "", loraCsv: "", updatedAt: null, loraCsvUpdatedAt: null }
  });

  function normalize(template = {}) {
    return {
      instructions: text(template.instructions, LIMITS.instructions),
      setupDoc: text(template.setupDoc, LIMITS.setupDoc),
      loraCsv: text(template.loraCsv, LIMITS.loraCsv),
      updatedAt: typeof template.updatedAt === "string" ? template.updatedAt : null,
      loraCsvUpdatedAt: typeof template.loraCsvUpdatedAt === "string" ? template.loraCsvUpdatedAt : null
    };
  }

  return {
    async get() {
      return normalize((await store.read()).template);
    },

    // 渡された項目だけを更新する（未指定の項目は現状維持）。
    async update(patch = {}) {
      const next = await store.update((data) => {
        const template = normalize(data.template);
        const now = new Date().toISOString();
        let changed = false;
        for (const key of ["instructions", "setupDoc", "loraCsv"]) {
          if (typeof patch[key] !== "string") continue;
          const value = text(patch[key], LIMITS[key]);
          if (value === template[key]) continue;
          template[key] = value;
          changed = true;
          if (key === "loraCsv") template.loraCsvUpdatedAt = now;
        }
        if (changed) template.updatedAt = now;
        data.template = template;
        return data;
      });
      return normalize(next.template);
    }
  };
}

function text(value, limit) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}
