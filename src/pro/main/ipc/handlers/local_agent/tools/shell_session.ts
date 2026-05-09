import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Tracks working directory per chat session so cwd persists across bash calls */
const sessionCwds = new Map<number, string>();

export function getSessionCwd(chatId: number, defaultPath: string): string {
  return sessionCwds.get(chatId) ?? defaultPath;
}

export function setSessionCwd(chatId: number, cwd: string): void {
  sessionCwds.set(chatId, cwd);
}

export function clearSession(chatId: number): void {
  sessionCwds.delete(chatId);
}

export function makeCwdTempFile(id: string): string {
  const dir = join(tmpdir(), "dyad-shell");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // dir already exists
  }
  return join(dir, `cwd-${id}.txt`);
}
