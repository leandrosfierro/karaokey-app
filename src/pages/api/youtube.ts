import type { NextApiRequest, NextApiResponse } from 'next';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { q } = req.query;

    console.log('[YouTube API] Request received for query:', q);
    console.log('[YouTube API] API Key present:', !!YOUTUBE_API_KEY);
    console.log('[YouTube API] API Key (first 10 chars):', YOUTUBE_API_KEY?.substring(0, 10));

    if (!q) {
        console.error('[YouTube API] Missing query parameter');
        return res.status(400).json({ error: 'Falta el parámetro de búsqueda q' });
    }

    if (!YOUTUBE_API_KEY) {
        console.warn('[YouTube API] No API key configured - using demo mode');
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
        const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&q=${encodeURIComponent(
            q as string
        )}&type=video&key=${YOUTUBE_API_KEY}`;

        console.log('[YouTube API] Calling Google API...');

        const response = await fetch(apiUrl);
        const data = await response.json();

        console.log('[YouTube API] Response status:', response.status);
        console.log('[YouTube API] Response data:', JSON.stringify(data).substring(0, 200));

        if (!response.ok) {
            console.error('[YouTube API] Google API Error:', data.error);
            return res.status(response.status).json({
                error: data.error?.message || 'Error en la API de YouTube',
                details: data.error,
                suggestion: data.error?.code === 403
                    ? 'Verifica que la YouTube Data API v3 esté habilitada en Google Cloud Console'
                    : 'Verifica tu API key en las variables de entorno de Vercel'
            });
        }

        if (data.error) {
            console.error('[YouTube API] Data contains error:', data.error);
            return res.status(500).json({
                error: data.error.message,
                details: data.error
            });
        }

        console.log('[YouTube API] Success! Found items:', data.items?.length);
        res.status(200).json(data);
    } catch (error: any) {
        console.error('[YouTube API] Exception:', error);
        res.status(500).json({
            error: 'Error al buscar en YouTube',
            details: error.message
        });
    }
}
