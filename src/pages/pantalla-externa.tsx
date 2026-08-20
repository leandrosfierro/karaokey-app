import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';

const ON_AIR_CHANNEL = 'karaokey-on-air';

type OnAirMessage = {
    type: 'on-air';
    deck: 'A' | 'B';
    kind: 'youtube' | 'local' | null;
    videoId: string | null;
    titulo: string | null;
    artista: string | null;
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

// Chrome-free mirror of whichever deck is currently "on air" (louder in the main
// window's mix). Video is muted here on purpose — real audio plays from the main
// window, so this window is a visual-only feed meant for a second monitor/TV.
export default function PantallaExterna() {
    const [onAir, setOnAir] = useState<OnAirMessage | null>(null);
    const playerRef = useRef<any>(null);
    const currentVideoIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel(ON_AIR_CHANNEL);
        channel.onmessage = (event: MessageEvent<OnAirMessage | SyncMessage>) => {
            const msg = event.data;
            if (msg.type === 'on-air') {
                setOnAir(msg);
            } else if (msg.type === 'sync' && playerRef.current && currentVideoIdRef.current === msg.videoId) {
                const player = playerRef.current;
                if (typeof player.getCurrentTime === 'function') {
                    const drift = Math.abs(player.getCurrentTime() - msg.currentTime);
                    if (drift > 1.5) player.seekTo(msg.currentTime, true);
                }
                if (msg.isPlaying && player.getPlayerState?.() !== 1) player.playVideo();
                if (!msg.isPlaying && player.getPlayerState?.() === 1) player.pauseVideo();
            }
        };
        return () => channel.close();
    }, []);

    useEffect(() => {
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
        }
    }, []);

    useEffect(() => {
        if (onAir?.kind !== 'youtube' || !onAir.videoId) {
            currentVideoIdRef.current = null;
            return;
        }
        if (currentVideoIdRef.current === onAir.videoId) return;
        currentVideoIdRef.current = onAir.videoId;

        const init = () => {
            if (playerRef.current) {
                try { playerRef.current.destroy(); } catch (e) { }
            }
            playerRef.current = new window.YT.Player('pantalla-externa-player', {
                height: '100%',
                width: '100%',
                videoId: onAir.videoId,
                playerVars: { playsinline: 1, controls: 0, rel: 0, mute: 1, autoplay: 1, origin: window.location.origin },
                events: {
                    onReady: (event: any) => {
                        event.target.mute();
                        event.target.playVideo();
                    },
                },
            });
        };

        if (window.YT && window.YT.Player) init();
        else {
            const interval = setInterval(() => {
                if (window.YT && window.YT.Player) { clearInterval(interval); init(); }
            }, 100);
        }
    }, [onAir]);

    return (
        <div className="min-h-screen w-screen bg-black flex items-center justify-center overflow-hidden">
            <Head>
                <title>Pantalla Externa — KaraoKey</title>
            </Head>

            {onAir?.kind === 'youtube' && onAir.videoId ? (
                <div id="pantalla-externa-player" className="w-full h-screen" />
            ) : onAir?.kind === 'local' ? (
                <div className="flex flex-col items-center justify-center gap-4 text-center px-8">
                    <div className="w-3 h-3 rounded-full bg-neon-pink animate-pulse" />
                    <h1 className="text-4xl md:text-6xl font-black text-white uppercase tracking-widest">
                        {onAir.titulo}
                    </h1>
                    {onAir.artista && (
                        <p className="text-white/50 text-xl md:text-2xl uppercase tracking-widest">{onAir.artista}</p>
                    )}
                </div>
            ) : (
                <div className="flex flex-col items-center gap-3 text-white/20">
                    <p className="text-sm font-bold uppercase tracking-[0.3em]">KaraoKey · En espera</p>
                </div>
            )}
        </div>
    );
}
