import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { motion } from "framer-motion";
import { LogIn, Mail, Lock, ArrowLeft } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth, translateAuthError } from "../lib/auth";

export default function Login() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (signInError) {
      setError(translateAuthError(signInError.message));
      return;
    }
    router.replace('/');
  };

  if (loading || user) {
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
        <title>KaraoKey | Iniciar sesión</title>
      </Head>

      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="max-w-sm w-full space-y-6"
      >
        <Link href="/bienvenida" className="inline-flex items-center gap-2 text-white/40 hover:text-white/70 transition-colors text-xs font-bold uppercase tracking-widest">
          <ArrowLeft size={14} /> Volver
        </Link>

        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-r from-[#FF3B81] via-[#9D4EDD] to-[#00B7ED]">
            KARAOKEY
          </h1>
          <p className="text-white/50 text-sm">Iniciá sesión para entrar a tu cuenta</p>
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              <LogIn size={18} />
            )}
            Entrar
          </button>
        </form>

        <p className="text-center text-sm text-white/40">
          ¿No tenés cuenta?{' '}
          <Link href="/registro" className="text-neon-blue hover:underline font-bold">
            Creá una
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
