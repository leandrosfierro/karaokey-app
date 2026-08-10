import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";

type ReqBody = {
  participantes: string[];
  canciones: { titulo: string; artista?: string }[];
  desafio?: string;
  modoDuo?: boolean;
};

const desafiosBase = [
  "Versión cuarteto cordobés",
  "Actor de telenovela mexicana",
  "Dramatismo extremo",
  "Como si estuvieras bajo la lluvia",
  "Solo mímica (sin cantar)",
  "Balada épica de los 80s"
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { participantes, canciones, desafio, modoDuo } = req.body as ReqBody;

  if (!participantes?.length || !canciones?.length) {
    return res.status(400).json({ error: "Faltan participantes o canciones" });
  }
  if (modoDuo && participantes.length < 2) {
    return res.status(400).json({ error: "Se necesitan al menos 2 participantes para el modo dúo" });
  }

  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

  // Fisher-Yates shuffle, take as many unique participants as the mode needs
  const shuffled = [...participantes];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const elegidos = shuffled.slice(0, modoDuo ? 2 : 1);
  const cancion = pick(canciones);
  const reto = desafio || pick(desafiosBase);

  res.status(200).json({
    id: randomUUID(),
    participantes: elegidos,
    cancion,
    desafio: reto
  });
}
