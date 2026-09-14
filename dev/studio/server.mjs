import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(directory, "../../public");
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const devFiles = new Set(["boot.js", "fixture-transport.js", "study.svg"]);
export function createStudioDevServer({ backendUrl } = {}) {
  const backend = backendUrl ? new URL(backendUrl) : null;
  if (backend && (backend.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(backend.hostname))) throw new Error("Studio backend must be a local HTTP origin");
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const readable = /^\/api\/v1\/scenes(?:\/[^/]+(?:\/[^/]+)?)?$/.test(pathname) || /^\/api\/v1\/section-profiles$/.test(pathname) || /^\/api\/(config|runtimes|checkpoints|loras|samplers|history)(\/[^/]+\/recipe)?$/.test(pathname)
      || ["/api/reforge/ip-adapter/options", "/api/checkpoint-lora-sets", "/api/experiments", "/api/civitai/install-folders", "/api/civitai/auth-status", "/api/comparisons"].includes(pathname)
      || /^\/api\/experiments\/[^/]+\/history$/.test(pathname)
      || /^\/api\/jobs(\/[^/]+)?$/.test(pathname) || pathname.startsWith("/outputs/") || /^\/api\/images\/[^/]+\/(original|thumbnail)$/.test(pathname);
    const writable = ["POST","PATCH","DELETE"].includes(request.method) && /^\/api\/v1\/(?:scenes(?:\/[^/]+(?:\/copy)?)?|section-profiles(?:\/[^/]+)?)$/.test(pathname) || request.method === "POST" && ["/api/jobs", "/api/checkpoints/select", "/api/loras/registry/ensure", "/api/checkpoint-lora-sets", "/api/experiments", "/api/comparisons", "/api/civitai/inspect", "/api/civitai/install"].includes(pathname)
      || request.method === "POST" && /^\/api\/experiments\/[^/]+\/cancel$/.test(pathname)
      || request.method === "PATCH" && /^\/api\/loras\/[^/]+$/.test(pathname)
      || request.method === "PATCH" && /^\/api\/history\/[^/]+\/content-rating$/.test(pathname)
      || request.method === "DELETE" && /^\/api\/jobs\/[^/]+$/.test(pathname);
    if (backend && ((["GET", "HEAD"].includes(request.method) && readable) || writable)) {
      if (writable && request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { response.writeHead(403).end(); return; }
      const target = new URL(backend);
      target.pathname = pathname; target.search = new URL(request.url, "http://localhost").search;
      const upstream = http.request(target, { method: request.method, headers: { ...(request.headers["content-type"] ? { "content-type": request.headers["content-type"] } : {}), ...(request.headers["content-length"] ? { "content-length": request.headers["content-length"] } : {}) } }, (incoming) => {
        response.writeHead(incoming.statusCode, { "content-type": incoming.headers["content-type"] || "application/octet-stream", "cache-control": "no-store" });
        incoming.pipe(response);
      });
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "Local Image Chat backendに接続できません" })); });
      response.on("close", () => upstream.destroy());
      request.pipe(upstream); return;
    }
    let file;
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
    if (pathname === "/studio-next" || pathname === "/studio-next/") file = path.join(directory, "index.html");
    else if (pathname.startsWith("/__studio-dev__/")) {
      const name = pathname.slice("/__studio-dev__/".length);
      if (devFiles.has(name)) file = path.join(directory, name);
    } else if (!pathname.startsWith("/api/")) {
      let relative;
      try { relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).slice(1); }
      catch { response.writeHead(400).end("Invalid path"); return; }
      const candidate = path.resolve(publicDirectory, relative);
      if (candidate.startsWith(publicDirectory + path.sep)) file = candidate;
    }
    if (!file) { response.writeHead(404).end("Not available in the studio preview"); return; }
    try {
      const data = await readFile(file);
      response.writeHead(200, { "content-type": contentTypes[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : data);
    } catch { response.writeHead(404).end("Not found"); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createStudioDevServer({ backendUrl: process.env.LIC_STUDIO_BACKEND_URL || "http://127.0.0.1:3030" });
  server.listen(41972, "127.0.0.1", () => console.log("LIC Studio R3: http://127.0.0.1:41972/studio-next/"));
}
