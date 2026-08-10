import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SlotMachineProps {
    items: string[];
    isSpinning: boolean;
    result: string | null;
    color?: string;
}

export const SlotMachine: React.FC<SlotMachineProps> = ({ items, isSpinning, result, color = "var(--primary)" }) => {
    const [spinItem, setSpinItem] = useState<string | null>(null);

    useEffect(() => {
        if (!isSpinning || items.length === 0) return;
        const interval = setInterval(() => {
            setSpinItem(items[Math.floor(Math.random() * items.length)]);
        }, 100);
        return () => clearInterval(interval);
    }, [isSpinning, items]);

    const displayValue = isSpinning
        ? (spinItem ?? "...")
        : (result ?? items[0] ?? "...");

    return (
        <div className="relative h-20 overflow-hidden bg-black/40 rounded-xl border border-white/10 flex items-center justify-center">
            <AnimatePresence mode="popLayout">
                <motion.div
                    key={displayValue}
                    initial={{ y: 50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -50, opacity: 0 }}
                    transition={{ duration: 0.1, ease: "linear" }}
                    className="text-xl font-bold text-center px-4"
                    style={{ color: isSpinning ? '#fff' : color.startsWith('var') ? color : `hsl(${color})` }}
                >
                    {displayValue}
                </motion.div>
            </AnimatePresence>

            <div className="absolute inset-0 pointer-events-none bg-linear-to-b from-black via-transparent to-black opacity-50" />
        </div>
    );
};
