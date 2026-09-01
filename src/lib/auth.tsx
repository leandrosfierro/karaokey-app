import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';

export type Modo = 'simple' | 'pro';

interface AuthContextValue {
    user: User | null;
    session: Session | null;
    loading: boolean;
    // undefined = never chosen yet (new account, or signed up before email
    // confirmation completed) — callers use this to show the one-time picker,
    // distinct from 'pro' which is the settled default once a choice is made.
    modo: Modo | undefined;
    setModo: (modo: Modo) => Promise<void>;
    onboardingDone: boolean;
    markOnboardingDone: () => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Patches user_metadata into the locally-held session immediately after a
// successful updateUser call, so the UI (modo switch, tutorial gate) reacts
// right away instead of waiting for the next onAuthStateChange round-trip.
function patchMetadata(session: Session, patch: Record<string, unknown>): Session {
    return {
        ...session,
        user: {
            ...session.user,
            user_metadata: { ...session.user.user_metadata, ...patch },
        },
    };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    /* eslint-disable react-hooks/set-state-in-effect -- env var check is a static,
       one-time boot-time fact, not state derived from props/state each render (same
       established pattern as index.tsx's bootstrap effect) */
    useEffect(() => {
        if (!isSupabaseConfigured) {
            setLoading(false);
            return;
        }
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setLoading(false);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
            setSession(newSession);
        });
        return () => sub.subscription.unsubscribe();
    }, []);
    /* eslint-enable react-hooks/set-state-in-effect */

    const user = session?.user ?? null;
    const rawModo = user?.user_metadata?.modo;
    const modo: Modo | undefined = rawModo === 'simple' || rawModo === 'pro' ? rawModo : undefined;
    const onboardingDone = Boolean(user?.user_metadata?.onboarding_done);

    const setModo = async (next: Modo) => {
        const { error } = await supabase.auth.updateUser({ data: { modo: next } });
        if (!error) setSession((prev) => (prev ? patchMetadata(prev, { modo: next }) : prev));
    };

    const markOnboardingDone = async () => {
        const { error } = await supabase.auth.updateUser({ data: { onboarding_done: true } });
        if (!error) setSession((prev) => (prev ? patchMetadata(prev, { onboarding_done: true }) : prev));
    };

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    return (
        <AuthContext.Provider value={{ user, session, loading, modo, setModo, onboardingDone, markOnboardingDone, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}

// Supabase Auth errors come back in English — map the common ones so the
// login/registro forms read consistently with the rest of the (Spanish) app.
export function translateAuthError(message: string): string {
    const known: Record<string, string> = {
        'Invalid login credentials': 'Email o contraseña incorrectos.',
        'User already registered': 'Ya existe una cuenta con ese email.',
        'Email not confirmed': 'Tenés que confirmar tu email antes de iniciar sesión — revisá tu correo.',
        'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres.',
        'Unable to validate email address: invalid format': 'Ese email no parece válido.',
        'email rate limit exceeded': 'Se enviaron demasiados correos en poco tiempo — esperá unos minutos y probá de nuevo.',
        'Email rate limit exceeded': 'Se enviaron demasiados correos en poco tiempo — esperá unos minutos y probá de nuevo.',
    };
    return known[message] ?? message;
}
