import { Mic2, Disc3 } from "lucide-react";
import type { Modo } from "../lib/auth";

interface ModoPickerProps {
    onPick: (modo: Modo) => void;
    submitting?: boolean;
    title?: string;
    subtitle?: string;
}

// Shared "Simple vs Pro" picker UI — used both as registro.tsx's last signup
// step and as index.tsx's one-time gate for accounts that reach the app
// without ever having chosen (e.g. email-confirmation was required, so there
// was no session yet to attach a modo to at signup time).
export function ModoPicker({ onPick, submitting, title, subtitle }: ModoPickerProps) {
    return (
        <div className="space-y-4">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold">{title ?? '¿Cómo querés usar KaraoKey?'}</h2>
                <p className="text-sm text-white/50">{subtitle ?? 'Podés cambiarlo después desde Configuración'}</p>
            </div>

            <button
                onClick={() => onPick('simple')}
                disabled={submitting}
                className="w-full text-left glass-card rounded-3xl p-6 border border-white/5 hover:border-neon-blue/40 transition-all space-y-2 cursor-pointer disabled:opacity-50"
            >
                <div className="flex items-center gap-3">
                    <Mic2 className="text-neon-blue" size={24} />
                    <h3 className="text-lg font-bold uppercase tracking-wider">Simple</h3>
                </div>
                <p className="text-sm text-white/60">Un solo reproductor, fácil y directo. Ideal para arrancar rápido.</p>
            </button>

            <button
                onClick={() => onPick('pro')}
                disabled={submitting}
                className="w-full text-left glass-card rounded-3xl p-6 border border-white/5 hover:border-neon-pink/40 transition-all space-y-2 cursor-pointer disabled:opacity-50"
            >
                <div className="flex items-center gap-3">
                    <Disc3 className="text-neon-pink" size={24} />
                    <h3 className="text-lg font-bold uppercase tracking-wider">Pro</h3>
                </div>
                <p className="text-sm text-white/60">Mezclador con 2 decks, crossfader y pantalla externa para el público.</p>
            </button>

            {submitting && (
                <p className="text-center text-xs text-white/40 flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Guardando...
                </p>
            )}
        </div>
    );
}
