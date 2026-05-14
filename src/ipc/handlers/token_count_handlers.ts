import { db } from "../../db";
import { chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { TokenCountParams, TokenCountResult } from "@/ipc/types";
import { getContextWindow } from "../utils/token_utils";
import { createLoggedHandler } from "./safe_handle";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("token_count_handlers");

const handle = createLoggedHandler(logger);

export function registerTokenCountHandlers() {
  handle(
    "chat:count-tokens",
    async (_event, req: TokenCountParams): Promise<TokenCountResult> => {
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, req.chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
          app: true,
        },
      });

      if (!chat) {
        throw new DyadError(
          `Chat not found: ${req.chatId}`,
          DyadErrorKind.NotFound,
        );
      }

      // Find the most recent assistant message that has real API token data.
      // Includes compaction summaries since they now store actual usage too.
      // Falls back to older messages if the latest was interrupted mid-stream.
      const lastMessageWithTokens = [...chat.messages]
        .reverse()
        .find(
          (m) => m.role === "assistant" && m.inputTokens !== null,
        );

      const contextWindow = await getContextWindow();

      logger.log(
        `Token counts for chat ${req.chatId}:`,
        `input=${lastMessageWithTokens?.inputTokens}`,
        `output=${lastMessageWithTokens?.outputTokens}`,
        `cached=${lastMessageWithTokens?.cachedInputTokens}`,
        `isCompactionSummary=${lastMessageWithTokens?.isCompactionSummary}`,
      );

      return {
        contextWindow,
        actualInputTokens: lastMessageWithTokens?.inputTokens ?? null,
        actualOutputTokens: lastMessageWithTokens?.outputTokens ?? null,
        actualCachedInputTokens: lastMessageWithTokens?.cachedInputTokens ?? null,
      };
    },
  );
}
