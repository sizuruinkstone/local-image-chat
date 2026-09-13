export function createLibraryService({getJson, onChange = () => {}, storage}) {
  let epoch = 0, disposed = false;
  let state = {items: [], search: "", sort: "newest", favorites: false, rating: "general", loading: false, error: "", hasMore: false, nextCursor: null, total: 0};
  try { const saved=JSON.parse(storage?.getItem("localImageChat.studioLibrary.v1"));if(saved)state={...state,search:String(saved.search??""),sort:saved.sort==="oldest"?"oldest":"newest",favorites:saved.favorites===true,rating:["general","nsfw"].includes(saved.rating)?saved.rating:"general"}; } catch {}
  const snapshot = () => structuredClone(state);
  const emit = () => { if (!disposed) onChange(snapshot()); };
  async function load({append = false} = {}) {
    if (disposed || append && (state.loading || !state.hasMore)) return false;
    const version = ++epoch;
    state = {...state, loading: true, error: ""}; emit();
    const query = new URLSearchParams({limit: "40", search: state.search, sort: state.sort});
    if (state.favorites) query.set("favorites", "1");
    query.set("rating", state.rating);
    if (append && state.nextCursor) query.set("cursor", state.nextCursor);
    try {
      const data = await getJson(`/api/history?${query}`);
      if (disposed || version !== epoch) return false;
      const items = (data.generations ?? []).flatMap(record => record.images.map(image => ({record, image})));
      const merged = new Map((append ? state.items : []).map(item => [item.image.id, item]));
      for (const item of items) merged.set(item.image.id, item);
      state = {...state, items: [...merged.values()], loading: false, hasMore: data.hasMore === true, nextCursor: data.nextCursor, total: data.total ?? items.length};
      emit(); return true;
    } catch (error) {
      if (disposed || version !== epoch) return false;
      state = {...state, loading: false, error: error.message}; emit(); return false;
    }
  }
  return {getSnapshot: snapshot, load, more: () => load({append: true}),
    setQuery(patch) { state = {...state, ...patch, items: [], nextCursor: null, hasMore: false};
      if (!["general","nsfw"].includes(state.rating)) state.rating = "general";
      try { storage?.setItem("localImageChat.studioLibrary.v1",JSON.stringify({search:state.search,sort:state.sort,favorites:state.favorites,rating:state.rating})); } catch {}
      return load(); },
    dispose() { disposed = true; epoch++; }
  };
}
