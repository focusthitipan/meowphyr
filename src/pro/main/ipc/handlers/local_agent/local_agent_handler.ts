/**
 * Local Agent v2 Handler
 * Main orchestrator for tool-based agent mode with parallel execution
 */

import crypto from "node:crypto";
import { IpcMainInvokeEvent } from "electron";
import {
  streamText,
  ToolSet,
  stepCountIs,
  hasToolCall,
  ModelMessage,
  type ToolExecutionOptions,
} from "ai";
import log from "electron-log";

import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { eq } from "drizzle-orm";

import {
  isBasicAgentMode,
  type UserSettings,
} from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import { detectFrameworkType } from "@/ipc/utils/framework_utils";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { safeSend } from "@/ipc/utils/safe_sender";
import { cancelOrphanedBaseStream } from "@/ipc/utils/stream_text_utils";
import { getMaxTokens, getTemperature, getContextWindow } from "@/ipc/utils/token_utils";
import {
  getProviderOptions,
  getAiHeaders,
  DYAD_INTERNAL_REQUEST_ID_HEADER,
} from "@/ipc/utils/provider_options";

import {
  AgentToolName,
  buildAgentToolSet,
  requireAgentToolConsent,
  clearPendingConsentsForChat,
  clearPendingQuestionnairesForChat,
} from "./tool_definitions";
import {
  deployAllFunctionsIfNeeded,
  commitAllChanges,
} from "./processors/file_operations";
import { storeDbTimestampAtCurrentVersion } from "@/ipc/utils/neon_timestamp_utils";
import { mcpManager } from "@/ipc/utils/mcp_manager";
import { mcpServers } from "@/db/schema";
import { requireMcpToolConsent } from "@/ipc/utils/mcp_consent";
import { getAiMessagesJsonIfWithinLimit } from "@/ipc/utils/ai_messages_utils";

import type { ChatStreamParams, ChatResponseEnd } from "@/ipc/types";
import {
  AgentContext,
  parsePartialJson,
  escapeXmlAttr,
  escapeXmlContent,
  unescapeXmlAttr,
  UserMessageContentPart,
  FileEditTracker,
} from "./tools/types";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import {
  prepareStepMessages,
  buildTodoReminderMessage,
  hasIncompleteTodos,
  formatTodoSummary,
  ensureToolResultOrdering,
  type InjectedMessage,
} from "./prepare_step_utils";
import { loadTodos } from "./todo_persistence";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import { TOOL_DEFINITIONS } from "./tool_definitions";
import {
  parseAiMessagesJson,
  type DbMessageForParsing,
} from "@/ipc/utils/ai_messages_utils";
import { parseMcpToolKey, sanitizeMcpName } from "@/ipc/utils/mcp_tool_utils";
import { addIntegrationTool } from "./tools/add_integration";
import { writePlanTool } from "./tools/write_plan";
import { exitPlanTool } from "./tools/exit_plan";
import {
  appendCancelledResponseNotice,
  filterCancelledMessagePairs,
} from "@/shared/chatCancellation";
import {
  isChatPendingCompaction,
  performCompaction,
  checkAndMarkForCompaction,
} from "@/ipc/handlers/compaction/compaction_handler";
import {
  getPostCompactionMessages,
  getMidTurnCompactionSummaryIds,
} from "@/ipc/handlers/compaction/compaction_utils";
import { DEFAULT_MAX_TOOL_CALL_STEPS } from "@/constants/settings_constants";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  type RetryReplayEvent,
  maybeCaptureRetryReplayEvent,
  maybeCaptureRetryReplayText,
  maybeAppendRetryReplayForRetry,
} from "./retry_replay_utils";
import { setChatSummaryTool } from "./tools/set_chat_summary";
import { AgentSwarm } from "./tools/agent_swarm";
import { createSendMessageTool } from "./tools/send_message_tool";
import { createReadMessagesTool } from "./tools/read_messages_tool";
import { createWaitForReplyTool } from "./tools/wait_for_reply_tool";
import { createMonitorAgentsTool } from "./tools/monitor_agents_tool";

const logger = log.scope("local_agent_handler");
const PLANNING_QUESTIONNAIRE_TOOL_NAME = "planning_questionnaire";
const MAX_TERMINATED_STREAM_RETRIES = 3;
const STREAM_RETRY_BASE_DELAY_MS = 400;
const STREAM_CONTINUE_MESSAGE =
  "[System] Your previous response stream was interrupted by a transient network error. Continue from exactly where you left off and do not repeat text that has already been sent.";

const RETRYABLE_STREAM_ERROR_STATUS_CODES = new Set([
  408, 429, 500, 502, 503, 504,
]);
const RETRYABLE_STREAM_ERROR_PATTERNS = [
  "server_error",
  "internal server error",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "too many requests",
  "rate_limit",
  "overloaded",
  "econnrefused",
  "enotfound",
  "econnreset",
  "epipe",
  "etimedout",
];

// ============================================================================
// Tool Streaming State Management
// ============================================================================

/**
 * Track streaming state per tool call ID
 */
interface ToolStreamingEntry {
  toolName: string;
  argsAccumulated: string;
}
const toolStreamingEntries = new Map<string, ToolStreamingEntry>();

function getOrCreateStreamingEntry(
  id: string,
  toolName?: string,
): ToolStreamingEntry | undefined {
  let entry = toolStreamingEntries.get(id);
  if (!entry && toolName) {
    entry = {
      toolName,
      argsAccumulated: "",
    };
    toolStreamingEntries.set(id, entry);
  }
  return entry;
}

function cleanupStreamingEntry(id: string): void {
  toolStreamingEntries.delete(id);
}

function findToolDefinition(toolName: string) {
  return TOOL_DEFINITIONS.find((t) => t.name === toolName);
}

function buildChatMessageHistory(
  chatMessages: Array<
    DbMessageForParsing & {
      isCompactionSummary: boolean | null;
      createdAt: Date;
    }
  >,
  options?: { excludeMessageIds?: Set<number> },
): ModelMessage[] {
  const excludedIds = options?.excludeMessageIds;
  const relevantMessages = getPostCompactionMessages(chatMessages);
  const reorderedMessages = [...relevantMessages];

  // For mid-turn compaction, keep the summary immediately after the triggering
  // user message so subsequent turns reflect that compaction happened before
  // post-compaction tool-loop steps.
  for (const summary of [...reorderedMessages].filter(
    (message) => message.isCompactionSummary,
  )) {
    const summaryIndex = reorderedMessages.findIndex(
      (m) => m.id === summary.id,
    );
    if (summaryIndex < 0) {
      continue;
    }

    const triggeringUser = [...reorderedMessages]
      .filter((m) => m.role === "user" && m.id < summary.id)
      .sort((a, b) => b.id - a.id)[0];
    if (!triggeringUser) {
      continue;
    }

    const triggeringUserIndex = reorderedMessages.findIndex(
      (m) => m.id === triggeringUser.id,
    );
    if (triggeringUserIndex < 0) {
      continue;
    }

    const isMidTurnSummary =
      summary.createdAt.getTime() >= triggeringUser.createdAt.getTime();
    if (!isMidTurnSummary || summaryIndex === triggeringUserIndex + 1) {
      continue;
    }

    reorderedMessages.splice(summaryIndex, 1);
    const targetIndex = Math.min(
      triggeringUserIndex + 1,
      reorderedMessages.length,
    );
    reorderedMessages.splice(targetIndex, 0, summary);
  }

  const filtered = reorderedMessages
    .filter((msg) => !excludedIds?.has(msg.id))
    .filter((msg) => msg.content || msg.aiMessagesJson);

  // Filter out cancelled message pairs (user prompt + cancelled assistant response)
  // so the AI doesn't try to reconcile cancelled/incorrect prompts with new ones.
  return filterCancelledMessagePairs(filtered).flatMap((msg) =>
    parseAiMessagesJson(msg),
  );
}

/**
 * Append a `<system-reminder>` to the latest user message listing referenced
 * apps so the agent knows which `app_name` values it can pass to read-only
 * tools (`read_file`, `list_files`, `grep`, `code_search`). Mutates the last
 * user message in-place to avoid copying unrelated parts of the history.
 */
function injectReferencedAppsReminder(
  messageHistory: ModelMessage[],
  referencedApps: readonly { appName: string }[],
): void {
  const list = referencedApps.map(({ appName }) => `\`${appName}\``).join(", ");
  const reminder = `\n\n<system-reminder>\nThe user has mentioned the following apps in their prompt: ${list}. These apps are separate from the current app and are READ-ONLY. To inspect them, pass the app name as the \`app_name\` parameter to read-only tools (\`read_file\`, \`list_files\`, \`grep\`, \`code_search\`); matching is case-insensitive. Write tools cannot target these apps. Omit \`app_name\` to operate on the current app.\n</system-reminder>`;

  for (let i = messageHistory.length - 1; i >= 0; i--) {
    const msg = messageHistory[i];
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") {
      messageHistory[i] = { ...msg, content: msg.content + reminder };
    } else {
      messageHistory[i] = {
        ...msg,
        content: [...msg.content, { type: "text", text: reminder }],
      };
    }
    return;
  }
}


/**
 * Replace the dyad-status block identified by slotId in content with replacement.
 * Uses depth counting instead of a non-greedy regex so nested dyad-status tags
 * (e.g. from bash tool results) are handled correctly.
 */
function replaceDyadStatusSlot(
  content: string,
  slotId: string,
  replacement: string,
): string {
  const slotOpenRe = new RegExp(
    `<dyad-status[^>]*data-slot="${slotId}"[^>]*>`,
  );
  const slotMatch = slotOpenRe.exec(content);
  if (!slotMatch) return content;

  const startIdx = slotMatch.index;
  const OPEN_TOKEN = "<dyad-status";
  const CLOSE_TOKEN = "</dyad-status>";
  let depth = 0;
  let i = startIdx;

  while (i < content.length) {
    const nextOpen = content.indexOf(OPEN_TOKEN, i);
    const nextClose = content.indexOf(CLOSE_TOKEN, i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + OPEN_TOKEN.length;
    } else {
      depth--;
      const endIdx = nextClose + CLOSE_TOKEN.length;
      if (depth === 0) {
        return content.slice(0, startIdx) + replacement + content.slice(endIdx);
      }
      i = endIdx;
    }
  }
  return content;
}

/**
 * Handle a chat stream in local-agent mode
 */
export async function handleLocalAgentStream(
  event: IpcMainInvokeEvent,
  req: ChatStreamParams,
  abortController: AbortController,
  {
    placeholderMessageId,
    systemPrompt,
    dyadRequestId,
    readOnly = false,
    planModeOnly = false,
    messageOverride,
    settingsOverride,
    referencedApps = [],
  }: {
    placeholderMessageId: number;
    systemPrompt: string;
    dyadRequestId: string;
    /**
     * If true, the agent operates in read-only mode (e.g., ask mode).
     * State-modifying tools are disabled, and no commits/deploys are made.
     */
    readOnly?: boolean;
    /**
     * If true, only include tools allowed in plan mode.
     * This includes read-only exploration tools and planning-specific tools.
     */
    planModeOnly?: boolean;
    /**
     * If provided, use these messages instead of fetching from the database.
     * Used for summarization where messages need to be transformed.
     */
    messageOverride?: ModelMessage[];
    settingsOverride?: UserSettings;
    /**
     * Apps referenced via `@app:Name` mentions in the user's prompt.
     * Read-only tools can target these via an `app_name` parameter.
     */
    referencedApps?: {
      appName: string;
      appPath: string;
    }[];
  },
): Promise<boolean> {
  const settings = settingsOverride ?? readSettings();
  const maxToolCallSteps =
    settings.maxToolCallSteps ?? DEFAULT_MAX_TOOL_CALL_STEPS;
  let fullResponse = "";
  let streamingPreview = ""; // Temporary preview for current tool, not persisted
  // Each parallel sub-agent gets its own streaming slot keyed by a random ID.
  // This allows multiple sub-agents to stream simultaneously without overwriting each other.
  const subAgentPreviews = new Map<string, string>();
  // Maps placeholder marker → slotId for inline replacement in fullResponse
  const subAgentMarkers = new Map<string, string>();

  function sendCurrentView() {
    let combined = fullResponse + streamingPreview;
    // Replace marker placeholders with live slot content (inline positioning)
    for (const [marker, slotId] of subAgentMarkers) {
      const preview = subAgentPreviews.get(slotId);
      if (preview) {
        combined = combined.replace(marker, preview);
      }
    }
    sendResponseChunk(
      event,
      req.chatId,
      chat,
      combined,
      placeholderMessageId,
      hiddenMessageIdsForStreaming,
    );
  }
  let activeRetryReplayEvents: RetryReplayEvent[] | null = null;
  // Mid-turn compaction inserts a DB summary row for LLM history, but we render
  // the user-facing compaction indicator inline in the active assistant turn.
  const hiddenMessageIdsForStreaming = new Set<number>();
  let postMidTurnCompactionStartStep: number | null = null;

  const appendInlineCompactionToTurn = async (
    summary?: string,
    backupPath?: string,
  ) => {
    const summaryText =
      summary && summary.trim().length > 0
        ? summary
        : "Conversation compacted.";
    const inlineCompaction = `<dyad-compaction title="Conversation compacted" state="finished">\n${escapeXmlContent(summaryText)}\n</dyad-compaction>`;
    const backupPathNote = backupPath
      ? `\nIf you need to retrieve earlier parts of the conversation history, you can read the backup file at: ${backupPath}\nNote: This file may be large. Read only the sections you need or use grep to search for specific content rather than reading the entire file.`
      : "";
    const separator =
      fullResponse.length > 0 && !fullResponse.endsWith("\n") ? "\n" : "";
    fullResponse = `${fullResponse}${separator}${inlineCompaction}${backupPathNote}\n`;
    await updateResponseInDb(placeholderMessageId, fullResponse);
  };



  const loadChat = async () =>
    db.query.chats.findFirst({
      where: eq(chats.id, req.chatId),
      with: {
        messages: {
          orderBy: (messages, { asc }) => [asc(messages.createdAt)],
        },
        app: true,
      },
    });

  // Get the chat and app — may be re-queried after compaction
  const initialChat = await loadChat();

  if (!initialChat || !initialChat.app) {
    throw new DyadError(
      `Chat not found: ${req.chatId}`,
      DyadErrorKind.NotFound,
    );
  }

  let chat = initialChat;

  for (const id of getMidTurnCompactionSummaryIds(chat.messages)) {
    hiddenMessageIdsForStreaming.add(id);
  }

  const appPath = getDyadAppPath(chat.app.path);

  const maybePerformPendingCompaction = async (options?: {
    showOnTopOfCurrentResponse?: boolean;
    force?: boolean;
  }) => {
    if (
      settings.enableContextCompaction === false ||
      (!options?.force && !(await isChatPendingCompaction(req.chatId)))
    ) {
      return false;
    }

    logger.info(`Performing pending compaction for chat ${req.chatId}`);
    const existingCompactionSummaryIds = new Set(
      chat.messages
        .filter((message) => message.isCompactionSummary)
        .map((message) => message.id),
    );
    const compactionResult = await performCompaction(
      event,
      req.chatId,
      appPath,
      dyadRequestId,
      (accumulatedSummary: string) => {
        // Stream compaction summary to the frontend in real-time.
        // During mid-turn compaction, keep already streamed content visible.
        const compactionPreview = `<dyad-compaction title="Compacting conversation">\n${escapeXmlContent(accumulatedSummary)}\n</dyad-compaction>`;
        const previewContent = options?.showOnTopOfCurrentResponse
          ? `${fullResponse}${streamingPreview ? streamingPreview : ""}\n${compactionPreview}`
          : compactionPreview;
        sendResponseChunk(
          event,
          req.chatId,
          chat,
          previewContent,
          placeholderMessageId,
          hiddenMessageIdsForStreaming,
          true, // Full messages: compaction changes message list
        );
      },
      {
        // Mid-turn compaction should not render as a separate message above the
        // current turn on subsequent streams, so keep its DB timestamp in turn order.
        createdAtStrategy: options?.showOnTopOfCurrentResponse
          ? "now"
          : "before-latest-user",
      },
    );
    if (!compactionResult.success) {
      logger.warn(
        `Compaction failed for chat ${req.chatId}: ${compactionResult.error}`,
      );
      // Continue anyway - compaction failure shouldn't block the conversation
    }

    // Re-query to pick up the newly inserted compaction summary message.
    // Only update if compaction succeeded — a failed compaction may have left
    // partial state that would corrupt subsequent message history.
    if (compactionResult.success) {
      const refreshedChat = await loadChat();
      if (refreshedChat?.app) {
        chat = refreshedChat;
      }

      if (options?.showOnTopOfCurrentResponse) {
        for (const message of chat.messages) {
          if (
            message.isCompactionSummary &&
            !existingCompactionSummaryIds.has(message.id)
          ) {
            hiddenMessageIdsForStreaming.add(message.id);
          }
        }
        await appendInlineCompactionToTurn(
          compactionResult.summary,
          compactionResult.backupPath,
        );
      }
    }

    if (options?.showOnTopOfCurrentResponse) {
      sendResponseChunk(
        event,
        req.chatId,
        chat,
        fullResponse + streamingPreview,
        placeholderMessageId,
        hiddenMessageIdsForStreaming,
        true, // Full messages: post-compaction refresh
      );
    }

    return compactionResult.success;
  };

  // Check if compaction is pending and enabled before processing the message
  await maybePerformPendingCompaction();

  // Send initial message update
  safeSend(event.sender, "chat:response:chunk", {
    chatId: req.chatId,
    messages: chat.messages.filter(
      (message) => !hiddenMessageIdsForStreaming.has(message.id),
    ),
  });

  // Track pending user messages to inject after tool results
  const pendingUserMessages: UserMessageContentPart[][] = [];
  // Store injected messages with their insertion index to re-inject at the same spot each step
  const allInjectedMessages: InjectedMessage[] = [];
  const warningMessages: string[] = [];

  try {
    // Get model client
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    // Load persisted todos from a previous turn (if any)
    const persistedTodos = await loadTodos(appPath, chat.id);
    // Ensure .dyad/ is gitignored (idempotent; also done by compaction/plans)
    // Skip in read-only/plan-only mode to avoid modifying the workspace
    if (!readOnly && !planModeOnly) {
      await ensureDyadGitignored(appPath).catch((err: unknown) =>
        logger.warn("Failed to ensure .dyad gitignored:", err),
      );
    }
    if (persistedTodos.length > 0) {
      // Emit loaded todos to the renderer so the UI shows them immediately
      safeSend(event.sender, "agent-tool:todos-update", {
        chatId: chat.id,
        todos: persistedTodos,
      });
    }

    // Build tool execute context
    const fileEditTracker: FileEditTracker = Object.create(null);
    const referencedAppsMap = new Map(
      referencedApps.map((ref) => [ref.appName.toLowerCase(), ref.appPath]),
    );
    // In-session swarm for inter-agent messaging (leader + all sub-agents share this)
    const swarm = new AgentSwarm();
    swarm.register("leader");
    // Permission bridge: sub-agents route consent requests through the leader,
    // which shows the real Electron consent UI to the user.
    swarm.setPermissionHandler(async (fromAgent, toolName, inputPreview) => {
      return requireAgentToolConsent(event, {
        chatId: chat.id,
        toolName: toolName as AgentToolName,
        toolDescription: `[from sub-agent "${fromAgent}"]`,
        inputPreview,
      });
    });
    const ctx: AgentContext = {
      event,
      appId: chat.app.id,
      appPath,
      referencedApps: referencedAppsMap,
      chatId: chat.id,
      supabaseProjectId: chat.app.supabaseProjectId,
      supabaseOrganizationSlug: chat.app.supabaseOrganizationSlug,
      neonProjectId: chat.app.neonProjectId,
      neonActiveBranchId:
        chat.app.neonActiveBranchId ?? chat.app.neonDevelopmentBranchId,
      frameworkType: detectFrameworkType(appPath),
      messageId: placeholderMessageId,
      isSharedModulesChanged: false,
      todos: persistedTodos,
      dyadRequestId,
      fileEditTracker,
      isDyadPro: true,
      onXmlStream: (accumulatedXml: string) => {
        streamingPreview = accumulatedXml;
        sendCurrentView();
      },
      onXmlComplete: (finalXml: string) => {
        const xmlChunk = `${finalXml}\n`;
        fullResponse += xmlChunk;
        streamingPreview = "";
        updateResponseInDb(placeholderMessageId, fullResponse);
        sendCurrentView();
      },
      requireConsent: async (params: {
        toolName: string;
        toolDescription?: string | null;
        inputPreview?: string | null;
      }) => {
        return requireAgentToolConsent(event, {
          chatId: chat.id,
          toolName: params.toolName as AgentToolName,
          toolDescription: params.toolDescription,
          inputPreview: params.inputPreview,
        });
      },
      appendUserMessage: (content: UserMessageContentPart[]) => {
        pendingUserMessages.push(content);
      },
      onUpdateTodos: (todos) => {
        safeSend(event.sender, "agent-tool:todos-update", {
          chatId: chat.id,
          todos,
        });
      },
      onWarningMessage: (message) => {
        warningMessages.push(message);
      },
      sendHeartbeat: () => {
        safeSend(event.sender, "chat:response:chunk", { chatId: chat.id });
      },
      swarm,
      agentName: "leader",
      runSubAgent: async (
        prompt: string,
        description: string,
        options?: { name?: string; background?: boolean; initialMessage?: string },
      ) => {
        const agentName = options?.name ?? `agent-${crypto.randomUUID().slice(0, 8)}`;
        const title = `Agent[${agentName}]: ${description || "Task"}`;
        // Register in swarm so other agents can message this one by name
        swarm.register(agentName);
        swarm.markRunning(agentName);
        // Pre-populate inbox with leader's initial message if provided
        if (options?.initialMessage) {
          swarm.send("leader", agentName, "task", options.initialMessage);
        }
        // Unique slot for this sub-agent's streaming preview.
        const slotId = crypto.randomUUID();
        // For background agents, embed an inline marker in fullResponse so the
        // card appears at the position where the agent tool was called.
        const marker = options?.background
          ? `\x00SUBAGENT:${slotId}\x00`
          : "";
        if (marker) {
          subAgentMarkers.set(marker, slotId);
          fullResponse += marker;
        }

        type LogEntry =
          | { kind: "activity"; text: string }
          | { kind: "text"; text: string }
          | { kind: "xml"; xml: string };
        const logEntries: LogEntry[] = [];
        let pendingText = "";
        // Maps toolCallId → activity label for tools currently streaming their args
        const streamingActivities = new Map<string, string>();
        // Maps toolCallId → label for tools whose args are done and are now executing
        const executingActivities = new Map<string, string>();

        function flushPendingText() {
          const trimmed = pendingText.trimEnd();
          if (trimmed) logEntries.push({ kind: "text", text: trimmed });
          pendingText = "";
        }

        function xmlToActivity(xml: string): string | null {
          const tagMatch = xml.match(/^<(dyad-[\w-]+)([^>]*)/);
          if (!tagMatch) return null;
          const tagName = tagMatch[1];
          const attrsStr = tagMatch[2];
          const getAttr = (name: string): string | undefined => {
            const m = attrsStr.match(new RegExp(`\\b${name}="([^"]*)"`));
            return m ? unescapeXmlAttr(m[1]) : undefined;
          };
          switch (tagName) {
            case "dyad-grep":
              return `🔍 grep: ${getAttr("query") ?? ""}`;
            case "dyad-read":
              return `📄 read: ${getAttr("path") ?? ""}`;
            case "dyad-list-files": {
              const pattern = getAttr("pattern");
              const directory = getAttr("directory");
              if (pattern) return `📁 glob: ${pattern}`;
              if (directory) return `📋 list: ${directory}/`;
              return "📋 list files";
            }
            case "dyad-code-search":
              return `🔎 code search: ${getAttr("query") ?? ""}`;
            case "dyad-fetch":
              return `🌐 fetch: ${getAttr("url") ?? ""}`;
            case "dyad-search":
              return `🌐 web search: ${getAttr("query") ?? ""}`;
            case "dyad-status": {
              const statusTitle = getAttr("title");
              return statusTitle ? `⚙️ ${statusTitle}` : null;
            }
            default:
              return `⚙️ ${tagName.replace("dyad-", "")}`;
          }
        }

        const MAX_PENDING_TAIL = 2_000; // show tail of actively-streaming text

        function buildBlockContent(extraPendingText?: string): string {
          // Build interleaved content: text entries are escaped, xml entries are
          // kept raw so DyadMarkdownParser can render them as full components.
          // We process logEntries in order to preserve call-site positioning.
          const parts: string[] = [];
          const pendingTextLines: string[] = [];

          function flushTextLines() {
            if (pendingTextLines.length > 0) {
              parts.push(escapeXmlContent(pendingTextLines.join("\n")));
              pendingTextLines.length = 0;
            }
          }

          for (const entry of logEntries) {
            if (entry.kind === "activity") {
              pendingTextLines.push(entry.text);
            } else if (entry.kind === "text") {
              pendingTextLines.push(`  ${entry.text}`);
            } else if (entry.kind === "xml") {
              flushTextLines();
              parts.push(entry.xml);
            }
          }

          // Streaming/executing activity labels always go at the tail (escaped)
          for (const activity of streamingActivities.values()) {
            pendingTextLines.push(`${activity}...`);
          }
          for (const activity of executingActivities.values()) {
            pendingTextLines.push(`${activity}...`);
          }
          const pending = (extraPendingText ?? "").trimEnd();
          if (pending) {
            const tail =
              pending.length > MAX_PENDING_TAIL
                ? `…\n${pending.slice(-MAX_PENDING_TAIL)}`
                : pending;
            pendingTextLines.push(tail);
          }
          flushTextLines();

          return parts.join("\n");
        }

        /** Write the current state of this sub-agent into its streaming slot.
         *  @param hintActivity Fallback label shown when no tool is active (e.g. "✍️ Writing...") */
        function updateSlot(innerContent: string, hintActivity?: string) {
          // Tools take priority; fall back to the caller-supplied hint (text/reasoning phase)
          const currentActivity =
            [...executingActivities.values()].at(-1) ??
            [...streamingActivities.values()].at(-1) ??
            hintActivity ??
            "";
          const activityAttr = currentActivity
            ? ` activity="${escapeXmlAttr(currentActivity)}"`
            : "";
          const newTag = `<dyad-status data-slot="${slotId}" title="${escapeXmlAttr(title)}" state="pending"${activityAttr}>\n${innerContent}\n</dyad-status>`;
          subAgentPreviews.set(slotId, newTag);
          if (options?.background) {
            // After the main agent finishes, the marker has been resolved into
            // fullResponse as a static pending block. sendCurrentView() only
            // replaces markers (now cleared), so it can't inject the new content.
            // Update fullResponse directly so streaming continues to reach the UI.
            if (marker && !subAgentMarkers.has(marker)) {
              const replaced = replaceDyadStatusSlot(fullResponse, slotId, newTag);
              if (replaced !== fullResponse) fullResponse = replaced;
            }
          } else {
            // Foreground sub-agent: the main loop is paused awaiting runSubAgent(),
            // so streamingPreview is free to use as the live display channel.
            // ctx.onXmlComplete() will clear it and commit the finished card.
            streamingPreview = newTag;
          }
          sendCurrentView();
        }

        // Claim the slot immediately so the block appears in the UI right away
        updateSlot(buildBlockContent());

        const subCtx: AgentContext = {
          ...ctx,
          onXmlStream: (_xml) => {
            // Activities are tracked via streamingActivities/executingActivities Maps;
            // just refresh the slot to pick up any label updates.
            updateSlot(buildBlockContent());
          },
          onXmlComplete: (xml) => {
            flushPendingText();
            // Don't embed dyad-status inside the slot — nested dyad-status tags
            // break the regex-based slot replacement and overflow the parser.
            // Use a text label instead for status-type outputs.
            if (xml.trimStart().startsWith("<dyad-status")) {
              const activity = xmlToActivity(xml);
              if (activity) logEntries.push({ kind: "activity", text: activity });
            } else {
              logEntries.push({ kind: "xml", xml });
            }
            updateSlot(buildBlockContent());
          },
          // Background agents auto-approve tools (they were delegated by leader).
          // Foreground agents still go through the leader's consent UI.
          requireConsent: options?.background
            ? async () => true
            : async (params) => {
                return swarm.requestPermission(
                  agentName,
                  params.toolName,
                  params.inputPreview ?? "",
                );
              },
          runSubAgent: undefined,
          swarm,
          agentName,
        };

        const subAgentPermission = settings.subAgentFileAccess ?? "staging";
        const baseSubTools = buildAgentToolSet(subCtx, {
          subAgentPermission,
        });

        // In staging mode, wrap write_file to enforce .meowphyr/ path prefix
        if (subAgentPermission === "staging" && baseSubTools.write_file) {
          const original = baseSubTools.write_file;
          baseSubTools.write_file = {
            ...original,
            execute: async (args: { path: string; content: string; description?: string }) => {
              const STAGING_DIR = ".meowphyr";
              const normalizedPath = args.path.replace(/\\/g, "/");
              const safePath = normalizedPath.startsWith(STAGING_DIR + "/") || normalizedPath === STAGING_DIR
                ? normalizedPath
                : `${STAGING_DIR}/${normalizedPath.replace(/^\/+/, "")}`;
              return original.execute({ ...args, path: safePath });
            },
          };
        }

        const subToolSet = {
          ...baseSubTools,
          send_message: createSendMessageTool(agentName, swarm, {
            onLog: (to, type, content) => {
              // Show outgoing messages (especially reports) in the sub-agent card.
              const preview =
                content.length > 300
                  ? content.slice(0, 300) + "…"
                  : content;
              logEntries.push({
                kind: "text",
                text: `📤 ${type} → ${to}:\n${preview}`,
              });
              updateSlot(buildBlockContent());
            },
          }),
          read_messages: createReadMessagesTool(agentName, swarm, {
            onLog: (msgs) => {
              if (msgs.length === 0) {
                logEntries.push({ kind: "text", text: "📥 read messages: no new messages" });
              } else {
                const lines = msgs.map(
                  (m) =>
                    `${m.type.toUpperCase()} from "${m.from}": ${m.content.slice(0, 150)}${m.content.length > 150 ? "…" : ""}`,
                );
                logEntries.push({
                  kind: "text",
                  text: `📥 read messages (${msgs.length}):\n${lines.join("\n")}`,
                });
              }
              updateSlot(buildBlockContent());
            },
          }),
          wait_for_reply: createWaitForReplyTool(agentName, swarm, {
            createCallbacks: () => ({
              onLog: (msg) => {
                if (msg) {
                  const preview =
                    msg.content.length > 150
                      ? msg.content.slice(0, 150) + "…"
                      : msg.content;
                  logEntries.push({
                    kind: "text",
                    text: `📨 received ${msg.type} from "${msg.from}":\n${preview}`,
                  });
                } else {
                  logEntries.push({ kind: "text", text: "⏰ wait timeout — no reply received" });
                }
                updateSlot(buildBlockContent());
              },
            }),
          }),
        };

        const subStreamingEntries = new Map<
          string,
          { toolName: string; argsAccumulated: string }
        >();

        // Background agents use their own AbortController so they survive
        // after the main agent's abortController is cleaned up. They're
        // aborted only when the user cancels the main chat.
        const bgAbort = options?.background ? new AbortController() : null;
        if (bgAbort) {
          // Inherit cancellation from parent: if main is aborted, kill bg too
          abortController.signal.addEventListener(
            "abort",
            () => bgAbort.abort(),
            { once: true },
          );
        }

        const bgSuffix = options?.background
          ? `\n\nIMPORTANT: You are running in background mode. When you finish, send a comprehensive summary to the leader via send_message(to: "leader", type: "report", content: <your summary>).`
          : "";
        const permissionSuffix =
          subAgentPermission === "read-only"
            ? `\n\nFILE ACCESS: Read-only mode. You cannot write, edit, or delete files. Report your findings as text or send a message to the leader.`
            : subAgentPermission === "staging"
              ? `\n\nFILE ACCESS: Staging mode. You may only write files to the \`.meowphyr/\` directory (enforced automatically). Use unique filenames that include your agent name to avoid conflicts (e.g. \`.meowphyr/report-${agentName}.md\`). This staging directory is the handoff point — the leader reads files from here.`
              : `\n\nFILE ACCESS: Full access. You may read and write files anywhere in the project.`;
        const subStreamResult = streamText({
          model: modelClient.model,
          headers: {
            ...getAiHeaders({
              builtinProviderId: modelClient.builtinProviderId,
            }),
            [DYAD_INTERNAL_REQUEST_ID_HEADER]: dyadRequestId,
          },
          providerOptions: getProviderOptions({
            dyadAppId: chat.app.id,
            dyadRequestId,
            dyadDisableFiles: true,
            files: [],
            mentionedAppsCodebases: [],
            builtinProviderId: modelClient.builtinProviderId,
            settings,
          }),
          system: `You are a focused sub-agent. Your task: ${description}\n\nThink step-by-step. Use the available tools to complete the task. Explain your reasoning between tool calls, then return a clear, concise summary of what you did and the outcome.${permissionSuffix}${bgSuffix}`,
          messages: [{ role: "user", content: prompt }],
          tools: subToolSet,
          stopWhen: stepCountIs(20),
          abortSignal: (bgAbort ?? abortController).signal,
        });

        const subFullStream = subStreamResult.fullStream;
        cancelOrphanedBaseStream(subStreamResult);

        /** Runs the stream-to-finish for a sub-agent (for-await + finalization) */
        async function runAgentStream(): Promise<string> {
          let pendingReasoning = "";
          const signal = (bgAbort ?? abortController).signal;

          for await (const part of subFullStream) {
            if (signal.aborted) break;

            switch (part.type) {
              case "reasoning-start":
                flushPendingText();
                break;

              case "reasoning-delta":
                pendingReasoning += part.text;
                updateSlot(buildBlockContent(`💭 ${pendingReasoning}`), "💭 Thinking...");
                break;

              case "reasoning-end":
                if (pendingReasoning.trim()) {
                  logEntries.push({
                    kind: "text",
                    text: `💭 ${pendingReasoning.trimEnd()}`,
                  });
                }
                pendingReasoning = "";
                updateSlot(buildBlockContent());
                break;

              case "text-delta":
                pendingText += part.text;
                updateSlot(buildBlockContent(pendingText), "✍️ Writing...");
                break;

              case "tool-input-start":
                flushPendingText();
                subStreamingEntries.set(part.id, {
                  toolName: part.toolName,
                  argsAccumulated: "",
                });
                // Show tool name immediately while args stream in
                streamingActivities.set(part.id, `⚙️ ${part.toolName}...`);
                updateSlot(buildBlockContent());
                break;

              case "tool-input-delta": {
                const entry = subStreamingEntries.get(part.id);
                if (entry) {
                  entry.argsAccumulated += part.delta;
                  // Swarm tools (send_message, read_messages, wait_for_reply) are
                  // not in TOOL_DEFINITIONS — keep the generic label from tool-input-start.
                  const toolDef = TOOL_DEFINITIONS.find(
                    (t) => t.name === entry.toolName,
                  );
                  if (toolDef?.buildXml) {
                    const partialArgs = parsePartialJson(entry.argsAccumulated);
                    const xml = toolDef.buildXml(partialArgs, false);
                    if (xml) {
                      const act = xmlToActivity(xml);
                      if (act) streamingActivities.set(part.id, act);
                      updateSlot(buildBlockContent());
                    }
                  }
                }
                break;
              }

              case "tool-input-end": {
                const act = streamingActivities.get(part.id);
                streamingActivities.delete(part.id);
                if (act) executingActivities.set(part.id, act);
                const seEntry = subStreamingEntries.get(part.id);
                subStreamingEntries.delete(part.id);
                if (seEntry) {
                  // Swarm tools have no buildXml — keep the generic label.
                  const toolDef = TOOL_DEFINITIONS.find(
                    (t) => t.name === seEntry.toolName,
                  );
                  if (toolDef?.buildXml) {
                    const finalArgs = parsePartialJson(seEntry.argsAccumulated);
                    const xml = toolDef.buildXml(finalArgs, true);
                    if (xml) {
                      // buildXml returned a string → emit the complete tool XML now.
                      // (if undefined, execute() will call subCtx.onXmlComplete itself)
                      subCtx.onXmlComplete(xml);
                    }
                  }
                }
                updateSlot(buildBlockContent());
                break;
              }

              case "tool-result": {
                executingActivities.delete(part.toolCallId);
                updateSlot(buildBlockContent());
                break;
              }
            }
          }

          flushPendingText();

          const finalText = await subStreamResult.text; // ensure stream is fully consumed

          // buildBlockContent() already has all text and xml entries interleaved
          // in call-site order — use it directly for the finished card content.
          const finalInnerContent = buildBlockContent();

          if (options?.background) {
            const finishTag = `<dyad-status data-slot="${slotId}" title="${escapeXmlAttr(title)}" state="finished">\n${finalInnerContent}\n</dyad-status>`;
            subAgentPreviews.set(slotId, finishTag);
            const replaced = replaceDyadStatusSlot(fullResponse, slotId, finishTag);
            if (replaced !== fullResponse) {
              fullResponse = replaced;
            } else if (marker) {
              fullResponse = fullResponse.replace(marker, finishTag + "\n");
            }
            if (marker) subAgentMarkers.delete(marker);
            await updateResponseInDb(placeholderMessageId, fullResponse);
            sendCurrentView();
            swarm.markCompleted(agentName);
            swarm.send(
              agentName,
              "leader",
              "report",
              `Agent "${agentName}" completed: ${description}\n\n${finalText}`,
            );
          } else {
            swarm.markCompleted(agentName);
            subAgentPreviews.delete(slotId);
            ctx.onXmlComplete(
              `<dyad-status title="${escapeXmlAttr(title)}" state="finished">\n${finalInnerContent}\n</dyad-status>`,
            );
          }

          return finalText;
        }

        if (options?.background) {
          // Fire-and-forget: the agent runs in the background and reports
          // results via send_message when done.
          runAgentStream().catch((err) => {
            logger.error(`Background agent "${agentName}" failed:`, err);
            const errorXml = `<dyad-status title="${escapeXmlAttr(title)}" state="aborted">\n${escapeXmlContent(`Error: ${getErrorMessage(err)}`)}\n</dyad-status>`;
            subAgentPreviews.set(slotId, errorXml);
            fullResponse = fullResponse.replace(marker, errorXml + "\n");
            subAgentMarkers.delete(marker);
            updateResponseInDb(placeholderMessageId, fullResponse);
            sendCurrentView();
            swarm.markFailed(agentName, getErrorMessage(err));
            swarm.send(
              agentName,
              "leader",
              "report",
              `Agent "${agentName}" failed: ${getErrorMessage(err)}`,
            );
          });
          return `Agent "${agentName}" started in background. It will report results via send_message when done. Use read_messages to check for results.`;
        }

        return runAgentStream();
      },
    };

    // Build tool set (agent tools + MCP tools)
    // In read-only mode, only include read-only tools and skip MCP tools
    // (since we can't determine if MCP tools modify state)
    // In plan mode, only include planning tools (read + questionnaire/plan tools)
    const agentTools = buildAgentToolSet(ctx, {
      readOnly,
      planModeOnly,
      basicAgentMode: !readOnly && !planModeOnly && isBasicAgentMode(settings),
    });

    // Patch agent tool description so leader knows what sub-agents can/cannot do
    if (agentTools.agent) {
      const subAgentPerm = settings.subAgentFileAccess ?? "staging";
      const permNote =
        subAgentPerm === "read-only"
          ? "IMPORTANT: Sub-agents are in read-only mode — they can read files and search but cannot write, edit, or delete any files. Only delegate research and analysis tasks."
          : subAgentPerm === "staging"
            ? "IMPORTANT: Sub-agents can only write files to the .meowphyr/ staging directory (enforced). Delegate research tasks and report-writing; the leader must apply staged outputs to the real project."
            : "Sub-agents have full file access.";
      agentTools.agent = {
        ...agentTools.agent,
        description: agentTools.agent.description + `\n\n${permNote}`,
      };
    }

    const mcpTools =
      readOnly || planModeOnly ? {} : await getMcpTools(event, ctx);
    // Leader swarm tools — lets the main agent communicate with workers
    const leaderSwarmTools = {
      send_message: createSendMessageTool("leader", swarm, {
        onLog: (to, type, content) => {
          const preview = content.length > 300 ? content.slice(0, 300) + "…" : content;
          ctx.onXmlComplete(
            `<dyad-status title="📤 ${type} → ${escapeXmlAttr(to)}" state="finished">${escapeXmlContent(preview)}</dyad-status>`,
          );
        },
      }),
      read_messages: createReadMessagesTool("leader", swarm, {
        onLog: (msgs) => {
          if (msgs.length === 0) {
            ctx.onXmlComplete(
              `<dyad-status title="📥 Read messages" state="finished">No messages.</dyad-status>`,
            );
          } else {
            const preview = msgs
              .map(
                (m) =>
                  `${m.type.toUpperCase()} from "${m.from}":\n${m.content.slice(0, 500)}${m.content.length > 500 ? "…" : ""}`,
              )
              .join("\n\n---\n\n");
            ctx.onXmlComplete(
              `<dyad-status title="📥 ${msgs.length} message(s)" state="finished">${escapeXmlContent(preview)}</dyad-status>`,
            );
          }
        },
      }),
      wait_for_reply: createWaitForReplyTool("leader", swarm, {
        // createCallbacks is called once per execution so that parallel
        // wait_for_reply calls each get their own dedicated UI slot.
        // Without this, all pending cards share a single streamingPreview
        // (showing only 1), while all completions each append to fullResponse
        // (showing N timeout/result cards) — an inconsistent mismatch.
        createCallbacks: () => {
          const slotId = crypto.randomUUID();
          const marker = `\x00WAITREPLY:${slotId}\x00`;
          fullResponse += marker;
          subAgentMarkers.set(marker, slotId);

          return {
            onStart: (waitingFor) => {
              const label = waitingFor ? `Waiting for "${waitingFor}"…` : "Waiting for replies…";
              const pendingCard = `<dyad-status data-slot="${slotId}" title="${escapeXmlAttr(label)}" state="pending"></dyad-status>`;
              subAgentPreviews.set(slotId, pendingCard);
              sendCurrentView();
            },
            onLog: (msg) => {
              let finalCard: string;
              if (msg) {
                finalCard = `<dyad-status data-slot="${slotId}" title="📥 ${msg.type.toUpperCase()} from &quot;${escapeXmlAttr(msg.from)}&quot;" state="finished">${escapeXmlContent(msg.content.slice(0, 500))}${msg.content.length > 500 ? "…" : ""}</dyad-status>`;
              } else {
                finalCard = `<dyad-status data-slot="${slotId}" title="⏰ Wait timeout" state="finished">No reply received.</dyad-status>`;
              }
              subAgentPreviews.set(slotId, finalCard);
              const replaced = replaceDyadStatusSlot(fullResponse, slotId, finalCard);
              if (replaced !== fullResponse) {
                fullResponse = replaced;
              } else {
                fullResponse = fullResponse.replace(marker, finalCard + "\n");
              }
              subAgentMarkers.delete(marker);
              updateResponseInDb(placeholderMessageId, fullResponse);
              sendCurrentView();
            },
          };
        },
      }),
      monitor_agents: createMonitorAgentsTool("leader", swarm, {
        onLog: (result) => {
          ctx.onXmlComplete(
            `<dyad-status title="🔭 Agent status" state="finished">${escapeXmlContent(result)}</dyad-status>`,
          );
        },
      }),
    };
    const allTools: ToolSet = { ...agentTools, ...mcpTools, ...leaderSwarmTools };

    // Prepare message history with graceful fallback
    // Use messageOverride if provided (e.g., for summarization)
    // If a compaction summary exists, only include messages from that point onward
    // (pre-compaction messages are preserved in DB for the user but not sent to LLM)
    const messageHistory: ModelMessage[] = messageOverride
      ? messageOverride
      : buildChatMessageHistory(chat.messages);

    // Inject the referenced-apps manifest into the user's latest message as a
    // `<system-reminder>` block (instead of appending it to the system prompt)
    // so the system prompt stays static and cacheable.
    if (referencedApps.length > 0) {
      injectReferencedAppsReminder(messageHistory, referencedApps);
    }

    // Used to swap out pre-compaction history while preserving in-flight turn steps.
    let baseMessageHistoryCount = messageHistory.length;
    let compactBeforeNextStep = false;
    let compactedMidTurn = false;
    let compactionFailedMidTurn = false;
    // Tracks the difference between the compacted base message count and the
    // SDK's initialMessages count. Used to adjust injection indices after
    // compaction so that subsequent steps (which use the SDK's shorter base)
    // inject user messages at the correct position.
    let compactionIndexDelta = 0;

    const maxOutputTokens = await getMaxTokens(settings.selectedModel);
    const temperature = await getTemperature(settings.selectedModel);

    // Run one or more generation passes. If the model emits a chat message while
    // there are still incomplete todos, we append a reminder and do another pass.
    const maxTodoFollowUpLoops = 1;
    let todoFollowUpLoops = 0;
    let hasInjectedPlanningQuestionnaireReflection = false;
    let currentMessageHistory = messageHistory;
    const accumulatedAiMessages: ModelMessage[] = [];
    // Track total steps across all passes to detect step limit
    let totalStepsExecuted = 0;
    let hitStepLimit = false;

    // If there are persisted todos from a previous turn, inject a synthetic
    // user message so the LLM is aware of them. Inserted BEFORE the user's
    // current message so the user's actual request is the last thing the LLM
    // reads, giving it natural priority over stale todos.
    if (
      !messageOverride &&
      !readOnly &&
      !planModeOnly &&
      persistedTodos.length > 0 &&
      hasIncompleteTodos(persistedTodos)
    ) {
      const incompleteTodos = persistedTodos.filter(
        (t) => t.status === "pending" || t.status === "in_progress",
      );
      const todoSummary = formatTodoSummary(incompleteTodos);
      const syntheticMessage: ModelMessage = {
        role: "user",
        content: [
          {
            type: "text",
            text: `[System] You have unfinished todos from your previous turn:\n${todoSummary}\n\nThe user's next message is their current request. If their request relates to these todos, continue working on them. If their request is about something different, discard these old todos by calling update_todos with merge=false and an empty list, then focus entirely on the user's new request.`,
          },
        ],
      };
      // Insert before the last message (the user's current message) so the
      // user's intent is the final thing the LLM sees.
      const insertIndex = Math.max(0, currentMessageHistory.length - 1);
      currentMessageHistory = [
        ...currentMessageHistory.slice(0, insertIndex),
        syntheticMessage,
        ...currentMessageHistory.slice(insertIndex),
      ];
    }

    while (!abortController.signal.aborted) {
      // Reset mid-turn compaction state at the start of each pass.
      // These flags track compaction within a single pass and must not persist
      // across passes (e.g., todo follow-up passes).
      compactedMidTurn = false;
      compactionFailedMidTurn = false;
      compactBeforeNextStep = false;
      compactionIndexDelta = 0;
      postMidTurnCompactionStartStep = null;
      baseMessageHistoryCount = currentMessageHistory.length;

      let passProducedChatText = false;
      let responseMessages: ModelMessage[] = [];
      let steps: Array<{
        toolCalls: Array<unknown>;
        response?: { messages?: ModelMessage[] };
      }> = [];
      let terminatedRetryCount = 0;
      let needsContinuationInstruction = false;

      // Retry loop: if the stream terminates with a transient error, captured text/tool events are replayed into message history, a continuation instruction is appended, and the stream is re-opened.
      while (!abortController.signal.aborted) {
        let streamErrorFromCallback: unknown;
        const retryReplayEvents: RetryReplayEvent[] = [];
        activeRetryReplayEvents = retryReplayEvents;
        const attemptMessages = needsContinuationInstruction
          ? [
              ...currentMessageHistory,
              buildTerminatedRetryContinuationInstruction(),
            ]
          : currentMessageHistory;
        const attemptToolInputIds = new Set<string>();
        const cleanupAttemptToolStreamingEntries = () => {
          for (const toolCallId of attemptToolInputIds) {
            cleanupStreamingEntry(toolCallId);
          }
          attemptToolInputIds.clear();
        };

        try {
          const streamResult = streamText({
            model: modelClient.model,
            headers: {
              ...getAiHeaders({
                builtinProviderId: modelClient.builtinProviderId,
              }),
              [DYAD_INTERNAL_REQUEST_ID_HEADER]: dyadRequestId,
            },
            providerOptions: getProviderOptions({
              dyadAppId: chat.app.id,
              dyadRequestId,
              dyadDisableFiles: true, // Local agent uses tools, not file injection
              files: [],
              mentionedAppsCodebases: [],
              builtinProviderId: modelClient.builtinProviderId,
              settings,
            }),
            maxOutputTokens,
            temperature,
            maxRetries: 2,
            system: systemPrompt,
            messages: attemptMessages,
            tools: allTools,
            stopWhen: [
              stepCountIs(maxToolCallSteps),
              // User needs to explicitly set up integration before AI can continue.
              hasToolCall(addIntegrationTool.name),
              // In plan mode, also stop after writing a plan or exiting plan mode.
              ...(planModeOnly
                ? [
                    hasToolCall(writePlanTool.name),
                    hasToolCall(exitPlanTool.name),
                  ]
                : []),
            ],
            abortSignal: abortController.signal,
            // Inject pending user messages (e.g., images from web_crawl) between steps
            // We must re-inject all accumulated messages each step because the AI SDK
            // doesn't persist dynamically injected messages in its internal state.
            // We track the insertion index so messages appear at the same position each step.
            prepareStep: async (options) => {
              let stepOptions = options;

              if (
                !messageOverride &&
                compactBeforeNextStep &&
                !compactedMidTurn &&
                settings.enableContextCompaction !== false
              ) {
                compactBeforeNextStep = false;
                const inFlightTailMessages = options.messages.slice(
                  baseMessageHistoryCount,
                );
                const compacted = await maybePerformPendingCompaction({
                  showOnTopOfCurrentResponse: true,
                  force: true,
                });

                if (compacted) {
                  compactedMidTurn = true;
                  // Preserve only messages generated after this compaction boundary.
                  postMidTurnCompactionStartStep = options.stepNumber;
                  // Clear stale injected messages — their insertAtIndex values are
                  // based on the pre-compaction message array which has been rebuilt
                  // with a different (typically smaller) count. Keeping them would
                  // cause injectMessagesAtPositions to splice at wrong positions.
                  allInjectedMessages.length = 0;
                  const preCompactionBaseCount = baseMessageHistoryCount;
                  const compactedMessageHistory = buildChatMessageHistory(
                    chat.messages,
                    {
                      // Keep the structured in-flight assistant/tool messages from
                      // the current stream instead of the placeholder DB content.
                      excludeMessageIds: new Set([placeholderMessageId]),
                    },
                  );
                  // The referenced-apps reminder lives only in-memory on the
                  // latest user message and is not persisted, so rebuilding
                  // history from the DB drops it. Re-inject so post-compaction
                  // tool steps keep the explicit app_name allow-list.
                  if (referencedApps.length > 0) {
                    injectReferencedAppsReminder(
                      compactedMessageHistory,
                      referencedApps,
                    );
                  }
                  baseMessageHistoryCount = compactedMessageHistory.length;
                  // The compacted history includes the compaction summary, but the
                  // AI SDK's initialMessages does not. Track the delta so we can
                  // adjust injection indices after prepareStepMessages runs.
                  compactionIndexDelta =
                    baseMessageHistoryCount - preCompactionBaseCount;
                  stepOptions = {
                    ...options,
                    // Preserve in-flight turn messages so same-turn tool loops can
                    // continue, while later turns are compacted via persisted history.
                    messages: [
                      ...compactedMessageHistory,
                      ...inFlightTailMessages,
                    ],
                  };
                } else {
                  // Prevent repeated compaction attempts if the first one fails.
                  compactionFailedMidTurn = true;
                }
              }

              const preparedStep = prepareStepMessages(
                stepOptions,
                pendingUserMessages,
                allInjectedMessages,
              );

              // After mid-turn compaction, injection indices are based on the
              // compacted message array (which includes the compaction summary).
              // The AI SDK's internal messages don't include this summary, so
              // subsequent steps have a shorter base. Adjust indices now so
              // future re-injections land at the correct position.
              if (compactionIndexDelta !== 0) {
                for (const injection of allInjectedMessages) {
                  injection.insertAtIndex = Math.max(
                    0,
                    injection.insertAtIndex - compactionIndexDelta,
                  );
                }
                // Always reset, even when no injections exist yet — a tool may
                // add pending messages in a later step and their indices should
                // not be shifted by a stale delta.
                compactionIndexDelta = 0;
              }

              // prepareStepMessages returns undefined when it has no additional
              // injections/cleanups to apply. If we already replaced the base
              // message history (e.g., after mid-turn compaction), we still need
              // to return the updated options.
              let result =
                preparedStep ??
                (stepOptions === options ? undefined : stepOptions);

              // Defensive: ensure injected user messages don't break
              // tool_use/tool_result pairing. Catches edge cases where
              // injection indices become stale after compaction.
              if (result?.messages) {
                const fixed = ensureToolResultOrdering(result.messages);
                if (fixed) {
                  logger.warn(
                    `ensureToolResultOrdering fixed misplaced user messages in chat ${req.chatId}`,
                  );
                  result = { ...result, messages: fixed };
                }
              }

              return result;
            },
            onStepFinish: async (step) => {
              if (!hasInjectedPlanningQuestionnaireReflection) {
                const questionnaireError =
                  getPlanningQuestionnaireErrorFromStep(step);
                if (questionnaireError) {
                  pendingUserMessages.push([
                    {
                      type: "text",
                      text: buildPlanningQuestionnaireReflectionMessage(
                        questionnaireError,
                        planModeOnly,
                      ),
                    },
                  ]);
                  hasInjectedPlanningQuestionnaireReflection = true;
                  logger.info(
                    `Injected synthetic planning_questionnaire reflection message for chat ${req.chatId}`,
                  );
                }
              }

              // Update DB and send realtime token update per step
              if (typeof step.usage.inputTokens === "number") {
                const stepInputTokens = step.usage.inputTokens;
                const stepOutputTokens = step.usage.outputTokens ?? null;
                const stepCachedInputTokens = step.usage.cachedInputTokens ?? null;

                await db
                  .update(messages)
                  .set({
                    maxTokensUsed: stepInputTokens + (stepCachedInputTokens ?? 0),
                    inputTokens: stepInputTokens,
                    outputTokens: stepOutputTokens,
                    cachedInputTokens: stepCachedInputTokens,
                  })
                  .where(eq(messages.id, placeholderMessageId))
                  .catch((err) =>
                    logger.error("Failed to save token count per step", err),
                  );

                safeSend(event.sender, "chat:response:chunk", {
                  chatId: req.chatId,
                  tokenUpdate: {
                    contextWindow: await getContextWindow(),
                    actualInputTokens: stepInputTokens,
                    actualOutputTokens: stepOutputTokens,
                    actualCachedInputTokens: stepCachedInputTokens,
                  },
                });
              }

              if (
                settings.enableContextCompaction === false ||
                compactedMidTurn ||
                typeof step.usage.inputTokens !== "number"
              ) {
                return;
              }

              // Total context usage = non-cached input + cached input.
              // For Anthropic/DeepSeek, inputTokens is non-cached only.
              const stepTotalInputTokens =
                step.usage.inputTokens + (step.usage.cachedInputTokens ?? 0);
              const shouldCompact = await checkAndMarkForCompaction(
                req.chatId,
                stepTotalInputTokens,
              );

              // If this step triggered tool calls, compact before the next step
              // in this same user turn instead of waiting for the next message.
              // Only attempt mid-turn compaction once per turn.
              if (
                shouldCompact &&
                step.toolCalls.length > 0 &&
                !compactionFailedMidTurn
              ) {
                compactBeforeNextStep = true;
              }
            },
            onFinish: async (response) => {
              const totalTokens = response.usage?.totalTokens;
              const inputTokens = response.usage?.inputTokens;
              const cachedInputTokens = response.usage?.cachedInputTokens;
              logger.log(
                "Total tokens used:",
                totalTokens,
                "Input tokens:",
                inputTokens,
                "Cached input tokens:",
                cachedInputTokens,
                "Cache hit ratio:",
                cachedInputTokens
                  ? (cachedInputTokens ?? 0) / (inputTokens ?? 0)
                  : 0,
              );
              if (typeof inputTokens === "number") {
                await db
                  .update(messages)
                  .set({
                    maxTokensUsed: inputTokens + (cachedInputTokens ?? 0),
                    inputTokens,
                    outputTokens: response.usage?.outputTokens ?? null,
                    cachedInputTokens: cachedInputTokens ?? null,
                  })
                  .where(eq(messages.id, placeholderMessageId))
                  .catch((err) =>
                    logger.error("Failed to save token count", err),
                  );
              }
            },
            onError: (error: any) => {
              const normalizedError = unwrapStreamError(error);
              streamErrorFromCallback = normalizedError;
              const extra: Record<string, unknown> = {};
              if (isRecord(normalizedError)) {
                if (normalizedError.responseBody) extra.responseBody = normalizedError.responseBody;
                if (normalizedError.statusCode) extra.statusCode = normalizedError.statusCode;
                if (normalizedError.url) extra.url = normalizedError.url;
              }
              logger.error(
                `Local agent stream error: ${getErrorMessage(normalizedError)}`,
                Object.keys(extra).length > 0 ? extra : undefined,
              );
            },
          });

          // Read .fullStream now (not lazily) so the SDK's `teeStream()`
          // runs synchronously, then cancel the orphaned tee branch
          // before any chunks are pumped. See `cancelOrphanedBaseStream`
          // for the underlying SDK behavior and why this is required.
          const fullStream = streamResult.fullStream;
          cancelOrphanedBaseStream(streamResult);

          let inThinkingBlock = false;
          let streamErrorFromIteration: unknown;

          try {
            for await (const part of fullStream) {
              if (abortController.signal.aborted) {
                logger.log(`Stream aborted for chat ${req.chatId}`);
                // Clean up pending consent/questionnaire requests to prevent stale UI banners
                clearPendingConsentsForChat(req.chatId);
                clearPendingQuestionnairesForChat(req.chatId);
                break;
              }

              let chunk = "";

              // Handle thinking block transitions
              if (
                inThinkingBlock &&
                ![
                  "reasoning-delta",
                  "reasoning-end",
                  "reasoning-start",
                ].includes(part.type)
              ) {
                chunk = "</think>\n";
                inThinkingBlock = false;
              }

              switch (part.type) {
                case "text-delta":
                  passProducedChatText = true;
                  chunk += part.text;
                  maybeCaptureRetryReplayText(
                    activeRetryReplayEvents,
                    part.text,
                  );
                  break;

                case "reasoning-start":
                  if (!inThinkingBlock) {
                    chunk = "<think>";
                    inThinkingBlock = true;
                  }
                  break;

                case "reasoning-delta":
                  if (!inThinkingBlock) {
                    chunk = "<think>";
                    inThinkingBlock = true;
                  }
                  chunk += part.text;
                  break;

                case "reasoning-end":
                  if (inThinkingBlock) {
                    chunk = "</think>\n";
                    inThinkingBlock = false;
                  }
                  break;

                case "tool-input-start": {
                  // Initialize streaming state for this tool call
                  getOrCreateStreamingEntry(part.id, part.toolName);
                  attemptToolInputIds.add(part.id);
                  break;
                }

                case "tool-input-delta": {
                  // Accumulate args and stream XML preview
                  const entry = getOrCreateStreamingEntry(part.id);
                  if (entry) {
                    entry.argsAccumulated += part.delta;
                    const toolDef = findToolDefinition(entry.toolName);
                    if (toolDef?.buildXml) {
                      const argsPartial = parsePartialJson(
                        entry.argsAccumulated,
                      );
                      const xml = toolDef.buildXml(argsPartial, false);
                      if (xml) {
                        ctx.onXmlStream(xml);
                      }
                    }
                  }
                  break;
                }

                case "tool-input-end": {
                  // Build final XML and persist
                  const entry = getOrCreateStreamingEntry(part.id);
                  if (entry) {
                    const toolDef = findToolDefinition(entry.toolName);
                    if (toolDef?.buildXml) {
                      const argsPartial = parsePartialJson(
                        entry.argsAccumulated,
                      );
                      const xml = toolDef.buildXml(argsPartial, true);
                      if (xml) {
                        ctx.onXmlComplete(xml);
                      } else {
                        // Tool opts out of a completion block (e.g. agent tool
                        // whose output is managed by runSubAgent). Clear any
                        // stale streaming preview so it doesn't duplicate the
                        // slot the tool will create during execution.
                        streamingPreview = "";
                        sendCurrentView();
                      }
                    }
                  }
                  cleanupStreamingEntry(part.id);
                  attemptToolInputIds.delete(part.id);
                  break;
                }

                case "tool-call":
                  maybeCaptureRetryReplayEvent(retryReplayEvents, part);
                  // Tool execution happens via execute callbacks
                  break;

                case "tool-result":
                  maybeCaptureRetryReplayEvent(retryReplayEvents, part);
                  // Tool results are already handled by the execute callback
                  break;
              }

              if (chunk) {
                fullResponse += chunk;
                await updateResponseInDb(placeholderMessageId, fullResponse);
                sendCurrentView();
              }
            }
          } catch (error) {
            if (!abortController.signal.aborted) {
              streamErrorFromIteration = error;
            } else {
              logger.log(
                `Stream interrupted after abort for chat ${req.chatId}`,
              );
            }
          }

          // Close thinking block if still open
          if (inThinkingBlock) {
            const closingThinkBlock = "</think>\n";
            fullResponse += closingThinkBlock;
            await updateResponseInDb(placeholderMessageId, fullResponse);
          }
          activeRetryReplayEvents = null;

          if (abortController.signal.aborted) {
            break;
          }

          const streamError =
            streamErrorFromIteration ?? streamErrorFromCallback;
          if (streamError) {
            if (
              shouldRetryTransientStreamError({
                error: streamError,
                retryCount: terminatedRetryCount,
                aborted: abortController.signal.aborted,
              })
            ) {
              maybeAppendRetryReplayForRetry({
                retryReplayEvents,
                currentMessageHistoryRef: currentMessageHistory,
                accumulatedAiMessagesRef: accumulatedAiMessages,
                onCurrentMessageHistoryUpdate: (next) =>
                  (currentMessageHistory = next),
              });
              terminatedRetryCount += 1;
              needsContinuationInstruction = true;
              const retryDelayMs =
                STREAM_RETRY_BASE_DELAY_MS * terminatedRetryCount;
              sendTelemetryEvent("local_agent:terminated_stream_retry", {
                chatId: req.chatId,
                dyadRequestId,
                retryCount: terminatedRetryCount,
                error: String(streamError),
                phase: "stream_iteration",
              });
              logger.warn(
                `Transient stream termination for chat ${req.chatId}; retrying pass (${terminatedRetryCount}/${MAX_TERMINATED_STREAM_RETRIES}) after ${retryDelayMs}ms`,
              );
              await delay(retryDelayMs);
              continue;
            }
            sendTelemetryEvent(
              "local_agent:terminated_stream_retries_exhausted",
              {
                chatId: req.chatId,
                dyadRequestId,
                retryCount: terminatedRetryCount,
                error: String(streamError),
                phase: "stream_iteration",
              },
            );
            throw streamError;
          }

          try {
            const response = await streamResult.response;
            steps = (await streamResult.steps) ?? [];
            responseMessages = response.messages;
          } catch (err) {
            if (
              shouldRetryTransientStreamError({
                error: err,
                retryCount: terminatedRetryCount,
                aborted: abortController.signal.aborted,
              })
            ) {
              maybeAppendRetryReplayForRetry({
                retryReplayEvents,
                currentMessageHistoryRef: currentMessageHistory,
                accumulatedAiMessagesRef: accumulatedAiMessages,
                onCurrentMessageHistoryUpdate: (next) =>
                  (currentMessageHistory = next),
              });
              terminatedRetryCount += 1;
              needsContinuationInstruction = true;
              const retryDelayMs =
                STREAM_RETRY_BASE_DELAY_MS * terminatedRetryCount;
              sendTelemetryEvent("local_agent:terminated_stream_retry", {
                chatId: req.chatId,
                dyadRequestId,
                retryCount: terminatedRetryCount,
                error: String(err),
                phase: "response_finalization",
              });
              logger.warn(
                `Transient stream termination while finalizing response for chat ${req.chatId}; retrying pass (${terminatedRetryCount}/${MAX_TERMINATED_STREAM_RETRIES}) after ${retryDelayMs}ms`,
              );
              await delay(retryDelayMs);
              continue;
            }
            if (isTerminatedStreamError(err)) {
              sendTelemetryEvent(
                "local_agent:terminated_stream_retries_exhausted",
                {
                  chatId: req.chatId,
                  dyadRequestId,
                  retryCount: terminatedRetryCount,
                  error: String(err),
                  phase: "response_finalization",
                },
              );
            }
            logger.warn("Failed to retrieve stream response messages:", err);
            steps = [];
            responseMessages = [];
          }

          break;
        } finally {
          cleanupAttemptToolStreamingEntries();
        }
      }

      if (abortController.signal.aborted) {
        break;
      }

      // Track total steps for step limit detection
      totalStepsExecuted += steps.length;

      if (responseMessages.length > 0) {
        // For mid-turn compaction, slice off pre-compaction messages
        const messagesToAccumulate =
          compactedMidTurn && postMidTurnCompactionStartStep !== null
            ? (() => {
                // stepNumber is 0-indexed (from AI SDK: stepNumber = steps.length).
                // We want the step just before compaction to determine how many
                // response messages to skip (they belong to pre-compaction context).
                const prevStepMessages =
                  steps[postMidTurnCompactionStartStep - 1]?.response?.messages;
                if (!prevStepMessages) {
                  logger.warn(
                    `No step data found at index ${postMidTurnCompactionStartStep - 1} for mid-turn compaction slicing; persisting all messages`,
                  );
                }
                return responseMessages.slice(prevStepMessages?.length ?? 0);
              })()
            : responseMessages;
        accumulatedAiMessages.push(...messagesToAccumulate);
        currentMessageHistory = [
          ...currentMessageHistory,
          ...messagesToAccumulate,
        ];
      }

      // Check if the model ended with text only (no tool calls in the final step).
      // set_chat_summary is metadata, so a summary-only final step should not
      // suppress the todo safety follow-up when the pass already produced text.
      // This is more reliable than passProducedChatText which is set on any text-delta
      // during the stream (including preambles before tool calls).
      const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
      const passEndedWithText =
        passProducedChatText &&
        (!lastStep ||
          lastStep.toolCalls.length === 0 ||
          stepOnlyCalledTool(lastStep, setChatSummaryTool.name));

      if (
        !shouldRunTodoFollowUpPass({
          readOnly,
          planModeOnly,
          passEndedWithText,
          todos: ctx.todos,
          todoFollowUpLoops,
          maxTodoFollowUpLoops,
        })
      ) {
        break;
      }

      todoFollowUpLoops += 1;
      const reminderText = buildTodoReminderMessage(ctx.todos);
      const reminderMessage: ModelMessage = {
        role: "user",
        content: [{ type: "text", text: reminderText }],
      };
      currentMessageHistory = [...currentMessageHistory, reminderMessage];
      // Note: Do NOT push reminderMessage to accumulatedAiMessages.
      // It is a synthetic message that should not be persisted to aiMessagesJson,
      // as it would pollute future conversation history with stale todo state.
      logger.info(
        `Starting todo follow-up pass ${todoFollowUpLoops}/${maxTodoFollowUpLoops} for chat ${req.chatId}`,
      );
    }

    // Handle cancellation paths where stream processing exits cleanly after abort.
    if (abortController.signal.aborted) {
      await db
        .update(messages)
        .set({
          content: appendCancelledResponseNotice(fullResponse ?? ""),
        })
        .where(eq(messages.id, placeholderMessageId));
      return false; // Cancelled - don't consume quota
    }

    // Collect XML produced by post-turn side-effects (step-limit notice,
    // Supabase deploy results) so we can persist them into aiMessagesJson.
    // parseAiMessagesJson reads from aiMessagesJson when present and ignores
    // the message's `content` column, so anything appended only to fullResponse
    // would be invisible to subsequent agent turns.
    const postTurnXmlParts: string[] = [];

    // Check if we hit the step limit and append a notice to the response
    if (totalStepsExecuted >= maxToolCallSteps) {
      hitStepLimit = true;
      logger.info(
        `Chat ${req.chatId} hit step limit of ${maxToolCallSteps} steps`,
      );
      const stepLimitXml = `<dyad-step-limit steps="${totalStepsExecuted}" limit="${maxToolCallSteps}">Automatically paused after ${totalStepsExecuted} tool calls.</dyad-step-limit>`;
      postTurnXmlParts.push(stepLimitXml);
      fullResponse += `\n\n${stepLimitXml}`;
      await updateResponseInDb(placeholderMessageId, fullResponse);
      sendCurrentView();
    }

    // In read-only and plan mode, skip the deploy step (commit follows below)
    if (!readOnly && !planModeOnly) {
      // Deploy all Supabase functions if shared modules changed
      const deployResult = await deployAllFunctionsIfNeeded({
        ...ctx,
        onXmlComplete: (finalXml) => {
          postTurnXmlParts.push(finalXml);
          ctx.onXmlComplete(finalXml);
        },
      });
      if (deployResult.warning) {
        const warningXml = `<dyad-output type="warning" message="${escapeXmlAttr("Supabase function deploy warning")}">${escapeXmlContent(deployResult.warning)}</dyad-output>`;
        postTurnXmlParts.push(warningXml);
        ctx.onXmlComplete(warningXml);
      }
      if (!deployResult.success) {
        const errorXml = `<dyad-output type="error" message="${escapeXmlAttr("Failed to deploy Supabase functions")}">${escapeXmlContent(deployResult.error ?? "Unknown deploy error")}</dyad-output>`;
        postTurnXmlParts.push(errorXml);
        ctx.onXmlComplete(errorXml);
      }
    }

    // Persist post-turn side-effects as a trailing assistant message so future
    // agent turns can see them via aiMessagesJson. Done before the
    // aiMessagesJson write below so deploy/step-limit info is captured even if
    // a later step (e.g. commit) throws.
    if (postTurnXmlParts.length > 0) {
      accumulatedAiMessages.push({
        role: "assistant",
        content: [{ type: "text", text: postTurnXmlParts.join("\n") }],
      });
    }

    // Save the AI SDK messages for multi-turn tool call preservation
    try {
      const aiMessagesJson = getAiMessagesJsonIfWithinLimit(
        accumulatedAiMessages,
      );
      if (aiMessagesJson) {
        await db
          .update(messages)
          .set({ aiMessagesJson })
          .where(eq(messages.id, placeholderMessageId));
      }
    } catch (err) {
      logger.warn("Failed to save AI messages JSON:", err);
    }

    // In read-only and plan mode, skip commits
    if (!readOnly && !planModeOnly) {
      // Commit all changes
      const commitResult = await commitAllChanges(ctx, ctx.chatSummary);

      if (commitResult.commitHash) {
        await db
          .update(messages)
          .set({ commitHash: commitResult.commitHash })
          .where(eq(messages.id, placeholderMessageId));
      }

      // Store Neon DB timestamp for version tracking / time-travel
      if (ctx.neonProjectId && ctx.neonActiveBranchId) {
        try {
          await storeDbTimestampAtCurrentVersion({ appId: ctx.appId });
        } catch (error) {
          logger.error(
            "Error storing Neon timestamp at current version:",
            error,
          );
        }
      }
    }

    // Mark as approved (auto-approve for local-agent)
    await db
      .update(messages)
      .set({ approvalState: "approved" })
      .where(eq(messages.id, placeholderMessageId));

    // Send telemetry for files with multiple edit tool types
    for (const [filePath, counts] of Object.entries(fileEditTracker)) {
      const toolsUsed = Object.entries(counts).filter(([, count]) => count > 0);
      if (toolsUsed.length >= 2) {
        sendTelemetryEvent("local_agent:file_edit_retry", {
          filePath,
          ...counts,
        });
      }
    }

    // Replace remaining inline markers with current slot content so
    // background agent cards survive the chat:response:end transition.
    for (const [marker, slotId] of subAgentMarkers) {
      const preview = subAgentPreviews.get(slotId);
      if (preview) {
        fullResponse = fullResponse.replace(marker, preview + "\n");
      } else {
        fullResponse = fullResponse.replace(marker, "");
      }
    }
    subAgentMarkers.clear();
    await updateResponseInDb(placeholderMessageId, fullResponse);

    // Send completion
    safeSend(event.sender, "chat:response:end", {
      chatId: req.chatId,
      updatedFiles: !readOnly,
      chatSummary: ctx.chatSummary,
      warningMessages:
        warningMessages.length > 0 ? [...new Set(warningMessages)] : undefined,
      pausePromptQueue: hitStepLimit || undefined,
    } satisfies ChatResponseEnd);

    return true; // Success
  } catch (error) {
    // Clean up any pending consent/questionnaire requests for this chat to prevent
    // stale UI banners and orphaned promises
    clearPendingConsentsForChat(req.chatId);
    clearPendingQuestionnairesForChat(req.chatId);

    if (abortController.signal.aborted) {
      // Handle cancellation
      await db
        .update(messages)
        .set({
          content: appendCancelledResponseNotice(fullResponse ?? ""),
        })
        .where(eq(messages.id, placeholderMessageId));
      return false; // Cancelled - don't consume quota
    }

    const errDetail: Record<string, unknown> = {};
    if (isRecord(error)) {
      if (error.responseBody) errDetail.responseBody = error.responseBody;
      if (error.statusCode) errDetail.statusCode = error.statusCode;
      if (error.url) errDetail.url = error.url;
    }
    logger.error(
      `Local agent error: ${getErrorMessage(error)}`,
      Object.keys(errDetail).length > 0 ? errDetail : undefined,
    );
    safeSend(event.sender, "chat:response:error", {
      chatId: req.chatId,
      error: `Error: ${getErrorMessage(error)}`,
      warningMessages:
        warningMessages.length > 0 ? [...new Set(warningMessages)] : undefined,
    });
    return false; // Error - don't consume quota
  }
}

function buildTerminatedRetryContinuationInstruction(): ModelMessage {
  return {
    role: "user",
    content: [{ type: "text", text: STREAM_CONTINUE_MESSAGE }],
  };
}

function unwrapStreamError(error: unknown): unknown {
  if (isRecord(error) && "error" in error) {
    return error.error;
  }
  return error;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error)) {
    if (typeof error.message === "string" && error.message.length > 0) {
      return error.message;
    }
    if ("error" in error) {
      return getErrorMessage(error.error);
    }
    if ("cause" in error) {
      return getErrorMessage(error.cause);
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isTerminatedStreamError(error: unknown): boolean {
  const normalized = unwrapStreamError(error);
  const message = getErrorMessage(normalized).toLowerCase();
  if (message.includes("typeerror: terminated") || message === "terminated") {
    return true;
  }
  const cause =
    isRecord(normalized) && "cause" in normalized
      ? normalized.cause
      : undefined;
  if (cause) {
    return isTerminatedStreamError(cause);
  }
  return false;
}

function isRetryableProviderStreamError(error: unknown): boolean {
  const normalized = unwrapStreamError(error);
  if (!isRecord(normalized)) {
    return false;
  }

  const statusCode =
    (typeof normalized.statusCode === "number" && normalized.statusCode) ||
    (typeof normalized.status === "number" && normalized.status) ||
    (isRecord(normalized.response) &&
    typeof normalized.response.status === "number"
      ? normalized.response.status
      : undefined);

  if (
    typeof statusCode === "number" &&
    (statusCode >= 500 || RETRYABLE_STREAM_ERROR_STATUS_CODES.has(statusCode))
  ) {
    return true;
  }

  const errorString =
    [
      typeof normalized.message === "string" ? normalized.message : undefined,
      typeof normalized.code === "string" ? normalized.code : undefined,
      typeof normalized.type === "string" ? normalized.type : undefined,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase() || getErrorMessage(normalized).toLowerCase();

  return RETRYABLE_STREAM_ERROR_PATTERNS.some((pattern) =>
    errorString.includes(pattern),
  );
}

function shouldRetryTransientStreamError(params: {
  error: unknown;
  retryCount: number;
  aborted: boolean;
}): boolean {
  const { error, retryCount, aborted } = params;
  return (
    !aborted &&
    retryCount < MAX_TERMINATED_STREAM_RETRIES &&
    (isTerminatedStreamError(error) || isRetryableProviderStreamError(error))
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function updateResponseInDb(messageId: number, content: string) {
  await db
    .update(messages)
    .set({ content })
    .where(eq(messages.id, messageId))
    .catch((err) => logger.error("Failed to update message", err));
}

function sendResponseChunk(
  event: IpcMainInvokeEvent,
  chatId: number,
  chat: any,
  fullResponse: string,
  placeholderMessageId: number,
  hiddenMessageIds?: Set<number>,
  /** When true, sends the full messages array instead of an incremental update */
  sendFullMessages?: boolean,
) {
  if (sendFullMessages) {
    const currentMessages = [...chat.messages].filter(
      (message) => !hiddenMessageIds?.has(message.id),
    );
    const placeholderMsg = currentMessages.find(
      (m) => m.id === placeholderMessageId,
    );
    if (placeholderMsg) {
      placeholderMsg.content = fullResponse;
    }
    safeSend(event.sender, "chat:response:chunk", {
      chatId,
      messages: currentMessages,
    });
  } else {
    // Send incremental update with only the streaming message content
    // to reduce IPC overhead during high-frequency streaming
    safeSend(event.sender, "chat:response:chunk", {
      chatId,
      streamingMessageId: placeholderMessageId,
      streamingContent: fullResponse,
    });
  }
}

function getPlanningQuestionnaireErrorFromStep(step: {
  content?: unknown;
}): string | null {
  if (!Array.isArray(step.content)) {
    return null;
  }

  for (const part of step.content) {
    if (!isRecord(part) || part.toolName !== PLANNING_QUESTIONNAIRE_TOOL_NAME) {
      continue;
    }

    if (part.type === "tool-error") {
      return typeof part.error === "string" ? part.error : "Unknown tool error";
    }

    if (
      part.type === "tool-result" &&
      typeof part.output === "string" &&
      part.output.startsWith("Error:")
    ) {
      return part.output;
    }
  }

  return null;
}

function buildPlanningQuestionnaireReflectionMessage(
  errorDetail?: string,
  planModeOnly?: boolean,
): string {
  const base = "Your planning_questionnaire tool call had a format error.";
  const detail = errorDetail ? ` The error was: ${errorDetail}` : "";
  if (planModeOnly) {
    return `[System]${base}${detail} Review the tool's input schema, fix the issue, and re-call planning_questionnaire with correct arguments.`;
  }
  return `[System]${base}${detail} Skip the questionnaire step and proceed directly to the planning phase.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stepOnlyCalledTool(
  step: { toolCalls: Array<unknown> },
  toolName: string,
): boolean {
  return (
    step.toolCalls.length > 0 &&
    step.toolCalls.every(
      (toolCall) => isRecord(toolCall) && toolCall.toolName === toolName,
    )
  );
}

function shouldRunTodoFollowUpPass(params: {
  readOnly: boolean;
  planModeOnly: boolean;
  passEndedWithText: boolean;
  todos: AgentContext["todos"];
  todoFollowUpLoops: number;
  maxTodoFollowUpLoops: number;
}): boolean {
  const {
    readOnly,
    planModeOnly,
    passEndedWithText,
    todos,
    todoFollowUpLoops,
    maxTodoFollowUpLoops,
  } = params;
  return (
    !readOnly &&
    !planModeOnly &&
    passEndedWithText &&
    hasIncompleteTodos(todos) &&
    todoFollowUpLoops < maxTodoFollowUpLoops
  );
}

async function getMcpTools(
  event: IpcMainInvokeEvent,
  ctx: AgentContext,
): Promise<ToolSet> {
  const mcpToolSet: ToolSet = {};

  try {
    const servers = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true as any));

    for (const s of servers) {
      const client = await mcpManager.getClient(s.id);
      const toolSet = await client.tools();

      for (const [name, mcpTool] of Object.entries(toolSet)) {
        const key = `${sanitizeMcpName(s.name || "")}__${sanitizeMcpName(name)}`;

        mcpToolSet[key] = {
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema,
          execute: async (args: unknown, execCtx: ToolExecutionOptions) => {
            try {
              const inputPreview =
                typeof args === "string"
                  ? args
                  : Array.isArray(args)
                    ? args.join(" ")
                    : JSON.stringify(args).slice(0, 500);

              const ok = await requireMcpToolConsent(event, {
                serverId: s.id,
                serverName: s.name,
                toolName: name,
                toolDescription: mcpTool.description,
                inputPreview,
              });

              if (!ok) throw new Error(`User declined running tool ${key}`);

              // Emit XML for UI (MCP tools don't stream, so use onXmlComplete directly)
              const { serverName, toolName } = parseMcpToolKey(key);
              const content = JSON.stringify(args, null, 2);
              ctx.onXmlComplete(
                `<dyad-mcp-tool-call server="${serverName}" tool="${toolName}">\n${content}\n</dyad-mcp-tool-call>`,
              );

              const res = await mcpTool.execute(args, execCtx);
              const resultStr =
                typeof res === "string" ? res : JSON.stringify(res);

              ctx.onXmlComplete(
                `<dyad-mcp-tool-result server="${serverName}" tool="${toolName}">\n${resultStr}\n</dyad-mcp-tool-result>`,
              );

              return resultStr;
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              const errorStack =
                error instanceof Error && error.stack ? error.stack : "";
              ctx.onXmlComplete(
                `<dyad-output type="error" message="MCP tool '${key}' failed: ${escapeXmlAttr(errorMessage)}">${escapeXmlContent(errorStack || errorMessage)}</dyad-output>`,
              );
              throw error;
            }
          },
        };
      }
    }
  } catch (e) {
    logger.warn("Failed building MCP toolset for local-agent", e);
  }

  return mcpToolSet;
}
