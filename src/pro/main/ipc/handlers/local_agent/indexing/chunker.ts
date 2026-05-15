export interface Chunk {
  text: string;
  startLine: number;
  endLine: number;
}

const MAX_CHUNK_CHARS = 1000;
const MIN_CHUNK_CHARS = 50;
const OVERLAP_LINES = 5;

/** Split file content into overlapping chunks by character limit (similar to Kilo Code). */
export function chunkFile(content: string, filePath: string): Chunk[] {
  const lines = content.split("\n");
  const header = `// ${filePath}\n`;

  // Small files: single chunk
  if (content.length + header.length <= MAX_CHUNK_CHARS) {
    return [{ text: `${header}${content}`, startLine: 0, endLine: lines.length - 1 }];
  }

  const chunks: Chunk[] = [];
  let startLine = 0;

  while (startLine < lines.length) {
    let charCount = header.length;
    let endLine = startLine;

    // Accumulate lines until we hit the char limit
    while (endLine < lines.length) {
      const lineLen = lines[endLine].length + 1; // +1 for newline
      if (charCount + lineLen > MAX_CHUNK_CHARS && endLine > startLine) break;
      charCount += lineLen;
      endLine++;
    }

    const chunkLines = lines.slice(startLine, endLine);
    const text = `${header}${chunkLines.join("\n")}`;

    if (text.length >= MIN_CHUNK_CHARS) {
      chunks.push({ text, startLine, endLine: endLine - 1 });
    }

    if (endLine >= lines.length) break;

    // Overlap: step back a few lines for context continuity
    startLine = Math.max(startLine + 1, endLine - OVERLAP_LINES);
  }

  return chunks;
}

export const EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".hpp", ".cs",
  ".css", ".scss", ".less",
  ".html", ".vue", ".svelte",
  ".json", ".yaml", ".yml", ".toml", ".env.example",
  ".md", ".mdx",
  ".sql",
  ".sh", ".bash", ".zsh",
]);

export const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "out", "coverage", ".cache", ".meowphyr", "__pycache__", ".venv",
  "venv", "target", "vendor",
]);

const MAX_FILE_SIZE = 200 * 1024; // 200 KB

import fs from "node:fs/promises";
import path from "node:path";

export interface FileEntry {
  filePath: string;
  relativePath: string;
  content: string;
}

export async function scanFiles(appPath: string): Promise<FileEntry[]> {
  const results: FileEntry[] = [];

  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!EXTENSIONS.has(ext)) continue;

        const filePath = path.join(dir, entry.name);
        try {
          const stat = await fs.stat(filePath);
          if (stat.size > MAX_FILE_SIZE) continue;

          const content = await fs.readFile(filePath, "utf-8");
          const relativePath = path.relative(appPath, filePath);
          results.push({ filePath, relativePath, content });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(appPath);
  return results;
}
