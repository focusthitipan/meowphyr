import { z } from "zod";
import { AgentSwarm } from "./agent_swarm";

const readMessagesSchema = z.object({
  all: z
    .boolean()
    .optional()
    .describe(
      "If true, return all messages including already-read ones (default: unread only)",
    ),
});

/**
 * Factory: returns an AI-SDK-compatible tool object bound to a specific
 * agent name and swarm instance.
 */
export function createReadMessagesTool(
  agentName: string,
  swarm: AgentSwarm,
  options?: {
    onLog?: (msgs: { from: string; type: string; content: string }[]) => void;
  },
) {
  return {
    description:
      "Read messages in your inbox sent by other agents. By default returns only unread messages.",
    inputSchema: readMessagesSchema,
    execute: async (args: z.infer<typeof readMessagesSchema>) => {
      const msgs = args.all
        ? swarm.readAll(agentName)
        : swarm.readUnread(agentName);
      options?.onLog?.(msgs);
      if (msgs.length === 0) {
        return "No messages.";
      }
      return msgs
        .map(
          (m) =>
            `[${m.type.toUpperCase()} from "${m.from}" at ${new Date(m.timestamp).toISOString()}]:\n${m.content}`,
        )
        .join("\n\n---\n\n");
    },
  };
}
