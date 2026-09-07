import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// createClient throws synchronously on a missing URL, which would crash the whole
// page at import time. Fall back to a placeholder so the app can boot and show a
// real "not configured" message instead — callers must check isSupabaseConfigured
// before relying on any query actually succeeding.
export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder'
);

// user_id is auto-populated by a column default (auth.uid()) on insert and
// enforced by RLS on every read/write — the app never needs to set or filter
// on it explicitly, it's here only for row-shape accuracy.
export interface ParticipanteRow {
    id: string;
    nombre: string;
    ya_canto: boolean;
    created_at: string;
    user_id: string | null;
}

export interface CancionRow {
    id: string;
    titulo: string;
    artista: string | null;
    created_at: string;
    user_id: string | null;
}

export interface LocalAudioRow {
    id: string;
    titulo: string;
    artista: string | null;
    storage_path: string;
    duration_seconds: number | null;
    file_size_bytes: number | null;
    created_at: string;
    user_id: string | null;
}

export interface ColaTurnoRow {
    id: string;
    nombre: string;
    cancion_titulo: string;
    cancion_artista: string | null;
    ya_canto: boolean;
    created_at: string;
    user_id: string | null;
}

// Modo Participativo — QR público para sumar temas y aplaudir en vivo. These four
// are the only karaokey_* tables anon ever touches, and only through the
// rpc_resolve_party / rpc_submit_tema_publico / rpc_registrar_aplauso functions —
// never a direct table read/write. See the migration `add_modo_participativo_tables`.
export interface HostRow {
    user_id: string;
    party_code: string;
    participativo_enabled: boolean;
    created_at: string;
}

// Doubles as the visible "quién canta qué" queue on the main screen: each row
// pairs a singer name (submitted_by) with the exact song+version they (or the
// host, manually) chose — youtube_video_id is what they actually picked in
// the /vivo/[code] search, not re-derived from titulo/artista later.
export interface TemaPublicoRow {
    id: string;
    user_id: string;
    titulo: string;
    artista: string | null;
    submitted_by: string;
    device_id: string;
    // Always set for a guest submission (rpc_submit_tema_publico requires it);
    // null for an entry the host added manually from the main screen without
    // picking a specific video — the normal search runs when it goes on stage.
    youtube_video_id: string | null;
    youtube_thumbnail: string | null;
    created_at: string;
}

export interface PerformanceRow {
    user_id: string;
    id: string;
    participantes: string[];
    cancion_titulo: string | null;
    cancion_artista: string | null;
    started_at: string;
}

export interface AplausoRow {
    id: string;
    performance_id: string;
    device_id: string;
    created_at: string;
}
