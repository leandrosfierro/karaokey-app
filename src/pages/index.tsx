import { useEffect, useState } from "react";
import Head from "next/head";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Music, Users, Play, Trophy, Mic2, Github } from "lucide-react";
import confetti from "canvas-confetti";
import { SlotMachine } from "../components/SlotMachine";
import { KaraokePlayer } from "../components/KaraokePlayer";

type Cancion = { titulo: string; artista?: string };

interface SorteoResult {
  participante: string;
  cancion: Cancion;
  desafio: string;
  id: string;
}

type ViewState = 'setup' | 'player';

export default function Home() {
  const [participantes, setParticipantes] = useState<string[]>([]);
  const [canciones, setCanciones] = useState<Cancion[]>([]);
  const [sorteo, setSorteo] = useState<SorteoResult | null>(null);
  const [girando, setGirando] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<ViewState>('setup');
  const [selectedParticipante, setSelectedParticipante] = useState<string | null>(null);
  const [selectedCancion, setSelectedCancion] = useState<Cancion | null>(null);
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Persistence
  useEffect(() => {
    const savedP = localStorage.getItem("karaokey-participantes");
    const savedC = localStorage.getItem("karaokey-canciones");
    if (savedP) setParticipantes(JSON.parse(savedP));
    else setParticipantes(["Lean", "Caro", "Mati", "Romi"]);

    if (savedC) setCanciones(JSON.parse(savedC));
    else setCanciones([
      { titulo: "De música ligera", artista: "Soda Stereo" },
      { titulo: "La gloria de Dios", artista: "Ricardo Montaner" },
      { titulo: "Color Esperanza", artista: "Diego Torres" },
      { titulo: "Soy Cordobés", artista: "La Mona" }
    ]);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("karaokey-participantes", JSON.stringify(participantes));
      localStorage.setItem("karaokey-canciones", JSON.stringify(canciones));
    }
  }, [participantes, canciones, mounted]);

  const pedirSorteo = async () => {
    if (participantes.length === 0 || canciones.length === 0) return;

    setGirando(true);
    setSorteo(null);

    try {
      const res = await fetch("/api/sorteo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantes, canciones })
      });
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
    }
  };

  const startStage = (p: string, c: Cancion, challenge?: string) => {
    setSorteo({
      participante: p,
      cancion: c,
      desafio: challenge || "¡A darlo todo!",
      id: Date.now().toString()
    });
    confetti.reset();
    setView('player');
    setShowWinnerModal(false);
  };

  const handleManualStart = () => {
    if (!selectedParticipante) {
      alert("¡Falta elegir quién canta!");
      return;
    }
    if (!selectedCancion) {
      alert("¡Falta elegir qué canción cantar!");
      return;
    }
    startStage(selectedParticipante, selectedCancion);
  };

  const addParticipante = (name: string) => {
    if (!name.trim()) return;
    setParticipantes((p: string[]) => Array.from(new Set([...p, name.trim()])));
  };

  const removeParticipante = (index: number) => {
    setParticipantes((p: string[]) => p.filter((_, i) => i !== index));
  };

  const addCancion = (v: string) => {
    if (!v.trim()) return;
    const [t, a] = v.split("-");
    setCanciones((c: Cancion[]) => [...c, { titulo: t.trim(), artista: a?.trim() }]);
  };

  const removeCancion = (index: number) => {
    setCanciones((c: Cancion[]) => c.filter((_, i) => i !== index));
  };

  const [importing, setImporting] = useState(false);

  // ... existing logic ...

  const importFromChannel = async (query: string) => {
    setImporting(true);
    try {
      const res = await fetch(`/api/channel-videos?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.items) {
        const newSongs: Cancion[] = data.items.map((item: any) => {
          // Simple cleanup of titles: "Artist - Song (Karaoke)" -> { titulo: "Song", artista: "Artist" }
          // This is a naive heuristic, can be improved.
          let fullTitle = item.snippet.title;
          // Remove common karaoke suffixes
          fullTitle = fullTitle.replace(/\(Karaoke Version\)/i, "").replace(/Karaoke/i, "").replace(/Lyrics/i, "").replace(/Letra/i, "").trim();

          const parts = fullTitle.split("-");
          if (parts.length >= 2) {
            return { titulo: parts[1].trim(), artista: parts[0].trim() };
          }
          return { titulo: fullTitle, artista: item.snippet.channelTitle };
        });

        setCanciones(prev => [...prev, ...newSongs]);
        alert(`¡Se agregaron ${newSongs.length} canciones exitosamente!`);
        setShowSettings(false);
      } else {
        alert("No se encontraron videos o hubo un error.");
      }
    } catch (e) {
      alert("Error importando canciones.");
    } finally {
      setImporting(false);
    }
  };

  if (!mounted) return null;

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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#121212] border border-white/10 rounded-3xl p-6 max-w-lg w-full space-y-6"
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
                      disabled={importing}
                      className="p-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-left flex items-center gap-2 truncate"
                    >
                      {importing ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={14} />}
                      {channel}
                    </button>
                  ))}
                </div>

                <div className="pt-4 border-t border-white/10">
                  <p className="text-sm text-white/60 mb-2">O pega un link/handle personalizado:</p>
                  <FormInput
                    icon={<Github size={18} />} // Placeholder icon
                    placeholder="@MiCanalFavorito"
                    onSubmit={(val) => importFromChannel(val)}
                    color="blue"
                  />
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
                <h1 className="text-6xl md:text-8xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-[#FF3B81] via-[#9D4EDD] to-[#00B7ED] animate-gradient">
                  KARAOKEY
                </h1>
              </motion.div>
              <p className="text-white/60 text-lg md:text-xl font-medium">
                ¿Quién canta ahora? ¡Que la suerte decida!
              </p>
            </header>

            <div className="grid lg:grid-cols-3 gap-8">
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="text-[#FF3B81] w-5 h-5" />
                  <h2 className="text-xl font-bold uppercase tracking-wider text-[#FF3B81]">Participantes</h2>
                </div>
                <div className="glass-card rounded-2xl p-4 min-h-[400px] flex flex-col border border-white/5 bg-white/5 backdrop-blur-md">
                  <div className="flex-1 space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    <AnimatePresence initial={false}>
                      {participantes.map((p, i) => (
                        <motion.div
                          key={`${p}-${i}`}
                          onClick={() => setSelectedParticipante(p === selectedParticipante ? null : p)}
                          initial={{ x: -20, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          exit={{ x: 20, opacity: 0 }}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${selectedParticipante === p
                            ? 'bg-[#FF3B81]/20 border-[#FF3B81] shadow-[0_0_15px_rgba(255,59,129,0.3)]'
                            : 'bg-white/5 border-white/5 hover:border-white/10'
                            }`}
                        >
                          <span className="font-medium">{p}</span>
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
                    className={`px-6 py-2 rounded-full font-bold text-sm uppercase tracking-widest transition-all ${selectedParticipante && selectedCancion
                      ? 'bg-green-500 text-white shadow-lg hover:scale-105'
                      : 'bg-white/5 text-white/30 cursor-not-allowed'
                      }`}
                    disabled={!selectedParticipante || !selectedCancion}
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
                        <label className="text-xs uppercase tracking-widest opacity-50 font-bold">Cantante</label>
                        <SlotMachine items={participantes} isSpinning={girando} result={sorteo?.participante || null} color="330 100% 60%" />
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
                            <p className="text-md font-medium italic">"{sorteo.desafio}"</p>
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
                      className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#FF3B81] to-[#9D4EDD] font-bold text-lg uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-3 shadow-xl text-white"
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
                  <Music className="text-[#00B7ED] w-5 h-5" />
                  <h2 className="text-xl font-bold uppercase tracking-wider text-[#00B7ED]">Cancionero</h2>
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
                            ? 'bg-[#00B7ED]/20 border-[#00B7ED] shadow-[0_0_15px_rgba(0,183,237,0.3)]'
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
                  className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                >
                  <motion.div
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="bg-[#1a1a1a] border border-white/10 rounded-3xl p-8 max-w-md w-full text-center space-y-6 relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-[#FF3B81]/10 to-[#00B7ED]/10" />

                    <div className="relative z-10 space-y-4">
                      <h3 className="text-3xl font-black italic uppercase text-white">¡Sorteo Listo!</h3>

                      <div className="space-y-2 py-4">
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                          <p className="text-xs uppercase tracking-widest opacity-50">Cantante</p>
                          <p className="text-2xl font-bold text-[#FF3B81]">{sorteo.participante}</p>
                        </div>
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                          <p className="text-xs uppercase tracking-widest opacity-50">Tema</p>
                          <p className="text-xl font-bold text-[#00B7ED]">{sorteo.cancion.titulo}</p>
                          <p className="text-xs opacity-50">{sorteo.cancion.artista}</p>
                        </div>
                        <div className="text-yellow-400 text-sm font-bold flex items-center justify-center gap-2">
                          <Trophy size={14} /> {sorteo.desafio}
                        </div>
                      </div>

                      <button
                        onClick={() => startStage(sorteo.participante, sorteo.cancion, sorteo.desafio)}
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
                <a href="https://github.com/leandrofierro" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                  <Github size={20} />
                </a>
              </div>
              <p className="text-xs uppercase tracking-widest font-bold">
                Hecho con pasión por Karaokey Team
              </p>
            </footer>
          </motion.main>
        ) : (
          <KaraokePlayer
            key="player"
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
  const accentClass = color === 'pink' ? 'hover:bg-[#FF3B81] hover:text-white border-[#FF3B81]/20' : 'hover:bg-[#00B7ED] hover:text-white border-[#00B7ED]/20';

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
          className="w-full rounded-xl pl-10 pr-4 py-3 bg-white/5 border border-white/10 outline-none focus:border-white/20 transition-all text-sm text-white placeholder:text-white/20 font-sans"
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
