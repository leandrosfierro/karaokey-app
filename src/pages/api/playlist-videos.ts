import type { NextApiRequest, NextApiResponse } from 'next';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

function extractPlaylistId(input: string): string | null {
    const trimmed = input.trim();
    const match = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // Bare playlist ID pasted directly (no URL wrapper)
    if (/^[a-zA-Z0-9_-]{10,40}$/.test(trimmed)) return trimmed;
    return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Falta el link de la playlist' });
    }

    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
        return res.status(400).json({ error: 'No se pudo reconocer el ID de la playlist en ese link' });
    }

    if (!YOUTUBE_API_KEY) {
        return res.status(400).json({ error: 'Falta configurar YOUTUBE_API_KEY para importar playlists' });
    }

    try {
        const items: any[] = [];
        let pageToken = '';

        // Up to 2 pages (100 videos) keeps this fast and within a sane quota per import
        for (let page = 0; page < 2; page++) {
            const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}${pageToken ? `&pageToken=${pageToken}` : ''}&key=${YOUTUBE_API_KEY}`;
            const response = await fetch(apiUrl);
            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json({
                    error: data.error?.message || 'Error al obtener la playlist',
                    suggestion: data.error?.code === 404
                        ? 'Verificá que la playlist exista y sea pública'
                        : undefined
                });
            }

            items.push(...(data.items || []));
            if (!data.nextPageToken) break;
            pageToken = data.nextPageToken;
        }

        if (items.length === 0) {
            return res.status(404).json({ error: 'La playlist está vacía o no es pública' });
        }

        res.status(200).json({ items });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Error al importar la playlist' });
    }
}
