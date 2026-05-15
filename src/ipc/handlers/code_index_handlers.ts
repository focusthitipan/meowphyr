import { createTypedHandler } from "./base";
import { codeIndexContracts } from "../types/code_index";
import type { IndexProgressPayload } from "../types/code_index";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { BrowserWindow } from "electron";
import log from "electron-log";
import { startWatching, stopWatching } from "../../pro/main/ipc/handlers/local_agent/indexing/file_watcher";

const logger = log.scope("code_index_handlers");

const activeIndexRuns = new Set<number>();

function sendProgress(payload: IndexProgressPayload) {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].webContents.send("code-index:progress", payload);
  }
}

async function restoreWatchers(reindexFn: (appId: number, appPath: string) => Promise<void>) {
  const { getIndexedAppIds } = await import(
    "../../pro/main/ipc/handlers/local_agent/indexing/vector_store"
  );
  const appIds = getIndexedAppIds();
  if (appIds.length === 0) return;

  const indexedApps = await db.query.apps.findMany({
    where: (apps, { inArray }) => inArray(apps.id, appIds),
    columns: { id: true, path: true },
  });

  for (const app of indexedApps) {
    const appPath = getDyadAppPath(app.path);
    startWatching(app.id, appPath, reindexFn);
    logger.log(`Restored file watcher for app ${app.id}`);
  }
}

export function registerCodeIndexHandlers() {
  const reindexFn = async (appId: number, appPath: string) => {
    const { indexCodebase } = await import(
      "../../pro/main/ipc/handlers/local_agent/indexing/codebase_indexer"
    );
    if (activeIndexRuns.has(appId)) return;
    activeIndexRuns.add(appId);
    try {
      const progress = await indexCodebase(appId, appPath);
      sendProgress({ appId, indexed: progress.indexed, total: progress.total, state: "complete" });
    } catch (err) {
      logger.error(`Auto re-index failed for app ${appId}:`, err);
      sendProgress({ appId, indexed: 0, total: 0, state: "error", error: String(err) });
    } finally {
      activeIndexRuns.delete(appId);
    }
  };

  restoreWatchers(reindexFn).catch((err) =>
    logger.error("Failed to restore file watchers:", err),
  );

  createTypedHandler(
    codeIndexContracts.indexCodebase,
    async (_, { appId }) => {
      const { indexCodebase } = await import(
        "../../pro/main/ipc/handlers/local_agent/indexing/codebase_indexer"
      );

      const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }

      if (activeIndexRuns.has(appId)) {
        logger.warn(`Index already running for app ${appId}, ignoring duplicate request`);
        throw new DyadError("Indexing already in progress for this app", DyadErrorKind.Validation);
      }

      const appPath = getDyadAppPath(app.path);
      logger.log(`Manual index triggered for app ${appId}`);
      activeIndexRuns.add(appId);

      try {
        const progress = await indexCodebase(appId, appPath, (p) => {
          sendProgress({
            appId,
            indexed: p.indexed,
            total: p.total,
            state: "indexing",
          });
        });

        sendProgress({
          appId,
          indexed: progress.indexed,
          total: progress.total,
          state: "complete",
        });

        startWatching(appId, appPath, reindexFn);

        return progress;
      } catch (err) {
        logger.error(`Indexing failed for app ${appId}:`, err);
        sendProgress({
          appId,
          indexed: 0,
          total: 0,
          state: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        activeIndexRuns.delete(appId);
      }
    },
  );

  createTypedHandler(
    codeIndexContracts.getIndexStatus,
    async (_, { appId }) => {
      const { getChunkCount } = await import(
        "../../pro/main/ipc/handlers/local_agent/indexing/vector_store"
      );
      return { chunkCount: getChunkCount(appId) };
    },
  );

  createTypedHandler(
    codeIndexContracts.clearIndex,
    async (_, { appId }) => {
      const { clearIndex } = await import(
        "../../pro/main/ipc/handlers/local_agent/indexing/vector_store"
      );
      clearIndex(appId);
      stopWatching(appId);
      logger.log(`Index cleared for app ${appId}`);
      return { success: true };
    },
  );
}
