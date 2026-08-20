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

export interface ParticipanteRow {
    id: string;
    nombre: string;
    ya_canto: boolean;
    created_at: string;
}

export interface CancionRow {
    id: string;
    titulo: string;
    artista: string | null;
    created_at: string;
}

export interface LocalAudioRow {
    id: string;
    titulo: string;
    artista: string | null;
    storage_path: string;
    duration_seconds: number | null;
    file_size_bytes: number | null;
    created_at: string;
}

export interface ColaTurnoRow {
    id: string;
    nombre: string;
    cancion_titulo: string;
    cancion_artista: string | null;
    ya_canto: boolean;
    created_at: string;
}
