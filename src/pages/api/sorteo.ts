import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";

type ReqBody = {
  participantes: string[];
  canciones: { titulo: string; artista?: string }[];
  desafio?: string;
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
  const { participantes, canciones, desafio } = req.body as ReqBody;

  if (!participantes?.length || !canciones?.length) {
    return res.status(400).json({ error: "Faltan participantes o canciones" });
  }

  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  const elegido = pick(participantes);
  const cancion = pick(canciones);
  const reto = desafio || pick(desafiosBase);

  res.status(200).json({
    id: randomUUID(),
    participante: elegido,
    cancion,
    desafio: reto
  });
}
