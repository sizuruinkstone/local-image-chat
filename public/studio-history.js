export const STUDIO_HISTORY_FILTERS = Object.freeze({
  all: "all",
  favorite: "favorite"
});

export function normalizeStudioHistoryFilter(value) {
  return value === STUDIO_HISTORY_FILTERS.favorite
    ? STUDIO_HISTORY_FILTERS.favorite
    : STUDIO_HISTORY_FILTERS.all;
}

export function filterStudioHistoryEntries(entries, filter) {
  const source = Array.isArray(entries) ? entries : [];
  const normalized = normalizeStudioHistoryFilter(filter);
  if (normalized === STUDIO_HISTORY_FILTERS.favorite) {
    return source.filter((entry) => entry?.image?.favorite === true);
  }
  return source;
}
