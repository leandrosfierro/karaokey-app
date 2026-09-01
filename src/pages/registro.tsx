import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { motion } from "framer-motion";
import { UserPlus, Mail, Lock, ArrowLeft } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth, translateAuthError, type Modo } from "../lib/auth";
import { ModoPicker } from "../components/ModoPicker";

// Registration is two steps: (1) email/password, (2) — only reachable once we
// actually have a session, i.e. the project doesn't require email confirmation
// — a one-time "¿Simple o Pro?" pick. If confirmation IS required, there's no
// session yet to attach a modo to; index.tsx shows the same picker on first
// login instead, so both configurations converge on the same one-time choice.
type Step = 'form' | 'confirm-email' | 'modo';

export default function Registro() {
  const { user, loading, setModo: saveModo } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user && step === 'form') {
      // Already logged in and landed here directly — nothing to register.
      router.replace('/');
    }
  }, [loading, user, step, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
    setSubmitting(false);
    if (signUpError) {
      setError(translateAuthError(signUpError.message));
      return;
    }
    if (data.session) {
      setStep('modo');
    } else {
      setStep('confirm-email');
    }
  };

  const handlePickModo = async (modo: Modo) => {
    setSubmitting(true);
    await saveModo(modo);
    setSubmitting(false);
    router.replace('/');
  };

  if (loading || (user && step === 'form')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-white/60">
        <div className="w-10 h-10 border-4 border-white/20 border-t-neon-pink rounded-full animate-spin" />
        <p className="text-sm font-bold uppercase tracking-widest">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-16 px-4 text-white font-sans flex flex-col items-center justify-center">
      <Head>
        <title>KaraoKey | Crear cuenta</title>
      </Head>

      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="max-w-sm w-full space-y-6"
      >
        {step !== 'confirm-email' && (
          <Link href="/bienvenida" className="inline-flex items-center gap-2 text-white/40 hover:text-white/70 transition-colors text-xs font-bold uppercase tracking-widest">
            <ArrowLeft size={14} /> Volver
          </Link>
        )}

        {step === 'form' && (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-r from-[#FF3B81] via-[#9D4EDD] to-[#00B7ED]">
                KARAOKEY
              </h1>
              <p className="text-white/50 text-sm">Creá tu cuenta — tus listas quedan solo para vos</p>
            </div>

            <form onSubmit={handleSubmit} className="glass-card rounded-3xl p-6 space-y-4 border border-white/5">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-white/50">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl pl-10 pr-4 py-3 bg-white/5 border border-white/10 outline-hidden focus:border-white/20 transition-all text-sm text-white placeholder:text-white/20 font-sans"
                    placeholder="tu@email.com"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-white/50">Contraseña</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl pl-10 pr-4 py-3 bg-white/5 border border-white/10 outline-hidden focus:border-white/20 transition-all text-sm text-white placeholder:text-white/20 font-sans"
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-white/50">Repetir contraseña</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl pl-10 pr-4 py-3 bg-white/5 border border-white/10 outline-hidden focus:border-white/20 transition-all text-sm text-white placeholder:text-white/20 font-sans"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {error && (
                <p className="text-xs text-[#FF3B81] bg-[#FF3B81]/10 border border-[#FF3B81]/20 rounded-xl p-3">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-linear-to-r from-[#FF3B81] to-[#9D4EDD] font-bold uppercase tracking-widest text-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <UserPlus size={18} />
                )}
                Crear cuenta
              </button>
            </form>

            <p className="text-center text-sm text-white/40">
              ¿Ya tenés cuenta?{' '}
              <Link href="/login" className="text-neon-blue hover:underline font-bold">
                Iniciá sesión
              </Link>
            </p>
          </>
        )}

        {step === 'confirm-email' && (
          <div className="glass-card rounded-3xl p-8 text-center space-y-4 border border-white/5">
            <Mail size={40} className="text-neon-blue mx-auto" />
            <h2 className="text-xl font-bold">Revisá tu correo</h2>
            <p className="text-sm text-white/60">
              Te enviamos un link de confirmación a <span className="text-white font-medium">{email}</span>. Confirmalo y después iniciá sesión.
            </p>
            <button
              onClick={() => router.push('/login')}
              className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 font-bold uppercase tracking-widest text-xs transition-all cursor-pointer"
            >
              Ir a Iniciar sesión
            </button>
          </div>
        )}

        {step === 'modo' && <ModoPicker onPick={handlePickModo} submitting={submitting} />}
      </motion.div>
    </div>
  );
}
