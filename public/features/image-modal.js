export function createImageModal({ document }) {
  let overlay = null;

  function ensure() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "imageModal hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "画像の拡大表示");

    const image = document.createElement("img");
    image.className = "imageModalImg";
    image.alt = "";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "imageModalClose";
    closeButton.setAttribute("aria-label", "閉じる");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", close);
    overlay.append(image, closeButton);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.body.append(overlay);
    return overlay;
  }

  function open(url, alt = "") {
    if (!url) return;
    const modal = ensure();
    const image = modal.querySelector(".imageModalImg");
    image.src = url;
    image.alt = alt;
    modal.classList.remove("hidden");
    document.addEventListener("keydown", handleKeydown);
  }

  function close() {
    if (!overlay || overlay.classList.contains("hidden")) return;
    overlay.classList.add("hidden");
    overlay.querySelector(".imageModalImg").removeAttribute("src");
    document.removeEventListener("keydown", handleKeydown);
  }

  function handleKeydown(event) {
    if (event.key === "Escape") close();
  }

  return { open, close };
}
