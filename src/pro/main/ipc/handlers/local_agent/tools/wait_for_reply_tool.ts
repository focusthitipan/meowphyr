import { z } from "zod";
import { AgentSwarm } from "./agent_swarm";

const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 60_000;

const waitForReplySchema = z.object({
  from: z
    .string()
    .optional()
    .describe(
      'Wait for a message from this specific agent name. Omit to accept from any agent.',
    ),
  timeout_ms: z
    .number()
    .min(1_000)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe(
      `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS / 1000}s, max: ${MAX_TIMEOUT_MS / 1000}s). Returns a timeout notice if no message arrives in time.`,
    ),
});

type WaitForReplyCallbacks = {
  onStart?: (waitingFor: string | undefined) => void;
  onLog?: (msg: { from: string; type: string; content: string } | null) => void;
};

/**
 * Factory: returns an AI-SDK-compatible tool object bound to a specific
 * agent name and swarm instance.
 *
 * The tool blocks (awaits) until a matching message arrives in the agent's
 * inbox or the timeout elapses.
 *
 * `createCallbacks` — optional factory called once per tool execution.
 * Use this instead of `onStart`/`onLog` when parallel calls need isolated
 * per-call state (e.g. unique UI slots).  Takes priority over the static
 * `onStart`/`onLog` when both are supplied.
 */
export function createWaitForReplyTool(
  agentName: string,
  swarm: AgentSwarm,
  options?: WaitForReplyCallbacks & {
    createCallbacks?: () => WaitForReplyCallbacks;
  },
) {
  return {
    description:
      "Block and wait for an incoming message from another agent. Use after send_message when you need a response before continuing.",
    inputSchema: waitForReplySchema,
    execute: async (
      args: z.infer<typeof waitForReplySchema>,
      execOptions?: { abortSignal?: AbortSignal },
    ) => {
      const timeoutMs = Math.min(
        args.timeout_ms ?? DEFAULT_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
      );
      // Per-call callbacks take priority over shared ones so that parallel
      // invocations each get their own isolated UI slot.
      const cbs: WaitForReplyCallbacks = options?.createCallbacks?.() ?? options ?? {};
      // Signal the UI that we're waiting BEFORE the blocking call
      cbs.onStart?.(args.from);
      const msg = await swarm.waitForMessage(agentName, {
        from: args.from,
        timeoutMs,
        signal: execOptions?.abortSignal,
      });
      cbs.onLog?.(msg);
      if (!msg) {
        return `Timeout after ${timeoutMs / 1000}s — no message received${args.from ? ` from "${args.from}"` : ""}.`;
      }
      return `[${msg.type.toUpperCase()} from "${msg.from}"]:\n${msg.content}`;
    },
  };
}
