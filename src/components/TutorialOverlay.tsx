import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Users2, ListMusic, Sparkles, Disc3, MonitorPlay, ArrowRight, X } from "lucide-react";
import type { Modo } from "../lib/auth";

interface TutorialStep {
    icon: React.ReactNode;
    title: string;
    body: string;
}

const BASE_STEPS: TutorialStep[] = [
    {
        icon: <Users2 size={28} className="text-neon-pink" />,
        title: "Sumá a los participantes",
        body: "En \"Participantes\" agregás a todos los que van a cantar. Quedan guardados en tu cuenta para la próxima.",
    },
    {
        icon: <ListMusic size={28} className="text-neon-blue" />,
        title: "Armá tu cancionero",
        body: "Con el ícono de Configuración pegás una lista de canciones, o importás un canal o playlist de YouTube entero.",
    },
    {
        icon: <Sparkles size={28} className="text-neon-pink" />,
        title: "Girá y a cantar",
        body: "Tocá el botón principal para sortear quién canta y qué canción. Desde \"Opciones de Sorteo\" podés usar Cola de Turnos o Modo Dúo.",
    },
];

const PRO_STEPS: TutorialStep[] = [
    {
        icon: <Disc3 size={28} className="text-neon-blue" />,
        title: "Mezclador DJ",
        body: "Con el ícono del disco abrís el mezclador: cargá cualquier tema en Deck A o Deck B y mezclalos con el crossfader.",
    },
    {
        icon: <MonitorPlay size={28} className="text-neon-pink" />,
        title: "Pantalla externa",
        body: "Desde el mezclador podés abrir una pantalla externa para el público: ve y escucha la mezcla en vivo, sin ningún control.",
    },
];

interface TutorialOverlayProps {
    modo: Modo | undefined;
    onFinish: () => void;
}

export function TutorialOverlay({ modo, onFinish }: TutorialOverlayProps) {
    const steps = modo === 'pro' ? [...BASE_STEPS, ...PRO_STEPS] : BASE_STEPS;
    const [i, setI] = useState(0);
    const step = steps[i];
    const isLast = i === steps.length - 1;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-9998 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
            >
                <motion.div
                    key={i}
                    initial={{ scale: 0.9, opacity: 0, y: 10 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    className="bg-[#121212] border border-white/10 rounded-3xl p-6 max-w-sm w-full space-y-5 relative"
                >
                    <button
                        onClick={onFinish}
                        className="absolute top-4 right-4 text-white/30 hover:text-white/70 transition-colors cursor-pointer"
                        title="Omitir tutorial"
                    >
                        <X size={18} />
                    </button>

                    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                        {step.icon}
                    </div>

                    <div className="space-y-2">
                        <h3 className="text-xl font-bold text-white">{step.title}</h3>
                        <p className="text-sm text-white/60 leading-relaxed">{step.body}</p>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-1.5">
                            {steps.map((_, idx) => (
                                <div
                                    key={idx}
                                    className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-6 bg-neon-pink' : 'w-1.5 bg-white/15'}`}
                                />
                            ))}
                        </div>

                        <div className="flex items-center gap-3">
                            {!isLast && (
                                <button
                                    onClick={onFinish}
                                    className="text-xs font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                                >
                                    Omitir
                                </button>
                            )}
                            <button
                                onClick={() => (isLast ? onFinish() : setI((prev) => prev + 1))}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-linear-to-r from-[#FF3B81] to-[#9D4EDD] font-bold uppercase tracking-widest text-xs hover:scale-105 active:scale-95 transition-all cursor-pointer"
                            >
                                {isLast ? 'Empezar' : 'Siguiente'} <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
