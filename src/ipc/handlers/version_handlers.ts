import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { desc, eq, and, gte, lt, inArray } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import { withLock } from "../utils/lock_utils";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { versionContracts } from "../types/version";

import { deployAllSupabaseFunctions } from "../../supabase_admin/supabase_utils";
import { readSettings } from "../../main/settings";
import fs from "node:fs";
import path from "node:path";
import {
  restoreFilesToBeforeMessage,
  hasBackup,
  listBackupFiles,
  evictBackupsBeyondLimit,
} from "../utils/file_history_backup";

const MAX_SNAPSHOTS_PER_CHAT = 100;
import { gitCurrentBranch } from "../utils/git_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { syncCloudSandboxSnapshot } from "../utils/cloud_sandbox_provider";

const logger = log.scope("version_handlers");

async function syncCloudSandboxSnapshotBestEffort(appId: number) {
  try {
    await syncCloudSandboxSnapshot({ appId });
  } catch (error) {
    logger.warn(
      `Cloud sandbox sync failed after version operation for app ${appId}:`,
      error,
    );
  }
}

export function registerVersionHandlers() {
  createTypedHandler(versionContracts.listVersions, async (_, params) => {
    const { appId, chatId } = params;
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      // The app might have just been deleted, so we return an empty array.
      return [];
    }

    // Scope to the current chat if provided (Claude Code behavior), otherwise all chats
    let chatIds: number[];
    if (chatId !== undefined) {
      chatIds = [chatId];
    } else {
      const appChats = await db.query.chats.findMany({
        where: eq(chats.appId, appId),
      });
      if (appChats.length === 0) return [];
      chatIds = appChats.map((c) => c.id);
    }

    // Get assistant messages for the scoped chat(s), newest first
    const assistantMessages = await db.query.messages.findMany({
      where: and(
        eq(messages.role, "assistant"),
        inArray(messages.chatId, chatIds),
      ),
      orderBy: desc(messages.id),
    });

    // Also fetch preceding user messages for descriptions
    const userMessages = await db.query.messages.findMany({
      where: and(
        eq(messages.role, "user"),
        inArray(messages.chatId, chatIds),
      ),
    });
    const userMsgByChatAndId = new Map<string, (typeof userMessages)[0]>();
    for (const msg of userMessages) {
      userMsgByChatAndId.set(`${msg.chatId}:${msg.id}`, msg);
    }

    // Build versions: only include turns where files were backed up
    const result = [];
    for (const msg of assistantMessages) {
      if (!hasBackup(appId, msg.id)) continue;

      // Find the user message just before this assistant message in same chat
      const precedingUser = userMessages
        .filter((u) => u.chatId === msg.chatId && u.id < msg.id)
        .sort((a, b) => b.id - a.id)[0];

      const description = precedingUser
        ? precedingUser.content.slice(0, 80)
        : "(no prompt)";

      result.push({
        oid: String(msg.id),
        message: description,
        timestamp: msg.createdAt
          ? Math.floor(msg.createdAt.getTime() / 1000)
          : 0,
        dbTimestamp: null,
        filesChanged: listBackupFiles(appId, msg.id),
      });
    }

    // Enforce MAX_SNAPSHOTS_PER_CHAT — result is newest-first, keep the first N
    if (result.length > MAX_SNAPSHOTS_PER_CHAT) {
      result.splice(MAX_SNAPSHOTS_PER_CHAT);
      const keepIds = new Set(result.map((v) => parseInt(v.oid)));
      // Only evict disk backups when scoped to a single chat (avoids cross-chat collateral)
      if (chatId !== undefined) {
        evictBackupsBeyondLimit(appId, keepIds);
      }
    }

    return result;
  });

  createTypedHandler(versionContracts.getCurrentBranch, async (_, params) => {
    const { appId } = params;
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new DyadError("App not found", DyadErrorKind.NotFound);
    }

    const appPath = getDyadAppPath(app.path);

    // Return appropriate result if the app is not a git repo
    if (!fs.existsSync(path.join(appPath, ".git"))) {
      throw new DyadError("Not a git repository", DyadErrorKind.External);
    }

    try {
      const currentBranch = await gitCurrentBranch({ path: appPath });

      return {
        branch: currentBranch || "<no-branch>",
      };
    } catch (error: any) {
      logger.error(`Error getting current branch for app ${appId}:`, error);
      throw new DyadError(
        `Failed to get current branch: ${error.message}`,
        DyadErrorKind.External,
      );
    }
  });

  createTypedHandler(versionContracts.revertVersion, async (_, params) => {
    const { appId, previousVersionId, currentChatMessageId } = params;
    return withLock(appId, async () => {
      const targetMessageId = parseInt(previousVersionId);
      if (isNaN(targetMessageId)) {
        throw new DyadError(
          `Invalid version ID: ${previousVersionId}`,
          DyadErrorKind.Validation,
        );
      }

      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });
      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }

      const appPath = getDyadAppPath(app.path);

      // Restore files to their state before this message's edits — no git commit created
      await restoreFilesToBeforeMessage(appId, targetMessageId, appPath);

      // Delete messages from the triggering user message onwards
      const targetMessage = await db.query.messages.findFirst({
        where: eq(messages.id, targetMessageId),
      });
      let restoredPrompt: string | undefined;
      if (targetMessage) {
        const chatId = currentChatMessageId?.chatId ?? targetMessage.chatId;

        // Find the user message that immediately preceded this AI response
        // so we delete it too (the prompt that caused this turn)
        const precedingUserMsg = await db.query.messages.findFirst({
          where: and(
            eq(messages.chatId, chatId),
            eq(messages.role, "user"),
            lt(messages.id, targetMessageId),
          ),
          orderBy: desc(messages.id),
        });

        // Capture the prompt to restore it to the input box
        restoredPrompt = precedingUserMsg?.content;

        const deleteFromId =
          currentChatMessageId?.messageId ??
          precedingUserMsg?.id ??
          targetMessageId;

        await db
          .delete(messages)
          .where(
            and(eq(messages.chatId, chatId), gte(messages.id, deleteFromId)),
          );
        logger.log(
          `Deleted messages from chat ${chatId} with id >= ${deleteFromId}`,
        );
      }

      // Re-deploy Supabase edge functions if needed
      if (app.supabaseProjectId) {
        try {
          const settings = readSettings();
          const deployErrors = await deployAllSupabaseFunctions({
            appPath,
            supabaseProjectId: app.supabaseProjectId,
            supabaseOrganizationSlug: app.supabaseOrganizationSlug ?? null,
            skipPruneEdgeFunctions: settings.skipPruneEdgeFunctions ?? false,
          });
          if (deployErrors.length > 0) {
            return {
              warningMessage: `Restored, but some Supabase functions failed to deploy: ${deployErrors.join(", ")}`,
            };
          }
        } catch (error) {
          return {
            warningMessage: `Restored, but error re-deploying Supabase functions: ${error}`,
          };
        }
      }

      await syncCloudSandboxSnapshotBestEffort(appId);
      return { successMessage: "Restored version", restoredPrompt };
    });
  });

  // checkoutVersion is a no-op in the file-history-based system.
  // Versions are previewed by restoring — there are no per-turn git commits to checkout.
  createTypedHandler(versionContracts.checkoutVersion, async () => {
    return;
  });
}

