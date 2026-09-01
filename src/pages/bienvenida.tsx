import { useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { motion } from "framer-motion";
import { Sparkles, LogIn, UserPlus, Users2, Disc3, MonitorPlay } from "lucide-react";
import { useAuth } from "../lib/auth";

// The very first thing anyone with no active session sees. index.tsx redirects
// here whenever it has no user; this page redirects back to "/" the moment a
// session shows up (e.g. landing here after already being logged in elsewhere).
export default function Bienvenida() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

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
        <title>KaraoKey | Bienvenido</title>
        <meta name="description" content="El sorteador y mezclador de karaoke más premium para tus fiestas." />
      </Head>

      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="max-w-lg w-full text-center space-y-8"
      >
        <div className="space-y-4">
          <h1 className="text-6xl md:text-7xl font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-r from-[#FF3B81] via-[#9D4EDD] to-[#00B7ED] animate-gradient">
            KARAOKEY
          </h1>
          <p className="text-white/60 text-lg font-medium">
            Sorteá quién canta, armá tu cancionero y mezclá como DJ — todo en un mismo lugar, para tus fiestas.
          </p>
        </div>

        <div className="glass-card rounded-3xl p-6 space-y-4 text-left border border-white/5">
          <div className="flex items-center gap-3">
            <Sparkles className="text-neon-pink shrink-0" size={20} />
            <p className="text-sm text-white/70">Sorteá cantante y canción, o armá una cola de turnos manual</p>
          </div>
          <div className="flex items-center gap-3">
            <Users2 className="text-neon-blue shrink-0" size={20} />
            <p className="text-sm text-white/70">Tu lista de participantes y canciones queda guardada en tu cuenta</p>
          </div>
          <div className="flex items-center gap-3">
            <Disc3 className="text-neon-pink shrink-0" size={20} />
            <p className="text-sm text-white/70">Modo Pro: mezclá 2 decks como DJ, con pantalla externa para el público</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => router.push('/registro')}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-linear-to-r from-[#FF3B81] to-[#9D4EDD] font-bold uppercase tracking-widest text-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl cursor-pointer"
          >
            <UserPlus size={18} /> Crear cuenta
          </button>
          <button
            onClick={() => router.push('/login')}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 font-bold uppercase tracking-widest text-sm transition-all cursor-pointer"
          >
            <LogIn size={18} /> Ya tengo cuenta
          </button>
        </div>

        <p className="text-white/30 text-xs flex items-center justify-center gap-2 pt-2">
          <MonitorPlay size={14} /> Pensado para fiestas y previas — un usuario por anfitrión
        </p>
      </motion.div>
    </div>
  );
}
