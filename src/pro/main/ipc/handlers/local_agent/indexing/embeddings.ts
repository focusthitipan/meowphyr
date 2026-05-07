import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("embeddings");

const DEFAULT_BASE_URL = "https://api.mistral.ai/v1";
const DEFAULT_MODEL = "codestral-embed-2505";
const DEFAULT_BATCH_SIZE = 60;
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

export function getEmbeddingConfig() {
  const settings = readSettings();
  const apiKey = settings.embeddingApiKey;
  if (!apiKey) {
    throw new DyadError(
      "Embedding API key is not configured. Please set it in Settings > Advanced > Code Search.",
      DyadErrorKind.Auth,
    );
  }
  return {
    apiKey,
    baseUrl: settings.embeddingBaseUrl ?? DEFAULT_BASE_URL,
    model: settings.embeddingModel ?? DEFAULT_MODEL,
  };
}

async function fetchEmbeddingBatch(
  batch: string[],
  apiKey: string,
  baseUrl: string,
  model: string,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): Promise<EmbeddingResponse> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: batch, model }),
      signal: AbortSignal.timeout(60_000),
    });

    if (response.ok) {
      return response.json() as Promise<EmbeddingResponse>;
    }

    const errorBody = await response.text().catch(() => "");

    if (response.status === 429 && attempt < maxRetries - 1) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      logger.warn(`Rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    throw new DyadError(
      `Embedding API failed: HTTP ${response.status} — ${errorBody}`,
      DyadErrorKind.External,
    );
  }

  throw new DyadError("Embedding API failed after max retries", DyadErrorKind.External);
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const { apiKey, baseUrl, model } = getEmbeddingConfig();
  const settings = readSettings();
  const batchSize = settings.embeddingBatchSize ?? DEFAULT_BATCH_SIZE;
  const maxRetries = settings.embeddingScannerMaxRetries ?? DEFAULT_MAX_RETRIES;
  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    logger.log(`Embedding batch ${Math.floor(i / batchSize) + 1}, size=${batch.length}`);

    const data = await fetchEmbeddingBatch(batch, apiKey, baseUrl, model, maxRetries);
    for (const item of data.data) {
      results[i + item.index] = item.embedding;
    }
  }

  return results;
}

export async function getEmbedding(text: string): Promise<number[]> {
  const [embedding] = await getEmbeddings([text]);
  return embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
