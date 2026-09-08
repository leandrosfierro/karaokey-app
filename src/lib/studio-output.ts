export type RemoteState = {
  id: string;
  ready: boolean;
  playing: boolean;
  time: number;
  duration: number;
  ended: boolean;
  error: string;
};
export type TransportAction = "play" | "pause" | "seek";
export type TransportCommand = {
  type: "transport";
  signature: string;
  deck: "A" | "B";
  action: TransportAction;
  value?: number;
};
export function validTransport(
  value: unknown,
  signature: string,
): value is TransportCommand {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<TransportCommand>;
  return (
    v.type === "transport" &&
    v.signature === signature &&
    (v.deck === "A" || v.deck === "B") &&
    (v.action === "play" ||
      v.action === "pause" ||
      (v.action === "seek" &&
        typeof v.value === "number" &&
        Number.isFinite(v.value) &&
        v.value >= 0))
  );
}
export function mixVolumes(
  mix: number,
  a: number,
  b: number,
): [number, number] {
  const clamp = (v: number, max: number) =>
    Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
  const x = clamp(mix, 1);
  return [(1 - x) * clamp(a, 100), x * clamp(b, 100)];
}
