import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { SKIP_DIRS, EXTENSIONS } from "./chunker";

const logger = log.scope("file_watcher");

const DEBOUNCE_MS = 2000;

interface WatcherEntry {
  watcher: fs.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  appPath: string;
}

const watchers = new Map<number, WatcherEntry>();

type ReindexFn = (appId: number, appPath: string) => Promise<void>;

function shouldWatch(filePath: string, appPath: string): boolean {
  const relative = path.relative(appPath, filePath);
  const parts = relative.split(path.sep);

  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  return EXTENSIONS.has(ext);
}

export function startWatching(appId: number, appPath: string, reindex: ReindexFn): void {
  if (watchers.has(appId)) {
    logger.log(`Already watching app ${appId}, skipping`);
    return;
  }

  logger.log(`Starting file watcher for app ${appId} at ${appPath}`);

  const entry: WatcherEntry = {
    watcher: null!,
    debounceTimer: null,
    appPath,
  };

  const trigger = () => {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      logger.log(`File change detected for app ${appId}, triggering re-index`);
      reindex(appId, appPath).catch((err) => {
        logger.error(`Auto re-index failed for app ${appId}:`, err);
      });
    }, DEBOUNCE_MS);
  };

  const watcher = fs.watch(appPath, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const filePath = path.join(appPath, filename);
    if (shouldWatch(filePath, appPath)) {
      trigger();
    }
  });

  watcher.on("error", (err) => {
    logger.error(`Watcher error for app ${appId}:`, err);
  });

  entry.watcher = watcher;
  watchers.set(appId, entry);
}

export function stopWatching(appId: number): void {
  const entry = watchers.get(appId);
  if (!entry) return;

  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entry.watcher.close();
  watchers.delete(appId);
  logger.log(`Stopped file watcher for app ${appId}`);
}

export function stopAllWatchers(): void {
  for (const appId of watchers.keys()) {
    stopWatching(appId);
  }
}
