const IMAGE_PLACEHOLDER_URL = "/image-placeholder.svg";

export function originalImageUrl(image) {
  return firstUrl(image?.originalUrl, image?.imageUrl)
    || imageRoute(image?.id, "original");
}

export function thumbnailImageUrl(image) {
  return firstUrl(image?.thumbnailUrl);
}

export function configureThumbnailImage(imageElement, image, {
  eager = false,
  placeholderUrl = IMAGE_PLACEHOLDER_URL
} = {}) {
  const thumbnailUrl = thumbnailImageUrl(image);
  const originalUrl = originalImageUrl(image);
  const initialUrl = thumbnailUrl || originalUrl || placeholderUrl;
  const initialStage = thumbnailUrl ? "thumbnail" : originalUrl ? "original" : "placeholder";

  imageElement.dataset.imageStage = initialStage;
  imageElement.dataset.thumbnailUrl = thumbnailUrl;
  imageElement.dataset.originalUrl = originalUrl;
  imageElement.src = initialUrl;
  imageElement.loading = eager ? "eager" : "lazy";
  imageElement.decoding = "async";
  if (eager) imageElement.fetchPriority = "high";

  imageElement.addEventListener("error", () => {
    const stage = imageElement.dataset.imageStage;
    if (
      stage === "thumbnail"
      && originalUrl
      && !sameImageUrl(imageElement.src, originalUrl)
    ) {
      imageElement.dataset.imageStage = "original";
      imageElement.dataset.originalFallback = "true";
      imageElement.src = originalUrl;
      imageElement.title = "サムネイルを表示できないため原寸画像を表示しています";
      return;
    }

    if (stage === "placeholder") return;
    imageElement.dataset.imageStage = "placeholder";
    imageElement.src = placeholderUrl;
    imageElement.classList.add("thumbnailError");
    imageElement.title = "画像を表示できません";
  });

  return { thumbnailUrl, originalUrl, initialUrl };
}

function imageRoute(id, kind) {
  const value = String(id ?? "").trim();
  if (!/^[a-z0-9-]{8,80}$/i.test(value)) return "";
  return `/api/images/${encodeURIComponent(value)}/${kind}`;
}

function firstUrl(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function sameImageUrl(left, right) {
  try {
    const base = globalThis.location?.origin || "http://local.invalid";
    return new URL(left, base).href === new URL(right, base).href;
  } catch {
    return left === right;
  }
}
