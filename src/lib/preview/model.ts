export type PreviewSong = {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration?: string;
  kind?: "youtube" | "local";
  url?: string;
};
export type PreviewParty = {
  id: string;
  name: string;
  code: string;
  enabled: number;
  closed: number;
  duo: number;
  singer_only: number;
  no_repeats: number;
  round: number;
};
export type PreviewParticipant = {
  id: string;
  name: string;
  sung_round: number;
};
export type TurnStatus = "review" | "pending" | "active" | "done" | "cancelled";
export type PreviewTurn = {
  id: string;
  singers: string;
  participant_ids: string[];
  song: PreviewSong | null;
  source: "manual" | "draw" | "guest";
  status: TurnStatus;
  applause: number;
  position?: number;
  created: number;
};
export type PreviewState = {
  user: { name: string; email: string } | null;
  parties: PreviewParty[];
  party: PreviewParty | null;
  participants: PreviewParticipant[];
  songs: PreviewSong[];
  turns: PreviewTurn[];
};
export type GuestState = {
  party: PreviewParty;
  current: PreviewTurn | null;
  requests: PreviewTurn[];
  voted: boolean;
  pendingCount: number;
};
export const turnLabels: Record<TurnStatus, string> = {
  review: "Por aprobar",
  pending: "En la cola",
  active: "En escenario",
  done: "Finalizado",
  cancelled: "Retirado",
};

// Draws are uniform (Fisher–Yates), and a round is never reset implicitly.
export function drawParticipants(
  participants: PreviewParticipant[],
  party: Pick<PreviewParty, "no_repeats" | "round" | "duo">,
  reserved: string[] = [],
  random = Math.random,
) {
  const pool = participants.filter(
    (p) =>
      (!party.no_repeats || p.sung_round !== party.round) &&
      !reserved.includes(p.id),
  );
  const count = party.duo ? 2 : 1;
  if (pool.length < count)
    throw new Error(
      party.duo
        ? "Faltan dos participantes disponibles. Agregá personas o empezá otra ronda."
        : "Todos ya tienen turno o cantaron. Empezá otra ronda para volver a sortear.",
    );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function youtubeId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be")
      return /^[\w-]{11}$/.test(url.pathname.slice(1))
        ? url.pathname.slice(1)
        : null;
    if (
      ![
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
      ].includes(url.hostname)
    )
      return null;
    const id =
      url.searchParams.get("v") ||
      url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
