export function createCivitaiTokenResolver(environmentToken) {
  const tokenFromEnvironment = sanitizeCivitaiToken(environmentToken);
  return (requestToken) => sanitizeCivitaiToken(requestToken) || tokenFromEnvironment;
}

export function sanitizeCivitaiToken(value) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}
