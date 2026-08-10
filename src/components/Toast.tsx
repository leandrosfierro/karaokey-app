import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, XCircle, Info, Undo2 } from 'lucide-react';

type ToastType = 'info' | 'success' | 'error';

interface ToastAction {
    label: string;
    onClick: () => void;
}

interface ToastOptions {
    type?: ToastType;
    duration?: number;
    action?: ToastAction;
}

interface ToastItem extends Required<Pick<ToastOptions, 'type' | 'duration'>> {
    id: number;
    message: string;
    action?: ToastAction;
}

type ToastFn = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

const ICONS: Record<ToastType, React.ReactNode> = {
    info: <Info size={18} className="text-[#00B7ED]" />,
    success: <CheckCircle2 size={18} className="text-emerald-400" />,
    error: <XCircle size={18} className="text-[#FF3B81]" />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(0);

    const dismiss = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const toast = useCallback<ToastFn>((message, options) => {
        const id = nextId.current++;
        const duration = options?.duration ?? (options?.action ? 5000 : 3500);
        setToasts((prev) => [...prev, { id, message, type: options?.type ?? 'info', duration, action: options?.action }]);
        setTimeout(() => dismiss(id), duration);
    }, [dismiss]);

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <div className="fixed bottom-4 inset-x-0 z-9999 flex flex-col items-center gap-2 px-4 pointer-events-none">
                <AnimatePresence>
                    {toasts.map((t) => (
                        <motion.div
                            key={t.id}
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="pointer-events-auto glass-card bg-[#161320]/95 border border-white/10 rounded-2xl px-4 py-3 shadow-2xl shadow-black/50 flex items-center gap-3 max-w-sm w-full"
                        >
                            {ICONS[t.type]}
                            <p className="text-sm text-white/90 flex-1">{t.message}</p>
                            {t.action && (
                                <button
                                    onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                                    className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#00B7ED] hover:text-white transition-colors shrink-0"
                                >
                                    <Undo2 size={14} /> {t.action.label}
                                </button>
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastFn {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within a ToastProvider');
    return ctx;
}
