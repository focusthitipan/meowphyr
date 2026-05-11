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

      // Use actual API-reported token counts from the last non-summary assistant message.
      // Compaction summary messages don't have token data stored.
      const lastAssistantMessage = [...chat.messages]
        .reverse()
        .find((m) => m.role === "assistant" && !m.isCompactionSummary);

      logger.log(
        `Token counts for chat ${req.chatId}:`,
        `input=${lastAssistantMessage?.inputTokens}`,
        `output=${lastAssistantMessage?.outputTokens}`,
        `cached=${lastAssistantMessage?.cachedInputTokens}`,
      );

      return {
        contextWindow: await getContextWindow(),
        actualInputTokens: lastAssistantMessage?.inputTokens ?? null,
        actualOutputTokens: lastAssistantMessage?.outputTokens ?? null,
        actualCachedInputTokens: lastAssistantMessage?.cachedInputTokens ?? null,
      };
    },
  );
}
