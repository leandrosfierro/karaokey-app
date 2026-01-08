# KaraoKey – Vercel Starter

Juego de karaoke social (MVP) listo para deploy en **Vercel** y versionado en **GitHub**.

## Requisitos
- Node 18+
- Cuenta en Vercel y GitHub

## Desarrollo local
```bash
npm install
npm run dev
```
Abrí http://localhost:3000

## Endpoints
- `GET /api/health` — healthcheck
- `POST /api/sorteo` — sortea participante, canción y desafío

Body de ejemplo:
```json
{
  "participantes": ["Lean", "Caro", "Mati"],
  "canciones": [{ "titulo": "De música ligera", "artista": "Soda Stereo" }]
}
```

## Deploy en Vercel (UI)
1. Subí este repo a **GitHub**.
2. En **Vercel → New Project**, importá el repo.
3. Framework: **Next.js**. Root: `/`.
4. Variables de entorno (opcional): `OPENAI_API_KEY`, `YOUTUBE_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`.
5. Deploy.

## Deploy por Vercel CLI (opcional)
```bash
npm i -g vercel
vercel
vercel --prod
```

## GitHub Actions (Preview con Vercel)
Configurar el **Vercel GitHub App** en el repo para obtener previews en cada PR.

## Estilo/UI
- Tailwind + tema neón (#FF3B81 / #00B7ED / #0A0A0A).
- Pantalla completa, animaciones básicas, listo para proyector/TV.

## Próximos pasos
- Integrar Gemini para desafíos IA.
- Agregar auth del “host” (código QR para público).
- Ranking y métricas en tiempo real.
```
