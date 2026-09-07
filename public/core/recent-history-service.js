export function createRecentHistoryService({ getJson, onData = () => {}, onError = () => {} }) {
  let revision = 0;
  let state = { generations: [], loading: false, error: null };
  return {
    getState: () => structuredClone(state),
    replace(generations) {
      revision += 1;
      state = { generations: structuredClone(generations), loading: false, error: null };
      onData(structuredClone(state.generations));
    },
    async load(filter = "all") {
      const request = ++revision;
      state = { ...state, loading: true, error: null };
      try {
        const data = await getJson(`/api/history?limit=20${filter === "favorite" ? "&favorites=1" : ""}`);
        if (request !== revision) return false;
        state = { generations: structuredClone(data.generations ?? []), loading: false, error: null };
        onData(structuredClone(state.generations));
        return true;
      } catch (error) {
        if (request !== revision) return false;
        state = { ...state, loading: false, error: error.message };
        onError(error.message);
        return false;
      }
    },
    dispose() { revision += 1; state.loading = false; }
  };
}
