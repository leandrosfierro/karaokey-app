import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Music, Users, Play, Trophy, Mic2, AtSign, CheckCircle2, RotateCcw, Users2, ListMusic, ListPlus, Settings2, ArrowLeft, RefreshCw, SkipForward, ListOrdered, Eraser, Disc3, HelpCircle, LogOut, MousePointerClick, Search } from "lucide-react";
import confetti from "canvas-confetti";
import { SlotMachine } from "../components/SlotMachine";
import { KaraokePlayer } from "../components/KaraokePlayer";
import { TutorialOverlay } from "../components/TutorialOverlay";
import { ModoPicker } from "../components/ModoPicker";
import { useToast } from "../components/Toast";
import { useAuth } from "../lib/auth";
import { supabase, isSupabaseConfigured, ParticipanteRow, CancionRow, ColaTurnoRow } from "../lib/supabase";

type Cancion = { titulo: string; artista?: string };

const DEFAULT_PARTICIPANTES = ["Lean", "Caro", "Mati", "Romi"];
const DEFAULT_CANCIONES: Cancion[] = [
  { titulo: "De música ligera", artista: "Soda Stereo" },
  { titulo: "La gloria de Dios", artista: "Ricardo Montaner" },
  { titulo: "Color Esperanza", artista: "Diego Torres" },
  { titulo: "Soy Cordobés", artista: "La Mona" }
];

// "Título - Artista" (used by the one-by-one input and the bulk-paste textarea)
function parseCancionLine(line: string): Cancion {
  const [t, a] = line.split("-");
  return { titulo: t.trim(), artista: a?.trim() };
}

// "Artist - Song (Karaoke)" -> { titulo: "Song", artista: "Artist" }. Naive heuristic,
// shared by the channel and playlist imports since both return the same YouTube snippet shape.
function parseKaraokeVideoTitle(item: any): Cancion {
  let fullTitle: string = item.snippet.title;
  fullTitle = fullTitle
    .replace(/\(Karaoke Version\)/i, "")
    .replace(/Karaoke/i, "")
    .replace(/Lyrics/i, "")
    .replace(/Letra/i, "")
    .trim();

  const parts = fullTitle.split("-");
  if (parts.length >= 2) {
    return { titulo: parts[1].trim(), artista: parts[0].trim() };
  }
  return { titulo: fullTitle, artista: item.snippet.channelTitle };
}

interface SorteoResult {
  participantes: string[];
  cancion: Cancion;
  desafio: string;
  id: string;
}

type ViewState = 'setup' | 'player' | 'cantante' | 'dj';
type ModoSorteo = 'completo' | 'cantante';

export default function Home() {
  const toast = useToast();
  const router = useRouter();
  const { user, loading: authLoading, modo, setModo, onboardingDone, markOnboardingDone, signOut } = useAuth();
  const [showTutorial, setShowTutorial] = useState(false);

  // No session -> straight to the welcome page. Everything below this component
  // assumes an authenticated user (RLS scopes every karaokey_* table to
  // auth.uid()), so nothing here fires for a logged-out visitor.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/bienvenida');
  }, [authLoading, user, router]);
  // Source of truth for participantes/canciones/ya-cantó is Supabase, not local
  // state — these rows are the durable record so the list survives clearing the
  // browser, switching devices, etc. Everything else (participantes, canciones,
  // yaCantaron) is derived from these on every render.
  const [participanteRows, setParticipanteRows] = useState<ParticipanteRow[]>([]);
  const [cancionRows, setCancionRows] = useState<CancionRow[]>([]);
  const [colaRows, setColaRows] = useState<ColaTurnoRow[]>([]);
  const participantes = participanteRows.map((r) => r.nombre);
  const canciones: Cancion[] = cancionRows.map((r) => ({ titulo: r.titulo, artista: r.artista ?? undefined }));
  const yaCantaron = participanteRows.filter((r) => r.ya_canto).map((r) => r.nombre);

  const [sorteo, setSorteo] = useState<SorteoResult | null>(null);
  const [sorteoCantante, setSorteoCantante] = useState<string[] | null>(null);
  const [girando, setGirando] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<ViewState>('setup');
  const [selectedParticipantes, setSelectedParticipantes] = useState<string[]>([]);
  const [selectedCancion, setSelectedCancion] = useState<Cancion | null>(null);
  const [cancionQuery, setCancionQuery] = useState("");
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOpcionesSorteo, setShowOpcionesSorteo] = useState(false);
  const [modoDuo, setModoDuo] = useState(false);
  const [modoSorteo, setModoSorteo] = useState<ModoSorteo>('completo');
  const [modoTurnos, setModoTurnos] = useState(false);

  // Load from Supabase and seed defaults on a brand-new, empty database.
  // modoDuo is just a session preference, not content worth a DB round-trip,
  // so it stays in localStorage. Every table read/written here is scoped to
  // the signed-in user by RLS (user_id = auth.uid(), defaulted on insert) —
  // no per-call .eq('user_id', ...) needed, so this waits only for a session
  // to exist before running.
  /* eslint-disable react-hooks/set-state-in-effect -- env var check is a static,
     one-time boot-time fact, not state derived from props/state each render */
  useEffect(() => {
    if (!isSupabaseConfigured) {
      console.error('[KaraoKey] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
      setLoadError(true);
      setMounted(true);
      return;
    }
    if (authLoading || !user) return; // wait for a session — RLS has nothing to return without one

    let cancelled = false;
    (async () => {
      const [{ data: pData, error: pErr }, { data: cData, error: cErr }, { data: colaData, error: colaErr }] = await Promise.all([
        supabase.from('karaokey_participantes').select('*').order('created_at', { ascending: true }),
        supabase.from('karaokey_canciones').select('*').order('created_at', { ascending: true }),
        supabase.from('karaokey_cola_turnos').select('*').order('created_at', { ascending: true }),
      ]);

      if (colaErr) console.error('[KaraoKey] Failed to load cola de turnos:', colaErr);
      else setColaRows(colaData ?? []);

      if (cancelled) return;

      if (pErr || cErr) {
        console.error('[KaraoKey] Supabase load error:', pErr, cErr);
        setLoadError(true);
      } else {
        if ((pData?.length ?? 0) === 0) {
          const { data: seededP } = await supabase
            .from('karaokey_participantes')
            .insert(DEFAULT_PARTICIPANTES.map((nombre) => ({ nombre })))
            .select();
          setParticipanteRows(seededP ?? []);
        } else {
          setParticipanteRows(pData!);
        }

        if ((cData?.length ?? 0) === 0) {
          const { data: seededC } = await supabase
            .from('karaokey_canciones')
            .insert(DEFAULT_CANCIONES.map((c) => ({ titulo: c.titulo, artista: c.artista ?? null })))
            .select();
          setCancionRows(seededC ?? []);
        } else {
          setCancionRows(cData!);
        }
      }

      const savedDuo = localStorage.getItem("karaokey-modo-duo");
      if (savedDuo) setModoDuo(JSON.parse(savedDuo));
      const savedModoSorteo = localStorage.getItem("karaokey-modo-sorteo");
      if (savedModoSorteo === 'completo' || savedModoSorteo === 'cantante') setModoSorteo(savedModoSorteo);
      const savedModoTurnos = localStorage.getItem("karaokey-modo-turnos");
      if (savedModoTurnos) setModoTurnos(JSON.parse(savedModoTurnos));
      setMounted(true);
    })();
    return () => { cancelled = true; };
  }, [authLoading, user]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("karaokey-modo-duo", JSON.stringify(modoDuo));
      localStorage.setItem("karaokey-modo-sorteo", modoSorteo);
      localStorage.setItem("karaokey-modo-turnos", JSON.stringify(modoTurnos));
    }
  }, [modoDuo, modoSorteo, modoTurnos, mounted]);

  const toggleModoDuo = () => {
    if (!modoDuo && participantes.length < 2) {
      toast("Necesitás al menos 2 participantes para el modo dúo", { type: 'error' });
      return;
    }
    setModoDuo((prev) => !prev);
    setSelectedParticipantes([]);
  };

  const toggleSelectedParticipante = (p: string) => {
    setSelectedParticipantes((prev) => {
      if (prev.includes(p)) return prev.filter((x) => x !== p);
      const max = modoDuo ? 2 : 1;
      if (prev.length < max) return [...prev, p];
      // At capacity: drop the oldest pick to make room for the new one
      return [...prev.slice(1), p];
    });
  };

  const pedirSorteo = async () => {
    if (participantes.length === 0 || canciones.length === 0) return;
    if (modoDuo && participantes.length < 2) {
      toast("Necesitás al menos 2 participantes para el modo dúo", { type: 'error' });
      return;
    }

    setGirando(true);
    setSorteo(null);

    try {
      const res = await fetch("/api/sorteo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantes, canciones, modoDuo })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al sortear');
      }
      const data: SorteoResult = await res.json();

      // Simulate spinning time
      setTimeout(() => {
        setSorteo(data);
        setGirando(false);
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#FF3B81', '#00B7ED', '#9D4EDD']
        });

        // Show confirmation modal
        setShowWinnerModal(true);
      }, 3000);
    } catch (error) {
      setGirando(false);
      toast(error instanceof Error ? error.message : "Error al sortear", { type: 'error' });
    }
  };

  const marcarYaCantaron = (p: string[]) => {
    setParticipanteRows((prev) => prev.map((r) => (p.includes(r.nombre) ? { ...r, ya_canto: true } : r)));
    supabase.from('karaokey_participantes').update({ ya_canto: true }).in('nombre', p).then(({ error }) => {
      if (error) console.error('[KaraoKey] Failed to save ya_canto:', error);
    });
  };

  const startStage = (p: string[], c: Cancion, challenge?: string) => {
    setSorteo({
      participantes: p,
      cancion: c,
      desafio: challenge || "¡A darlo todo!",
      id: Date.now().toString()
    });
    marcarYaCantaron(p);
    confetti.reset();
    setView('player');
    setShowWinnerModal(false);
  };

  // "Solo Cantante" mode: no song, no escenario — just reveal who's up next.
  const revealCantante = (p: string[]) => {
    setSorteoCantante(p);
    marcarYaCantaron(p);
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#FF3B81', '#00B7ED', '#9D4EDD']
    });
    setView('cantante');
  };

  const pedirSorteoCantante = () => {
    if (participantes.length === 0) return;
    if (modoDuo && participantes.length < 2) {
      toast("Necesitás al menos 2 participantes para el modo dúo", { type: 'error' });
      return;
    }

    setGirando(true);
    setTimeout(() => {
      const shuffled = [...participantes].sort(() => Math.random() - 0.5);
      const elegidos = shuffled.slice(0, modoDuo ? 2 : 1);
      setGirando(false);
      revealCantante(elegidos);
    }, 3000);
  };

  // "Cola de Turnos" mode — a manually-ordered queue as an alternative to the
  // random draw above. Reuses startStage/revealCantante/marcarYaCantaron so
  // modoTurnos only decides *how* the next {participant, song} pair is picked;
  // modoSorteo still decides what happens once it is.
  const addTurno = async (nombre: string, cancion: Cancion) => {
    const trimmed = nombre.trim();
    if (!trimmed || !cancion.titulo.trim()) return;
    const { data, error } = await supabase
      .from('karaokey_cola_turnos')
      .insert({ nombre: trimmed, cancion_titulo: cancion.titulo, cancion_artista: cancion.artista ?? null })
      .select()
      .single();
    if (error || !data) {
      toast('No se pudo guardar el turno.', { type: 'error' });
      return;
    }
    setColaRows((prev) => [...prev, data]);
  };

  const removeTurno = (index: number) => {
    const removed = colaRows[index];
    setColaRows((prev) => prev.filter((_, i) => i !== index));
    supabase.from('karaokey_cola_turnos').delete().eq('id', removed.id).then(({ error }) => {
      if (error) toast('Error al eliminar de la base de datos.', { type: 'error' });
    });
    toast(`Turno de ${removed.nombre} eliminado`, {
      action: {
        label: 'Deshacer',
        onClick: async () => {
          const { data } = await supabase.from('karaokey_cola_turnos').insert(removed).select().single();
          if (data) setColaRows((prev) => { const copy = [...prev]; copy.splice(index, 0, data); return copy; });
        }
      }
    });
  };

  const limpiarCantados = async () => {
    setColaRows((prev) => prev.filter((r) => !r.ya_canto));
    const { error } = await supabase.from('karaokey_cola_turnos').delete().eq('ya_canto', true);
    if (error) toast('Error al limpiar en la base de datos.', { type: 'error' });
  };

  const vaciarCola = async () => {
    if (colaRows.length === 0) return;
    if (!window.confirm('¿Vaciar toda la cola de turnos?')) return;
    setColaRows([]);
    const { error } = await supabase.from('karaokey_cola_turnos').delete().not('id', 'is', null);
    if (error) toast('Error al vaciar en la base de datos.', { type: 'error' });
  };

  const siguienteTurno = () => {
    const pendientes = colaRows.filter((r) => !r.ya_canto);
    if (pendientes.length === 0) {
      toast('No hay nadie más en la cola', { type: 'error' });
      return;
    }
    const next = pendientes[0];
    setColaRows((prev) => prev.map((r) => (r.id === next.id ? { ...r, ya_canto: true } : r)));
    supabase.from('karaokey_cola_turnos').update({ ya_canto: true }).eq('id', next.id).then(({ error }) => {
      if (error) console.error('[KaraoKey] Failed to save turno ya_canto:', error);
    });

    if (modoSorteo === 'cantante') {
      revealCantante([next.nombre]);
    } else {
      startStage([next.nombre], { titulo: next.cancion_titulo, artista: next.cancion_artista ?? undefined });
    }
  };

  const handleManualStart = () => {
    const requeridos = modoDuo ? 2 : 1;
    if (selectedParticipantes.length < requeridos) {
      toast(modoDuo ? "¡Faltan elegir los 2 cantantes!" : "¡Falta elegir quién canta!", { type: 'error' });
      return;
    }
    if (modoSorteo === 'cantante') {
      revealCantante(selectedParticipantes);
      return;
    }
    if (!selectedCancion) {
      toast("¡Falta elegir qué canción cantar!", { type: 'error' });
      return;
    }
    startStage(selectedParticipantes, selectedCancion);
  };

  const addParticipante = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || participanteRows.some((r) => r.nombre === trimmed)) return;
    const { data, error } = await supabase.from('karaokey_participantes').insert({ nombre: trimmed }).select().single();
    if (error || !data) {
      toast('No se pudo guardar el participante.', { type: 'error' });
      return;
    }
    setParticipanteRows((prev) => [...prev, data]);
  };

  const removeParticipante = (index: number) => {
    const removed = participanteRows[index];
    setParticipanteRows((prev) => prev.filter((_, i) => i !== index));
    supabase.from('karaokey_participantes').delete().eq('id', removed.id).then(({ error }) => {
      if (error) toast('Error al eliminar de la base de datos.', { type: 'error' });
    });
    toast(`${removed.nombre} eliminado de participantes`, {
      action: {
        label: 'Deshacer',
        onClick: async () => {
          const { data } = await supabase.from('karaokey_participantes').insert(removed).select().single();
          if (data) setParticipanteRows((prev) => { const copy = [...prev]; copy.splice(index, 0, data); return copy; });
        }
      }
    });
  };

  const addCancionesBulk = async () => {
    const lineas = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lineas.length === 0) {
      toast("Pegá al menos una canción", { type: 'error' });
      return;
    }
    const nuevas = lineas.map(parseCancionLine);
    const { data, error } = await supabase
      .from('karaokey_canciones')
      .insert(nuevas.map((n) => ({ titulo: n.titulo, artista: n.artista ?? null })))
      .select();
    if (error || !data) {
      toast('No se pudieron guardar las canciones.', { type: 'error' });
      return;
    }
    setCancionRows((prev) => [...prev, ...data]);
    toast(`¡Se agregaron ${data.length} canciones!`, { type: 'success' });
    setBulkText("");
  };

  const removeCancion = (index: number) => {
    const removed = cancionRows[index];
    setCancionRows((prev) => prev.filter((_, i) => i !== index));
    supabase.from('karaokey_canciones').delete().eq('id', removed.id).then(({ error }) => {
      if (error) toast('Error al eliminar de la base de datos.', { type: 'error' });
    });
    toast(`"${removed.titulo}" eliminada`, {
      action: {
        label: 'Deshacer',
        onClick: async () => {
          const { data } = await supabase.from('karaokey_canciones').insert(removed).select().single();
          if (data) setCancionRows((prev) => { const copy = [...prev]; copy.splice(index, 0, data); return copy; });
        }
      }
    });
  };

  const [importingChannel, setImportingChannel] = useState(false);
  const [importingPlaylist, setImportingPlaylist] = useState(false);
  const [bulkText, setBulkText] = useState("");

  // Shared by both import flows below — insert into Supabase first, then mirror
  // into local state, so an import that fails to save doesn't show as added.
  const insertCanciones = async (newSongs: Cancion[]): Promise<CancionRow[] | null> => {
    const { data, error } = await supabase
      .from('karaokey_canciones')
      .insert(newSongs.map((s) => ({ titulo: s.titulo, artista: s.artista ?? null })))
      .select();
    if (error || !data) return null;
    setCancionRows((prev) => [...prev, ...data]);
    return data;
  };

  const importFromChannel = async (query: string) => {
    setImportingChannel(true);
    try {
      const res = await fetch(`/api/channel-videos?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.items?.length) {
        const newSongs: Cancion[] = data.items.map(parseKaraokeVideoTitle);
        const inserted = await insertCanciones(newSongs);
        if (!inserted) {
          toast('No se pudieron guardar las canciones.', { type: 'error' });
          return;
        }
        toast(`¡Se agregaron ${inserted.length} canciones!`, { type: 'success' });
        setShowSettings(false);
      } else {
        toast("No se encontraron videos o hubo un error.", { type: 'error' });
      }
    } catch (e) {
      toast("Error importando canciones.", { type: 'error' });
    } finally {
      setImportingChannel(false);
    }
  };

  const importFromPlaylist = async (url: string) => {
    setImportingPlaylist(true);
    try {
      const res = await fetch(`/api/playlist-videos?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al importar la playlist');
      }
      const newSongs: Cancion[] = data.items
        .filter((item: any) => !['Deleted video', 'Private video'].includes(item.snippet.title))
        .map(parseKaraokeVideoTitle);

      if (newSongs.length === 0) {
        toast("No se encontraron canciones válidas en esa playlist", { type: 'error' });
        return;
      }
      const inserted = await insertCanciones(newSongs);
      if (!inserted) {
        toast('No se pudieron guardar las canciones.', { type: 'error' });
        return;
      }
      toast(`¡Se agregaron ${inserted.length} canciones de la playlist!`, { type: 'success' });
      setShowSettings(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error importando la playlist.", { type: 'error' });
    } finally {
      setImportingPlaylist(false);
    }
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-white/60">
        <div className="w-10 h-10 border-4 border-white/20 border-t-neon-pink rounded-full animate-spin" />
        <p className="text-sm font-bold uppercase tracking-widest">Cargando...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-white/80 px-6 text-center">
        <p className="text-lg font-bold">No se pudo conectar con la base de datos</p>
        <p className="text-sm text-white/50 max-w-sm">Revisá tu conexión a internet y recargá la página.</p>
      </div>
    );
  }

  // Reached the app with a session but no Simple/Pro choice on record yet —
  // happens once, right after signup, for accounts that needed email
  // confirmation (so registro.tsx had no session yet to attach a modo to).
  // Blocking: the rest of the app reads `modo` to decide what to render.
  if (modo === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12">
        <div className="max-w-sm w-full">
          <ModoPicker onPick={setModo} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12 px-4 md:px-6 text-white font-sans overflow-x-hidden relative">
      <Head>
        <title>KaraoKey | Diversión de Alto Voltaje</title>
        <meta name="description" content="El sorteador de karaoke más premium para tus fiestas." />
      </Head>

      {/* Top toolbar — in-flow (sticky, not fixed) so these controls reserve real
          layout space and can never overlap page content at narrow/short
          viewports. They used to be independently `fixed` at hardcoded pixel
          offsets, which visibly overlapped the KARAOKEY title on mobile. */}
      <div className="sticky top-0 z-50 flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOpcionesSorteo(true)}
            className="p-3 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-colors backdrop-blur-md"
            title="Opciones de Sorteo"
          >
            <Settings2 size={20} className="text-white/60" />
          </button>

          {/* Mezclador DJ — standalone dual-deck player, Pro only */}
          {modo === 'pro' && (
            <button
              onClick={() => setView('dj')}
              className="p-3 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-colors backdrop-blur-md"
              title="Mezclador DJ"
            >
              <Disc3 size={20} className="text-white/60" />
            </button>
          )}

          {/* Switching modo used to live only inside Configuración — easy to miss,
              and not reachable at all once you're deep in a screen like the player.
              This is always in the toolbar (sticky, visible on every screen) so it's
              a one-tap jump in either direction. */}
          <button
            onClick={() => {
              const next = modo === 'simple' ? 'pro' : 'simple';
              setModo(next);
              if (next === 'simple' && view === 'dj') setView('setup');
              toast(
                next === 'pro' ? '¡Modo Pro activado! Ya podés mezclar con 2 decks.' : 'Modo Simple activado.',
                { type: 'success' }
              );
            }}
            className="flex items-center gap-1.5 pl-3 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-colors backdrop-blur-md text-white/60 hover:text-white"
            title={modo === 'simple' ? 'Cambiar a Modo Pro' : 'Cambiar a Modo Simple'}
          >
            {modo === 'simple' ? <Disc3 size={18} /> : <Mic2 size={18} />}
            <span className="text-[10px] font-bold uppercase tracking-widest">
              {modo === 'simple' ? 'Pro' : 'Simple'}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTutorial(true)}
            className="p-3 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-colors backdrop-blur-md"
            title="¿Cómo funciona?"
          >
            <HelpCircle size={20} className="text-white/60" />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-3 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-colors backdrop-blur-md"
            title="Configuración / Importar"
          >
            <Users size={20} className="text-white/60" />
          </button>
        </div>
      </div>

      {(showTutorial || !onboardingDone) && (
        <TutorialOverlay
          modo={modo}
          onFinish={() => {
            setShowTutorial(false);
            if (!onboardingDone) markOnboardingDone();
          }}
        />
      )}

      {/* Opciones de Sorteo Modal */}
      <AnimatePresence>
        {showOpcionesSorteo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
            onClick={() => setShowOpcionesSorteo(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#121212] border border-white/10 rounded-3xl p-6 max-w-lg w-full space-y-6"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-2xl font-bold text-white mb-4">Opciones de Sorteo</h3>

              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm text-white/60">Tipo de sorteo:</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setModoSorteo('completo')}
                      className={`p-4 rounded-xl border text-center transition-all ${modoSorteo === 'completo'
                        ? 'bg-neon-pink/20 border-neon-pink text-white shadow-[0_0_15px_rgba(255,59,129,0.3)]'
                        : 'bg-white/5 border-white/10 text-white/50 hover:border-white/20'
                        }`}
                    >
                      <Music size={20} className="mx-auto mb-2" />
                      <span className="text-xs font-bold uppercase tracking-widest">Cantante + Canción</span>
                    </button>
                    <button
                      onClick={() => setModoSorteo('cantante')}
                      className={`p-4 rounded-xl border text-center transition-all ${modoSorteo === 'cantante'
                        ? 'bg-neon-pink/20 border-neon-pink text-white shadow-[0_0_15px_rgba(255,59,129,0.3)]'
                        : 'bg-white/5 border-white/10 text-white/50 hover:border-white/20'
                        }`}
                    >
                      <Mic2 size={20} className="mx-auto mb-2" />
                      <span className="text-xs font-bold uppercase tracking-widest">Solo Cantante</span>
                    </button>
                  </div>
                  <p className="text-xs text-white/40">
                    {modoSorteo === 'completo'
                      ? 'Sortea quién canta y qué canción, y va al escenario con el reproductor.'
                      : 'Solo sortea quién canta — se muestra el nombre en pantalla, sin canción ni reproductor.'}
                  </p>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <button
                    onClick={toggleModoDuo}
                    className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border border-white/10 bg-white/5 hover:border-white/20 transition-all"
                  >
                    <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/70">
                      <Users2 size={16} /> Modo Dúo
                    </span>
                    <span className={`relative w-9 h-5 rounded-full transition-colors ${modoDuo ? 'bg-neon-blue' : 'bg-white/15'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${modoDuo ? 'translate-x-4' : ''}`} />
                    </span>
                  </button>
                  <p className="text-xs text-white/40 pt-2">
                    {modoDuo ? 'Sortea de a 2 personas por vez.' : 'Sortea de a 1 persona por vez.'}
                  </p>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <button
                    onClick={() => setModoTurnos((prev) => !prev)}
                    className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border border-white/10 bg-white/5 hover:border-white/20 transition-all"
                  >
                    <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/70">
                      <ListOrdered size={16} /> Cola de Turnos
                    </span>
                    <span className={`relative w-9 h-5 rounded-full transition-colors ${modoTurnos ? 'bg-neon-blue' : 'bg-white/15'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${modoTurnos ? 'translate-x-4' : ''}`} />
                    </span>
                  </button>
                  <p className="text-xs text-white/40 pt-2">
                    {modoTurnos ? 'Armá la cola vos mismo: nombre + canción, y andá pasando turnos.' : 'Sortea al azar entre todos los participantes.'}
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#121212] border border-white/10 rounded-3xl p-6 max-w-lg w-full space-y-6 max-h-[85vh] overflow-y-auto custom-scrollbar"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-2xl font-bold text-white mb-4">Configuración de Canciones</h3>

              <div className="space-y-4">
                <p className="text-sm text-white/60">Importar automáticamente desde canales de YouTube:</p>

                <div className="grid grid-cols-2 gap-3">
                  {['@Poroto', '@MKFolklore', '@MKCumbia', '@karaokesseba', '@KaraokeInstrumental'].map(channel => (
                    <button
                      key={channel}
                      onClick={() => importFromChannel(channel)}
                      disabled={importingChannel}
                      className="p-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-left flex items-center gap-2 truncate"
                    >
                      {importingChannel ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={14} />}
                      {channel}
                    </button>
                  ))}
                </div>

                <div className="pt-4 border-t border-white/10">
                  <p className="text-sm text-white/60 mb-2">O pega un link/handle personalizado:</p>
                  <FormInput
                    icon={<AtSign size={18} />}
                    placeholder="@MiCanalFavorito"
                    onSubmit={(val) => importFromChannel(val)}
                    color="blue"
                  />
                </div>

                <div className="pt-4 border-t border-white/10 space-y-2">
                  <p className="text-sm text-white/60">Importar una playlist completa de YouTube:</p>
                  <FormInput
                    icon={<ListMusic size={18} />}
                    placeholder="Link de la playlist de YouTube"
                    onSubmit={(val) => importFromPlaylist(val)}
                    color="blue"
                  />
                  {importingPlaylist && (
                    <p className="text-xs text-white/40 flex items-center gap-2 pt-1">
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                      Importando playlist...
                    </p>
                  )}
                </div>

                <div className="pt-4 border-t border-white/10 space-y-2">
                  <p className="text-sm text-white/60">O pegá una lista en bloque (una canción por línea, &quot;Título - Artista&quot;):</p>
                  <textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={"De música ligera - Soda Stereo\nColor Esperanza - Diego Torres"}
                    rows={4}
                    className="w-full rounded-xl p-3 bg-white/5 border border-white/10 outline-hidden focus:border-white/20 transition-all text-sm text-white placeholder:text-white/20 font-sans resize-none"
                  />
                  <button
                    onClick={addCancionesBulk}
                    disabled={!bulkText.trim()}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-neon-blue/10 hover:bg-neon-blue/20 disabled:opacity-40 disabled:cursor-not-allowed border border-neon-blue/20 rounded-xl text-xs font-bold uppercase tracking-wider text-neon-blue transition-colors"
                  >
                    <ListPlus size={14} /> Agregar Todas
                  </button>
                </div>

                {yaCantaron.length > 0 && (
                  <div className="pt-4 border-t border-white/10">
                    <button
                      onClick={async () => {
                        setParticipanteRows((prev) => prev.map((r) => ({ ...r, ya_canto: false })));
                        const { error } = await supabase.from('karaokey_participantes').update({ ya_canto: false }).eq('ya_canto', true);
                        if (error) toast('Error al reiniciar en la base de datos.', { type: 'error' });
                        else toast("Se reinició quién ya cantó", { type: 'success' });
                      }}
                      className="w-full flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-white/70"
                    >
                      <RotateCcw size={14} /> Reiniciar quién ya cantó ({yaCantaron.length})
                    </button>
                  </div>
                )}

                <div className="pt-4 border-t border-white/10 space-y-3">
                  <p className="text-sm text-white/60">Tu cuenta: <span className="text-white/90">{user?.email}</span></p>

                  <div className="flex items-center gap-2 p-1 bg-white/5 border border-white/10 rounded-xl">
                    <button
                      onClick={() => setModo('simple')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${modo === 'simple' ? 'bg-neon-blue/20 text-white' : 'text-white/40 hover:text-white/70'}`}
                    >
                      Simple
                    </button>
                    <button
                      onClick={() => setModo('pro')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${modo === 'pro' ? 'bg-neon-pink/20 text-white' : 'text-white/40 hover:text-white/70'}`}
                    >
                      Pro
                    </button>
                  </div>

                  <button
                    onClick={() => signOut()}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 rounded-xl text-xs font-bold uppercase tracking-wider text-white/70 hover:text-red-400 transition-colors"
                  >
                    <LogOut size={14} /> Cerrar sesión
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {view === 'setup' ? (
          <motion.main
            key="setup"
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            className="max-w-6xl mx-auto space-y-12"
          >
            <header className="text-center space-y-4">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="inline-block"
              >
                <h1 className="text-6xl md:text-8xl font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-r from-[#FF3B81] via-[#9D4EDD] to-[#00B7ED] animate-gradient">
                  KARAOKEY
                </h1>
              </motion.div>
              <p className="text-white/60 text-lg md:text-xl font-medium">
                ¿Quién canta ahora? ¡Que la suerte decida!
              </p>

              <button
                onClick={() => setShowOpcionesSorteo(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 hover:border-white/20 transition-all text-white/50 hover:text-white/80"
                title="Opciones de Sorteo"
              >
                <Settings2 size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">
                  {modoSorteo === 'completo' ? 'Cantante + Canción' : 'Solo Cantante'} · {modoDuo ? 'Dúo' : 'Solo'}
                </span>
              </button>
            </header>

            <div className="grid lg:grid-cols-3 gap-8">
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="text-neon-pink w-5 h-5" />
                  <h2 className="text-xl font-bold uppercase tracking-wider text-neon-pink">Participantes</h2>
                </div>
                <div className="glass-card rounded-2xl p-4 min-h-[400px] flex flex-col border border-white/5 bg-white/5 backdrop-blur-md">
                  <div className="flex-1 space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    <AnimatePresence initial={false}>
                      {participantes.map((p, i) => (
                        <motion.div
                          key={`${p}-${i}`}
                          onClick={() => toggleSelectedParticipante(p)}
                          initial={{ x: -20, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          exit={{ x: 20, opacity: 0 }}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${selectedParticipantes.includes(p)
                            ? 'bg-neon-pink/20 border-neon-pink shadow-[0_0_15px_rgba(255,59,129,0.3)]'
                            : 'bg-white/5 border-white/5 hover:border-white/10'
                            }`}
                        >
                          <span className="font-medium flex items-center gap-2">
                            {p}
                            {yaCantaron.includes(p) && (
                              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" aria-label="Ya cantó" />
                            )}
                          </span>
                          <button onClick={(e) => { e.stopPropagation(); removeParticipante(i); }} className="text-white/20 hover:text-red-400 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {participantes.length === 0 && (
                      <div className="h-full flex items-center justify-center opacity-40 italic text-sm">No hay nadie... todavía</div>
                    )}
                  </div>
                  <FormInput icon={<Plus size={18} />} placeholder="Nombre del cantante..." onSubmit={addParticipante} color="pink" />
                </div>
              </div>

              <div className="space-y-4 flex flex-col justify-center relative">
                {modoTurnos ? (
                  <ColaTurnosPanel
                    colaRows={colaRows}
                    canciones={canciones}
                    onAdd={addTurno}
                    onRemove={removeTurno}
                    onSiguienteTurno={siguienteTurno}
                    onLimpiarCantados={limpiarCantados}
                    onVaciarCola={vaciarCola}
                  />
                ) : (
                  <>
                    <div className="glass-card rounded-3xl p-8 neon-border relative overflow-hidden bg-white/5 backdrop-blur-md border border-white/10">
                      <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                        <Mic2 size={120} />
                      </div>

                      <div className="relative z-10 space-y-8">
                        <div className="space-y-6">
                          <div className="space-y-2">
                            <label className="text-xs uppercase tracking-widest opacity-50 font-bold">{modoDuo ? 'Cantantes' : 'Cantante'}</label>
                            <SlotMachine items={participantes} isSpinning={girando} result={sorteo?.participantes.join(' & ') || null} color="330 100% 60%" />
                          </div>

                          {modoSorteo === 'completo' && (
                            <div className="space-y-2">
                              <label className="text-xs uppercase tracking-widest opacity-50 font-bold">Canción</label>
                              <SlotMachine items={canciones.map(c => c.titulo)} isSpinning={girando} result={sorteo?.cancion.titulo || null} color="195 100% 45%" />
                            </div>
                          )}
                        </div>

                        <div className="h-24 flex flex-col justify-center">
                          <AnimatePresence mode="wait">
                            {modoSorteo === 'completo' && sorteo && !girando ? (
                              <motion.div
                                key="result"
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="bg-white/5 p-4 rounded-2xl border border-white/10 text-center space-y-2"
                              >
                                <div className="inline-flex items-center gap-2 text-yellow-400 font-bold uppercase text-[10px] tracking-widest">
                                  <Trophy size={12} /> Desafío Especial
                                </div>
                                <p className="text-md font-medium italic">&ldquo;{sorteo.desafio}&rdquo;</p>
                              </motion.div>
                            ) : (
                              <motion.div
                                key="placeholder"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-center text-white/20 text-sm italic"
                              >
                                {girando
                                  ? (modoSorteo === 'completo' ? "Buscando el hit perfecto..." : "Eligiendo quién sigue...")
                                  : "¡Dale play al sorteo!"}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        <button
                          onClick={() => modoSorteo === 'completo' ? pedirSorteo() : pedirSorteoCantante()}
                          disabled={girando || participantes.length === 0 || (modoSorteo === 'completo' && canciones.length === 0)}
                          className="w-full py-4 rounded-2xl bg-linear-to-r from-[#FF3B81] to-[#9D4EDD] font-bold text-lg uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-3 shadow-xl text-white"
                        >
                          {girando ? (
                            <>
                              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              MEZCLANDO...
                            </>
                          ) : (
                            <>
                              <Play fill="currentColor" size={20} /> SORTEAR AHORA
                            </>
                          )}
                        </button>

                        {/* Manual alternative — an in-flow secondary action right under the
                            automatic one, not an absolutely-positioned overlay (that used to
                            float above this card at a fixed offset and would end up stuck
                            behind/between sections whenever the grid stacked to one column on
                            narrower screens). Selecting a participant (left column) and, in
                            modoSorteo "completo", a song (right column) enables it. */}
                        <div className="flex items-center gap-3 text-white/20">
                          <div className="flex-1 h-px bg-white/10" />
                          <span className="text-[10px] font-bold uppercase tracking-widest">o elegí manualmente</span>
                          <div className="flex-1 h-px bg-white/10" />
                        </div>

                        <button
                          onClick={handleManualStart}
                          disabled={selectedParticipantes.length !== (modoDuo ? 2 : 1) || (modoSorteo === 'completo' && !selectedCancion)}
                          className={`w-full py-3 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 border ${selectedParticipantes.length === (modoDuo ? 2 : 1) && (modoSorteo === 'cantante' || selectedCancion)
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 hover:scale-[1.01] active:scale-[0.99] cursor-pointer'
                            : 'bg-white/5 border-white/5 text-white/30 cursor-not-allowed'
                            }`}
                        >
                          <MousePointerClick size={16} />
                          {modoSorteo === 'completo' ? 'Ir al Escenario (Manual)' : 'Mostrar Cantante (Manual)'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Music className="text-neon-blue w-5 h-5" />
                  <h2 className="text-xl font-bold uppercase tracking-wider text-neon-blue">Cancionero</h2>
                </div>
                <div className="glass-card rounded-2xl p-4 min-h-[400px] flex flex-col border border-white/5 bg-white/5 backdrop-blur-md">
                  <div className="flex-1 space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    <AnimatePresence initial={false}>
                      {canciones
                        .map((c, i) => ({ c, i }))
                        .filter(({ c }) => {
                          const q = cancionQuery.trim().toLowerCase();
                          if (!q) return true;
                          return c.titulo.toLowerCase().includes(q) || (c.artista ?? "").toLowerCase().includes(q);
                        })
                        .map(({ c, i }) => (
                          <motion.div
                            key={`${c.titulo}-${i}`}
                            onClick={() => setSelectedCancion(selectedCancion === c ? null : c)}
                            initial={{ x: 20, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -20, opacity: 0 }}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${selectedCancion === c
                              ? 'bg-neon-blue/20 border-neon-blue shadow-[0_0_15px_rgba(0,183,237,0.3)]'
                              : 'bg-white/5 border-white/5 hover:border-white/10'
                              }`}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium text-sm leading-tight">{c.titulo}</span>
                              <span className="text-[10px] opacity-50 uppercase tracking-tighter">{c.artista || "Desconocido"}</span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); removeCancion(i); }} className="text-white/20 hover:text-red-400 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </motion.div>
                        ))}
                    </AnimatePresence>
                    {canciones.length === 0 && (
                      <div className="h-full flex items-center justify-center opacity-40 italic text-sm">Agregá tus hits favoritos</div>
                    )}
                    {canciones.length > 0 && cancionQuery.trim() && !canciones.some((c) => c.titulo.toLowerCase().includes(cancionQuery.trim().toLowerCase()) || (c.artista ?? "").toLowerCase().includes(cancionQuery.trim().toLowerCase())) && (
                      <div className="py-6 text-center opacity-40 italic text-sm">Ninguna coincide con &quot;{cancionQuery}&quot;</div>
                    )}
                  </div>

                  {/* This used to be an "add one song by typing Título - Artista" input that
                      silently inserted whatever you typed — easy to mistake for a search box,
                      since that's exactly what it looked like. It's a real live search/filter
                      now; actually adding songs (one-by-one, bulk paste, or importing a whole
                      channel/playlist) lives in Configuración, one tap away below. */}
                  <div className="relative mt-2">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                    <input
                      type="text"
                      value={cancionQuery}
                      onChange={(e) => setCancionQuery(e.target.value)}
                      placeholder="Buscar en tu cancionero..."
                      className="w-full rounded-xl pl-9 pr-4 py-3 bg-white/5 border border-white/10 outline-hidden focus:border-white/20 transition-all text-sm text-white placeholder:text-white/20 font-sans"
                    />
                  </div>
                  <button
                    onClick={() => setShowSettings(true)}
                    className="mt-2 w-full flex items-center justify-center gap-2 p-3 bg-neon-blue/10 hover:bg-neon-blue/20 border border-neon-blue/20 rounded-xl text-xs font-bold uppercase tracking-wider text-neon-blue transition-colors cursor-pointer"
                  >
                    <ListPlus size={14} /> Sumar Canciones
                  </button>
                </div>
              </div>
            </div>

            {/* Winner Confirmaton Modal */}
            <AnimatePresence>
              {showWinnerModal && sorteo && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
                >
                  <motion.div
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="bg-[#1a1a1a] border border-white/10 rounded-3xl p-8 max-w-md w-full text-center space-y-6 relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-linear-to-br from-[#FF3B81]/10 to-[#00B7ED]/10" />

                    <div className="relative z-10 space-y-4">
                      <h3 className="text-3xl font-black italic uppercase text-white">¡Sorteo Listo!</h3>

                      <div className="space-y-2 py-4">
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                          <p className="text-xs uppercase tracking-widest opacity-50">{sorteo.participantes.length > 1 ? 'Cantantes' : 'Cantante'}</p>
                          <p className="text-2xl font-bold text-neon-pink">{sorteo.participantes.join(' & ')}</p>
                        </div>
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                          <p className="text-xs uppercase tracking-widest opacity-50">Tema</p>
                          <p className="text-xl font-bold text-neon-blue">{sorteo.cancion.titulo}</p>
                          <p className="text-xs opacity-50">{sorteo.cancion.artista}</p>
                        </div>
                        <div className="text-yellow-400 text-sm font-bold flex items-center justify-center gap-2">
                          <Trophy size={14} /> {sorteo.desafio}
                        </div>
                      </div>

                      <button
                        onClick={() => startStage(sorteo.participantes, sorteo.cancion, sorteo.desafio)}
                        className="w-full py-4 rounded-xl bg-white text-black font-black uppercase tracking-widest hover:scale-105 transition-transform"
                      >
                        ¡Al Escenario!
                      </button>
                      <button
                        onClick={() => setShowWinnerModal(false)}
                        className="text-white/50 text-sm hover:text-white transition-colors"
                      >
                        Cancelar / Sortear de nuevo
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <footer className="pt-12 flex flex-col items-center gap-4 text-white/40">
              <div className="flex items-center gap-6">
                <a href="https://github.com/leandrofierro" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors" aria-label="GitHub">
                  <GithubIcon size={20} />
                </a>
              </div>
              <p className="text-xs uppercase tracking-widest font-bold">
                Hecho con pasión por Karaokey Team
              </p>
            </footer>
          </motion.main>
        ) : view === 'cantante' ? (
          <motion.div
            key="cantante"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-screen flex flex-col items-center justify-center gap-10 text-center px-4"
          >
            <Mic2 size={72} className="text-neon-pink drop-shadow-lg" />
            <div className="space-y-3">
              <p className="text-white/50 uppercase tracking-widest text-sm font-bold">
                {sorteoCantante && sorteoCantante.length > 1 ? '¡Les toca cantar a!' : '¡Le toca cantar a!'}
              </p>
              <h1 className="text-6xl md:text-8xl font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-r from-[#FF3B81] via-[#9D4EDD] to-[#00B7ED]">
                {sorteoCantante?.join(' & ')}
              </h1>
            </div>
            <div className="flex flex-wrap gap-4 justify-center pt-8">
              <button
                onClick={() => setView('setup')}
                className="px-6 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2 font-bold uppercase tracking-widest text-sm cursor-pointer group"
              >
                <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" /> Menú Principal
              </button>
              <button
                onClick={() => modoTurnos ? siguienteTurno() : pedirSorteoCantante()}
                disabled={girando}
                className="px-8 py-3 rounded-2xl bg-linear-to-r from-[#FF3B81] to-[#9D4EDD] hover:scale-105 active:scale-95 transition-all flex items-center gap-2 font-bold uppercase tracking-widest text-sm cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={18} className={girando ? "animate-spin" : "animate-[spin_4s_linear_infinite]"} /> {modoTurnos ? 'Siguiente Turno' : 'Siguiente Sorteo'}
              </button>
            </div>
          </motion.div>
        ) : view === 'player' ? (
          <KaraokePlayer
            key={sorteo!.id}
            song={sorteo!.cancion}
            challenge={sorteo!.desafio}
            onBack={() => setView('setup')}
            onNext={() => {
              setView('setup');
              setTimeout(() => modoTurnos ? siguienteTurno() : pedirSorteo(), 500);
            }}
            simple={modo === 'simple'}
          />
        ) : (
          // Modo DJ — standalone Karaokey Pro player, no sorteo dependency: both
          // decks start empty, loaded from Mi Cancionero / YouTube / Mi Biblioteca.
          // (Only reachable when modo === 'pro' — the toolbar button is hidden
          // otherwise — so no `simple` prop needed here.)
          <KaraokePlayer
            key="dj-mixer"
            onBack={() => setView('setup')}
            cancionero={canciones}
          />
        )}
      </AnimatePresence>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .animate-gradient {
          background-size: 200% auto;
          animation: shine 3s linear infinite;
        }
        @keyframes shine {
          to { background-position: 200% center; }
        }
      `}</style>
    </div>
  );
}

interface ColaTurnosPanelProps {
  colaRows: ColaTurnoRow[];
  canciones: Cancion[];
  onAdd: (nombre: string, cancion: Cancion) => void;
  onRemove: (index: number) => void;
  onSiguienteTurno: () => void;
  onLimpiarCantados: () => void;
  onVaciarCola: () => void;
}

// Manual, ordered alternative to the random draw — toggled via the "Cola de
// Turnos" switch in Opciones de Sorteo. See siguienteTurno() for how a turn
// reuses the existing startStage/revealCantante flow.
function ColaTurnosPanel({ colaRows, canciones, onAdd, onRemove, onSiguienteTurno, onLimpiarCantados, onVaciarCola }: ColaTurnosPanelProps) {
  const [nombre, setNombre] = useState("");
  const [cancionTitulo, setCancionTitulo] = useState("");
  const pendientes = colaRows.filter((r) => !r.ya_canto);
  const cantados = colaRows.filter((r) => r.ya_canto).length;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const cancion = canciones.find((c) => c.titulo === cancionTitulo);
    if (!nombre.trim() || !cancion) return;
    onAdd(nombre, cancion);
    setNombre("");
    setCancionTitulo("");
  };

  return (
    <div className="glass-card rounded-3xl p-6 neon-border relative overflow-hidden bg-white/5 backdrop-blur-md border border-white/10 space-y-4">
      <div className="flex items-center gap-2">
        <ListOrdered className="text-neon-blue w-5 h-5" />
        <h2 className="text-xl font-bold uppercase tracking-wider text-neon-blue">Cola de Turnos</h2>
      </div>

      <form onSubmit={handleAdd} className="space-y-2">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del cantante..."
          className="w-full rounded-xl px-4 py-3 bg-white/5 border border-white/10 outline-hidden focus:border-white/20 transition-all text-sm text-white placeholder:text-white/20 font-sans"
        />
        <select
          value={cancionTitulo}
          onChange={(e) => setCancionTitulo(e.target.value)}
          className="w-full rounded-xl px-4 py-3 bg-white/5 border border-white/10 outline-hidden focus:border-white/20 transition-all text-sm text-white font-sans"
        >
          <option value="" className="bg-[#121212]">Elegir canción del cancionero...</option>
          {canciones.map((c, i) => (
            <option key={`${c.titulo}-${i}`} value={c.titulo} className="bg-[#121212]">
              {c.titulo} — {c.artista || "Desconocido"}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!nombre.trim() || !cancionTitulo}
          className="w-full flex items-center justify-center gap-2 p-3 bg-neon-blue/10 hover:bg-neon-blue/20 disabled:opacity-40 disabled:cursor-not-allowed border border-neon-blue/20 rounded-xl text-xs font-bold uppercase tracking-wider text-neon-blue transition-colors"
        >
          <Plus size={14} /> Agregar a la Cola
        </button>
      </form>

      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
        <AnimatePresence initial={false}>
          {colaRows.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -20, opacity: 0 }}
              className={`flex items-center justify-between p-3 rounded-xl border transition-all ${r.ya_canto ? 'bg-white/5 border-white/5 opacity-40' : 'bg-neon-blue/10 border-neon-blue/20'}`}
            >
              <div className="flex flex-col">
                <span className="font-medium text-sm flex items-center gap-2">
                  {r.nombre}
                  {r.ya_canto && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" aria-label="Ya cantó" />}
                </span>
                <span className="text-[10px] opacity-50 uppercase tracking-tighter">
                  {r.cancion_titulo}{r.cancion_artista ? ` — ${r.cancion_artista}` : ''}
                </span>
              </div>
              <button onClick={() => onRemove(i)} className="text-white/20 hover:text-red-400 transition-colors">
                <Trash2 size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {colaRows.length === 0 && (
          <div className="py-6 text-center opacity-40 italic text-sm">Nadie en la cola todavía</div>
        )}
      </div>

      <button
        onClick={onSiguienteTurno}
        disabled={pendientes.length === 0}
        className="w-full py-4 rounded-2xl bg-linear-to-r from-[#FF3B81] to-[#9D4EDD] font-bold text-lg uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-3 shadow-xl text-white"
      >
        <SkipForward size={20} /> Siguiente Turno
      </button>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onLimpiarCantados}
          disabled={cantados === 0}
          className="flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-white/70"
        >
          <Eraser size={14} /> Limpiar Cantados
        </button>
        <button
          onClick={onVaciarCola}
          disabled={colaRows.length === 0}
          className="flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-white/70"
        >
          <Trash2 size={14} /> Vaciar Cola
        </button>
      </div>
    </div>
  );
}

interface FormInputProps {
  icon: React.ReactNode;
  placeholder: string;
  onSubmit: (v: string) => void;
  color: 'pink' | 'blue';
}

function FormInput({ icon, placeholder, onSubmit, color }: FormInputProps) {
  const [v, setV] = useState("");
  const accentClass = color === 'pink' ? 'hover:bg-neon-pink hover:text-white border-neon-pink/20' : 'hover:bg-neon-blue hover:text-white border-neon-blue/20';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (v.trim()) {
      onSubmit(v);
      setV("");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-2 mt-4"
    >
      <div className="relative flex-1">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30 text-white">
          {icon}
        </div>
        <input
          value={v}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl pl-10 pr-4 py-3 bg-white/5 border border-white/10 outline-hidden focus:border-white/20 transition-all text-sm text-white placeholder:text-white/20 font-sans"
        />
      </div>
      <button
        type="submit"
        className={`px-4 rounded-xl bg-white/5 border transition-all font-bold text-xs uppercase tracking-tighter text-white ${accentClass}`}
      >
        OK
      </button>
    </form>
  );
}

function GithubIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.69.42.36.78 1.07.78 2.16 0 1.56-.01 2.82-.01 3.2 0 .3.2.66.79.55A10.52 10.52 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
    </svg>
  );
}
