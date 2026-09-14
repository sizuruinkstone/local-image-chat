const runtimes = [{ id: "forge-neo-anima", label: "Anima · preview", available: true, provider: "forge-neo", features: { txt2img: true } }];
export function createPreviewTransport() {
  return {
    async getJson(url) {
      const path = new URL(url, "http://preview.local").pathname;
      if (path === "/api/config") return { runtimes, defaultRuntimeId: "forge-neo-anima", defaults: { width: 1440, height: 1024, seed: -1, steps: 28, cfgScale: 5, samplerName: "Euler", scheduler: "Automatic" } };
      if (path === "/api/runtimes") return { runtimes, defaultRuntimeId: "forge-neo-anima" };
      if (path === "/api/checkpoints") return { checkpoints: [{ title: "anima-studio.safetensors", modelName: "Anima Studio" }], activeCheckpoint: "anima-studio.safetensors" };
      if (path === "/api/loras") return { loras: [{ name: "Soft light" }] };
      if (path === "/api/samplers") return { samplers: ["Euler"], schedulers: ["Automatic"] };
      if (path === "/api/history") return { generations: [], hasMore: false };
      throw new Error(`R2 preview has no fixture for ${path}`);
    },
    async postJson() { throw new Error("R2 preview never submits backend operations"); },
    async fetch() { throw new Error("R2 preview never submits backend operations"); }
  };
}
