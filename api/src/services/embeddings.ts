import axios from 'axios';

const BASE = process.env.EMBEDDINGS_URL ?? 'http://localhost:8001';

export async function embed(text: string): Promise<number[]> {
  const { data } = await axios.post<{ embedding: number[] }>(`${BASE}/embed`, { text });
  return data.embedding;
}

export async function similarity(a: number[], b: number[]): Promise<number> {
  const { data } = await axios.post<{ score: number }>(`${BASE}/similarity`, { a, b });
  return data.score;
}
