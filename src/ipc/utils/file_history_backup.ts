import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { getUserDataPath } from "@/paths/paths";

const logger = log.scope("file-history-backup");

function getBackupRoot(): string {
  return path.join(getUserDataPath(), "file-history");
}

function getMsgDir(appId: number, messageId: number): string {
  return path.join(getBackupRoot(), String(appId), String(messageId));
}

// Sentinel file suffix for files that were newly created (didn't exist before)
const NEW_FILE_SUFFIX = ".__new__";

function getBackupPath(
  appId: number,
  messageId: number,
  relativePath: string,
): string {
  const normalized = relativePath.replace(/\\/g, "/");
  return path.join(getMsgDir(appId, messageId), normalized + ".bak");
}

function getNewFileSentinel(
  appId: number,
  messageId: number,
  relativePath: string,
): string {
  const normalized = relativePath.replace(/\\/g, "/");
  return path.join(getMsgDir(appId, messageId), normalized + NEW_FILE_SUFFIX);
}

/**
 * Call before any AI tool writes/edits/deletes a file.
 * Backs up the file's pre-edit content, tied to the current message turn.
 * If the file was already backed up for this message, skips (preserves first/pre-edit state).
 */
export async function backupFileBeforeChange(
  appId: number,
  messageId: number,
  appPath: string,
  relativePath: string,
): Promise<void> {
  try {
    const backupPath = getBackupPath(appId, messageId, relativePath);
    const sentinelPath = getNewFileSentinel(appId, messageId, relativePath);

    // Already backed up for this message - don't overwrite (keep pre-edit state)
    if (fs.existsSync(backupPath) || fs.existsSync(sentinelPath)) return;

    const fullPath = path.join(appPath, relativePath);

    if (fs.existsSync(fullPath)) {
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(fullPath, backupPath);
    } else {
      // File doesn't exist yet - mark as newly created so restore deletes it
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
      fs.writeFileSync(sentinelPath, "");
    }
  } catch (error) {
    logger.warn(
      `Failed to backup file ${relativePath} for message ${messageId}:`,
      error,
    );
  }
}

/**
 * Restores all files to their state before targetMessageId was processed.
 * Finds all backups from targetMessageId onwards and applies the earliest
 * backup for each file (= state just before that file was first modified).
 */
export async function restoreFilesToBeforeMessage(
  appId: number,
  targetMessageId: number,
  appPath: string,
): Promise<void> {
  const appBackupRoot = path.join(getBackupRoot(), String(appId));

  if (!fs.existsSync(appBackupRoot)) {
    logger.warn(
      `No file history found for app ${appId}, cannot restore without git`,
    );
    return;
  }

  // Find all message backup dirs with id >= targetMessageId, sorted ascending
  const messageDirs = fs
    .readdirSync(appBackupRoot)
    .map((d) => parseInt(d))
    .filter((id) => !isNaN(id) && id >= targetMessageId)
    .sort((a, b) => a - b);

  if (messageDirs.length === 0) return;

  // Collect files to restore: for each relative path, use the EARLIEST backup
  // (= state just before the first edit at or after targetMessageId)
  const toRestore = new Map<
    string,
    { messageId: number; isNew: boolean; backupPath: string }
  >();

  for (const msgId of messageDirs) {
    const msgDir = getMsgDir(appId, msgId);
    collectBackupsFromDir(msgDir, msgDir, msgId, toRestore);
  }

  // Apply restores
  for (const [relativePath, { isNew, backupPath }] of toRestore) {
    const fullPath = path.join(appPath, relativePath);
    try {
      if (isNew) {
        // File was created after targetMessage - delete it
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          logger.log(`Restore: deleted new file ${relativePath}`);
        }
      } else {
        // Restore file from backup
        if (fs.existsSync(backupPath)) {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.copyFileSync(backupPath, fullPath);
          logger.log(`Restore: restored ${relativePath}`);
        }
      }
    } catch (error) {
      logger.error(`Failed to restore file ${relativePath}:`, error);
    }
  }
}

function collectBackupsFromDir(
  baseDir: string,
  currentDir: string,
  messageId: number,
  result: Map<
    string,
    { messageId: number; isNew: boolean; backupPath: string }
  >,
): void {
  if (!fs.existsSync(currentDir)) return;

  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectBackupsFromDir(baseDir, entryPath, messageId, result);
    } else if (entry.name.endsWith(NEW_FILE_SUFFIX)) {
      const relativePath = path
        .relative(baseDir, entryPath)
        .slice(0, -NEW_FILE_SUFFIX.length)
        .replace(/\\/g, "/");
      if (!result.has(relativePath)) {
        result.set(relativePath, { messageId, isNew: true, backupPath: "" });
      }
    } else if (entry.name.endsWith(".bak")) {
      const relativePath = path
        .relative(baseDir, entryPath)
        .slice(0, -4)
        .replace(/\\/g, "/");
      if (!result.has(relativePath)) {
        result.set(relativePath, {
          messageId,
          isNew: false,
          backupPath: entryPath,
        });
      }
    }
  }
}

/**
 * Returns true if any file was backed up for this message (i.e. AI modified files in this turn).
 */
export function hasBackup(appId: number, messageId: number): boolean {
  return fs.existsSync(getMsgDir(appId, messageId));
}

/**
 * Returns the relative paths of files backed up for a given message turn.
 * Each .bak = modified file, .__new__ = newly created file.
 */
export function listBackupFiles(appId: number, messageId: number): string[] {
  const msgDir = getMsgDir(appId, messageId);
  if (!fs.existsSync(msgDir)) return [];
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith(".bak")) {
        const rel = path
          .relative(msgDir, path.join(dir, entry.name))
          .slice(0, -4) // remove .bak
          .replace(/\\/g, "/");
        files.push(rel);
      } else if (entry.name.endsWith(NEW_FILE_SUFFIX)) {
        const rel = path
          .relative(msgDir, path.join(dir, entry.name))
          .slice(0, -NEW_FILE_SUFFIX.length)
          .replace(/\\/g, "/");
        files.push(rel);
      }
    }
  }
  walk(msgDir);
  return files;
}

/**
 * Evicts backup dirs for old messageIds that exceed the per-chat snapshot cap.
 * keepMessageIds = the IDs to keep (latest MAX_SNAPSHOTS turns for the chat).
 * Dirs not in keepMessageIds AND belonging to this app are removed.
 */
export function evictBackupsBeyondLimit(
  appId: number,
  keepMessageIds: Set<number>,
): void {
  const appBackupRoot = path.join(getBackupRoot(), String(appId));
  if (!fs.existsSync(appBackupRoot)) return;
  for (const entry of fs.readdirSync(appBackupRoot)) {
    const msgId = parseInt(entry);
    if (!isNaN(msgId) && !keepMessageIds.has(msgId)) {
      try {
        fs.rmdirSync(path.join(appBackupRoot, entry), { recursive: true });
        logger.log(`Evicted old backup for message ${msgId}`);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Cleans up backup directories for message IDs not in keepMessageIds.
 * Call this after pruning old messages to avoid unbounded disk growth.
 */
export function cleanupOldBackups(
  appId: number,
  keepMessageIds: Set<number>,
): void {
  const appBackupRoot = path.join(getBackupRoot(), String(appId));
  if (!fs.existsSync(appBackupRoot)) return;

  for (const entry of fs.readdirSync(appBackupRoot)) {
    const msgId = parseInt(entry);
    if (!isNaN(msgId) && !keepMessageIds.has(msgId)) {
      try {
        fs.rmdirSync(path.join(appBackupRoot, entry), { recursive: true });
      } catch {
        // ignore
      }
    }
  }
}
