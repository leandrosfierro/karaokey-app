declare module 'soundtouchjs' {
    export class PitchShifter {
        constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number, onEnd?: () => void);
        readonly duration: number;
        readonly sampleRate: number;
        timePlayed: number;
        sourcePosition: number;
        percentagePlayed: number;
        pitch: number;
        pitchSemitones: number;
        rate: number;
        tempo: number;
        readonly node: ScriptProcessorNode;
        connect(toNode: AudioNode): void;
        disconnect(): void;
        on(eventName: 'play', cb: (detail: { timePlayed: number; formattedTimePlayed: string; percentagePlayed: number }) => void): void;
        off(eventName?: string): void;
    }
}
