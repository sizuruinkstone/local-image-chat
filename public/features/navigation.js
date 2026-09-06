import { APP_VIEWS, hashForView, normalizeAppView, viewFromHash } from "../view-router.js";

export function createNavigation({
  body,
  mainNav,
  views,
  browser = window,
  storage = localStorage,
  onGalleryEnter,
  onCompareEnter
}) {
  let currentView = "generate";
  let initialized = false;

  function showView(view, { remember = true } = {}) {
    currentView = normalizeAppView(view);
    body.dataset.currentView = currentView;
    for (const name of APP_VIEWS) {
      views[name].classList.toggle("hidden", name !== currentView);
    }
    for (const button of mainNav.querySelectorAll("[data-view]")) {
      const active = button.dataset.view === currentView;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (remember) {
      storage.setItem("localImageChat.view", currentView);
      if (viewFromHash(browser.location.hash) !== currentView) {
        browser.history.replaceState(null, "", hashForView(currentView));
      }
    }
    if (currentView === "gallery") onGalleryEnter();
    if (currentView === "compare") onCompareEnter();
  }

  function loadInitialView() {
    return viewFromHash(browser.location.hash)
      ?? normalizeAppView(storage.getItem("localImageChat.view"));
  }

  function onClick(event) {
    const button = event.target.closest("[data-view]");
    if (button) showView(button.dataset.view);
  }

  function onHashChange() {
    const view = viewFromHash(browser.location.hash);
    if (view && view !== currentView) showView(view, { remember: false });
  }

  // Listener registration and initial view restoration stay at their existing
  // app startup positions. View changes never dispose application monitors.
  function init() {
    if (initialized) return;
    mainNav.addEventListener("click", onClick);
    browser.addEventListener("hashchange", onHashChange);
    initialized = true;
  }

  function dispose() {
    if (!initialized) return;
    mainNav.removeEventListener("click", onClick);
    browser.removeEventListener("hashchange", onHashChange);
    initialized = false;
  }

  return { showView, loadInitialView, getCurrentView: () => currentView, init, dispose };
}
