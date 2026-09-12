import { supabase } from "./supabase";
import type { CancionRow, TemaPublicoRow, PerformanceRow } from "./supabase";
import type { PreviewSong, PreviewTurn } from "./preview/model";
import { youtubeId } from "./preview/model";

export function studioSong(row: CancionRow): PreviewSong | null {
  if (!row.youtube_video_id) return null;
  return {
    id: row.youtube_video_id,
    title: row.titulo,
    channel: row.artista || "",
    thumbnail:
      row.youtube_thumbnail ||
      `https://i.ytimg.com/vi/${row.youtube_video_id}/mqdefault.jpg`,
  };
}

export function studioTurns(
  rows: TemaPublicoRow[],
  performance: PerformanceRow | null,
  applause: number,
): PreviewTurn[] {
  const turns: PreviewTurn[] = rows
    .filter((r) => r.status !== "active")
    .map((r) => ({
      id: r.id,
      singers: r.submitted_by,
      participant_ids: [],
      song: r.youtube_video_id
        ? {
            id: r.youtube_video_id,
            title: r.titulo,
            channel: r.artista || "",
            thumbnail:
              r.youtube_thumbnail ||
              `https://i.ytimg.com/vi/${r.youtube_video_id}/mqdefault.jpg`,
          }
        : null,
      source: "guest" as const,
      status: r.status,
      applause: 0,
      created: Date.parse(r.approved_at || r.created_at),
    }))
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  if (performance)
    turns.push({
      id: performance.id,
      singers: performance.participantes.join(" & "),
      participant_ids: [],
      song: performance.youtube_video_id
        ? {
            id: performance.youtube_video_id,
            title: performance.cancion_titulo || "",
            channel: performance.cancion_artista || "",
            thumbnail:
              performance.youtube_thumbnail ||
              `https://i.ytimg.com/vi/${performance.youtube_video_id}/mqdefault.jpg`,
          }
        : null,
      status: "active",
      source: "manual",
      applause,
      created: Date.parse(performance.started_at),
    });
  return turns;
}

export async function studioSearch(
  query: string,
  kind: "search" | "playlist" | "channel" = "search",
): Promise<PreviewSong[]> {
  const id = youtubeId(query.trim());
  if (id && kind === "search") {
    // An explicit URL retains the chosen version even when search quota is exhausted.
    return [
      {
        id,
        title: `Video de YouTube · ${id}`,
        channel: "Versión elegida por enlace",
        thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      },
    ];
  }
  const response = await fetch(
    kind === "playlist"
      ? `/api/playlist-videos?url=${encodeURIComponent(query)}`
      : kind === "channel"
        ? `/api/channel-videos?q=${encodeURIComponent(query)}`
        : `/api/youtube?q=${encodeURIComponent(query)}`,
    { cache: "no-store" },
  );
  const data = await response.json();
  if (!response.ok || data.note)
    throw new Error(
      data.note
        ? "La búsqueda real no está configurada en este entorno. Podés pegar el enlace exacto de YouTube."
        : data.suggestion || data.error || "No se pudo buscar. Reintentá.",
    );
  return (data.items || []).flatMap(
    (item: {
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        resourceId?: { videoId?: string };
        thumbnails?: { medium?: { url?: string } };
      };
    }) => {
      const videoId = item.id?.videoId || item.snippet?.resourceId?.videoId;
      if (
        !videoId ||
        !/^[\w-]{11}$/.test(videoId) ||
        !item.snippet?.title ||
        ["Private video", "Deleted video"].includes(item.snippet.title)
      )
        return [];
      return [
        {
          id: videoId,
          title: item.snippet.title,
          channel: item.snippet.channelTitle || "",
          thumbnail:
            item.snippet.thumbnails?.medium?.url ||
            `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        },
      ];
    },
  );
}

export async function saveStudioSongs(userId: string, songs: PreviewSong[]) {
  const { data, error } = await supabase
    .from("karaokey_canciones")
    .select("youtube_video_id")
    .eq("user_id", userId);
  if (error) throw error;
  const existing = new Set(data.map((r) => r.youtube_video_id));
  const rows = [...new Map(songs.map((s) => [s.id, s])).values()].filter(
    (s) =>
      s.kind !== "local" && /^[\w-]{11}$/.test(s.id) && !existing.has(s.id),
  );
  if (!rows.length) return 0;
  const payload = rows.map((s) => ({
    user_id: userId,
    titulo: s.title,
    artista: s.channel || null,
    youtube_video_id: s.id,
    youtube_thumbnail: s.thumbnail,
  }));
  for (let start = 0; start < payload.length; start += 200) {
    const result = await supabase
      .from("karaokey_canciones")
      .insert(payload.slice(start, start + 200));
    if (result.error) throw result.error;
  }
  return payload.length;
}
