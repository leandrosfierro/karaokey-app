import { PitchShifter } from 'soundtouchjs';

// Mirrors YT.PlayerState numeric values used elsewhere in the app: ENDED=0, PLAYING=1, PAUSED=2.
export type DeckState = 0 | 1 | 2;

export interface DeckReadyEvent {
    target: DeckAdapter;
}

export interface DeckStateChangeEvent {
    data: DeckState;
}

// Structural subset of YT.Player already used by KaraokePlayer.tsx. A real YT.Player
// instance satisfies this interface as-is (TS structural typing), so the existing
// crossfader/sync logic keeps working unchanged for both YouTube and local decks.
export interface DeckAdapter {
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): DeckState;
    setVolume(vol: number): void; // 0-100
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    destroy(): void;
}

interface LocalAudioDeckEvents {
    onReady: (event: DeckReadyEvent) => void;
    onStateChange: (event: DeckStateChangeEvent) => void;
}

interface LocalAudioDeckOptions {
    autoCue?: boolean;
}

const AUTO_CUE_SILENCE_THRESHOLD = 0.01;

// Plays a locally-uploaded audio file through the Web Audio API with real, independent
// pitch/tempo control via soundtouchjs — only possible because we own the raw PCM data,
// unlike a YouTube iframe embed (which never exposes decoded audio to the page).
export class LocalAudioDeckAdapter implements DeckAdapter {
    private audioCtx: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private shifter: PitchShifter | null = null;
    private state: DeckState = 2;
    private muted = false;
    private lastVolume = 100;
    private destroyed = false;
    private events: LocalAudioDeckEvents;
    private autoCue: boolean;

    // Seconds into the track where the first non-silent sample falls — only computed
    // when autoCue is enabled. Read by the caller right after onReady to seed a cue point.
    autoCueSeconds = 0;

    constructor(publicUrl: string, events: LocalAudioDeckEvents, options: LocalAudioDeckOptions = {}) {
        this.events = events;
        this.autoCue = options.autoCue ?? false;
        this.init(publicUrl);
    }

    private async init(publicUrl: string) {
        try {
            const AudioContextCtor: typeof AudioContext =
                window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const ctx = new AudioContextCtor();
            const response = await fetch(publicUrl);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            if (this.destroyed) {
                ctx.close();
                return;
            }

            if (this.autoCue) {
                this.autoCueSeconds = findFirstNonSilentSecond(audioBuffer);
            }

            const gain = ctx.createGain();
            gain.connect(ctx.destination);

            const shifter = new PitchShifter(ctx, audioBuffer, 4096, () => {
                this.state = 0;
                this.events.onStateChange({ data: 0 });
            });

            this.audioCtx = ctx;
            this.gainNode = gain;
            this.shifter = shifter;
            this.events.onReady({ target: this });
        } catch (err) {
            console.error('[LocalAudioDeckAdapter] Failed to load local track:', err);
        }
    }

    // Extra controls beyond DeckAdapter — only called when a deck's kind === 'local'.
    setPitchSemitones(semitones: number) {
        if (this.shifter) this.shifter.pitchSemitones = semitones;
    }

    setTempo(percent: number) {
        if (this.shifter) this.shifter.tempo = percent / 100;
    }

    playVideo() {
        if (!this.shifter || !this.gainNode || !this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        this.shifter.connect(this.gainNode);
        this.state = 1;
        this.events.onStateChange({ data: 1 });
    }

    pauseVideo() {
        if (!this.shifter) return;
        this.shifter.disconnect();
        this.state = 2;
        this.events.onStateChange({ data: 2 });
    }

    seekTo(seconds: number, _allowSeekAhead?: boolean) {
        if (!this.shifter || !this.shifter.duration) return;
        // Note: soundtouchjs's percentagePlayed getter returns 0-100, but its setter
        // expects a 0-1 fraction — an inconsistency in the library itself, not a typo here.
        const fraction = Math.min(Math.max(seconds / this.shifter.duration, 0), 1);
        this.shifter.percentagePlayed = fraction;
    }

    getCurrentTime() {
        return this.shifter?.timePlayed ?? 0;
    }

    getDuration() {
        return this.shifter?.duration ?? 0;
    }

    getPlayerState(): DeckState {
        return this.state;
    }

    setVolume(vol: number) {
        this.lastVolume = vol;
        if (this.gainNode && !this.muted) this.gainNode.gain.value = vol / 100;
    }

    mute() {
        this.muted = true;
        if (this.gainNode) this.gainNode.gain.value = 0;
    }

    unMute() {
        this.muted = false;
        if (this.gainNode) this.gainNode.gain.value = this.lastVolume / 100;
    }

    isMuted() {
        return this.muted;
    }

    destroy() {
        this.destroyed = true;
        try {
            this.shifter?.off();
            this.shifter?.disconnect();
        } catch {
            // already torn down
        }
        try {
            this.audioCtx?.close();
        } catch {
            // already closed
        }
        this.shifter = null;
        this.gainNode = null;
        this.audioCtx = null;
    }
}

// Auto Cue: skip leading silence by finding the first sample past a small threshold
// on the first channel, so playback starts right where the track actually begins.
function findFirstNonSilentSecond(buffer: AudioBuffer): number {
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > AUTO_CUE_SILENCE_THRESHOLD) {
            return i / buffer.sampleRate;
        }
    }
    return 0;
}
