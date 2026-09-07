// Frontend revision: studio-production-r7 (network-only; no offline asset cache).
// ホーム画面へ追加できるようにするためだけのService Worker。
// 画像生成はローカルのサーバーが必要なので、オフライン用のキャッシュは持たない。
// 古いフロントエンドが残らないよう、fetchは常にネットワークへ素通しし、
// 既存のCacheStorageは有効化時に全部消す。

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// キャッシュを一切挟まない（この行が無いとインストール可能と判定されない）。
self.addEventListener("fetch", () => {});
