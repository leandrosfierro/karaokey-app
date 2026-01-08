import type { NextApiRequest, NextApiResponse } from 'next';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { q } = req.query;

    if (!q) {
        return res.status(400).json({ error: 'Falta el parámetro de búsqueda q' });
    }

    if (!YOUTUBE_API_KEY) {
        // Fallback or demo mode if no API key is provided
        return res.status(200).json({
            items: [
                {
                    id: { videoId: 'dQw4w9WgXcQ' },
                    snippet: {
                        title: `${q} - Karaoke Version (Demo Mode)`,
                        thumbnails: { medium: { url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg' } }
                    }
                },
                {
                    id: { videoId: '3JZ_D3ELwOQ' },
                    snippet: {
                        title: `${q} - Official Lyrics`,
                        thumbnails: { medium: { url: 'https://img.youtube.com/vi/3JZ_D3ELwOQ/mqdefault.jpg' } }
                    }
                }
            ],
            note: "Configura YOUTUBE_API_KEY en tu .env para resultados reales."
        });
    }

    try {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&q=${encodeURIComponent(
                q as string
            )}&type=video&key=${YOUTUBE_API_KEY}`
        );
        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ error: data.error.message });
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Error al buscar en YouTube' });
    }
}
