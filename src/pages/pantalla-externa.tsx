import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';

const ON_AIR_CHANNEL = 'karaokey-on-air';
const HEARTBEAT_MS = 3000;

type DeckInfo = {
    kind: 'youtube' | 'local' | null;
    videoId: string | null;
    titulo: string | null;
    artista: string | null;
};

type MixMessage = {
    type: 'mix';
    assistLevel: number;
    volA: number;
    volB: number;
    deckA: DeckInfo;
    deckB: DeckInfo;
};

type SyncMessage = {
    type: 'sync';
    deck: 'A' | 'B';
    videoId: string;
    currentTime: number;
    isPlaying: boolean;
};

declare global {
    interface Window {
        YT: any;
    }
}

const EMPTY_DECK: DeckInfo = { kind: null, videoId: null, titulo: null, artista: null };

// Creates/replaces a mirrored player for one deck whenever its videoId changes.
// Both decks play continuously and unmuted — the crossfade effect in the component
// is what actually controls how loud each one is, exactly like the main window.
function useMirroredDeck(
    elementId: string,
    info: DeckInfo,
    playerRef: React.MutableRefObject<any>,
    videoIdRef: React.MutableRefObject<string | null>
) {
    useEffect(() => {
        if (info.kind !== 'youtube' || !info.videoId) {
            videoIdRef.current = null;
            return;
        }
        if (videoIdRef.current === info.videoId) return;
        videoIdRef.current = info.videoId;

        const init = () => {
            if (playerRef.current) {
                try { playerRef.current.destroy(); } catch (e) { }
            }
            playerRef.current = new window.YT.Player(elementId, {
                height: '100%',
                width: '100%',
                videoId: info.videoId,
                playerVars: { playsinline: 1, controls: 0, rel: 0, autoplay: 1, origin: window.location.origin },
                events: {
                    onReady: (event: any) => { event.target.playVideo(); },
                },
            });
        };

        if (window.YT && window.YT.Player) init();
        else {
            const interval = setInterval(() => {
                if (window.YT && window.YT.Player) { clearInterval(interval); init(); }
            }, 100);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [info.kind, info.videoId]);
}

// The "Program" output — this is what the audience/singer actually see and hear,
// with zero controls. It runs its own pair of mirrored YouTube players (real audio,
// unmuted) and crossfades them live using the exact same volume formula the main
// control window uses, driven by a continuous BroadcastChannel feed. A locally-
// uploaded deck can never be mirrored here — its Web Audio graph only exists inside
// the main window's JS realm — so it only ever shows a title card, no sound.
export default function PantallaExterna() {
    const [deckA, setDeckA] = useState<DeckInfo>(EMPTY_DECK);
    const [deckB, setDeckB] = useState<DeckInfo>(EMPTY_DECK);
    const [assistLevel, setAssistLevel] = useState(0);
    const [volA, setVolA] = useState(100);
    const [volB, setVolB] = useState(100);

    const deckAPlayer = useRef<any>(null);
    const deckBPlayer = useRef<any>(null);
    const deckAVideoIdRef = useRef<string | null>(null);
    const deckBVideoIdRef = useRef<string | null>(null);

    // Handshake: tell the main window we're here, and keep telling it (heartbeat)
    // so it can detect this tab closing and resume its own audio.
    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel(ON_AIR_CHANNEL);

        const sendHello = () => channel.postMessage({ type: 'hello' });
        sendHello();
        const heartbeat = setInterval(sendHello, HEARTBEAT_MS);

        channel.onmessage = (event: MessageEvent<MixMessage | SyncMessage>) => {
            const msg = event.data;
            if (msg.type === 'mix') {
                setDeckA(msg.deckA);
                setDeckB(msg.deckB);
                setAssistLevel(msg.assistLevel);
                setVolA(msg.volA);
                setVolB(msg.volB);
            } else if (msg.type === 'sync') {
                const player = msg.deck === 'A' ? deckAPlayer.current : deckBPlayer.current;
                const currentVideoId = msg.deck === 'A' ? deckAVideoIdRef.current : deckBVideoIdRef.current;
                if (!player || currentVideoId !== msg.videoId || typeof player.getCurrentTime !== 'function') return;
                const drift = Math.abs(player.getCurrentTime() - msg.currentTime);
                if (drift > 1.5) player.seekTo(msg.currentTime, true);
                if (msg.isPlaying && player.getPlayerState?.() !== 1) player.playVideo();
                if (!msg.isPlaying && player.getPlayerState?.() === 1) player.pauseVideo();
            }
        };

        return () => { clearInterval(heartbeat); channel.close(); };
    }, []);

    useEffect(() => {
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
        }
    }, []);

    useMirroredDeck('pantalla-externa-deck-a', deckA, deckAPlayer, deckAVideoIdRef);
    useMirroredDeck('pantalla-externa-deck-b', deckB, deckBPlayer, deckBVideoIdRef);

    // Live crossfade — identical formula to the main window's mixer, so the audio
    // heard here always matches what the crossfader shows on the control screen.
    useEffect(() => {
        if (deckAPlayer.current && typeof deckAPlayer.current.setVolume === 'function') {
            const v = Math.floor((1 - assistLevel) * 100 * (volA / 100));
            deckAPlayer.current.setVolume(v);
        }
        if (deckBPlayer.current && typeof deckBPlayer.current.setVolume === 'function') {
            const v = Math.floor(assistLevel * 100 * (volB / 100));
            deckBPlayer.current.setVolume(v);
        }
    }, [assistLevel, volA, volB, deckA, deckB]);

    const idle = deckA.kind === null && deckB.kind === null;
    const opacityA = 1 - assistLevel;
    const opacityB = assistLevel;

    return (
        <div className="min-h-screen w-screen bg-black overflow-hidden relative">
            <Head>
                <title>Pantalla Externa — KaraoKey</title>
            </Head>

            {idle ? (
                <div className="min-h-screen w-screen flex items-center justify-center">
                    <p className="text-white/20 text-sm font-bold uppercase tracking-[0.3em]">KaraoKey · En espera</p>
                </div>
            ) : (
                <>
                    <DeckLayer elementId="pantalla-externa-deck-a" info={deckA} opacity={opacityA} />
                    <DeckLayer elementId="pantalla-externa-deck-b" info={deckB} opacity={opacityB} />
                </>
            )}
        </div>
    );
}

function DeckLayer({ elementId, info, opacity }: { elementId: string; info: DeckInfo; opacity: number }) {
    if (info.kind === null) return null;
    return (
        <div
            className="absolute inset-0 flex items-center justify-center transition-opacity duration-150"
            style={{ opacity, pointerEvents: 'none' }}
        >
            {info.kind === 'youtube' ? (
                <div id={elementId} className="w-full h-full" />
            ) : (
                <div className="flex flex-col items-center justify-center gap-4 text-center px-8">
                    <div className="w-3 h-3 rounded-full bg-neon-pink animate-pulse" />
                    <h1 className="text-4xl md:text-6xl font-black text-white uppercase tracking-widest">
                        {info.titulo}
                    </h1>
                    {info.artista && (
                        <p className="text-white/50 text-xl md:text-2xl uppercase tracking-widest">{info.artista}</p>
                    )}
                </div>
            )}
        </div>
    );
}
