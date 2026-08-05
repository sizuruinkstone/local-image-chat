import assert from "node:assert/strict";
import test from "node:test";
import {
  configureThumbnailImage,
  originalImageUrl,
  thumbnailImageUrl
} from "../public/image-delivery.js";

test("APIのthumbnailUrlを優先し、原寸URLは同じ共通処理で解決する", () => {
  const image = {
    id: "image-0001",
    thumbnailUrl: " /api/images/image-0001/thumbnail ",
    originalUrl: " /api/images/image-0001/original ",
    imageUrl: "/outputs/legacy.png"
  };
  assert.equal(thumbnailImageUrl(image), "/api/images/image-0001/thumbnail");
  assert.equal(originalImageUrl(image), "/api/images/image-0001/original");
  assert.equal(originalImageUrl({ id: "image-0001", imageUrl: "/outputs/legacy.png" }), "/outputs/legacy.png");
  assert.equal(originalImageUrl({ id: "image-0001" }), "/api/images/image-0001/original");
});

test("thumbnailUrlが空ならoriginalUrlを最初から使用する", () => {
  const element = fakeImageElement();
  const result = configureThumbnailImage(element, {
    id: "image-0002",
    thumbnailUrl: " ",
    originalUrl: "/api/images/image-0002/original"
  });
  assert.equal(result.initialUrl, "/api/images/image-0002/original");
  assert.equal(element.src, "/api/images/image-0002/original");
  assert.equal(element.dataset.imageStage, "original");
  assert.equal(element.loading, "lazy");
  assert.equal(element.decoding, "async");
});

test("サムネイル失敗時だけ原寸へ1回切り替え、原寸も失敗したらプレースホルダーにする", () => {
  const element = fakeImageElement();
  configureThumbnailImage(element, {
    id: "image-0003",
    thumbnailUrl: "/api/images/image-0003/thumbnail",
    originalUrl: "/api/images/image-0003/original"
  });

  assert.equal(element.src, "/api/images/image-0003/thumbnail");
  element.emitError();
  assert.equal(element.src, "/api/images/image-0003/original");
  assert.equal(element.dataset.originalFallback, "true");
  assert.equal(element.dataset.imageStage, "original");

  element.emitError();
  assert.equal(element.src, "/image-placeholder.svg");
  assert.equal(element.dataset.imageStage, "placeholder");
  assert.equal(element.classList.has("thumbnailError"), true);

  element.emitError();
  assert.equal(element.src, "/image-placeholder.svg", "プレースホルダー失敗時も無限にURLを変更しない");
});

test("サムネイルと原寸が同じURLなら再設定せずプレースホルダーへ進む", () => {
  const element = fakeImageElement();
  configureThumbnailImage(element, {
    thumbnailUrl: "/same.png",
    originalUrl: "/same.png"
  });
  element.emitError();
  assert.equal(element.src, "/image-placeholder.svg");
  assert.equal(element.dataset.originalFallback, undefined);
});

function fakeImageElement() {
  const listeners = new Map();
  const classes = new Set();
  return {
    src: "",
    title: "",
    dataset: {},
    classList: {
      add(value) { classes.add(value); },
      has(value) { return classes.has(value); }
    },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    emitError() {
      listeners.get("error")?.();
    }
  };
}
