import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import screenfull from 'screenfull';
import { Maximize2, Minimize2, ArrowLeft, RefreshCw, Trophy, Mic2, Music, Volume2, Play, Pause, Upload, SkipBack, Flag, Square, ArrowLeftRight, MonitorPlay, Check, Search, ListMusic, Library } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from './Toast';
import { useAuth } from '../lib/auth';
import { supabase, LocalAudioRow } from '../lib/supabase';
import { DeckAdapter, LocalAudioDeckAdapter } from '../lib/deckAdapter';

const LOCAL_AUDIO_BUCKET = 'karaokey-audio';
const MAX_LOCAL_FILE_BYTES = 25 * 1024 * 1024;
const AUTO_CROSSFADE_THRESHOLD_SECONDS = 6;
const AUTO_CROSSFADE_RAMP_MS = 4000;
const ON_AIR_CHANNEL = 'karaokey-on-air';

// A freshly-constructed YT.Player is assigned to a ref synchronously, but its API
// methods (getCurrentTime, seekTo, etc.) aren't actually callable until the iframe's
// internal ready handshake completes — calling them too early throws. Every read/call
// site on a deck ref (outside the player's own onReady handler) must go through this.
function deckReady(player: DeckAdapter | null): player is DeckAdapter {
    return !!player && typeof player.getCurrentTime === 'function';
}

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// iOS Safari (and any iOS WebView, since they all share WebKit there) enforces a real,
// unfixable platform rule: no JS API may change an HTML5 <video>'s volume — the user's
// physical hardware buttons are the only way. A YouTube embed's audio is exactly that
// under the hood, so `player.setVolume()` genuinely does nothing there — this is a
// documented, longstanding limitation of the YouTube IFrame API on iOS, not a bug in
// this app. (Local uploads are unaffected: they go through a Web Audio gain node, a
// different code path iOS doesn't restrict this way.)
function isIOSDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iPadOS 13+ reports as "Macintosh" but still exposes touch points, unlike a real Mac.
    const isIPadOS = ua.includes('Macintosh') && typeof document !== 'undefined' && 'ontouchend' in document;
    return /iPad|iPhone|iPod/.test(ua) || isIPadOS;
}

// TWO INDEPENDENT DECKS — Deck A/B can each hold any track (YouTube or local upload),
// mirroring how a real DJ console works. There is no built-in "karaoke + original vocal
// of the same song" pairing — that's now just something the host can do manually by
// loading a plain (non-"karaoke") search result into the other deck.

interface KaraokePlayerProps {
    song?: { titulo: string; artista?: string };
    challenge?: string;
    onBack: () => void;
    onNext?: () => void;
    // The app's saved song list (Cancionero) — lets a standalone DJ session load a
    // song into either deck without needing a sorteo draw. Omitted in sorteo mode.
    cancionero?: { titulo: string; artista?: string }[];
    // Simple-mode accounts get one single-deck player: no Deck B, no crossfader/
    // Vol/Igualar/Auto Crossfade row, no Pantalla Externa. Deck A works exactly
    // as it always has (Cue/Set/Play/Stop, Tono/Tempo, all three source tabs).
    simple?: boolean;
}

interface VideoResult {
    id: string;
    title: string;
    thumbnail: string;
    channel?: string;
}

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

// Cache-checked karaoke search, shared by the sorteo auto-load (Deck A on mount)
// and the standalone "Mi Cancionero" loader (either deck, on demand).
async function searchKaraokeVideo(cancion: { titulo: string; artista?: string }): Promise<{ videoId: string | null; alternatives: VideoResult[] }> {
    const cacheKey = cancionCacheKey(cancion.titulo, cancion.artista);

    const { data: cached } = await supabase
        .from('karaokey_video_cache')
        .select('*')
        .eq('cancion_key', cacheKey)
        .maybeSingle();

    if (cached && cached.karaoke_video_id) {
        return { videoId: cached.karaoke_video_id, alternatives: cached.karaoke_alternatives ?? [] };
    }

    const kQuery = `${cancion.titulo} ${cancion.artista || ''} karaoke`;
    const kRes = await fetch(`/api/youtube?q=${encodeURIComponent(kQuery)}`);
    const kData = await kRes.json();

    if (!kRes.ok) {
        throw new Error(kData.reason === 'quota_exceeded' ? 'quota_exceeded' : `YouTube API failed: ${kRes.status}`);
    }

    let karaokeResults: VideoResult[] = [];
    if (kData.items && kData.items.length > 0) {
        karaokeResults = kData.items.map((item: any) => ({
            id: item.id.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.medium.url,
            channel: item.snippet.channelTitle,
        }));
    }

    supabase.from('karaokey_video_cache').upsert({
        cancion_key: cacheKey,
        karaoke_video_id: karaokeResults[0]?.id ?? null,
        karaoke_alternatives: karaokeResults,
    }, { onConflict: 'cancion_key' }).then(({ error }) => {
        if (error) console.error('[KaraoKey] Failed to cache video search:', error);
    });

    return { videoId: karaokeResults[0]?.id ?? null, alternatives: karaokeResults };
}

declare global {
    interface Window {
        onYouTubeIframeAPIReady: () => void;
        YT: any;
    }
}

type DeckKind = 'youtube' | 'local';
type DeckLetter = 'A' | 'B';

export const KaraokePlayer: React.FC<KaraokePlayerProps> = ({ song, challenge, onBack, onNext, cancionero, simple = false }) => {
    const toast = useToast();
    const { user } = useAuth();
    const [isFullscreen, setIsFullscreen] = useState(false);
    // iOS Safari (and some other mobile browsers) refuse the real Fullscreen API for
    // any element that isn't a <video> tag — Apple only allows it there. When that's
    // the case, this is a CSS-only "fake fullscreen" fallback (fixed, covers the
    // viewport) instead of leaving the button doing nothing.
    const [cssFullscreen, setCssFullscreen] = useState(false);
    const [loading, setLoading] = useState(true);
    const videoRowRef = useRef<HTMLDivElement>(null);
    const hasFetched = useRef(false);

    // ---- Deck A ----
    const deckAPlayer = useRef<DeckAdapter | null>(null);
    const [deckAVideoId, setDeckAVideoId] = useState<string | null>(null);
    const [deckAAlternatives, setDeckAAlternatives] = useState<VideoResult[]>([]);
    const [deckAKind, setDeckAKind] = useState<DeckKind>('youtube');
    const [deckALocalTrack, setDeckALocalTrack] = useState<LocalAudioRow | null>(null);
    const [deckAPitch, setDeckAPitch] = useState(0);
    const [deckATempo, setDeckATempo] = useState(100);
    const [deckAIsPlaying, setDeckAIsPlaying] = useState(false);
    const [deckACurrentTime, setDeckACurrentTime] = useState(0);
    const [deckADuration, setDeckADuration] = useState(0);
    const deckACuePointRef = useRef(0);

    // ---- Deck B ----
    const deckBPlayer = useRef<DeckAdapter | null>(null);
    const [deckBVideoId, setDeckBVideoId] = useState<string | null>(null);
    const [deckBAlternatives, setDeckBAlternatives] = useState<VideoResult[]>([]);
    const [deckBKind, setDeckBKind] = useState<DeckKind>('youtube');
    const [deckBLocalTrack, setDeckBLocalTrack] = useState<LocalAudioRow | null>(null);
    const [deckBPitch, setDeckBPitch] = useState(0);
    const [deckBTempo, setDeckBTempo] = useState(100);
    const [deckBIsPlaying, setDeckBIsPlaying] = useState(false);
    const [deckBCurrentTime, setDeckBCurrentTime] = useState(0);
    const [deckBDuration, setDeckBDuration] = useState(0);
    const deckBCuePointRef = useRef(0);

    // ---- Mixer ----
    const [assistLevel, setAssistLevel] = useState(0); // 0 = full Deck A, 1 = full Deck B
    const [volA, setVolA] = useState(100);
    const [volB, setVolB] = useState(100);
    const [autoCue, setAutoCue] = useState(true);
    const [autoCrossfade, setAutoCrossfade] = useState(false);
    const rampingRef = useRef(false);

    // ---- Local audio library (shared by both decks) ----
    const [localTracks, setLocalTracks] = useState<LocalAudioRow[]>([]);
    const [uploadingLocal, setUploadingLocal] = useState(false);

    // Per-deck "loading from Mi Cancionero" indicator (searching YouTube on demand).
    const [deckASearching, setDeckASearching] = useState(false);
    const [deckBSearching, setDeckBSearching] = useState(false);

    // Refs mirroring latest state so player event callbacks (bound once by the
    // YouTube API, or fired from inside the local adapter) always read current values.
    const assistLevelRef = useRef(assistLevel);
    useEffect(() => { assistLevelRef.current = assistLevel; }, [assistLevel]);
    const volARef = useRef(volA);
    useEffect(() => { volARef.current = volA; }, [volA]);
    const volBRef = useRef(volB);
    useEffect(() => { volBRef.current = volB; }, [volB]);
    const deckAPitchRef = useRef(deckAPitch);
    useEffect(() => { deckAPitchRef.current = deckAPitch; }, [deckAPitch]);
    const deckATempoRef = useRef(deckATempo);
    useEffect(() => { deckATempoRef.current = deckATempo; }, [deckATempo]);
    const deckBPitchRef = useRef(deckBPitch);
    useEffect(() => { deckBPitchRef.current = deckBPitch; }, [deckBPitch]);
    const deckBTempoRef = useRef(deckBTempo);
    useEffect(() => { deckBTempoRef.current = deckBTempo; }, [deckBTempo]);
    const autoCueRef = useRef(autoCue);
    useEffect(() => { autoCueRef.current = autoCue; }, [autoCue]);

    // Whichever deck is louder in the current mix is "on air" — same idea a real DJ
    // booth uses for what feeds the external monitor.
    const onAirDeck = (): DeckLetter => {
        const effA = (1 - assistLevel) * (volA / 100);
        const effB = assistLevel * (volB / 100);
        return effA >= effB ? 'A' : 'B';
    };

    // ---- External on-air monitor (second window) — a real "Program" output, not
    // just a preview: once connected, it plays real audio for whichever YouTube
    // deck(s) are loaded (crossfaded live, same formula as the main mix), and the
    // main window mutes that same audio so it isn't heard twice. A locally-uploaded
    // deck's audio can never leave the AudioContext that decoded it, so it always
    // keeps playing from the main window regardless — the external window can only
    // show a title card for it, no audio. ----
    const onAirChannelRef = useRef<BroadcastChannel | null>(null);
    const [externalConnected, setExternalConnected] = useState(false);
    const lastHeartbeatRef = useRef(0);
    // Holds the last broadcast 'mix' payload — BroadcastChannel has no history/replay,
    // so a page that connects (or reconnects) after the last state change would
    // otherwise sit idle until the next crossfader move. Re-sent on every 'hello'.
    const mixStateRef = useRef<Record<string, unknown> | null>(null);

    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel(ON_AIR_CHANNEL);
        onAirChannelRef.current = channel;
        channel.onmessage = (event: MessageEvent<{ type: string }>) => {
            if (event.data?.type === 'hello') {
                lastHeartbeatRef.current = Date.now();
                setExternalConnected(true);
                if (mixStateRef.current) channel.postMessage(mixStateRef.current);
            }
        };
        return () => channel.close();
    }, []);

    // Drop the connection if the external tab stops sending heartbeats (closed, crashed).
    useEffect(() => {
        const interval = setInterval(() => {
            if (lastHeartbeatRef.current && Date.now() - lastHeartbeatRef.current > 7000) {
                setExternalConnected(false);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const openExternalMonitor = () => {
        window.open('/pantalla-externa', 'karaokey-external', 'width=960,height=540');
    };

    // Broadcast the full mix state (both decks + crossfader) whenever any of it
    // changes — the external window now runs its own mirrored pair of decks and
    // crossfades them itself, instead of just displaying a single "winner."
    useEffect(() => {
        const payload = {
            type: 'mix',
            assistLevel,
            volA,
            volB,
            deckA: { kind: deckAKind, videoId: deckAVideoId, titulo: deckALocalTrack?.titulo ?? null, artista: deckALocalTrack?.artista ?? null },
            deckB: { kind: deckBKind, videoId: deckBVideoId, titulo: deckBLocalTrack?.titulo ?? null, artista: deckBLocalTrack?.artista ?? null },
        };
        mixStateRef.current = payload;
        onAirChannelRef.current?.postMessage(payload);
    }, [assistLevel, volA, volB, deckAKind, deckAVideoId, deckALocalTrack, deckBKind, deckBVideoId, deckBLocalTrack]);

    // Periodic time-sync tick for each YouTube deck, so the external window's
    // mirrored players don't visibly/audibly drift out of sync over a long song.
    useEffect(() => {
        const interval = setInterval(() => {
            (['A', 'B'] as const).forEach((deck) => {
                const kind = deck === 'A' ? deckAKind : deckBKind;
                if (kind !== 'youtube') return;
                const player = deck === 'A' ? deckAPlayer.current : deckBPlayer.current;
                const videoId = deck === 'A' ? deckAVideoId : deckBVideoId;
                if (!deckReady(player) || !videoId) return;
                onAirChannelRef.current?.postMessage({
                    type: 'sync',
                    deck,
                    videoId,
                    currentTime: player.getCurrentTime(),
                    isPlaying: player.getPlayerState() === 1,
                });
            });
        }, 2000);
        return () => clearInterval(interval);
    }, [deckAKind, deckBKind, deckAVideoId, deckBVideoId]);

    // ---- Load YouTube API just once ----
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
        if (!user) return; // shouldn't happen — this component only mounts once authenticated
        setUploadingLocal(true);
        try {
            const ext = file.name.split('.').pop() || 'mp3';
            // Storage RLS requires objects to live under a `${user.id}/...` prefix.
            const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
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

    const selectDeckAYoutube = (id: string) => { setDeckAKind('youtube'); setDeckAVideoId(id); };
    const selectDeckALocal = (track: LocalAudioRow) => { setDeckAKind('local'); setDeckALocalTrack(track); };
    const selectDeckBYoutube = (id: string) => { setDeckBKind('youtube'); setDeckBVideoId(id); };
    const selectDeckBLocal = (track: LocalAudioRow) => { setDeckBKind('local'); setDeckBLocalTrack(track); };

    // "Mi Cancionero" — load a song from the app's own saved list into a deck on
    // demand (searches/caches exactly like the sorteo auto-load, just triggered
    // manually and targeting whichever deck the host picked).
    const loadCancionIntoDeck = async (cancion: { titulo: string; artista?: string }, deck: DeckLetter) => {
        const setSearching = deck === 'A' ? setDeckASearching : setDeckBSearching;
        setSearching(true);
        try {
            const { videoId, alternatives } = await searchKaraokeVideo(cancion);
            if (deck === 'A') {
                setDeckAAlternatives(alternatives);
                if (videoId) selectDeckAYoutube(videoId);
            } else {
                setDeckBAlternatives(alternatives);
                if (videoId) selectDeckBYoutube(videoId);
            }
            if (!videoId) {
                toast(`No se encontró un video karaoke para "${cancion.titulo}".`, { type: 'error' });
            }
        } catch (error) {
            toast(
                error instanceof Error && error.message === 'quota_exceeded'
                    ? 'Se agotó la cuota diaria de búsquedas de YouTube.'
                    : 'No se pudo buscar el video.',
                { type: 'error' }
            );
        } finally {
            setSearching(false);
        }
    };
    const loadCancionIntoDeckA = (cancion: { titulo: string; artista?: string }) => loadCancionIntoDeck(cancion, 'A');
    const loadCancionIntoDeckB = (cancion: { titulo: string; artista?: string }) => loadCancionIntoDeck(cancion, 'B');

    // Fetch the karaoke track for Deck A only, when a song was handed in by a sorteo
    // draw. The component is remounted (fresh state) per song via the `key` prop set
    // by the parent. Deck B starts empty — the host loads whatever they want into it
    // manually. In standalone DJ mode (no `song` prop) this effect never runs — both
    // decks start empty, same as Deck B always does.
    useEffect(() => {
        const fetchVideos = async () => {
            if (hasFetched.current || !song) return;
            hasFetched.current = true;
            try {
                const { videoId, alternatives } = await searchKaraokeVideo(song);
                setDeckAAlternatives(alternatives);
                if (videoId) setDeckAVideoId(videoId);
            } catch (error) {
                console.error("[KaraoKey] Error fetching Deck A video:", error);
                if (error instanceof Error && error.message === 'quota_exceeded') {
                    toast('Se agotó la cuota diaria gratuita de búsquedas de YouTube. Va a volver a funcionar mañana.', { type: 'error', duration: 8000 });
                } else {
                    toast('Error al buscar videos. Verifica la consola del navegador y la configuración de la YouTube API Key.', { type: 'error', duration: 6000 });
                }
            } finally {
                setLoading(false);
            }
        };

        if (song?.titulo) {
            fetchVideos();
        } else {
            setLoading(false);
        }
    }, [song, toast]);

    // ---- Init/update Deck A ----
    useEffect(() => {
        if (deckAKind === 'local') {
            if (!deckALocalTrack) return;
            if (deckAPlayer.current) { try { deckAPlayer.current.destroy(); } catch (e) { } }
            const { data } = supabase.storage.from(LOCAL_AUDIO_BUCKET).getPublicUrl(deckALocalTrack.storage_path);
            const adapter = new LocalAudioDeckAdapter(data.publicUrl, {
                onReady: (event) => {
                    const vol = Math.floor((1 - assistLevelRef.current) * 100 * (volARef.current / 100));
                    event.target.setVolume(vol);
                    adapter.setPitchSemitones(deckAPitchRef.current);
                    adapter.setTempo(deckATempoRef.current);
                    setDeckADuration(adapter.getDuration());
                    const cue = adapter.autoCueSeconds > 0 ? adapter.autoCueSeconds : 0;
                    deckACuePointRef.current = cue;
                    if (cue > 0) adapter.seekTo(cue, true);
                    setDeckACurrentTime(cue);
                },
                onStateChange: (event) => setDeckAIsPlaying(event.data === 1),
            }, { autoCue: autoCueRef.current });
            deckAPlayer.current = adapter;
            return;
        }

        if (!deckAVideoId) return;

        const initA = () => {
            if (deckAPlayer.current) { try { deckAPlayer.current.destroy(); } catch (e) { } }
            deckAPlayer.current = new window.YT.Player('youtube-player-deck-a', {
                height: '100%',
                width: '100%',
                videoId: deckAVideoId,
                playerVars: { playsinline: 1, controls: 0, rel: 0, origin: window.location.origin },
                events: {
                    onReady: (event: any) => {
                        const vol = Math.floor((1 - assistLevelRef.current) * 100 * (volARef.current / 100));
                        event.target.setVolume(vol);
                        deckACuePointRef.current = 0;
                    },
                    onStateChange: (event: any) => setDeckAIsPlaying(event.data === 1),
                }
            });
        };

        if (window.YT && window.YT.Player) initA();
        else {
            const interval = setInterval(() => {
                if (window.YT && window.YT.Player) { clearInterval(interval); initA(); }
            }, 100);
        }
    }, [deckAKind, deckAVideoId, deckALocalTrack]);

    // ---- Init/update Deck B (mirrors Deck A) ----
    useEffect(() => {
        if (deckBKind === 'local') {
            if (!deckBLocalTrack) return;
            if (deckBPlayer.current) { try { deckBPlayer.current.destroy(); } catch (e) { } }
            const { data } = supabase.storage.from(LOCAL_AUDIO_BUCKET).getPublicUrl(deckBLocalTrack.storage_path);
            const adapter = new LocalAudioDeckAdapter(data.publicUrl, {
                onReady: (event) => {
                    const vol = Math.floor(assistLevelRef.current * 100 * (volBRef.current / 100));
                    event.target.setVolume(vol);
                    adapter.setPitchSemitones(deckBPitchRef.current);
                    adapter.setTempo(deckBTempoRef.current);
                    setDeckBDuration(adapter.getDuration());
                    const cue = adapter.autoCueSeconds > 0 ? adapter.autoCueSeconds : 0;
                    deckBCuePointRef.current = cue;
                    if (cue > 0) adapter.seekTo(cue, true);
                    setDeckBCurrentTime(cue);
                },
                onStateChange: (event) => setDeckBIsPlaying(event.data === 1),
            }, { autoCue: autoCueRef.current });
            deckBPlayer.current = adapter;
            return;
        }

        if (!deckBVideoId) return;

        const initB = () => {
            if (deckBPlayer.current) { try { deckBPlayer.current.destroy(); } catch (e) { } }
            deckBPlayer.current = new window.YT.Player('youtube-player-deck-b', {
                height: '100%',
                width: '100%',
                videoId: deckBVideoId,
                playerVars: { playsinline: 1, controls: 0, rel: 0, origin: window.location.origin },
                events: {
                    onReady: (event: any) => {
                        const vol = Math.floor(assistLevelRef.current * 100 * (volBRef.current / 100));
                        event.target.setVolume(vol);
                        deckBCuePointRef.current = 0;
                    },
                    onStateChange: (event: any) => setDeckBIsPlaying(event.data === 1),
                }
            });
        };

        if (window.YT && window.YT.Player) initB();
        else {
            const interval = setInterval(() => {
                if (window.YT && window.YT.Player) { clearInterval(interval); initB(); }
            }, 100);
        }
    }, [deckBKind, deckBVideoId, deckBLocalTrack]);

    // ---- Position polling (both decks, either kind — drives the shared scrubber) ----
    useEffect(() => {
        const interval = setInterval(() => {
            if (deckReady(deckAPlayer.current)) {
                setDeckACurrentTime(deckAPlayer.current.getCurrentTime());
                const d = deckAPlayer.current.getDuration();
                if (d) setDeckADuration(d);
            }
        }, 250);
        return () => clearInterval(interval);
    }, [deckAKind, deckAVideoId, deckALocalTrack]);

    useEffect(() => {
        const interval = setInterval(() => {
            if (deckReady(deckBPlayer.current)) {
                setDeckBCurrentTime(deckBPlayer.current.getCurrentTime());
                const d = deckBPlayer.current.getDuration();
                if (d) setDeckBDuration(d);
            }
        }, 250);
        return () => clearInterval(interval);
    }, [deckBKind, deckBVideoId, deckBLocalTrack]);

    // ---- Transport: Cue / Set / Play / Stop (uniform across YouTube and local decks) ----
    const handleSetA = () => { if (deckReady(deckAPlayer.current)) deckACuePointRef.current = deckAPlayer.current.getCurrentTime(); };
    const handleCueA = () => {
        deckAPlayer.current?.seekTo(deckACuePointRef.current, true);
        deckAPlayer.current?.pauseVideo();
        setDeckACurrentTime(deckACuePointRef.current);
    };
    // A real Play/Pause toggle — this used to always call playVideo(), which was
    // invisible while the button only ever said "Play." Once the redesign started
    // showing a Pause icon/label while playing, clicking it re-called playVideo()
    // (a no-op on an already-playing deck), so pause silently never happened.
    const handlePlayA = () => (deckAIsPlaying ? deckAPlayer.current?.pauseVideo() : deckAPlayer.current?.playVideo());
    const handleStopA = () => { deckAPlayer.current?.pauseVideo(); deckAPlayer.current?.seekTo(0, true); setDeckACurrentTime(0); };
    const seekDeckA = (seconds: number) => { deckAPlayer.current?.seekTo(seconds, true); setDeckACurrentTime(seconds); };

    const handleSetB = () => { if (deckReady(deckBPlayer.current)) deckBCuePointRef.current = deckBPlayer.current.getCurrentTime(); };
    const handleCueB = () => {
        deckBPlayer.current?.seekTo(deckBCuePointRef.current, true);
        deckBPlayer.current?.pauseVideo();
        setDeckBCurrentTime(deckBCuePointRef.current);
    };
    const handlePlayB = () => (deckBIsPlaying ? deckBPlayer.current?.pauseVideo() : deckBPlayer.current?.playVideo());
    const handleStopB = () => { deckBPlayer.current?.pauseVideo(); deckBPlayer.current?.seekTo(0, true); setDeckBCurrentTime(0); };
    const seekDeckB = (seconds: number) => { deckBPlayer.current?.seekTo(seconds, true); setDeckBCurrentTime(seconds); };

    // ---- Live pitch/tempo updates (only meaningful for local decks) ----
    useEffect(() => {
        if (deckAKind === 'local' && deckAPlayer.current instanceof LocalAudioDeckAdapter) {
            deckAPlayer.current.setPitchSemitones(deckAPitch);
            deckAPlayer.current.setTempo(deckATempo);
        }
    }, [deckAPitch, deckATempo, deckAKind]);

    useEffect(() => {
        if (deckBKind === 'local' && deckBPlayer.current instanceof LocalAudioDeckAdapter) {
            deckBPlayer.current.setPitchSemitones(deckBPitch);
            deckBPlayer.current.setTempo(deckBTempo);
        }
    }, [deckBPitch, deckBTempo, deckBKind]);

    // ---- Igualar: copy pitch from one local deck to the other (no BPM matching — no
    // BPM detection exists — so tempo is left untouched) ----
    const igualarEnabled = deckAKind === 'local' && deckBKind === 'local';
    const igualarBtoA = () => { if (igualarEnabled) setDeckAPitch(deckBPitch); };
    const igualarAtoB = () => { if (igualarEnabled) setDeckBPitch(deckAPitch); };

    // ---- Volume crossfader logic — applies to both decks uniformly, except: once
    // an external "Program" window is connected, a YouTube deck's real audio has
    // moved there, so it's silenced here to avoid playing twice. Local decks can
    // never move (see note above `onAirChannelRef`), so they're never muted by this.
    useEffect(() => {
        if (deckAPlayer.current) {
            const muted = externalConnected && deckAKind === 'youtube';
            const vol = muted ? 0 : Math.floor((1 - assistLevel) * 100 * (volA / 100));
            deckAPlayer.current.setVolume(vol);
            if (vol > 0 && deckReady(deckAPlayer.current) && deckAPlayer.current.isMuted()) deckAPlayer.current.unMute();
        }
        if (deckBPlayer.current) {
            const muted = externalConnected && deckBKind === 'youtube';
            const vol = muted ? 0 : Math.floor(assistLevel * 100 * (volB / 100));
            deckBPlayer.current.setVolume(vol);
            if (vol > 0 && deckReady(deckBPlayer.current) && deckBPlayer.current.isMuted()) deckBPlayer.current.unMute();
        }
    }, [assistLevel, volA, volB, externalConnected, deckAKind, deckBKind]);

    // ---- Auto Crossfade: as the on-air deck nears its end, ramp the crossfader
    // over to the other deck (if it has something loaded) ----
    const rampCrossfadeTo = (target: number) => {
        if (rampingRef.current) return;
        rampingRef.current = true;
        const start = assistLevelRef.current;
        const startTime = Date.now();
        const step = () => {
            const elapsed = Date.now() - startTime;
            const t = Math.min(elapsed / AUTO_CROSSFADE_RAMP_MS, 1);
            setAssistLevel(start + (target - start) * t);
            if (t < 1) requestAnimationFrame(step);
            else rampingRef.current = false;
        };
        requestAnimationFrame(step);
    };

    useEffect(() => {
        if (!autoCrossfade) return;
        const interval = setInterval(() => {
            const deck = onAirDeck();
            const activeDuration = deck === 'A' ? deckADuration : deckBDuration;
            const activeTime = deck === 'A' ? deckACurrentTime : deckBCurrentTime;
            const otherLoaded = deck === 'A' ? (deckBVideoId || deckBLocalTrack) : (deckAVideoId || deckALocalTrack);
            if (!activeDuration || !otherLoaded) return;
            const remaining = activeDuration - activeTime;
            if (remaining > 0 && remaining < AUTO_CROSSFADE_THRESHOLD_SECONDS) {
                rampCrossfadeTo(deck === 'A' ? 1 : 0);
            }
        }, 1000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoCrossfade, assistLevel, volA, volB, deckACurrentTime, deckADuration, deckBCurrentTime, deckBDuration, deckAVideoId, deckALocalTrack, deckBVideoId, deckBLocalTrack]);

    // screenfull.toggle() returns a promise that can reject (permissions denied,
    // browser quirks, etc.) — it was never awaited/caught before, so a failure was
    // completely silent: the button visually "did nothing." Now it either succeeds,
    // or falls back to the CSS-only fullscreen below, or (only if even that can't
    // apply) tells the user plainly instead of doing nothing.
    const toggleFullscreen = () => {
        if (!videoRowRef.current || !screenfull.isEnabled) {
            setCssFullscreen((v) => !v);
            return;
        }
        try {
            const result = screenfull.toggle(videoRowRef.current);
            result?.catch(() => setCssFullscreen((v) => !v));
        } catch {
            setCssFullscreen((v) => !v);
        }
    };

    useEffect(() => {
        const handler = () => setIsFullscreen(screenfull.isFullscreen);
        if (screenfull.isEnabled) screenfull.on('change', handler);
        return () => { if (screenfull.isEnabled) screenfull.off('change', handler); };
    }, []);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            // No elevated z-index here on purpose: it used to be z-2000, back when the
            // toolbar's Opciones de Sorteo/Configuración buttons were `fixed` at viewport
            // corners and needed covering. They're an in-flow sticky toolbar now, so they
            // no longer overlap this screen — and the old z-2000 was instead outranking
            // the app's own z-100 modals (Opciones de Sorteo, Configuración) whenever one
            // was opened from here, rendering them uninteractable underneath the player.
            className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8 space-y-8 relative"
        >
            <div className="text-center space-y-4 relative z-10 w-full max-w-4xl">
                {song ? (
                    <div className="space-y-1">
                        <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-linear-to-r from-[#FF3B81] to-[#00B7ED] uppercase italic drop-shadow-lg">
                            ¡A ESCENARIO!
                        </h2>
                        <p className="text-white font-bold text-xl tracking-widest text-shadow">
                            {song.titulo} <span className="opacity-50">—</span> {song.artista || "Desconocido"}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-linear-to-r from-[#FF3B81] to-[#00B7ED] uppercase italic drop-shadow-lg">
                            Karaokey Pro
                        </h2>
                        <p className="text-white/40 font-bold text-xs tracking-widest uppercase">
                            by LSF Producciones
                        </p>
                        <p className="text-white/60 font-bold text-sm tracking-widest text-shadow">
                            MEZCLADOR DJ — Cargá cualquier tema en Deck A o Deck B
                        </p>
                    </div>
                )}

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

            <div className="w-full max-w-6xl mx-auto space-y-6 relative z-10">
                {!cssFullscreen && (
                    <div className="flex justify-center">
                        <button
                            onClick={toggleFullscreen}
                            className="px-6 py-3 bg-linear-to-r from-neon-pink/20 to-neon-blue/20 border border-white/20 rounded-2xl text-white hover:from-neon-pink/30 hover:to-neon-blue/30 hover:border-white/30 hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center gap-2 text-sm font-bold uppercase tracking-widest shadow-lg"
                            title="Pantalla Completa"
                        >
                            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />} Pantalla Completa
                        </button>
                    </div>
                )}

                {/* Simple mode has the whole width to itself — a wider column than Pro's
                    two-up grid gives the single deck's video real prominence instead of
                    floating in a narrow strip. cssFullscreen covers the CSS-only fallback
                    (iOS Safari won't grant real Fullscreen API access to a non-<video>
                    element) — it can't hide the browser chrome, but it does fill the
                    screen, so the button does something real there instead of nothing. */}
                <div
                    ref={videoRowRef}
                    className={
                        cssFullscreen
                            ? "fixed inset-0 z-9999 bg-black p-4 overflow-y-auto content-start grid grid-cols-1 gap-6" + (simple ? "" : " md:grid-cols-2")
                            : (simple ? "grid grid-cols-1 gap-6 bg-[#0a0a0a] max-w-3xl mx-auto w-full" : "grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#0a0a0a]")
                    }
                >
                    {cssFullscreen && (
                        // A normal in-flow button, not another `fixed` one — this container
                        // is itself trapped inside an ancestor with a CSS transform (framer-
                        // motion's animate={{y:...}}), which makes any `position:fixed`
                        // descendant behave like `absolute` relative to that ancestor instead
                        // of truly escaping to the viewport. A fixed exit button here would
                        // end up wherever that trapped stacking context happens to place it —
                        // this way it's always exactly where it visually appears, reachable.
                        <button
                            onClick={toggleFullscreen}
                            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-bold uppercase tracking-widest cursor-pointer transition-all ${simple ? '' : 'md:col-span-2'}`}
                        >
                            <Minimize2 size={16} /> Salir de Pantalla Completa
                        </button>
                    )}
                    <DeckPanel
                        label="DECK A"
                        accent="pink"
                        videoElementId="youtube-player-deck-a"
                        kind={deckAKind}
                        localTrack={deckALocalTrack}
                        loadingInitial={loading && !deckAVideoId}
                        isPlaying={deckAIsPlaying}
                        currentTime={deckACurrentTime}
                        duration={deckADuration}
                        onSeek={seekDeckA}
                        onCue={handleCueA}
                        onSet={handleSetA}
                        onPlay={handlePlayA}
                        onStop={handleStopA}
                        pitch={deckAPitch}
                        tempo={deckATempo}
                        onPitchChange={setDeckAPitch}
                        onTempoChange={setDeckATempo}
                        youtubeVideos={deckAAlternatives}
                        youtubeSelectedId={deckAVideoId}
                        onSelectYoutube={selectDeckAYoutube}
                        onSearchResults={setDeckAAlternatives}
                        localTracks={localTracks}
                        onSelectLocal={selectDeckALocal}
                        onUpload={uploadLocalTrack}
                        uploading={uploadingLocal}
                        cancionero={cancionero}
                        onLoadFromCancionero={loadCancionIntoDeckA}
                        searchingCancion={deckASearching}
                        volume={simple ? volA : undefined}
                        onVolumeChange={simple ? setVolA : undefined}
                    />
                    {!simple && (
                        <DeckPanel
                            label="DECK B"
                            accent="blue"
                            videoElementId="youtube-player-deck-b"
                            kind={deckBKind}
                            localTrack={deckBLocalTrack}
                            isPlaying={deckBIsPlaying}
                            currentTime={deckBCurrentTime}
                            duration={deckBDuration}
                            onSeek={seekDeckB}
                            onCue={handleCueB}
                            onSet={handleSetB}
                            onPlay={handlePlayB}
                            onStop={handleStopB}
                            pitch={deckBPitch}
                            tempo={deckBTempo}
                            onPitchChange={setDeckBPitch}
                            onTempoChange={setDeckBTempo}
                            youtubeVideos={deckBAlternatives}
                            youtubeSelectedId={deckBVideoId}
                            onSelectYoutube={selectDeckBYoutube}
                            onSearchResults={setDeckBAlternatives}
                            localTracks={localTracks}
                            onSelectLocal={selectDeckBLocal}
                            onUpload={uploadLocalTrack}
                            uploading={uploadingLocal}
                            cancionero={cancionero}
                            onLoadFromCancionero={loadCancionIntoDeckB}
                            searchingCancion={deckBSearching}
                        />
                    )}
                </div>

                {/* MIXER STRIP — Pro only. Simple accounts get one deck, no crossfader,
                    no Vol A/B, no Igualar/Auto Crossfade, and no Pantalla Externa. */}
                {!simple && (
                <div className="glass-card p-6 rounded-3xl border border-white/5 bg-black/40 backdrop-blur-xl space-y-6">
                    <div className="flex flex-col md:flex-row items-center gap-8 justify-between">
                        <button
                            onClick={() => setAssistLevel(0)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-widest transition-all cursor-pointer ${assistLevel === 0 ? "bg-neon-pink text-white shadow-lg shadow-[#FF3B81]/30" : "text-white/50 hover:bg-white/10"}`}
                        >
                            Solo Deck A
                        </button>

                        <div className="flex-1 w-full max-w-md flex flex-col items-center gap-3">
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neon-blue">
                                <Volume2 size={14} />
                                <span>Crossfader</span>
                            </div>
                            <div className="relative w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                                <div
                                    className="absolute top-0 left-0 h-full bg-linear-to-r from-[#FF3B81] to-[#00B7ED]"
                                    style={{ width: `${assistLevel * 100}%` }}
                                />
                                <input
                                    type="range" min="0" max="1" step="0.01" value={assistLevel}
                                    onChange={(e) => setAssistLevel(parseFloat(e.target.value))}
                                    className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                                />
                            </div>
                            <div className="flex justify-between items-center w-full text-[10px] font-bold text-white/30 uppercase tracking-widest">
                                <span>A</span>
                                <button onClick={() => setAssistLevel(0.5)} className="hover:text-white/70 cursor-pointer transition-colors">50</button>
                                <span>B</span>
                            </div>
                        </div>

                        <button
                            onClick={() => setAssistLevel(1)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-widest transition-all cursor-pointer ${assistLevel === 1 ? "bg-neon-blue text-white shadow-lg shadow-[#00B7ED]/30" : "text-white/50 hover:bg-white/10"}`}
                        >
                            Solo Deck B
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
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

                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                            onClick={igualarBtoA}
                            disabled={!igualarEnabled}
                            title="Copia el tono del Deck B al Deck A"
                            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed border border-white/5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-white/70 cursor-pointer transition-all"
                        >
                            <ArrowLeftRight size={14} /> Igualar B→A
                        </button>
                        <button
                            onClick={igualarAtoB}
                            disabled={!igualarEnabled}
                            title="Copia el tono del Deck A al Deck B"
                            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed border border-white/5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-white/70 cursor-pointer transition-all"
                        >
                            <ArrowLeftRight size={14} /> Igualar A→B
                        </button>
                        <button
                            onClick={() => setAutoCue(v => !v)}
                            className={`px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-all border ${autoCue ? 'bg-neon-blue/20 border-neon-blue/40 text-white' : 'bg-white/5 border-white/5 text-white/50'}`}
                        >
                            Auto Cue {autoCue ? 'ON' : 'OFF'}
                        </button>
                        <button
                            onClick={() => setAutoCrossfade(v => !v)}
                            className={`px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-all border ${autoCrossfade ? 'bg-neon-pink/20 border-neon-pink/40 text-white' : 'bg-white/5 border-white/5 text-white/50'}`}
                        >
                            Auto Crossfade {autoCrossfade ? 'ON' : 'OFF'}
                        </button>
                        <button
                            onClick={openExternalMonitor}
                            title="Abrir la salida de aire (Program) en una segunda pantalla, sin controles"
                            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-white/70 cursor-pointer transition-all"
                        >
                            <MonitorPlay size={14} /> Pantalla Externa
                        </button>
                    </div>
                </div>
                )}

                <div className="flex flex-wrap gap-4 justify-center pt-2">
                    <button
                        onClick={onBack}
                        className="px-6 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2 font-bold uppercase tracking-widest text-sm cursor-pointer hover:shadow-lg hover:shadow-white/5 group"
                    >
                        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" /> Menú Principal
                    </button>
                    {onNext && (
                        <button
                            onClick={onNext}
                            className="px-8 py-3 rounded-2xl bg-linear-to-r from-[#FF3B81] to-[#9D4EDD] hover:scale-105 active:scale-95 transition-all flex items-center gap-2 font-bold uppercase tracking-widest text-sm cursor-pointer"
                        >
                            <RefreshCw size={18} className="animate-[spin_4s_linear_infinite]" /> Siguiente Sorteo
                        </button>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

interface DeckPanelProps {
    label: string;
    accent: 'pink' | 'blue';
    videoElementId: string;
    kind: DeckKind;
    localTrack: LocalAudioRow | null;
    loadingInitial?: boolean;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    onSeek: (seconds: number) => void;
    onCue: () => void;
    onSet: () => void;
    onPlay: () => void;
    onStop: () => void;
    pitch: number;
    tempo: number;
    onPitchChange: (n: number) => void;
    onTempoChange: (n: number) => void;
    youtubeVideos: VideoResult[];
    youtubeSelectedId: string | null;
    onSelectYoutube: (id: string) => void;
    onSearchResults: (videos: VideoResult[]) => void;
    localTracks: LocalAudioRow[];
    onSelectLocal: (track: LocalAudioRow) => void;
    onUpload: (file: File) => void;
    uploading: boolean;
    cancionero?: { titulo: string; artista?: string }[];
    onLoadFromCancionero: (cancion: { titulo: string; artista?: string }) => void;
    searchingCancion: boolean;
    // Only set for Deck A in Simple mode — Pro mode controls volume via the
    // mixer strip's Vol A/Vol B sliders instead, so this stays undefined there.
    volume?: number;
    onVolumeChange?: (n: number) => void;
}

// One self-contained deck: video/audio area, shared transport, pitch/tempo, and its
// own source panel (search YouTube, pick from the local library, or load straight
// from the app's saved Cancionero) — fully independent of the other deck.
function DeckPanel(props: DeckPanelProps) {
    const accentText = props.accent === 'pink' ? 'text-neon-pink' : 'text-neon-blue';
    const accentBg = props.accent === 'pink' ? 'bg-neon-pink' : 'bg-neon-blue';
    const accentShadow = props.accent === 'pink' ? 'shadow-[#FF3B81]/30' : 'shadow-[#00B7ED]/30';
    const accentRange = props.accent === 'pink' ? 'accent-[#FF3B81]' : 'accent-[#00B7ED]';
    const hasTrack = (props.kind === 'youtube' && !!props.youtubeSelectedId) || (props.kind === 'local' && !!props.localTrack);

    // The main video/thumbnail area is the star of the screen — a stronger glow and a
    // live pulse while playing gives it real presence instead of blending into the
    // smaller cards below it (which now deliberately look like a pick-list, not a
    // second player — see VideoOptionsList/LocalTrackList/CancioneroTrackList).
    const accentGlow = props.accent === 'pink' ? 'shadow-[#FF3B81]/20' : 'shadow-[#00B7ED]/20';
    const accentRing = props.accent === 'pink' ? 'ring-neon-pink/50' : 'ring-neon-blue/50';

    return (
        <div className="space-y-3">
            <div className={`text-xs font-bold uppercase tracking-widest ${accentText}`}>{props.label}</div>

            <div className={`relative rounded-3xl overflow-hidden glass-card neon-border aspect-video shadow-2xl bg-black transition-all ${hasTrack ? `ring-2 ${accentRing} shadow-[0_0_40px_-8px] ${accentGlow}` : 'shadow-black/50'}`}>
                {/* Always mounted (visibility toggled via opacity, never conditionally
                    rendered) — the YouTube IFrame API replaces the sibling video div below
                    with its own <iframe> outside of React's tracking, so a sibling that
                    mounts/unmounts here (as this badge briefly did) makes React's next
                    reconciliation try to insertBefore/removeChild against a DOM node it no
                    longer recognizes, crashing with a NotFoundError. */}
                <div className={`absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full transition-opacity ${props.isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${accentBg} animate-pulse`} />
                    <span className="text-white text-[10px] font-bold uppercase tracking-widest">Sonando</span>
                </div>
                {props.kind === 'youtube' && props.youtubeSelectedId ? (
                    <div id={props.videoElementId} className="w-full h-full" />
                ) : props.kind === 'local' && props.localTrack ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6">
                        <Music size={40} className={accentText} />
                        <p className="text-white font-bold text-center">{props.localTrack.titulo}</p>
                        {props.localTrack.artista && <p className="text-white/50 text-sm">{props.localTrack.artista}</p>}
                    </div>
                ) : props.loadingInitial ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                        <div className={`animate-spin rounded-full h-12 w-12 border-t-4 ${props.accent === 'pink' ? 'border-neon-pink' : 'border-neon-blue'} border-r-transparent`} />
                        <p className="text-white font-bold text-xs tracking-widest animate-pulse">BUSCANDO PISTA...</p>
                    </div>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/30">
                        <Music size={32} />
                        <p className="text-xs font-bold uppercase tracking-widest">Sin pista cargada</p>
                    </div>
                )}
            </div>

            {props.onVolumeChange !== undefined ? (
                // Simple mode — one compact, YouTube-style bar: seek row, then Play/Pause
                // as a circular primary button with volume inline next to it (mirroring
                // where YouTube's own player puts them), Cue/Set as small secondary icons,
                // Stop tucked at the end. Replaces the separate transport/Volumen cards
                // Pro mode still uses below.
                <div className="glass-card p-3 rounded-2xl border border-white/5 bg-black/30 space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/40 font-mono w-10 shrink-0">{formatTime(props.currentTime)}</span>
                        <input
                            type="range" min={0} max={props.duration || 0} step={0.1}
                            value={props.currentTime} disabled={!hasTrack}
                            onChange={(e) => props.onSeek(parseFloat(e.target.value))}
                            className={`flex-1 ${accentRange} ${hasTrack ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
                        />
                        <span className="text-[10px] text-white/40 font-mono w-10 shrink-0 text-right">{formatTime(props.duration)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={props.onPlay} disabled={!hasTrack}
                            title={props.isPlaying ? 'Pausar' : 'Play'}
                            className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all disabled:cursor-not-allowed ${hasTrack ? `${accentBg} text-white shadow-lg ${accentShadow} hover:brightness-110 active:scale-95 cursor-pointer` : 'bg-white/5 text-white/30'}`}
                        >
                            {props.isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                        </button>
                        <button
                            onClick={props.onCue} disabled={!hasTrack} title="Cue"
                            className="shrink-0 p-2.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/60 cursor-pointer transition-all"
                        >
                            <SkipBack size={16} />
                        </button>
                        <button
                            onClick={props.onSet} disabled={!hasTrack} title="Set"
                            className="shrink-0 p-2.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/60 cursor-pointer transition-all"
                        >
                            <Flag size={16} />
                        </button>
                        <div className="flex-1 flex items-center gap-2 min-w-0 pl-1">
                            <Volume2 size={16} className={`shrink-0 ${accentText}`} />
                            <input
                                type="range" min="0" max="100" step="1" value={props.volume}
                                onChange={(e) => props.onVolumeChange!(parseInt(e.target.value))}
                                className={`flex-1 w-full min-w-0 h-1.5 ${accentRange} cursor-pointer`}
                            />
                            <span className="shrink-0 text-[10px] font-bold text-white/50 w-8 text-right">{props.volume}%</span>
                        </div>
                        <button
                            onClick={props.onStop} disabled={!hasTrack} title="Stop"
                            className="shrink-0 p-2.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/40 cursor-pointer transition-all"
                        >
                            <Square size={14} />
                        </button>
                    </div>
                    {props.kind === 'youtube' && isIOSDevice() && (
                        <p className="text-[10px] text-white/40 leading-relaxed px-1">
                            En iPhone/iPad, Apple no deja que ninguna app web controle el volumen de un video de YouTube — usá los botones físicos de volumen del celular.
                        </p>
                    )}
                </div>
            ) : (
                <div className="glass-card p-3 rounded-2xl border border-white/5 bg-black/30 space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/40 font-mono w-10 shrink-0">{formatTime(props.currentTime)}</span>
                        <input
                            type="range" min={0} max={props.duration || 0} step={0.1}
                            value={props.currentTime} disabled={!hasTrack}
                            onChange={(e) => props.onSeek(parseFloat(e.target.value))}
                            className={`flex-1 ${accentRange} ${hasTrack ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
                        />
                        <span className="text-[10px] text-white/40 font-mono w-10 shrink-0 text-right">{formatTime(props.duration)}</span>
                    </div>
                    {/* Play/Pause is the primary action — always colored and front-and-center,
                        unlike Cue/Set/Stop which stay as secondary ghost buttons. Matches how
                        every real media player weights its controls. */}
                    <div className="grid grid-cols-4 gap-2 items-stretch">
                        <button
                            onClick={props.onCue} disabled={!hasTrack}
                            className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/70 text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-all"
                        >
                            <SkipBack size={14} /> Cue
                        </button>
                        <button
                            onClick={props.onSet} disabled={!hasTrack}
                            className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/70 text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-all"
                        >
                            <Flag size={14} /> Set
                        </button>
                        <button
                            onClick={props.onPlay} disabled={!hasTrack}
                            className={`col-span-2 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all ${hasTrack ? `${accentBg} text-white shadow-lg ${accentShadow} hover:brightness-110 active:scale-[0.98]` : 'bg-white/5 text-white/40'}`}
                        >
                            {props.isPlaying ? <Pause size={16} /> : <Play size={16} />} {props.isPlaying ? 'Pausar' : 'Play'}
                        </button>
                    </div>
                    <button
                        onClick={props.onStop} disabled={!hasTrack}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/50 text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-all"
                    >
                        <Square size={12} /> Stop
                    </button>
                </div>
            )}

            {/* YouTube never exposes decoded audio to the page (no JS API can), so pitch/
                tempo can only ever work on local uploads — showing a permanently-disabled
                slider for YouTube decks was just clutter with no path to working. Hidden
                outright instead of shown-and-greyed-out. */}
            {props.kind === 'local' && (
            <div className="glass-card p-4 rounded-2xl border border-white/5 bg-black/20">
                <PitchTempoControls
                    label="Tono / Tempo"
                    pitch={props.pitch}
                    tempo={props.tempo}
                    onPitchChange={props.onPitchChange}
                    onTempoChange={props.onTempoChange}
                    accent={props.accent}
                />
            </div>
            )}

            <DeckSourcePanel
                label="Cargar en este deck"
                icon={<Music size={16} />}
                accent={props.accent}
                kind={props.kind}
                youtubeVideos={props.youtubeVideos}
                youtubeSelectedId={props.youtubeSelectedId}
                onSelectYoutube={props.onSelectYoutube}
                onSearchResults={props.onSearchResults}
                localTracks={props.localTracks}
                localSelectedId={props.localTrack?.id ?? null}
                onSelectLocal={props.onSelectLocal}
                onUpload={props.onUpload}
                uploading={props.uploading}
                cancionero={props.cancionero}
                onLoadFromCancionero={props.onLoadFromCancionero}
                searchingCancion={props.searchingCancion}
            />
        </div>
    );
}

interface VideoOptionsListProps {
    label?: string;
    icon?: React.ReactNode;
    videos: VideoResult[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    accent: 'pink' | 'blue';
}

// Deliberately a compact row list — small fixed-size thumbnail + title/channel — the
// same shape real YouTube search results use, not a second set of big video cards.
// Full-width aspect-video cards here used to visually compete with (and get mistaken
// for) the actual player above; a small thumbnail in a list row reads unambiguously
// as "pick one of these," never as a second player.
function VideoOptionsList({ label, icon, videos, selectedId, onSelect, accent }: VideoOptionsListProps) {
    if (videos.length === 0) return null;

    const accentClasses = accent === 'pink'
        ? { selected: 'bg-neon-pink/10 border-neon-pink/50', badge: 'bg-neon-pink', border: 'border-l-neon-pink' }
        : { selected: 'bg-neon-blue/10 border-neon-blue/50', badge: 'bg-neon-blue', border: 'border-l-neon-blue' };

    return (
        <div className="space-y-2">
            {label && (
                <div className="flex items-center gap-2 text-white/60 font-bold uppercase text-xs tracking-widest">
                    {icon} {label}
                </div>
            )}
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                {videos.map((video) => {
                    const active = selectedId === video.id;
                    return (
                        <button
                            key={video.id}
                            onClick={() => onSelect(video.id)}
                            className={`w-full group flex items-center gap-3 p-2 pr-3 rounded-xl transition-all border border-l-4 cursor-pointer text-left ${active
                                ? `${accentClasses.selected} ${accentClasses.border}`
                                : 'bg-white/5 border-white/5 border-l-transparent hover:border-white/10 hover:bg-white/10'
                                }`}
                        >
                            <div className="relative w-24 h-14 shrink-0 rounded-lg overflow-hidden pointer-events-none bg-black">
                                <Image
                                    src={video.thumbnail}
                                    alt={video.title}
                                    fill
                                    sizes="96px"
                                    className="object-cover"
                                    unoptimized
                                />
                            </div>
                            <div className="min-w-0 flex-1 pointer-events-none">
                                <p className={`text-xs font-bold line-clamp-2 leading-snug ${active ? 'text-white' : 'text-white/70'}`}>
                                    {video.title}
                                </p>
                                {video.channel && (
                                    <p className="text-[10px] text-white/40 line-clamp-1 mt-0.5">{video.channel}</p>
                                )}
                            </div>
                            {active && (
                                <div className={`shrink-0 w-5 h-5 rounded-full ${accentClasses.badge} flex items-center justify-center pointer-events-none`}>
                                    <Check size={12} className="text-white" strokeWidth={3} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

interface PitchTempoControlsProps {
    label: string;
    pitch: number;
    tempo: number;
    onPitchChange: (n: number) => void;
    onTempoChange: (n: number) => void;
    accent: 'pink' | 'blue';
}

// Real pitch (±12 semitones) / tempo (%) controls — only ever rendered for local decks
// (the caller hides this entirely for YouTube ones), so always enabled here.
// A YouTube iframe embed never exposes decoded audio to the page, so these stay
// disabled (and clearly labeled) whenever that deck is playing from YouTube.
function PitchTempoControls({ label, pitch, tempo, onPitchChange, onTempoChange, accent }: PitchTempoControlsProps) {
    const accentText = accent === 'pink' ? 'text-neon-pink' : 'text-neon-blue';
    const accentAccent = accent === 'pink' ? 'accent-[#FF3B81]' : 'accent-[#00B7ED]';

    return (
        <div className="space-y-3">
            <div className={`text-[10px] font-bold uppercase tracking-widest ${accentText}`}>
                {label}
            </div>
            <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-white/50 uppercase tracking-widest">
                    <span>Tono</span><span>{pitch > 0 ? '+' : ''}{pitch}</span>
                </div>
                <input
                    type="range" min="-12" max="12" step="1" value={pitch}
                    onChange={(e) => onPitchChange(parseInt(e.target.value))}
                    className={`w-full ${accentAccent} cursor-pointer`}
                />
            </div>
            <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-white/50 uppercase tracking-widest">
                    <span>Tempo</span><span>{tempo}%</span>
                </div>
                <input
                    type="range" min="50" max="150" step="1" value={tempo}
                    onChange={(e) => onTempoChange(parseInt(e.target.value))}
                    className={`w-full ${accentAccent} cursor-pointer`}
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

// Manual YouTube search — lets the host load any video into this deck, not just the
// auto-fetched karaoke top-5 (and is now the only way to load an "original vocal"
// version, since that's no longer searched/paired automatically).
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
                channel: item.snippet.channelTitle,
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
            <div className="relative flex-1 min-w-0">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
                    placeholder={placeholder}
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder:text-white/30 outline-hidden focus:border-white/30"
                />
            </div>
            <button
                onClick={doSearch}
                disabled={searching}
                className="shrink-0 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold uppercase tracking-widest transition-all cursor-pointer disabled:opacity-50"
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
        ? { selected: 'bg-neon-pink/10 border-neon-pink/50', badge: 'bg-neon-pink', border: 'border-l-neon-pink', icon: 'bg-neon-pink/15 text-neon-pink' }
        : { selected: 'bg-neon-blue/10 border-neon-blue/50', badge: 'bg-neon-blue', border: 'border-l-neon-blue', icon: 'bg-neon-blue/15 text-neon-blue' };

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
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                    {tracks.map((track) => {
                        const active = selectedId === track.id;
                        return (
                            <button
                                key={track.id}
                                onClick={() => onSelect(track)}
                                className={`w-full text-left flex items-center gap-3 p-2.5 pr-3 rounded-xl transition-all border border-l-4 cursor-pointer ${active ? `${accentClasses.selected} ${accentClasses.border}` : 'bg-white/5 border-white/5 border-l-transparent hover:border-white/10 hover:bg-white/10'}`}
                            >
                                <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${active ? accentClasses.icon : 'bg-white/10 text-white/40'}`}>
                                    <Music size={16} />
                                </div>
                                <span className={`text-xs font-bold line-clamp-1 flex-1 ${active ? 'text-white' : 'text-white/70'}`}>{track.titulo}</span>
                                {active && (
                                    <div className={`shrink-0 w-5 h-5 rounded-full ${accentClasses.badge} flex items-center justify-center`}>
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

type SourceTab = DeckKind | 'cancionero';

interface DeckSourcePanelProps {
    label: string;
    icon: React.ReactNode;
    accent: 'pink' | 'blue';
    kind: DeckKind;
    youtubeVideos: VideoResult[];
    youtubeSelectedId: string | null;
    onSelectYoutube: (id: string) => void;
    onSearchResults: (videos: VideoResult[]) => void;
    localTracks: LocalAudioRow[];
    localSelectedId: string | null;
    onSelectLocal: (track: LocalAudioRow) => void;
    onUpload: (file: File) => void;
    uploading: boolean;
    cancionero?: { titulo: string; artista?: string }[];
    onLoadFromCancionero: (cancion: { titulo: string; artista?: string }) => void;
    searchingCancion: boolean;
}

// One deck's source panel: a tab switch between searching YouTube, picking from the
// local pitch/tempo-capable library, or loading straight from the app's Cancionero.
function DeckSourcePanel(props: DeckSourcePanelProps) {
    const [tab, setTab] = useState<SourceTab>(props.kind);
    const accentActive = props.accent === 'pink' ? 'bg-neon-pink text-white' : 'bg-neon-blue text-white';
    const hasCancionero = !!props.cancionero && props.cancionero.length > 0;

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-white/60 font-bold uppercase text-xs tracking-widest">
                {props.icon} {props.label}
            </div>
            <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/5">
                {hasCancionero && (
                    <button
                        onClick={() => setTab('cancionero')}
                        className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer ${tab === 'cancionero' ? `${accentActive} shadow-md` : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
                    >
                        <ListMusic size={14} /> Mi Cancionero
                    </button>
                )}
                <button
                    onClick={() => setTab('youtube')}
                    className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer ${tab === 'youtube' ? `${accentActive} shadow-md` : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
                >
                    <Search size={14} /> Buscar YouTube
                </button>
                <button
                    onClick={() => setTab('local')}
                    className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer ${tab === 'local' ? `${accentActive} shadow-md` : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
                >
                    <Library size={14} /> Mi Biblioteca
                </button>
            </div>
            {tab === 'cancionero' ? (
                <CancioneroTrackList
                    cancionero={props.cancionero ?? []}
                    onSelect={props.onLoadFromCancionero}
                    searching={props.searchingCancion}
                    accent={props.accent}
                />
            ) : tab === 'youtube' ? (
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

interface CancioneroTrackListProps {
    cancionero: { titulo: string; artista?: string }[];
    onSelect: (cancion: { titulo: string; artista?: string }) => void;
    searching: boolean;
    accent: 'pink' | 'blue';
}

// Lets the host load a song straight from the app's own saved Cancionero (built via
// the existing bulk-paste/channel/playlist import) into this deck — searches and
// caches a karaoke video for it on click, same as the sorteo auto-load does for Deck A.
function CancioneroTrackList({ cancionero, onSelect, searching, accent }: CancioneroTrackListProps) {
    const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
    const accentClasses = accent === 'pink'
        ? { border: 'hover:border-neon-pink/40', icon: 'group-hover:bg-neon-pink/15 group-hover:text-neon-pink' }
        : { border: 'hover:border-neon-blue/40', icon: 'group-hover:bg-neon-blue/15 group-hover:text-neon-blue' };

    if (cancionero.length === 0) {
        return <p className="text-xs text-white/30 text-center py-4">Tu cancionero está vacío.</p>;
    }

    return (
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
            {cancionero.map((cancion, i) => {
                const isLoading = searching && loadingIndex === i;
                return (
                    <button
                        key={`${cancion.titulo}-${i}`}
                        onClick={() => { setLoadingIndex(i); onSelect(cancion); }}
                        disabled={searching}
                        className={`w-full group text-left flex items-center gap-3 p-2.5 pr-3 rounded-xl transition-all border bg-white/5 border-white/5 ${accentClasses.border} disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
                    >
                        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-white/10 text-white/40 transition-colors ${accentClasses.icon}`}>
                            {isLoading ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Music size={16} />
                            )}
                        </div>
                        <span className="text-xs flex-1 min-w-0">
                            <span className="font-bold line-clamp-1 block text-white/80 group-hover:text-white">{cancion.titulo}</span>
                            {cancion.artista && <span className="text-white/40 line-clamp-1 block">{cancion.artista}</span>}
                        </span>
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-white/30 group-hover:text-white/60 transition-colors">
                            {isLoading ? 'Cargando' : 'Cargar'}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
