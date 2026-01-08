import React, { useState, useEffect, useRef } from 'react';
import screenfull from 'screenfull';
import { Maximize2, Minimize2, ArrowLeft, RefreshCw, ListMusic, Trophy, Mic2, Music, Volume2, Settings2 } from 'lucide-react';
import { motion } from 'framer-motion';

// NATIVE YOUTUBE API IMPLEMENTATION (Dual Player)

interface KaraokePlayerProps {
    song: { titulo: string; artista?: string };
    challenge?: string;
    onBack: () => void;
    onNext: () => void;
}

interface VideoResult {
    id: string;
    title: string;
    thumbnail: string;
}

declare global {
    interface Window {
        onYouTubeIframeAPIReady: () => void;
        YT: any;
    }
}

export const KaraokePlayer: React.FC<KaraokePlayerProps> = ({ song, challenge, onBack, onNext }) => {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [karaokeVideoId, setKaraokeVideoId] = useState<string | null>(null);
    const [alternatives, setAlternatives] = useState<VideoResult[]>([]);
    const [originalVideoId, setOriginalVideoId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const playerContainerRef = useRef<HTMLDivElement>(null);
    const hasFetched = useRef(false);

    // Native Player References
    const masterPlayer = useRef<any>(null);
    const slavePlayer = useRef<any>(null);

    // 0 = Karaoke Only, 1 = Original Only (Crossfade)
    const [assistLevel, setAssistLevel] = useState(0);

    // Manual Sync Offset (in seconds) - shift the original track relative to karaoke
    const [syncOffset, setSyncOffset] = useState(0);

    // Load YouTube API just once
    useEffect(() => {
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
        }
    }, []);

    // Fetch Videos
    useEffect(() => {
        setKaraokeVideoId(null);
        setOriginalVideoId(null);
        setAlternatives([]);
        setLoading(true);
        setSyncOffset(0); // Reset sync on new song
        hasFetched.current = false;

        const fetchVideos = async () => {
            if (hasFetched.current) return;
            hasFetched.current = true;

            console.log('[KaraoKey] Fetching videos for:', song.titulo, song.artista);

            try {
                // 1. Karaoke Search
                const kQuery = `${song.titulo} ${song.artista || ''} karaoke`;
                console.log('[KaraoKey] Karaoke query:', kQuery);

                const kRes = await fetch(`/api/youtube?q=${encodeURIComponent(kQuery)}`);

                if (!kRes.ok) {
                    console.error('[KaraoKey] API Error:', kRes.status, kRes.statusText);
                    const errorText = await kRes.text();
                    console.error('[KaraoKey] Error details:', errorText);
                    throw new Error(`YouTube API failed: ${kRes.status}`);
                }

                const kData = await kRes.json();
                console.log('[KaraoKey] Karaoke results:', kData);

                if (kData.items && kData.items.length > 0) {
                    const results: VideoResult[] = kData.items.map((item: any) => ({
                        id: item.id.videoId,
                        title: item.snippet.title,
                        thumbnail: item.snippet.thumbnails.medium.url
                    }));
                    setAlternatives(results);
                    setKaraokeVideoId(results[0].id);
                    console.log('[KaraoKey] Karaoke video selected:', results[0].id);
                } else {
                    console.warn('[KaraoKey] No karaoke results found');
                }

                // 2. Original Search
                const oQuery = `${song.titulo} ${song.artista || ''} official video`;
                console.log('[KaraoKey] Original query:', oQuery);

                const oRes = await fetch(`/api/youtube?q=${encodeURIComponent(oQuery)}`);
                const oData = await oRes.json();
                console.log('[KaraoKey] Original results:', oData);

                if (oData.items && oData.items.length > 0) {
                    setOriginalVideoId(oData.items[0].id.videoId);
                    console.log('[KaraoKey] Original video selected:', oData.items[0].id.videoId);
                } else {
                    console.warn('[KaraoKey] No original results found');
                }

            } catch (error) {
                console.error("[KaraoKey] CRITICAL Error fetching videos:", error);
                alert('Error al buscar videos. Verifica la consola del navegador y la configuración de la YouTube API Key.');
            } finally {
                setLoading(false);
                console.log('[KaraoKey] Fetch completed. Loading:', false);
            }
        };

        if (song.titulo) {
            fetchVideos();
        }
    }, [song.titulo, song.artista]);

    // Initialize/Update MASTER Player (Karaoke)
    useEffect(() => {
        if (!karaokeVideoId) return;

        const initMaster = () => {
            if (masterPlayer.current) {
                try { masterPlayer.current.destroy(); } catch (e) { }
            }

            masterPlayer.current = new window.YT.Player('youtube-player-master', {
                height: '100%',
                width: '100%',
                videoId: karaokeVideoId,
                playerVars: {
                    'playsinline': 1,
                    'controls': 1, // Native controls
                    'rel': 0,
                    'origin': window.location.origin
                },
                events: {
                    'onReady': (event: any) => {
                        // Apply initial volume
                        const vol = Math.floor((1 - assistLevel) * 100);
                        event.target.setVolume(vol);
                    },
                    'onStateChange': (event: any) => {
                        // Use separate handler to access latest state/refs
                        handleMasterStateChange(event);
                    }
                }
            });
        };

        if (window.YT && window.YT.Player) {
            initMaster();
        } else {
            // Retry
            const interval = setInterval(() => {
                if (window.YT && window.YT.Player) {
                    clearInterval(interval);
                    initMaster();
                }
            }, 100);
        }
    }, [karaokeVideoId]);

    // Initialize/Update SLAVE Player (Original)
    useEffect(() => {
        if (!originalVideoId) return;

        const initSlave = () => {
            if (slavePlayer.current) {
                try { slavePlayer.current.destroy(); } catch (e) { }
            }

            slavePlayer.current = new window.YT.Player('youtube-player-slave', {
                height: '100%',
                width: '100%',
                videoId: originalVideoId,
                playerVars: {
                    'playsinline': 1,
                    'controls': 0,
                    'disablekb': 1,
                    'rel': 0,
                    'start': 0,
                    'origin': window.location.origin
                },
                events: {
                    'onReady': (event: any) => {
                        event.target.mute();
                        event.target.setVolume(0);
                    }
                }
            });
        };

        if (window.YT && window.YT.Player) {
            initSlave();
        } else {
            const interval = setInterval(() => {
                if (window.YT && window.YT.Player) {
                    clearInterval(interval);
                    initSlave();
                }
            }, 100);
        }
    }, [originalVideoId]);

    // Sync Logic Handler
    // We use a ref for syncOffset to ensure the callback always reads the latest value without re-binding
    const syncOffsetRef = useRef(syncOffset);
    useEffect(() => { syncOffsetRef.current = syncOffset; }, [syncOffset]);

    const handleMasterStateChange = (event: any) => {
        const state = event.data;
        const offset = syncOffsetRef.current; // Read latest offset

        // Playing
        if (state === 1) {
            if (slavePlayer.current && typeof slavePlayer.current.playVideo === 'function') {
                slavePlayer.current.playVideo();

                const masterTime = masterPlayer.current.getCurrentTime();
                const slaveTime = slavePlayer.current.getCurrentTime();

                // Target time allows negative offset (clamped to 0)
                const targetTime = Math.max(0, masterTime + offset);

                if (Math.abs(targetTime - slaveTime) > 0.3) {
                    slavePlayer.current.seekTo(targetTime, true);
                }
            }
        }

        // Paused/Ended
        if (state === 2 || state === 0) {
            if (slavePlayer.current && typeof slavePlayer.current.pauseVideo === 'function') {
                slavePlayer.current.pauseVideo();
            }
        }
    };

    // Resync on Offset Change while Playing
    useEffect(() => {
        if (masterPlayer.current && slavePlayer.current &&
            masterPlayer.current.getPlayerState && masterPlayer.current.getPlayerState() === 1) {

            const masterTime = masterPlayer.current.getCurrentTime();
            const targetTime = Math.max(0, masterTime + syncOffset); // Use state directly here as it's a dependency
            slavePlayer.current.seekTo(targetTime, true);
        }
    }, [syncOffset]);


    // Volume Crossfader Logic
    useEffect(() => {
        // Master Volume
        if (masterPlayer.current && typeof masterPlayer.current.setVolume === 'function') {
            const vol = Math.floor((1 - assistLevel) * 100);
            masterPlayer.current.setVolume(vol);
        }

        // Slave Volume & Unmute
        if (slavePlayer.current && typeof slavePlayer.current.setVolume === 'function') {
            const vol = Math.floor(assistLevel * 100);
            slavePlayer.current.setVolume(vol);

            // Unmute if volume > 0
            if (vol > 0) {
                if (typeof slavePlayer.current.isMuted === 'function' && slavePlayer.current.isMuted()) {
                    masterPlayer.current ? slavePlayer.current.unMute() : null;
                    slavePlayer.current.unMute();
                }
            }
        }
    }, [assistLevel]);

    const toggleFullscreen = () => {
        if (playerContainerRef.current && screenfull.isEnabled) {
            screenfull.toggle(playerContainerRef.current);
        }
    };

    useEffect(() => {
        const handler = () => {
            setIsFullscreen(screenfull.isFullscreen);
        };
        if (screenfull.isEnabled) {
            screenfull.on('change', handler);
        }
        return () => {
            if (screenfull.isEnabled) screenfull.off('change', handler);
        };
    }, []);

    const handleEnded = () => {
        if (screenfull.isFullscreen) screenfull.exit();
    };


    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8 space-y-8 relative z-[2000]"
        >
            <div className="text-center space-y-4 relative z-10 w-full max-w-4xl">
                <div className="space-y-1">
                    <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#FF3B81] to-[#00B7ED] uppercase italic drop-shadow-lg">
                        ¡A ESCENARIO!
                    </h2>
                    <p className="text-white font-bold text-xl tracking-widest text-shadow">
                        {song.titulo} <span className="opacity-50">—</span> {song.artista || "Desconocido"}
                    </p>
                </div>

                {challenge && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="inline-flex items-center gap-2 px-6 py-2 bg-yellow-400/20 border border-yellow-400/40 rounded-full text-yellow-300 text-sm font-bold uppercase tracking-wider backdrop-blur-sm"
                    >
                        <Trophy size={16} /> {challenge}
                    </motion.div>
                )}
            </div>

            <div className="w-full max-w-6xl grid lg:grid-cols-4 gap-8 items-start relative z-10">
                <div className="lg:col-span-3 space-y-6">
                    <div
                        ref={playerContainerRef}
                        className={`relative rounded-3xl overflow-hidden glass-card neon-border aspect-video group ${isFullscreen ? 'w-full h-full' : ''} shadow-2xl shadow-black/50`}
                    >
                        {karaokeVideoId ? (
                            <>
                                <div className="w-full h-full relative z-20 bg-black">
                                    {/* MASTER PLAYER (Karaoke) */}
                                    <div id="youtube-player-master" className="w-full h-full" />
                                </div>

                                {/* SLAVE PLAYER (Original Voice) - Hidden */}
                                <div style={{ width: 1, height: 1, opacity: 0, position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                                    <div id="youtube-player-slave" />
                                </div>
                            </>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-black/60 gap-4">
                                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-[#FF3B81] border-r-transparent"></div>
                                <p className="text-white font-bold tracking-widest animate-pulse">BUSCANDO PISTAS...</p>
                            </div>
                        )}

                        {!isFullscreen && (
                            <div
                                className="absolute bottom-4 right-4 z-50 pointer-events-auto"
                                onClick={(e) => { e.stopPropagation(); }}
                            >
                                <button
                                    onClick={toggleFullscreen}
                                    className="p-3 bg-black/60 backdrop-blur-md rounded-xl text-white opacity-50 group-hover:opacity-100 transition-opacity hover:scale-110 cursor-pointer"
                                    title="Pantalla Completa"
                                >
                                    <Maximize2 size={24} />
                                </button>
                            </div>
                        )}
                        {isFullscreen && (
                            <button
                                onClick={toggleFullscreen}
                                className="absolute top-4 right-4 p-3 bg-black/60 backdrop-blur-md rounded-xl text-white hover:scale-110 z-50 cursor-pointer"
                                title="Salir Pantalla Completa"
                            >
                                <Minimize2 size={24} />
                            </button>
                        )}
                    </div>

                    {/* DJ MIXER CONTROLS */}
                    <div className="space-y-4">
                        <div className="glass-card p-6 rounded-3xl border border-white/5 flex flex-col md:flex-row items-center gap-8 justify-between bg-black/40 backdrop-blur-xl">
                            <button
                                onClick={() => setAssistLevel(0)}
                                className={`flex items-center gap-3 text-sm font-bold uppercase tracking-widest transition-all cursor-pointer px-4 py-2 rounded-xl ${assistLevel === 0 ? "bg-[#FF3B81] text-white shadow-lg shadow-[#FF3B81]/30" : "text-white/50 hover:bg-white/10"}`}
                            >
                                <Mic2 size={18} />
                                <span>Solo Karaoke</span>
                            </button>

                            <div className="flex-1 w-full max-w-md flex flex-col items-center gap-3">
                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#00B7ED]">
                                    <Volume2 size={14} />
                                    <span>Mezclador Crossfader</span>
                                </div>
                                <div className="relative w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                                    <div
                                        className="absolute top-0 left-0 h-full bg-gradient-to-r from-[#FF3B81] to-[#00B7ED]"
                                        style={{ width: `${assistLevel * 100}%` }}
                                    />
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={assistLevel}
                                        onChange={(e) => setAssistLevel(parseFloat(e.target.value))}
                                        className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                </div>
                                <div className="flex justify-between w-full text-[10px] font-bold text-white/30 uppercase tracking-widest">
                                    <span>Pista</span>
                                    <span>Mezcla</span>
                                    <span>Voz Original</span>
                                </div>
                            </div>

                            <button
                                onClick={() => setAssistLevel(1)}
                                className={`flex items-center gap-3 text-sm font-bold uppercase tracking-widest transition-all cursor-pointer px-4 py-2 rounded-xl ${assistLevel === 1 ? "bg-[#00B7ED] text-white shadow-lg shadow-[#00B7ED]/30" : "text-white/50 hover:bg-white/10"}`}
                            >
                                <span>Solo Voz Original</span>
                                <Music size={18} />
                            </button>
                        </div>

                        {/* MANUAL SYNC CONTROLS */}
                        {originalVideoId && (
                            <div className="glass-card p-3 rounded-xl border border-white/5 flex flex-wrap items-center justify-center gap-4 bg-black/20 animate-in slide-in-from-top-2">
                                <span className="text-xs font-bold uppercase tracking-widest text-white/60 flex items-center gap-2">
                                    <Settings2 size={14} /> Ajuste de Sincronización:
                                    <span className="text-[#00B7ED] bg-white/5 px-2 py-0.5 rounded font-mono">{syncOffset > 0 ? '+' : ''}{syncOffset.toFixed(1)}s</span>
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setSyncOffset(prev => Math.round((prev - 0.5) * 10) / 10)}
                                        className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold hover:bg-white/20 transition-colors border border-white/5"
                                        title="Retrasar Voz 0.5s"
                                    >
                                        -0.5s
                                    </button>
                                    <button
                                        onClick={() => setSyncOffset(prev => Math.round((prev - 0.1) * 10) / 10)}
                                        className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold hover:bg-white/20 transition-colors border border-white/5"
                                        title="Retrasar Voz 0.1s"
                                    >
                                        -0.1s
                                    </button>
                                    <button
                                        onClick={() => setSyncOffset(0)}
                                        className="px-3 py-1 bg-white/5 rounded-lg text-xs text-white/40 font-bold hover:bg-white/10 transition-colors border border-white/5"
                                        title="Resetear Sincronización"
                                    >
                                        Reset
                                    </button>
                                    <button
                                        onClick={() => setSyncOffset(prev => Math.round((prev + 0.1) * 10) / 10)}
                                        className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold hover:bg-white/20 transition-colors border border-white/5"
                                        title="Adelantar Voz 0.1s"
                                    >
                                        +0.1s
                                    </button>
                                    <button
                                        onClick={() => setSyncOffset(prev => Math.round((prev + 0.5) * 10) / 10)}
                                        className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold hover:bg-white/20 transition-colors border border-white/5"
                                        title="Adelantar Voz 0.5s"
                                    >
                                        +0.5s
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-4 justify-center pt-4">
                        <button
                            onClick={onBack}
                            className="px-6 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2 font-bold uppercase tracking-widest text-sm cursor-pointer hover:shadow-lg hover:shadow-white/5 group"
                        >
                            <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" /> Menú Principal
                        </button>
                        <button
                            onClick={onNext}
                            className="px-8 py-3 rounded-2xl bg-gradient-to-r from-[#FF3B81] to-[#9D4EDD] hover:scale-105 active:scale-95 transition-all flex items-center gap-2 font-bold uppercase tracking-widest text-sm cursor-pointer"
                        >
                            <RefreshCw size={18} className="animate-[spin_4s_linear_infinite]" /> Siguiente Sorteo
                        </button>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-white/60 font-bold uppercase text-xs tracking-widest">
                        <ListMusic size={16} /> Opciones Sugeridas
                    </div>

                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                        {alternatives.map((video) => (
                            <button
                                key={video.id}
                                onClick={() => setKaraokeVideoId(video.id)}
                                className={`w-full group text-left space-y-2 p-3 rounded-2xl transition-all border cursor-pointer hover:shadow-lg ${karaokeVideoId === video.id
                                    ? 'bg-[#FF3B81]/10 border-[#FF3B81]/40 shadow-lg shadow-[#FF3B81]/10'
                                    : 'bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/10'
                                    }`}
                            >
                                <div className="relative aspect-video rounded-xl overflow-hidden pointer-events-none group-hover:scale-[1.02] transition-transform">
                                    <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" />
                                    {karaokeVideoId === video.id && (
                                        <div className="absolute top-2 right-2 bg-[#FF3B81] text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-lg">
                                            ACTUAL
                                        </div>
                                    )}
                                </div>
                                <div className="px-1 pointer-events-none">
                                    <p className={`text-xs font-bold line-clamp-2 ${karaokeVideoId === video.id ? 'text-white' : 'text-white/70'}`}>
                                        {video.title}
                                    </p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
