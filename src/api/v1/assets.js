import express from "express";
import {
  REFERENCE_ASSET_MAX_RAW_BYTES,
  ReferenceAssetError,
  normalizeReferenceAssetMimeType
} from "../../reference-assets.js";

export function createReferenceAssetBodyParser() {
  return express.raw({
    limit: REFERENCE_ASSET_MAX_RAW_BYTES,
    type: () => true
  });
}

export function registerAssetRoutes(router, { referenceAssets, wrap }) {
  if (!referenceAssets || typeof referenceAssets.importBuffer !== "function") {
    throw new Error("Reference Asset Serviceが不正です");
  }

  router.post("/assets/images", wrap(async (request, response) => {
    const mimeType = normalizeReferenceAssetMimeType(request.get("content-type"));
    if (mimeType === "application/json" || mimeType.startsWith("multipart/")) {
      throw new ReferenceAssetError(
        "INVALID_REQUEST",
        "参照画像はmultipart、JSON、pathではなくraw image bytesで送信してください",
        400
      );
    }
    if (!Buffer.isBuffer(request.body)) {
      throw new ReferenceAssetError(
        "INVALID_REQUEST",
        "参照画像はmultipart、JSON、pathではなくraw image bytesで送信してください",
        400
      );
    }
    const asset = await referenceAssets.importBuffer(request.body, {
      mimeType
    });
    response.status(201).json(asset);
  }));
}
