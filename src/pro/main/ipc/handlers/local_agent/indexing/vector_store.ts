import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { getUserDataPath } from "@/paths/paths";
import { cosineSimilarity } from "./embeddings";
import log from "electron-log";

const logger = log.scope("vector_store");

export interface SearchResult {
  filePath: string;
  relativePath: string;
  chunkText: string;
  startLine: number;
  endLine: number;
  score: number;
}

function getIndexDir(): string {
  return path.join(getUserDataPath(), "code-index");
}

function getDbPath(appId: number): string {
  return path.join(getIndexDir(), `${appId}.db`);
}

function openDb(appId: number): Database.Database {
  const dir = getIndexDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(getDbPath(appId));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      embedding TEXT NOT NULL,
      file_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);
    CREATE TABLE IF NOT EXISTS file_hashes (
      file_path TEXT PRIMARY KEY,
      file_hash TEXT NOT NULL
    );
  `);
  return db;
}

export function getFileHash(appId: number, filePath: string): string | null {
  const db = openDb(appId);
  try {
    const row = db
      .prepare("SELECT file_hash FROM file_hashes WHERE file_path = ?")
      .get(filePath) as { file_hash: string } | undefined;
    return row?.file_hash ?? null;
  } finally {
    db.close();
  }
}

export function upsertChunks(
  appId: number,
  filePath: string,
  relativePath: string,
  fileHash: string,
  chunks: { text: string; startLine: number; endLine: number; embedding: number[] }[],
): void {
  const db = openDb(appId);
  try {
    const deleteChunks = db.prepare("DELETE FROM chunks WHERE file_path = ?");
    const insertChunk = db.prepare(
      "INSERT INTO chunks (file_path, relative_path, chunk_text, start_line, end_line, embedding, file_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const upsertHash = db.prepare(
      "INSERT OR REPLACE INTO file_hashes (file_path, file_hash) VALUES (?, ?)",
    );

    db.transaction(() => {
      deleteChunks.run(filePath);
      for (const chunk of chunks) {
        insertChunk.run(
          filePath,
          relativePath,
          chunk.text,
          chunk.startLine,
          chunk.endLine,
          JSON.stringify(chunk.embedding),
          fileHash,
        );
      }
      upsertHash.run(filePath, fileHash);
    })();
  } finally {
    db.close();
  }
}

export function getIndexedAppIds(): number[] {
  const dir = getIndexDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => parseInt(f.replace(".db", ""), 10))
    .filter((id) => !isNaN(id));
}

export function getIndexedFilePaths(appId: number): string[] {
  try {
    const db = openDb(appId);
    try {
      const rows = db.prepare("SELECT file_path FROM file_hashes").all() as { file_path: string }[];
      return rows.map((r) => r.file_path);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export function deleteFile(appId: number, filePath: string): void {
  const db = openDb(appId);
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM chunks WHERE file_path = ?").run(filePath);
      db.prepare("DELETE FROM file_hashes WHERE file_path = ?").run(filePath);
    })();
  } finally {
    db.close();
  }
}

export function searchVectors(
  appId: number,
  queryEmbedding: number[],
  topK = 10,
  minScore = 0.3,
): SearchResult[] {
  const db = openDb(appId);
  try {
    const rows = db
      .prepare(
        "SELECT file_path, relative_path, chunk_text, start_line, end_line, embedding FROM chunks",
      )
      .all() as {
      file_path: string;
      relative_path: string;
      chunk_text: string;
      start_line: number;
      end_line: number;
      embedding: string;
    }[];

    const scored = rows
      .map((row) => {
        const embedding: number[] = JSON.parse(row.embedding);
        const score = cosineSimilarity(queryEmbedding, embedding);
        return {
          filePath: row.file_path,
          relativePath: row.relative_path,
          chunkText: row.chunk_text,
          startLine: row.start_line,
          endLine: row.end_line,
          score,
        };
      })
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score);

    // Deduplicate by file path — keep best score per file
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const r of scored) {
      if (!seen.has(r.relativePath)) {
        seen.add(r.relativePath);
        deduped.push(r);
      }
      if (deduped.length >= topK) break;
    }

    return deduped;
  } finally {
    db.close();
  }
}

export function getChunkCount(appId: number): number {
  try {
    const db = openDb(appId);
    try {
      const row = db.prepare("SELECT COUNT(*) as count FROM chunks").get() as {
        count: number;
      };
      return row.count;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

export function clearIndex(appId: number): void {
  const dbPath = getDbPath(appId);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    logger.log(`Cleared index for app ${appId}`);
  }
}
