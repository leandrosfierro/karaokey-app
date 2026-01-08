import type { NextApiRequest, NextApiResponse } from 'next';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { q } = req.query;

    if (!q || !YOUTUBE_API_KEY) {
        return res.status(400).json({ items: [] });
    }

    try {
        let channelId = q as string;

        // simplistic check if it's a handle or url, resolving handles is complex without extra calls.
        // We will assume the user inputs a search term for the channel to find ID first, or just searches videos.
        // Strategy: Search for channel first if it looks like a handle (@...)

        if (channelId.startsWith('@') || channelId.includes('youtube.com')) {
            // Search for the channel ID
            const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(channelId)}&key=${YOUTUBE_API_KEY}`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();

            if (searchData.items && searchData.items.length > 0) {
                channelId = searchData.items[0].id.channelId;
            } else {
                return res.status(404).json({ message: 'Channel not found' });
            }
        }

        // Now fetch videos from that channel
        // We use searching for type=video within that channelId is often easier/better sorted by viewCount for "hits"
        const videosUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=viewCount&maxResults=20&q=karaoke&key=${YOUTUBE_API_KEY}`;

        const videosRes = await fetch(videosUrl);
        const videosData = await videosRes.json();

        res.status(200).json(videosData);
    } catch (error) {
        console.error('YouTube API Error:', error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
}
