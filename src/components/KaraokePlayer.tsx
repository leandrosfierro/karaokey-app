import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import screenfull from 'screenfull';
import { Maximize2, Minimize2, ArrowLeft, RefreshCw, Trophy, Mic2, Music, Volume2, Settings2, Play, Pause, Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from './Toast';
import { supabase, LocalAudioRow } from '../lib/supabase';
import { DeckAdapter, LocalAudioDeckAdapter } from '../lib/deckAdapter';

const LOCAL_AUDIO_BUCKET = 'karaokey-audio';
const MAX_LOCAL_FILE_BYTES = 25 * 1024 * 1024;

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

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

// Titles that give away a karaoke/instrumental upload, used to keep those out of the
// "original version" pick — YouTube search for regional genres (cuarteto, cumbia, etc.)
// is dominated by karaoke channels, so the raw top result is often karaoke again.
const KARAOKE_LIKE_TITLE = /karaoke|instrumental|solo\s*pista|sin\s*voz|backing\s*track|videoke|midi/i;

// Stable per-song lookup key for the video cache — same song should hit the
// same cache row regardless of accents/casing/whitespace differences.
function cancionCacheKey(titulo: string, artista?: string): string {
    return `${titulo}|${artista || ''}`
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeTitle(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Lower is better: prefer results whose title actually names the song (an artist's
// channel can surface unrelated songs, full albums, or "greatest hits" compilations
// that mention neither the song nor "karaoke") and that aren't karaoke uploads.
function scoreOriginalCandidate(videoTitle: string, songTitle: string): number {
    const normalizedSong = normalizeTitle(songTitle);
    const matchesSong = normalizedSong.length > 0 && normalizeTitle(videoTitle).includes(normalizedSong);
    const looksKaraoke = KARAOKE_LIKE_TITLE.test(videoTitle);
    if (matchesSong && !looksKaraoke) return 0;
    if (matchesSong && looksKaraoke) return 1;
    if (!matchesSong && !looksKaraoke) return 2;
    return 3;
}

declare global {
    interface Window {
        onYouTubeIframeAPIReady: () => void;
        YT: any;
    }
}

export const KaraokePlayer: React.FC<KaraokePlayerProps> = ({ song, challenge, onBack, onNext }) => {
    const toast = useToast();
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [karaokeVideoId, setKaraokeVideoId] = useState<string | null>(null);
    const [alternatives, setAlternatives] = useState<VideoResult[]>([]);
    const [originalVideoId, setOriginalVideoId] = useState<string | null>(null);
    const [originalAlternatives, setOriginalAlternatives] = useState<VideoResult[]>([]);
    const [loading, setLoading] = useState(true);
    const playerContainerRef = useRef<HTMLDivElement>(null);
    const hasFetched = useRef(false);

    // Native Player References — a DeckAdapter is either a real YT.Player (structurally
    // compatible, no wrapper needed) or a LocalAudioDeckAdapter for uploaded files.
    const masterPlayer = useRef<DeckAdapter | null>(null);
    const slavePlayer = useRef<DeckAdapter | null>(null);

    // 0 = Karaoke Only, 1 = Original Only (Crossfade)
    const [assistLevel, setAssistLevel] = useState(0);

    // Manual Sync Offset (in seconds) - shift the original track relative to karaoke
    const [syncOffset, setSyncOffset] = useState(0);

    // Independent per-deck volume trims, layered on top of the crossfader.
    const [volA, setVolA] = useState(100);
    const [volB, setVolB] = useState(100);

    // Source kind per deck: a YouTube search result, or a track from the local library.
    const [masterKind, setMasterKind] = useState<'youtube' | 'local'>('youtube');
    const [slaveKind, setSlaveKind] = useState<'youtube' | 'local'>('youtube');
    const [karaokeLocalTrack, setKaraokeLocalTrack] = useState<LocalAudioRow | null>(null);
    const [originalLocalTrack, setOriginalLocalTrack] = useState<LocalAudioRow | null>(null);
    const [localTracks, setLocalTracks] = useState<LocalAudioRow[]>([]);
    const [uploadingLocal, setUploadingLocal] = useState(false);

    // Real pitch (semitones) / tempo (%) — only meaningful for local decks, since a
    // YouTube iframe never exposes raw audio for the Web Audio API to process.
    const [karaokePitch, setKaraokePitch] = useState(0);
    const [karaokeTempo, setKaraokeTempo] = useState(100);
    const [originalPitch, setOriginalPitch] = useState(0);
    const [originalTempo, setOriginalTempo] = useState(100);

    // Local decks have no native browser chrome (no iframe controls), so we track
    // minimal transport state ourselves to render a custom play/pause + seek bar.
    const [masterIsPlaying, setMasterIsPlaying] = useState(false);
    const [masterCurrentTime, setMasterCurrentTime] = useState(0);
    const [masterDuration, setMasterDuration] = useState(0);

    // Refs mirroring latest state so player event callbacks (bound once by the
    // YouTube API) always read current values without re-binding on every change.
    const syncOffsetRef = useRef(syncOffset);
    useEffect(() => { syncOffsetRef.current = syncOffset; }, [syncOffset]);

    const assistLevelRef = useRef(assistLevel);
    useEffect(() => { assistLevelRef.current = assistLevel; }, [assistLevel]);

    const volARef = useRef(volA);
    useEffect(() => { volARef.current = volA; }, [volA]);
    const volBRef = useRef(volB);
    useEffect(() => { volBRef.current = volB; }, [volB]);

    const karaokePitchRef = useRef(karaokePitch);
    useEffect(() => { karaokePitchRef.current = karaokePitch; }, [karaokePitch]);
    const karaokeTempoRef = useRef(karaokeTempo);
    useEffect(() => { karaokeTempoRef.current = karaokeTempo; }, [karaokeTempo]);
    const originalPitchRef = useRef(originalPitch);
    useEffect(() => { originalPitchRef.current = originalPitch; }, [originalPitch]);
    const originalTempoRef = useRef(originalTempo);
    useEffect(() => { originalTempoRef.current = originalTempo; }, [originalTempo]);

    const handleMasterStateChange = (event: any) => {
        const state = event.data;
        const offset = syncOffsetRef.current; // Read latest offset

        setMasterIsPlaying(state === 1);

        // Playing
        if (state === 1) {
            if (slavePlayer.current && typeof slavePlayer.current.playVideo === 'function') {
                slavePlayer.current.playVideo();

                const masterTime = masterPlayer.current!.getCurrentTime();
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

    // Load YouTube API just once
    useEffect(() => {
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
        }
    }, []);

    // Local audio library — global (not song-scoped), so it's fetched once per mount.
    useEffect(() => {
        supabase
            .from('karaokey_audio_local')
            .select('*')
            .order('created_at', { ascending: true })
            .then(({ data, error }) => {
                if (error) {
                    console.error('[KaraoKey] Failed to load local audio library:', error);
                    return;
                }
                setLocalTracks(data ?? []);
            });
    }, []);

    const uploadLocalTrack = async (file: File) => {
        if (file.size > MAX_LOCAL_FILE_BYTES) {
            toast('El archivo es muy pesado (máx. 25MB).', { type: 'error' });
            return;
        }
        setUploadingLocal(true);
        try {
            const ext = file.name.split('.').pop() || 'mp3';
            const path = `${crypto.randomUUID()}.${ext}`;
            const { error: uploadError } = await supabase.storage.from(LOCAL_AUDIO_BUCKET).upload(path, file);
            if (uploadError) throw uploadError;

            const titulo = file.name.replace(/\.[^/.]+$/, '');
            const { data, error } = await supabase
                .from('karaokey_audio_local')
                .insert({ titulo, storage_path: path, file_size_bytes: file.size })
                .select()
                .single();
            if (error) throw error;

            setLocalTracks(prev => [...prev, data]);
            toast(`"${titulo}" agregado a tu biblioteca.`, { type: 'success' });
        } catch (err) {
            console.error('[KaraoKey] Failed to upload local track:', err);
            toast('No se pudo subir el archivo de audio.', { type: 'error' });
        } finally {
            setUploadingLocal(false);
        }
    };

    const selectKaraokeYoutube = (id: string) => {
        setMasterKind('youtube');
        setKaraokeVideoId(id);
    };
    const selectKaraokeLocal = (track: LocalAudioRow) => {
        setMasterKind('local');
        setKaraokeLocalTrack(track);
    };
    const selectOriginalYoutube = (id: string) => {
        setSlaveKind('youtube');
        setOriginalVideoId(id);
    };
    const selectOriginalLocal = (track: LocalAudioRow) => {
        setSlaveKind('local');
        setOriginalLocalTrack(track);
    };

    // Fetch Videos. The component is remounted (fresh state) per song via the
    // `key` prop set by the parent, so no manual state reset is needed here.
    useEffect(() => {
        const fetchVideos = async () => {
            if (hasFetched.current) return;
            hasFetched.current = true;

            const cacheKey = cancionCacheKey(song.titulo, song.artista);
            console.log('[KaraoKey] Fetching videos for:', song.titulo, song.artista);

            // Check the cache first — repeat songs (very likely across a party, or the
            // next one) don't burn any YouTube search quota at all.
            const { data: cached } = await supabase
                .from('karaokey_video_cache')
                .select('*')
                .eq('cancion_key', cacheKey)
                .maybeSingle();

            if (cached) {
                console.log('[KaraoKey] Cache hit for', cacheKey);
                setAlternatives(cached.karaoke_alternatives ?? []);
                setKaraokeVideoId(cached.karaoke_video_id ?? null);
                setOriginalAlternatives(cached.original_alternatives ?? []);
                setOriginalVideoId(cached.original_video_id ?? null);
                setLoading(false);
                return;
            }

            try {
                // 1. Karaoke Search
                const kQuery = `${song.titulo} ${song.artista || ''} karaoke`;
                console.log('[KaraoKey] Karaoke query:', kQuery);

                const kRes = await fetch(`/api/youtube?q=${encodeURIComponent(kQuery)}`);
                const kData = await kRes.json();

                if (!kRes.ok) {
                    console.error('[KaraoKey] API Error:', kRes.status, kData);
                    throw new Error(kData.reason === 'quota_exceeded' ? 'quota_exceeded' : `YouTube API failed: ${kRes.status}`);
                }

                console.log('[KaraoKey] Karaoke results:', kData);

                let karaokeResults: VideoResult[] = [];
                if (kData.items && kData.items.length > 0) {
                    karaokeResults = kData.items.map((item: any) => ({
                        id: item.id.videoId,
                        title: item.snippet.title,
                        thumbnail: item.snippet.thumbnails.medium.url
                    }));
                    setAlternatives(karaokeResults);
                    setKaraokeVideoId(karaokeResults[0].id);
                    console.log('[KaraoKey] Karaoke video selected:', karaokeResults[0].id);
                } else {
                    console.warn('[KaraoKey] No karaoke results found');
                }

                // 2. Original Search — dropping the literal "official video" qualifier:
                // for regional genres (cuarteto, cumbia, etc.) most uploads aren't tagged
                // in English, so the plain title+artist search matches better in practice.
                const oQuery = `${song.titulo} ${song.artista || ''}`.trim();
                console.log('[KaraoKey] Original query:', oQuery);

                const oRes = await fetch(`/api/youtube?q=${encodeURIComponent(oQuery)}`);
                const oData = await oRes.json();

                if (!oRes.ok) {
                    console.error('[KaraoKey] API Error:', oRes.status, oData);
                    throw new Error(oData.reason === 'quota_exceeded' ? 'quota_exceeded' : `YouTube API failed: ${oRes.status}`);
                }

                console.log('[KaraoKey] Original results:', oData);

                let rankedOriginal: VideoResult[] = [];
                if (oData.items && oData.items.length > 0) {
                    const oResults: VideoResult[] = oData.items.map((item: any) => ({
                        id: item.id.videoId,
                        title: item.snippet.title,
                        thumbnail: item.snippet.thumbnails.medium.url
                    }));

                    // Rank by: actually names the song & isn't karaoke (best) → names the
                    // song but is karaoke → neither names it nor is karaoke → worst case.
                    // An artist's own channel can just as easily surface an unrelated
                    // single, a full album, or a "greatest hits" compilation.
                    rankedOriginal = oResults
                        .map((v, i) => ({ v, score: scoreOriginalCandidate(v.title, song.titulo), i }))
                        .sort((a, b) => a.score - b.score || a.i - b.i)
                        .map((r) => r.v);

                    setOriginalAlternatives(rankedOriginal);
                    setOriginalVideoId(rankedOriginal[0].id);
                    console.log('[KaraoKey] Original video selected:', rankedOriginal[0].id, rankedOriginal[0].title);

                    if (scoreOriginalCandidate(rankedOriginal[0].title, song.titulo) > 0) {
                        toast(`No encontramos con certeza la versión original de "${song.titulo}". Elegí una manualmente en "Voz Original" si hace falta.`, { type: 'info', duration: 6000 });
                    }
                } else {
                    console.warn('[KaraoKey] No original results found');
                }

                // Cache for next time this song comes up (fire and forget)
                supabase.from('karaokey_video_cache').upsert({
                    cancion_key: cacheKey,
                    karaoke_video_id: karaokeResults[0]?.id ?? null,
                    karaoke_alternatives: karaokeResults,
                    original_video_id: rankedOriginal[0]?.id ?? null,
                    original_alternatives: rankedOriginal,
                }, { onConflict: 'cancion_key' }).then(({ error }) => {
                    if (error) console.error('[KaraoKey] Failed to cache video search:', error);
                });

            } catch (error) {
                console.error("[KaraoKey] CRITICAL Error fetching videos:", error);
                if (error instanceof Error && error.message === 'quota_exceeded') {
                    toast('Se agotó la cuota diaria gratuita de búsquedas de YouTube. Va a volver a funcionar mañana.', { type: 'error', duration: 8000 });
                } else {
                    toast('Error al buscar videos. Verifica la consola del navegador y la configuración de la YouTube API Key.', { type: 'error', duration: 6000 });
                }
            } finally {
                setLoading(false);
                console.log('[KaraoKey] Fetch completed. Loading:', false);
            }
        };

        if (song.titulo) {
            fetchVideos();
        }
    }, [song.titulo, song.artista, toast]);

    // Initialize/Update MASTER Deck (Karaoke) — YouTube branch unchanged; local branch
    // constructs a LocalAudioDeckAdapter into the same ref via structural typing.
    useEffect(() => {
        if (masterKind === 'local') {
            if (!karaokeLocalTrack) return;
            if (masterPlayer.current) {
                try { masterPlayer.current.destroy(); } catch (e) { }
            }
            const { data } = supabase.storage.from(LOCAL_AUDIO_BUCKET).getPublicUrl(karaokeLocalTrack.storage_path);
            const adapter = new LocalAudioDeckAdapter(data.publicUrl, {
                onReady: (event) => {
                    const vol = Math.floor((1 - assistLevelRef.current) * 100 * (volARef.current / 100));
                    event.target.setVolume(vol);
                    adapter.setPitchSemitones(karaokePitchRef.current);
                    adapter.setTempo(karaokeTempoRef.current);
                    setMasterDuration(adapter.getDuration());
                    setMasterCurrentTime(0);
                },
                onStateChange: (event) => handleMasterStateChange(event),
            });
            masterPlayer.current = adapter;
            return;
        }

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
                        // Apply initial volume (read from ref: always current, no re-init on crossfader moves)
                        const vol = Math.floor((1 - assistLevelRef.current) * 100 * (volARef.current / 100));
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
    }, [masterKind, karaokeVideoId, karaokeLocalTrack]);

    // Local master deck has no native browser chrome — poll its own transport state
    // to drive a custom play/pause + seek UI.
    useEffect(() => {
        if (masterKind !== 'local') return;
        const interval = setInterval(() => {
            if (masterPlayer.current) {
                setMasterCurrentTime(masterPlayer.current.getCurrentTime());
                setMasterDuration(masterPlayer.current.getDuration());
            }
        }, 250);
        return () => clearInterval(interval);
    }, [masterKind, karaokeLocalTrack]);

    const toggleMasterPlay = () => {
        if (!masterPlayer.current) return;
        if (masterPlayer.current.getPlayerState() === 1) {
            masterPlayer.current.pauseVideo();
        } else {
            masterPlayer.current.playVideo();
        }
    };

    const seekMaster = (seconds: number) => {
        masterPlayer.current?.seekTo(seconds, true);
        setMasterCurrentTime(seconds);
    };

    // Live pitch/tempo updates for already-loaded local decks (only meaningful when
    // that deck's source is a local file — YouTube can never support this).
    useEffect(() => {
        if (masterKind === 'local' && masterPlayer.current instanceof LocalAudioDeckAdapter) {
            masterPlayer.current.setPitchSemitones(karaokePitch);
            masterPlayer.current.setTempo(karaokeTempo);
        }
    }, [karaokePitch, karaokeTempo, masterKind]);

    useEffect(() => {
        if (slaveKind === 'local' && slavePlayer.current instanceof LocalAudioDeckAdapter) {
            slavePlayer.current.setPitchSemitones(originalPitch);
            slavePlayer.current.setTempo(originalTempo);
        }
    }, [originalPitch, originalTempo, slaveKind]);

    // Initialize/Update SLAVE Deck (Original) — YouTube branch unchanged; local branch
    // mirrors the master's local-adapter construction.
    useEffect(() => {
        if (slaveKind === 'local') {
            if (!originalLocalTrack) return;
            if (slavePlayer.current) {
                try { slavePlayer.current.destroy(); } catch (e) { }
            }
            const { data } = supabase.storage.from(LOCAL_AUDIO_BUCKET).getPublicUrl(originalLocalTrack.storage_path);
            const adapter = new LocalAudioDeckAdapter(data.publicUrl, {
                onReady: (event) => {
                    const vol = Math.floor(assistLevelRef.current * 100 * (volBRef.current / 100));
                    event.target.setVolume(vol);
                    if (vol > 0) event.target.unMute(); else event.target.mute();
                    adapter.setPitchSemitones(originalPitchRef.current);
                    adapter.setTempo(originalTempoRef.current);

                    if (masterPlayer.current && typeof masterPlayer.current.getCurrentTime === 'function') {
                        const masterTime = masterPlayer.current.getCurrentTime();
                        const targetTime = Math.max(0, masterTime + syncOffsetRef.current);
                        event.target.seekTo(targetTime, true);

                        if (masterPlayer.current.getPlayerState && masterPlayer.current.getPlayerState() === 1) {
                            event.target.playVideo();
                        } else {
                            event.target.pauseVideo();
                        }
                    }
                },
                onStateChange: () => { },
            });
            slavePlayer.current = adapter;
            return;
        }

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
                        // Apply current crossfader position (read from ref: always current,
                        // no re-init on crossfader moves) instead of always muting — otherwise
                        // switching to a different "Voz Original" pick mid-song goes silent.
                        const vol = Math.floor(assistLevelRef.current * 100 * (volBRef.current / 100));
                        event.target.setVolume(vol);
                        if (vol > 0) event.target.unMute();
                        else event.target.mute();

                        // Align to the karaoke track's current position/state — covers
                        // picking a different "Voz Original" alternative mid-performance.
                        if (masterPlayer.current && typeof masterPlayer.current.getCurrentTime === 'function') {
                            const masterTime = masterPlayer.current.getCurrentTime();
                            const targetTime = Math.max(0, masterTime + syncOffsetRef.current);
                            event.target.seekTo(targetTime, true);

                            if (masterPlayer.current.getPlayerState && masterPlayer.current.getPlayerState() === 1) {
                                event.target.playVideo();
                            } else {
                                event.target.pauseVideo();
                            }
                        }
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
    }, [slaveKind, originalVideoId, originalLocalTrack]);

    // Resync on Offset Change while Playing
    useEffect(() => {
        if (masterPlayer.current && slavePlayer.current &&
            masterPlayer.current.getPlayerState && masterPlayer.current.getPlayerState() === 1) {

            const masterTime = masterPlayer.current.getCurrentTime();
            const targetTime = Math.max(0, masterTime + syncOffset); // Use state directly here as it's a dependency
            slavePlayer.current.seekTo(targetTime, true);
        }
    }, [syncOffset]);


    // Volume Crossfader Logic — crossfader position × per-deck volume trim (Vol A/Vol B)
    useEffect(() => {
        // Master Volume
        if (masterPlayer.current && typeof masterPlayer.current.setVolume === 'function') {
            const vol = Math.floor((1 - assistLevel) * 100 * (volA / 100));
            masterPlayer.current.setVolume(vol);
        }

        // Slave Volume & Unmute
        if (slavePlayer.current && typeof slavePlayer.current.setVolume === 'function') {
            const vol = Math.floor(assistLevel * 100 * (volB / 100));
            slavePlayer.current.setVolume(vol);

            // Unmute if volume > 0
            if (vol > 0) {
                if (typeof slavePlayer.current.isMuted === 'function' && slavePlayer.current.isMuted()) {
                    slavePlayer.current.unMute();
                }
            }
        }
    }, [assistLevel, volA, volB]);

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
            className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8 space-y-8 relative z-2000"
        >
            <div className="text-center space-y-4 relative z-10 w-full max-w-4xl">
                <div className="space-y-1">
                    <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-linear-to-r from-[#FF3B81] to-[#00B7ED] uppercase italic drop-shadow-lg">
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
                        className="inline-flex items-center gap-2 px-6 py-2 bg-yellow-400/20 border border-yellow-400/40 rounded-full text-yellow-300 text-sm font-bold uppercase tracking-wider backdrop-blur-xs"
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
                        {masterKind === 'youtube' && karaokeVideoId ? (
                            <div className="w-full h-full relative z-20 bg-black">
                                {/* MASTER PLAYER (Karaoke) */}
                                <div id="youtube-player-master" className="w-full h-full" />
                            </div>
                        ) : masterKind === 'local' && karaokeLocalTrack ? (
                            // Local decks have no native browser chrome (Web Audio only) — a
                            // minimal custom transport replaces the missing iframe controls.
                            <div className="w-full h-full flex flex-col items-center justify-center bg-black/60 gap-5 p-8">
                                <Music size={48} className="text-neon-pink" />
                                <div className="text-center">
                                    <p className="text-white font-bold text-lg">{karaokeLocalTrack.titulo}</p>
                                    {karaokeLocalTrack.artista && <p className="text-white/50 text-sm">{karaokeLocalTrack.artista}</p>}
                                </div>
                                <button
                                    onClick={toggleMasterPlay}
                                    className="p-4 rounded-full bg-neon-pink text-white hover:scale-105 active:scale-95 transition-all cursor-pointer shadow-lg shadow-[#FF3B81]/30"
                                >
                                    {masterIsPlaying ? <Pause size={28} /> : <Play size={28} />}
                                </button>
                                <div className="w-full max-w-sm flex items-center gap-3">
                                    <span className="text-xs text-white/50 font-mono">{formatTime(masterCurrentTime)}</span>
                                    <input
                                        type="range"
                                        min={0}
                                        max={masterDuration || 0}
                                        step={0.1}
                                        value={masterCurrentTime}
                                        onChange={(e) => seekMaster(parseFloat(e.target.value))}
                                        className="flex-1 accent-[#FF3B81] cursor-pointer"
                                    />
                                    <span className="text-xs text-white/50 font-mono">{formatTime(masterDuration)}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-black/60 gap-4">
                                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-neon-pink border-r-transparent"></div>
                                <p className="text-white font-bold tracking-widest animate-pulse">BUSCANDO PISTAS...</p>
                            </div>
                        )}

                        {/* SLAVE PLAYER (Original Voice) - Hidden (both YouTube and local use the
                            same off-screen container; the local adapter has no DOM element of its
                            own, so this stays empty for it, but the id is only needed by the
                            YouTube branch) */}
                        <div style={{ width: 1, height: 1, opacity: 0, position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                            <div id="youtube-player-slave" />
                        </div>

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
                                className={`flex flex-col items-center gap-1 text-sm font-bold uppercase tracking-widest transition-all cursor-pointer px-4 py-2 rounded-xl ${assistLevel === 0 ? "bg-neon-pink text-white shadow-lg shadow-[#FF3B81]/30" : "text-white/50 hover:bg-white/10"}`}
                            >
                                <span className="text-[9px] opacity-70">DECK A</span>
                                <span className="flex items-center gap-2"><Mic2 size={18} /> Solo Karaoke</span>
                            </button>

                            <div className="flex-1 w-full max-w-md flex flex-col items-center gap-3">
                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neon-blue">
                                    <Volume2 size={14} />
                                    <span>Mezclador Crossfader</span>
                                </div>
                                <div className="relative w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                                    <div
                                        className="absolute top-0 left-0 h-full bg-linear-to-r from-[#FF3B81] to-[#00B7ED]"
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
                                className={`flex flex-col items-center gap-1 text-sm font-bold uppercase tracking-widest transition-all cursor-pointer px-4 py-2 rounded-xl ${assistLevel === 1 ? "bg-neon-blue text-white shadow-lg shadow-[#00B7ED]/30" : "text-white/50 hover:bg-white/10"}`}
                            >
                                <span className="text-[9px] opacity-70">DECK B</span>
                                <span className="flex items-center gap-2">Solo Voz Original <Music size={18} /></span>
                            </button>
                        </div>

                        {/* VOL A / VOL B TRIM SLIDERS — independent of the crossfader */}
                        <div className="glass-card p-4 rounded-2xl border border-white/5 grid grid-cols-2 gap-6 bg-black/20">
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-neon-pink">
                                    <span>Vol A</span><span>{volA}%</span>
                                </div>
                                <input
                                    type="range" min="0" max="100" step="1" value={volA}
                                    onChange={(e) => setVolA(parseInt(e.target.value))}
                                    className="w-full accent-[#FF3B81] cursor-pointer"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-neon-blue">
                                    <span>Vol B</span><span>{volB}%</span>
                                </div>
                                <input
                                    type="range" min="0" max="100" step="1" value={volB}
                                    onChange={(e) => setVolB(parseInt(e.target.value))}
                                    className="w-full accent-[#00B7ED] cursor-pointer"
                                />
                            </div>
                        </div>

                        {/* PITCH / TEMPO — only real for local decks; a YouTube iframe never
                            exposes raw audio to the Web Audio API, so it's disabled there. */}
                        <div className="glass-card p-4 rounded-2xl border border-white/5 grid grid-cols-2 gap-6 bg-black/20">
                            <PitchTempoControls
                                label="Deck A"
                                enabled={masterKind === 'local'}
                                pitch={karaokePitch}
                                tempo={karaokeTempo}
                                onPitchChange={setKaraokePitch}
                                onTempoChange={setKaraokeTempo}
                                accent="pink"
                            />
                            <PitchTempoControls
                                label="Deck B"
                                enabled={slaveKind === 'local'}
                                pitch={originalPitch}
                                tempo={originalTempo}
                                onPitchChange={setOriginalPitch}
                                onTempoChange={setOriginalTempo}
                                accent="blue"
                            />
                        </div>

                        {/* MANUAL SYNC CONTROLS */}
                        {(originalVideoId || originalLocalTrack) && (
                            <div className="glass-card p-3 rounded-xl border border-white/5 flex flex-wrap items-center justify-center gap-4 bg-black/20 animate-in slide-in-from-top-2">
                                <span className="text-xs font-bold uppercase tracking-widest text-white/60 flex items-center gap-2">
                                    <Settings2 size={14} /> Ajuste de Sincronización:
                                    <span className="text-neon-blue bg-white/5 px-2 py-0.5 rounded-sm font-mono">{syncOffset > 0 ? '+' : ''}{syncOffset.toFixed(1)}s</span>
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
                            className="px-8 py-3 rounded-2xl bg-linear-to-r from-[#FF3B81] to-[#9D4EDD] hover:scale-105 active:scale-95 transition-all flex items-center gap-2 font-bold uppercase tracking-widest text-sm cursor-pointer"
                        >
                            <RefreshCw size={18} className="animate-[spin_4s_linear_infinite]" /> Siguiente Sorteo
                        </button>
                    </div>
                </div>

                <div className="space-y-6">
                    <DeckSourcePanel
                        label="Deck A · Pista Karaoke"
                        icon={<Mic2 size={16} />}
                        accent="pink"
                        kind={masterKind}
                        youtubeVideos={alternatives}
                        youtubeSelectedId={karaokeVideoId}
                        onSelectYoutube={selectKaraokeYoutube}
                        onSearchResults={setAlternatives}
                        localTracks={localTracks}
                        localSelectedId={karaokeLocalTrack?.id ?? null}
                        onSelectLocal={selectKaraokeLocal}
                        onUpload={uploadLocalTrack}
                        uploading={uploadingLocal}
                    />
                    <DeckSourcePanel
                        label="Deck B · Voz Original"
                        icon={<Music size={16} />}
                        accent="blue"
                        kind={slaveKind}
                        youtubeVideos={originalAlternatives}
                        youtubeSelectedId={originalVideoId}
                        onSelectYoutube={selectOriginalYoutube}
                        onSearchResults={setOriginalAlternatives}
                        localTracks={localTracks}
                        localSelectedId={originalLocalTrack?.id ?? null}
                        onSelectLocal={selectOriginalLocal}
                        onUpload={uploadLocalTrack}
                        uploading={uploadingLocal}
                    />
                </div>
            </div>
        </motion.div>
    );
};

interface VideoOptionsListProps {
    label?: string;
    icon?: React.ReactNode;
    videos: VideoResult[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    accent: 'pink' | 'blue';
}

function VideoOptionsList({ label, icon, videos, selectedId, onSelect, accent }: VideoOptionsListProps) {
    if (videos.length === 0) return null;

    const accentClasses = accent === 'pink'
        ? { selected: 'bg-neon-pink/10 border-neon-pink/40 shadow-lg shadow-[#FF3B81]/10', badge: 'bg-neon-pink' }
        : { selected: 'bg-neon-blue/10 border-neon-blue/40 shadow-lg shadow-[#00B7ED]/10', badge: 'bg-neon-blue' };

    return (
        <div className="space-y-3">
            {label && (
                <div className="flex items-center gap-2 text-white/60 font-bold uppercase text-xs tracking-widest">
                    {icon} {label}
                </div>
            )}
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {videos.map((video) => (
                    <button
                        key={video.id}
                        onClick={() => onSelect(video.id)}
                        className={`w-full group text-left space-y-2 p-3 rounded-2xl transition-all border cursor-pointer hover:shadow-lg ${selectedId === video.id
                            ? accentClasses.selected
                            : 'bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/10'
                            }`}
                    >
                        <div className="relative aspect-video rounded-xl overflow-hidden pointer-events-none group-hover:scale-[1.02] transition-transform">
                            <Image
                                src={video.thumbnail}
                                alt={video.title}
                                fill
                                sizes="(min-width: 1024px) 300px, 100vw"
                                className="object-cover"
                                unoptimized
                            />
                            {selectedId === video.id && (
                                <div className={`absolute top-2 right-2 ${accentClasses.badge} text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-lg`}>
                                    ACTUAL
                                </div>
                            )}
                        </div>
                        <div className="px-1 pointer-events-none">
                            <p className={`text-xs font-bold line-clamp-2 ${selectedId === video.id ? 'text-white' : 'text-white/70'}`}>
                                {video.title}
                            </p>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

interface PitchTempoControlsProps {
    label: string;
    enabled: boolean;
    pitch: number;
    tempo: number;
    onPitchChange: (n: number) => void;
    onTempoChange: (n: number) => void;
    accent: 'pink' | 'blue';
}

// Real pitch (±12 semitones) / tempo (%) controls — only functional for local decks.
// A YouTube iframe embed never exposes decoded audio to the page, so these stay
// disabled (and clearly labeled) whenever that deck is playing from YouTube.
function PitchTempoControls({ label, enabled, pitch, tempo, onPitchChange, onTempoChange, accent }: PitchTempoControlsProps) {
    const accentText = accent === 'pink' ? 'text-neon-pink' : 'text-neon-blue';
    const accentAccent = accent === 'pink' ? 'accent-[#FF3B81]' : 'accent-[#00B7ED]';

    return (
        <div className={`space-y-3 ${enabled ? '' : 'opacity-40'}`}>
            <div className={`text-[10px] font-bold uppercase tracking-widest ${accentText}`}>
                {label} {!enabled && <span className="text-white/30">(YOUTUBE NO)</span>}
            </div>
            <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-white/50 uppercase tracking-widest">
                    <span>Tono</span><span>{pitch > 0 ? '+' : ''}{pitch}</span>
                </div>
                <input
                    type="range" min="-12" max="12" step="1" value={pitch} disabled={!enabled}
                    onChange={(e) => onPitchChange(parseInt(e.target.value))}
                    className={`w-full ${accentAccent} ${enabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                />
            </div>
            <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-white/50 uppercase tracking-widest">
                    <span>Tempo</span><span>{tempo}%</span>
                </div>
                <input
                    type="range" min="50" max="150" step="1" value={tempo} disabled={!enabled}
                    onChange={(e) => onTempoChange(parseInt(e.target.value))}
                    className={`w-full ${accentAccent} ${enabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                />
            </div>
        </div>
    );
}

interface SearchBoxProps {
    placeholder: string;
    onResults: (videos: VideoResult[]) => void;
    onSelect: (id: string) => void;
}

// Manual YouTube search — lets the user override/extend the auto-fetched top-5
// results per deck, since the automatic match can occasionally pick the wrong video.
function SearchBox({ placeholder, onResults, onSelect }: SearchBoxProps) {
    const toast = useToast();
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);

    const doSearch = async () => {
        if (!query.trim() || searching) return;
        setSearching(true);
        try {
            const res = await fetch(`/api/youtube?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.reason === 'quota_exceeded' ? 'quota_exceeded' : 'search_failed');

            const results: VideoResult[] = (data.items || []).map((item: any) => ({
                id: item.id.videoId,
                title: item.snippet.title,
                thumbnail: item.snippet.thumbnails.medium.url,
            }));
            onResults(results);
            if (results.length > 0) onSelect(results[0].id);
        } catch (err) {
            toast(
                err instanceof Error && err.message === 'quota_exceeded'
                    ? 'Se agotó la cuota diaria de búsquedas de YouTube.'
                    : 'No se pudo buscar en YouTube.',
                { type: 'error' }
            );
        } finally {
            setSearching(false);
        }
    };

    return (
        <div className="flex gap-2">
            <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
                placeholder={placeholder}
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-white/30 outline-hidden focus:border-white/30"
            />
            <button
                onClick={doSearch}
                disabled={searching}
                className="shrink-0 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold uppercase tracking-widest transition-all cursor-pointer disabled:opacity-50"
            >
                {searching ? '...' : 'Buscar'}
            </button>
        </div>
    );
}

interface LocalTrackListProps {
    tracks: LocalAudioRow[];
    selectedId: string | null;
    onSelect: (track: LocalAudioRow) => void;
    onUpload: (file: File) => void;
    uploading: boolean;
    accent: 'pink' | 'blue';
}

function LocalTrackList({ tracks, selectedId, onSelect, onUpload, uploading, accent }: LocalTrackListProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const accentClasses = accent === 'pink'
        ? { selected: 'bg-neon-pink/10 border-neon-pink/40', badge: 'bg-neon-pink' }
        : { selected: 'bg-neon-blue/10 border-neon-blue/40', badge: 'bg-neon-blue' };

    return (
        <div className="space-y-3">
            <input
                ref={inputRef}
                type="file"
                accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUpload(file);
                    e.target.value = '';
                }}
            />
            <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-white/20 text-white/60 hover:border-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-all cursor-pointer disabled:opacity-50"
            >
                <Upload size={14} /> {uploading ? 'Subiendo...' : 'Subir Archivo de Audio'}
            </button>
            {tracks.length === 0 ? (
                <p className="text-xs text-white/30 text-center py-4">Tu biblioteca está vacía. Subí un MP3/WAV para tener tono y tempo reales.</p>
            ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                    {tracks.map((track) => (
                        <button
                            key={track.id}
                            onClick={() => onSelect(track)}
                            className={`w-full text-left flex items-center gap-3 p-3 rounded-xl transition-all border cursor-pointer ${selectedId === track.id ? accentClasses.selected : 'bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/10'}`}
                        >
                            <Music size={16} className="shrink-0 text-white/50" />
                            <span className="text-xs font-bold line-clamp-1 flex-1">{track.titulo}</span>
                            {selectedId === track.id && (
                                <span className={`${accentClasses.badge} text-white text-[9px] font-bold px-2 py-0.5 rounded-md shrink-0`}>ACTUAL</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

interface DeckSourcePanelProps {
    label: string;
    icon: React.ReactNode;
    accent: 'pink' | 'blue';
    kind: 'youtube' | 'local';
    youtubeVideos: VideoResult[];
    youtubeSelectedId: string | null;
    onSelectYoutube: (id: string) => void;
    onSearchResults: (videos: VideoResult[]) => void;
    localTracks: LocalAudioRow[];
    localSelectedId: string | null;
    onSelectLocal: (track: LocalAudioRow) => void;
    onUpload: (file: File) => void;
    uploading: boolean;
}

// One deck's source panel: a tab switch between searching YouTube (the existing
// flow) and picking from the local pitch/tempo-capable library (new).
function DeckSourcePanel(props: DeckSourcePanelProps) {
    const [tab, setTab] = useState<'youtube' | 'local'>(props.kind);
    const accentActive = props.accent === 'pink' ? 'bg-neon-pink text-white' : 'bg-neon-blue text-white';

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-white/60 font-bold uppercase text-xs tracking-widest">
                {props.icon} {props.label}
            </div>
            <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/5">
                <button
                    onClick={() => setTab('youtube')}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer ${tab === 'youtube' ? accentActive : 'text-white/40 hover:text-white/70'}`}
                >
                    Buscar YouTube
                </button>
                <button
                    onClick={() => setTab('local')}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer ${tab === 'local' ? accentActive : 'text-white/40 hover:text-white/70'}`}
                >
                    Mi Biblioteca
                </button>
            </div>
            {tab === 'youtube' ? (
                <div className="space-y-3">
                    <SearchBox placeholder="Buscar en YouTube..." onResults={props.onSearchResults} onSelect={props.onSelectYoutube} />
                    <VideoOptionsList
                        videos={props.youtubeVideos}
                        selectedId={props.kind === 'youtube' ? props.youtubeSelectedId : null}
                        onSelect={props.onSelectYoutube}
                        accent={props.accent}
                    />
                </div>
            ) : (
                <LocalTrackList
                    tracks={props.localTracks}
                    selectedId={props.kind === 'local' ? props.localSelectedId : null}
                    onSelect={props.onSelectLocal}
                    onUpload={props.onUpload}
                    uploading={props.uploading}
                    accent={props.accent}
                />
            )}
        </div>
    );
}
