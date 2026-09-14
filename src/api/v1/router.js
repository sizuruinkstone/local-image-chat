import {registerSectionProfileRoutes} from "../../section-profiles.js";
import {registerSceneRoutes} from "../../scenes.js";
import express from "express";
import { registerAssetRoutes } from "./assets.js";
import { registerCapabilityRoutes } from "./capabilities.js";
import { registerGenerationRoutes } from "./generations.js";
import { registerHistoryRoutes } from "./history.js";

export function createV1Router({ generationService, referenceAssets, sectionProfiles, scenes }) {
  const router = express.Router();
  const wrap = (handler) => (request, response, next) => {
    Promise.resolve(handler(request, response)).catch(next);
  };

  if(sectionProfiles)registerSectionProfileRoutes(router,{service:sectionProfiles,wrap});
  if(scenes)registerSceneRoutes(router,{service:scenes,wrap});
  if (referenceAssets) registerAssetRoutes(router, { referenceAssets, wrap });
  registerCapabilityRoutes(router, { service: generationService, wrap });
  registerGenerationRoutes(router, { service: generationService, wrap });
  registerHistoryRoutes(router, { service: generationService, wrap });

  router.use((_request, response) => {
    sendV1Error(response, {
      status: 404,
      code: "NOT_FOUND",
      message: "API v1のエンドポイントが見つかりません"
    });
  });
  router.use(createV1ErrorMiddleware());
  return router;
}

// express.json()より前に失敗したmalformed JSONも、/api/v1だけ同じ形式へ寄せる。
export function createV1ErrorMiddleware() {
  return (error, request, response, next) => {
    if (!isV1Request(request)) {
      next(error);
      return;
    }
    const mapped = mapV1Error(error, request);
    console.error(`[API v1] ${request.method} ${request.originalUrl} ${mapped.code}: ${error?.message ?? error}`);
    sendV1Error(response, mapped);
  };
}

function mapV1Error(error, request) {
  if (error?.type === "entity.parse.failed") {
    return { status: 400, code: "INVALID_REQUEST", message: "リクエストJSONを解析できません" };
  }
  if (error?.type === "entity.too.large"
    && assetUploadPath(request)) {
    return { status: 413, code: "ASSET_TOO_LARGE", message: "参照画像は12MiB以下にしてください" };
  }
  if (error?.apiCode) {
    return {
      status: error.statusCode ?? 400,
      code: error.apiCode,
      message: publicMessage(error.apiCode, error.message)
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "API v1の処理に失敗しました"
  };
}

function assetUploadPath(request) {
  const path = String(request?.originalUrl ?? request?.url ?? "").split("?", 1)[0];
  return path === "/api/v1/assets/images";
}

function publicMessage(code, message) {
  if (code === "INTERNAL_ERROR") return "API v1の処理に失敗しました";
  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 500)
    : "リクエストを処理できません";
}

function sendV1Error(response, { status, code, message }) {
  if (response.headersSent) return;
  response.status(status).json({ error: { code, message } });
}

function isV1Request(request) {
  const path = String(request.originalUrl ?? request.url ?? "").split("?")[0];
  return path === "/api/v1" || path.startsWith("/api/v1/");
}
