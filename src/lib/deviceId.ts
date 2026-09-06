// A random per-browser identifier for the public /vivo/[code] guest page — not tied
// to any account, just enough to let the server-side RPCs (rpc_submit_tema_publico,
// rpc_registrar_aplauso) tell "this same phone" apart from another one, so the
// 20s submission cooldown and the one-aplauso-per-performance rule can be enforced.
// Deliberately not cryptographically strong or tamper-proof — clearing site data or
// using another device resets it, which is an accepted trade-off for a casual party
// feature, not a paid or high-stakes vote.
const STORAGE_KEY = 'karaokey-device-id';

export function getDeviceId(): string {
    if (typeof window === 'undefined') return '';
    try {
        let id = localStorage.getItem(STORAGE_KEY);
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem(STORAGE_KEY, id);
        }
        return id;
    } catch {
        // localStorage blocked (private mode, disabled site data, etc.) — fall back to
        // an in-memory id for this page load only; cooldowns/dedupe just won't persist
        // across reloads for this guest, which is a harmless degradation.
        return crypto.randomUUID();
    }
}
