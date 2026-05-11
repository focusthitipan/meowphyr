/**
 * Compaction Storage Module
 * Stores human/LLM-readable conversation transcripts before compaction.
 * Uses XML-structured format with truncated tool results for token efficiency.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import { DYAD_INTERNAL_DIR_NAME } from "@/ipc/utils/media_path_utils";

const logger = log.scope("compaction_storage");

/**
 * Maximum characters to keep from tool results before truncating.
 */
export const TOOL_RESULT_TRUNCATION_LIMIT = 1000;

/**
 * Message structure passed to the storage module.
 */
export interface CompactionMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Get the backup directory for a specific chat within the app's .dyad/chats/ directory.
 */
function getChatBackupDir(appPath: string, chatId: number): string {
  return path.join(appPath, DYAD_INTERNAL_DIR_NAME, "chats", String(chatId));
}

/**
 * Strip image data from message content before summarization.
 * Images (base64 or URL) waste tokens in the compaction LLM call and may
 * cause errors with models that don't support vision.
 * Replaces each image with a lightweight placeholder.
 */
export function stripImages(content: string): string {
  // Strip <dyad-attachment> image tags (base64 or media URL)
  let result = content.replace(
    /<dyad-attachment[^>]*type="image[^"]*"[^>]*>[\s\S]*?<\/dyad-attachment>/g,
    "[image removed for summarization]",
  );
  // Also strip self-closing dyad-attachment image tags
  result = result.replace(
    /<dyad-attachment[^>]*type="image[^"]*"[^>]*\/>/g,
    "[image removed for summarization]",
  );
  return result;
}

/**
 * Transform dyad-specific tool XML tags to shorter, LLM-friendly equivalents
 * and truncate large tool results for token efficiency.
 */
export function transformToolTags(content: string): string {
  // Transform <dyad-mcp-tool-call> to <tool-use>
  let result = content.replace(
    /<dyad-mcp-tool-call server="([^"]*)" tool="([^"]*)">\n([\s\S]*?)\n<\/dyad-mcp-tool-call>/g,
    '<tool-use name="$2" server="$1">\n$3\n</tool-use>',
  );

  // Transform <dyad-mcp-tool-result> to <tool-result> with truncation
  result = result.replace(
    /<dyad-mcp-tool-result server="([^"]*)" tool="([^"]*)">\n([\s\S]*?)\n<\/dyad-mcp-tool-result>/g,
    (_match, server, tool, resultContent: string) => {
      const chars = resultContent.length;
      const truncated = chars > TOOL_RESULT_TRUNCATION_LIMIT;
      const attrs = [
        `name="${tool}"`,
        `server="${server}"`,
        `chars="${chars}"`,
        ...(truncated ? ['truncated="true"'] : []),
      ].join(" ");
      const body = truncated
        ? resultContent.slice(0, TOOL_RESULT_TRUNCATION_LIMIT) + "\n..."
        : resultContent;
      return `<tool-result ${attrs}>\n${body}\n</tool-result>`;
    },
  );

  return result;
}

/**
 * Format messages as an XML-structured conversation transcript
 * that is easy for a future LLM to read.
 */
export function formatAsTranscript(
  messages: CompactionMessage[],
  chatId: number,
): string {
  const timestamp = new Date().toISOString();
  const header = `<transcript chatId="${chatId}" messageCount="${messages.length}" compactedAt="${timestamp}">`;

  const body = messages
    .map(
      (m) =>
        `<msg role="${m.role}">\n${transformToolTags(stripImages(m.content))}\n</msg>`,
    )
    .join("\n\n");

  return `${header}\n\n${body}\n\n</transcript>`;
}

/**
 * Store pre-compaction messages as a readable transcript.
 *
 * @param appPath - The absolute app directory path
 * @param chatId - The chat ID
 * @param messages - The messages to backup
 * @returns The relative path to the backup file (relative to appPath)
 */
export async function storePreCompactionMessages(
  appPath: string,
  chatId: number,
  messages: CompactionMessage[],
): Promise<string> {
  const chatBackupDir = getChatBackupDir(appPath, chatId);

  // Ensure directory exists and .dyad is gitignored
  if (!fs.existsSync(chatBackupDir)) {
    fs.mkdirSync(chatBackupDir, { recursive: true });
  }
  await ensureDyadGitignored(appPath);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `compaction-${timestamp}.md`;
  const backupPath = path.join(chatBackupDir, backupFileName);

  const transcript = formatAsTranscript(messages, chatId);

  try {
    fs.writeFileSync(backupPath, transcript);
    logger.info(
      `Stored compaction backup for chat ${chatId}: ${messages.length} messages`,
    );
    // Return the relative path from the app directory
    return path.relative(appPath, backupPath);
  } catch (error) {
    logger.error(
      `Failed to store compaction backup for chat ${chatId}:`,
      error,
    );
    throw error;
  }
}
