export function createAppBootstrap({
  lifecycleTarget = globalThis.window,
  preConfigControllers = [],
  restoreConfig,
  restorePreferences,
  registerPwa,
  prepareInitialUi,
  loadInitialData,
  finalizeInitialState,
  startAppMonitors,
  bindPrimaryListeners,
  controllers = [],
  bindFeatureListeners,
  activateInitialView,
  bindLateListeners,
  lifecycleControllers = [],
  teardown = []
}) {
  let startPromise = null;
  let disposed = false;
  const listenerDisposers = [];

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listenerDisposers.push(() => target.removeEventListener(type, handler, options));
  }

  async function runStartup() {
    for (const controller of preConfigControllers) controller.init();
    await restoreConfig(listen);
    restorePreferences();
    registerPwa();
    prepareInitialUi();
    await loadInitialData();
    finalizeInitialState();
    startAppMonitors();
    bindPrimaryListeners(listen);
    for (const controller of controllers) controller.init();
    bindFeatureListeners(listen);
    activateInitialView();
    bindLateListeners(listen);
    listen(lifecycleTarget, "beforeunload", dispose);
  }

  function start() {
    if (!startPromise) startPromise = runStartup();
    return startPromise;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const remove of listenerDisposers.splice(0).reverse()) remove();
    for (const controller of [...lifecycleControllers].reverse()) controller?.dispose?.();
    for (const callback of teardown) callback();
  }

  return { start, dispose };
}

export function registerServiceWorker({ navigator, onError = (error) => console.warn(error) }) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    onError(`[PWA] Service Workerを登録できません: ${error.message}`);
  });
}
