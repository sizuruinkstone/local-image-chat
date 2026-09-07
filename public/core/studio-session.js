// Additive application-session envelope. Existing production preferences remain untouched.
export const STUDIO_SESSION_KEY = "localImageChat.studioSession.v1";
export function createStudioSession(storage) {
  return {
    read() { try { const value = JSON.parse(storage.getItem(STUDIO_SESSION_KEY)); return value?.version === 1 && value.draft?.prompt && Array.isArray(value.draft?.selection?.selected) ? value : null; } catch { return null; } },
    write(value) { try { storage.setItem(STUDIO_SESSION_KEY, JSON.stringify({version: 1, ...value})); return true; } catch { return false; } }
  };
}
