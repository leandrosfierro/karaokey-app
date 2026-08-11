import { useEffect, useState } from "react";
import Head from "next/head";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Music, Users, Play, Trophy, Mic2, AtSign, CheckCircle2, RotateCcw, Users2, ListMusic, ListPlus } from "lucide-react";
import confetti from "canvas-confetti";
import { SlotMachine } from "../components/SlotMachine";
import { KaraokePlayer } from "../components/KaraokePlayer";
import { useToast } from "../components/Toast";
import { supabase, isSupabaseConfigured, ParticipanteRow, CancionRow } from "../lib/supabase";

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

type ViewState = 'setup' | 'player';

export default function Home() {
  const toast = useToast();
  // Source of truth for participantes/canciones/ya-cantó is Supabase, not local
  // state — these rows are the durable record so the list survives clearing the
  // browser, switching devices, etc. Everything else (participantes, canciones,
  // yaCantaron) is derived from these on every render.
  const [participanteRows, setParticipanteRows] = useState<ParticipanteRow[]>([]);
  const [cancionRows, setCancionRows] = useState<CancionRow[]>([]);
  const participantes = participanteRows.map((r) => r.nombre);
  const canciones: Cancion[] = cancionRows.map((r) => ({ titulo: r.titulo, artista: r.artista ?? undefined }));
  const yaCantaron = participanteRows.filter((r) => r.ya_canto).map((r) => r.nombre);

  const [sorteo, setSorteo] = useState<SorteoResult | null>(null);
  const [girando, setGirando] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<ViewState>('setup');
  const [selectedParticipantes, setSelectedParticipantes] = useState<string[]>([]);
  const [selectedCancion, setSelectedCancion] = useState<Cancion | null>(null);
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [modoDuo, setModoDuo] = useState(false);

  // Load from Supabase and seed defaults on a brand-new, empty database.
  // modoDuo is just a session preference, not content worth a DB round-trip,
  // so it stays in localStorage.
  /* eslint-disable react-hooks/set-state-in-effect -- env var check is a static,
     one-time boot-time fact, not state derived from props/state each render */
  useEffect(() => {
    if (!isSupabaseConfigured) {
      console.error('[KaraoKey] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
      setLoadError(true);
      setMounted(true);
      return;
    }

    let cancelled = false;
    (async () => {
      const [{ data: pData, error: pErr }, { data: cData, error: cErr }] = await Promise.all([
        supabase.from('karaokey_participantes').select('*').order('created_at', { ascending: true }),
        supabase.from('karaokey_canciones').select('*').order('created_at', { ascending: true }),
      ]);

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
      setMounted(true);
    })();
    return () => { cancelled = true; };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("karaokey-modo-duo", JSON.stringify(modoDuo));
    }
  }, [modoDuo, mounted]);

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
        const audio = new Audio("https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg");
        audio.play().catch(() => { });

        // Show confirmation modal
        setShowWinnerModal(true);
      }, 3000);
    } catch (error) {
      setGirando(false);
      toast(error instanceof Error ? error.message : "Error al sortear", { type: 'error' });
    }
  };

  const startStage = (p: string[], c: Cancion, challenge?: string) => {
    setSorteo({
      participantes: p,
      cancion: c,
      desafio: challenge || "¡A darlo todo!",
      id: Date.now().toString()
    });
    setParticipanteRows((prev) => prev.map((r) => (p.includes(r.nombre) ? { ...r, ya_canto: true } : r)));
    supabase.from('karaokey_participantes').update({ ya_canto: true }).in('nombre', p).then(({ error }) => {
      if (error) console.error('[KaraoKey] Failed to save ya_canto:', error);
    });
    confetti.reset();
    setView('player');
    setShowWinnerModal(false);
  };

  const handleManualStart = () => {
    const requeridos = modoDuo ? 2 : 1;
    if (selectedParticipantes.length < requeridos) {
      toast(modoDuo ? "¡Faltan elegir los 2 cantantes!" : "¡Falta elegir quién canta!", { type: 'error' });
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

  const addCancion = async (v: string) => {
    if (!v.trim()) return;
    const parsed = parseCancionLine(v);
    const { data, error } = await supabase.from('karaokey_canciones').insert({ titulo: parsed.titulo, artista: parsed.artista ?? null }).select().single();
    if (error || !data) {
      toast('No se pudo guardar la canción.', { type: 'error' });
      return;
    }
    setCancionRows((prev) => [...prev, data]);
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

  return (
    <div className="min-h-screen py-12 px-4 md:px-6 text-white font-sans overflow-x-hidden relative">
      <Head>
        <title>KaraoKey | Diversión de Alto Voltaje</title>
        <meta name="description" content="El sorteador de karaoke más premium para tus fiestas." />
      </Head>

      {/* Settings Button */}
      <button
        onClick={() => setShowSettings(true)}
        className="fixed top-4 right-4 z-50 p-3 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-colors backdrop-blur-md"
        title="Configuración / Importar"
      >
        <Users size={20} className="text-white/60" />
      </button>

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
                onClick={toggleModoDuo}
                className={`inline-flex items-center gap-3 px-4 py-2 rounded-full border transition-all ${modoDuo
                  ? 'bg-neon-blue/20 border-neon-blue text-white shadow-[0_0_15px_rgba(0,183,237,0.3)]'
                  : 'bg-white/5 border-white/10 text-white/50 hover:border-white/20'
                  }`}
              >
                <Users2 size={16} />
                <span className="text-xs font-bold uppercase tracking-widest">Modo Dúo</span>
                <span className={`relative w-9 h-5 rounded-full transition-colors ${modoDuo ? 'bg-neon-blue' : 'bg-white/15'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${modoDuo ? 'translate-x-4' : ''}`} />
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
                {/* Manual Play Button Overlay */}
                <div className="absolute -top-12 w-full flex justify-center z-10">
                  <button
                    onClick={handleManualStart}
                    className={`px-6 py-2 rounded-full font-bold text-sm uppercase tracking-widest transition-all ${selectedParticipantes.length === (modoDuo ? 2 : 1) && selectedCancion
                      ? 'bg-green-500 text-white shadow-lg hover:scale-105'
                      : 'bg-white/5 text-white/30 cursor-not-allowed'
                      }`}
                    disabled={selectedParticipantes.length !== (modoDuo ? 2 : 1) || !selectedCancion}
                  >
                    Ir al Escenario (Manual)
                  </button>
                </div>

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

                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-widest opacity-50 font-bold">Canción</label>
                        <SlotMachine items={canciones.map(c => c.titulo)} isSpinning={girando} result={sorteo?.cancion.titulo || null} color="195 100% 45%" />
                      </div>
                    </div>

                    <div className="h-24 flex flex-col justify-center">
                      <AnimatePresence mode="wait">
                        {sorteo && !girando ? (
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
                            {girando ? "Buscando el hit perfecto..." : "¡Dale play al sorteo!"}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <button
                      onClick={pedirSorteo}
                      disabled={girando || participantes.length === 0 || canciones.length === 0}
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
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Music className="text-neon-blue w-5 h-5" />
                  <h2 className="text-xl font-bold uppercase tracking-wider text-neon-blue">Cancionero</h2>
                </div>
                <div className="glass-card rounded-2xl p-4 min-h-[400px] flex flex-col border border-white/5 bg-white/5 backdrop-blur-md">
                  <div className="flex-1 space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    <AnimatePresence initial={false}>
                      {canciones.map((c, i) => (
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
                  </div>
                  <FormInput icon={<Music size={18} />} placeholder="Título - Artista" onSubmit={addCancion} color="blue" />
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
        ) : (
          <KaraokePlayer
            key={sorteo!.id}
            song={sorteo!.cancion}
            challenge={sorteo!.desafio}
            onBack={() => setView('setup')}
            onNext={() => {
              setView('setup');
              setTimeout(() => pedirSorteo(), 500);
            }}
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
