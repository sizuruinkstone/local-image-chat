import express from "express";
import path from "node:path";

// Entry selection only; APIs, output delivery and the explicit rollback UI keep
// their existing contracts. Modules are revalidated rather than cached forever.
export function installFrontendEntry(app, publicDirectory) {
  app.get(["/", "/index.html", "/studio-next", "/studio-next/"], (request, response) => {
    response.set("Cache-Control", "no-cache");
    response.sendFile(path.join(publicDirectory, request.query.legacy === "1" ? "index.html" : "frontend/index.html"));
  });
  app.use(express.static(publicDirectory, {
    setHeaders(response, filename) {
      if (/\.(?:html|js|css|webmanifest)$/.test(filename)) response.setHeader("Cache-Control", "no-cache");
    }
  }));
}
