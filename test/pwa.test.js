import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("Web App Manifestがホーム画面追加の条件を満たす", async () => {
  const manifest = JSON.parse(await fs.readFile("public/manifest.webmanifest", "utf8"));
  assert.equal(manifest.name, "Local Image Chat");
  assert.ok(manifest.short_name.length <= 12, "ホーム画面の表示名は短くする");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);

  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes("192x192"), "192pxアイコンが必要");
  // purposeは "maskable" 単独でも "any maskable" でもよい
  assert.ok(
    manifest.icons.some((icon) => String(icon.purpose ?? "").split(/\s+/).includes("maskable")),
    "maskableアイコンが必要"
  );

  for (const icon of manifest.icons) {
    const file = await fs.readFile(`public${icon.src}`);
    // PNGシグネチャを確認（実体のあるファイルか）
    assert.deepEqual([...file.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], icon.src);
    assert.ok(file.length > 200, icon.src);
  }
  const appleIcon = await fs.readFile("public/icons/apple-touch-icon.png");
  assert.deepEqual([...appleIcon.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test("index.htmlがPWAとスマホ表示のメタ情報を持つ", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /<meta name="theme-color" content="#e5edf5"/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/);
  // セーフエリア対応にはviewport-fit=coverが必要
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /width=device-width/);
});

test("Service Workerはキャッシュを持たない（古い画面を残さない）", async () => {
  const sw = await fs.readFile("public/sw.js", "utf8");
  assert.match(sw, /addEventListener\("fetch"/, "インストール可能にするためfetchハンドラが要る");
  assert.match(sw, /caches\.delete/, "有効化時に既存キャッシュを消す");
  assert.equal(/caches\.(open|match|put|add)\b/.test(sw), false, "キャッシュへ保存しない");
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
});

test("フロントエンドがlocalhost固定のURLを埋め込まない", async () => {
  const files = ["public/app.js", "public/index.html", "public/ui-kit.js", "public/compare-view.js"];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    // コメント行を除いて、http://127.0.0.1 や localhost への直リンクが無いこと
    const hits = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .filter((line) => /https?:\/\/(127\.0\.0\.1|localhost)/.test(line));
    assert.deepEqual(hits, [], `${file} に固定URLがある`);
  }
});

test("スマホ向けCSSが用意されている", async () => {
  const css = await fs.readFile("public/style.css", "utf8");
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  // iOSの自動ズーム対策（入力欄16px）
  assert.match(css, /input, select, textarea \{ font-size: 16px; \}/);
});
