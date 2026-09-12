import type { NextApiRequest, NextApiResponse } from "next";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_PAGES = 40;

type YouTubeError = {
  error?: { message?: string; errors?: { reason?: string }[] };
};

function channelReference(value: string) {
  const input = value.trim();
  const channelId = input.match(/youtube\.com\/channel\/(UC[\w-]+)/i)?.[1];
  if (channelId) return { key: "id", value: channelId } as const;
  const handle =
    input.match(/youtube\.com\/@([^/?#]+)/i)?.[1] ||
    input.match(/^@([^/?#]+)$/)?.[1];
  if (handle) return { key: "forHandle", value: `@${handle}` } as const;
  if (/^UC[\w-]{20,}$/.test(input))
    return { key: "id", value: input } as const;
  return null;
}

async function youtubeJson(url: URL) {
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as YouTubeError & Record<string, unknown>;
  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason;
    const quota = reason === "quotaExceeded" || reason === "rateLimitExceeded";
    const error = new Error(
      quota
        ? "La cuota diaria de YouTube está agotada. Probá nuevamente mañana."
        : data.error?.message || "YouTube no pudo responder.",
    );
    Object.assign(error, { status: quota ? 429 : response.status });
    throw error;
  }
  return data;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Método no permitido" });
  if (!YOUTUBE_API_KEY)
    return res.status(503).json({ error: "Falta configurar YouTube API Key" });

  const query = typeof req.query.q === "string" ? req.query.q : "";
  const reference = channelReference(query);
  if (!reference)
    return res.status(400).json({
      error: "Pegá el enlace del canal, su @usuario o su identificador.",
    });

  try {
    const channelUrl = new URL(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    channelUrl.searchParams.set("part", "snippet,contentDetails");
    channelUrl.searchParams.set(reference.key, reference.value);
    channelUrl.searchParams.set("key", YOUTUBE_API_KEY);
    const channelData = await youtubeJson(channelUrl);
    const channel = (
      channelData.items as
        | {
            id: string;
            snippet?: { title?: string };
            contentDetails?: { relatedPlaylists?: { uploads?: string } };
          }[]
        | undefined
    )?.[0];
    const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
    if (!channel || !uploads)
      return res.status(404).json({ error: "No encontramos ese canal." });

    const items: {
      id: { videoId: string };
      snippet: {
        title: string;
        channelTitle: string;
        thumbnails: { medium: { url: string } };
      };
    }[] = [];
    let pageToken = "";
    let page = 0;
    do {
      const videosUrl = new URL(
        "https://www.googleapis.com/youtube/v3/playlistItems",
      );
      videosUrl.searchParams.set("part", "snippet");
      videosUrl.searchParams.set("playlistId", uploads);
      videosUrl.searchParams.set("maxResults", "50");
      if (pageToken) videosUrl.searchParams.set("pageToken", pageToken);
      videosUrl.searchParams.set("key", YOUTUBE_API_KEY);
      const videosData = await youtubeJson(videosUrl);
      const pageItems =
        (videosData.items as
          | {
              snippet?: {
                title?: string;
                resourceId?: { videoId?: string };
                thumbnails?: { medium?: { url?: string } };
              };
            }[]
          | undefined) ?? [];
      for (const item of pageItems) {
        const videoId = item.snippet?.resourceId?.videoId;
        const title = item.snippet?.title;
        if (
          !videoId ||
          !title ||
          ["Private video", "Deleted video"].includes(title)
        )
          continue;
        items.push({
          id: { videoId },
          snippet: {
            title,
            channelTitle: channel.snippet?.title || query,
            thumbnails: {
              medium: {
                url:
                  item.snippet?.thumbnails?.medium?.url ||
                  `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
              },
            },
          },
        });
      }
      pageToken = (videosData.nextPageToken as string | undefined) ?? "";
      page += 1;
    } while (pageToken && page < MAX_PAGES);

    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).json({
      items,
      channel: { id: channel.id, title: channel.snippet?.title || query },
      total: items.length,
      truncated: Boolean(pageToken),
    });
  } catch (caught) {
    const error = caught as Error & { status?: number };
    console.error("YouTube channel import error:", error.message);
    return res
      .status(error.status || 500)
      .json({ error: error.message || "No se pudo importar el canal." });
  }
}
