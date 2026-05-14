import crypto from "node:crypto";
import log from "electron-log";
import { scanFiles, chunkFile, type Chunk } from "./chunker";
import { getEmbeddings } from "./embeddings";
import { getFileHash, upsertChunks, getChunkCount } from "./vector_store";

const logger = log.scope("codebase_indexer");

function hashContent(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

export interface IndexProgress {
  indexed: number;
  total: number;
  skipped: number;
}

interface FileToProcess {
  filePath: string;
  relativePath: string;
  content: string;
  hash: string;
  chunks: Chunk[];
}

const FILE_BATCH_SIZE = 20;

export async function indexCodebase(
  appId: number,
  appPath: string,
  onProgress?: (progress: IndexProgress) => void,
): Promise<IndexProgress> {
  logger.log(`Starting indexing for app ${appId} at ${appPath}`);

  const files = await scanFiles(appPath);
  const progress: IndexProgress = { indexed: 0, total: files.length, skipped: 0 };

  // Determine which files need (re)indexing
  const toProcess: FileToProcess[] = [];
  for (const file of files) {
    const hash = hashContent(file.content);
    if (getFileHash(appId, file.filePath) === hash) {
      progress.skipped++;
    } else {
      toProcess.push({ ...file, hash, chunks: chunkFile(file.content, file.relativePath) });
    }
  }

  logger.log(`${toProcess.length} files to index, ${progress.skipped} unchanged`);

  // Process files in batches
  for (let i = 0; i < toProcess.length; i += FILE_BATCH_SIZE) {
    const batch = toProcess.slice(i, i + FILE_BATCH_SIZE);

    // Flatten all chunks from this batch with their file index
    const flatChunks: { fileIdx: number; chunk: Chunk }[] = [];
    for (let fi = 0; fi < batch.length; fi++) {
      for (const chunk of batch[fi].chunks) {
        flatChunks.push({ fileIdx: fi, chunk });
      }
    }

    if (flatChunks.length === 0) continue;

    logger.log(`File batch ${Math.floor(i / FILE_BATCH_SIZE) + 1}: embedding ${flatChunks.length} chunks from ${batch.length} files`);

    // Embed all chunks at once
    const embeddings = await getEmbeddings(flatChunks.map((c) => c.chunk.text));

    // Group embeddings back by file and upsert
    for (let fi = 0; fi < batch.length; fi++) {
      const file = batch[fi];
      const fileChunkEntries = flatChunks
        .map((fc, idx) => ({ ...fc, embedding: embeddings[idx] }))
        .filter((fc) => fc.fileIdx === fi)
        .map((fc) => ({
          text: fc.chunk.text,
          startLine: fc.chunk.startLine,
          endLine: fc.chunk.endLine,
          embedding: fc.embedding,
        }));

      upsertChunks(appId, file.filePath, file.relativePath, file.hash, fileChunkEntries);

      progress.indexed++;
      onProgress?.(progress);
    }
    logger.log(`File batch ${Math.floor(i / FILE_BATCH_SIZE) + 1} done, total indexed so far: ${progress.indexed}`);
  }

  logger.log(
    `Indexing done: ${progress.indexed} indexed, ${progress.skipped} skipped, ${getChunkCount(appId)} total chunks`,
  );

  return progress;
}
