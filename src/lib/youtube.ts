// Shared helpers for turning a raw YouTube Data API v3 search result item
// (the `{ id: { videoId }, snippet: { title, thumbnails, channelTitle } }`
// shape /api/youtube passes through as-is) into what the rest of the app
// actually works with. Used by KaraokePlayer's own search/cache, the host's
// channel/playlist import in index.tsx, and the public /vivo/[code] guest
// search — kept in one place so all three agree on the same parsing.

export interface VideoResult {
    id: string;
    title: string;
    thumbnail: string;
    channel?: string;
}

export function mapYoutubeItemToVideoResult(item: any): VideoResult {
    return {
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.medium.url,
        channel: item.snippet.channelTitle,
    };
}

// Stable per-song lookup key for karaokey_video_cache — same song should hit
// the same cache row regardless of accents/casing/whitespace differences.
export function cancionCacheKey(titulo: string, artista?: string): string {
    return `${titulo}|${artista || ''}`
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// "Artist - Song (Karaoke Version)" -> { titulo: "Song", artista: "Artist" }.
// A naive heuristic, not perfect for every upload's title formatting, but good
// enough to pre-fill a sensible título/artista from whichever video someone picked.
export function parseKaraokeVideoTitle(item: any): { titulo: string; artista?: string } {
    let fullTitle: string = item.snippet.title;
    fullTitle = fullTitle
        .replace(/\(Karaoke Version\)/i, "")
        .replace(/Karaoke/i, "")
        .replace(/Lyrics/i, "")
        .replace(/Letra/i, "")
        .trim();

    const parts = fullTitle.split("-");
    if (parts.length >= 2) {
        return { titulo: parts[1].trim(), artista: parts[0].trim() };
    }
    return { titulo: fullTitle, artista: item.snippet.channelTitle };
}
