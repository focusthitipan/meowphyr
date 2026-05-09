import { z } from "zod";
import { AgentSwarm, AgentMessageType } from "./agent_swarm";

const sendMessageSchema = z.object({
  to: z
    .string()
    .describe(
      'Name of the agent to message ("leader" = main agent, "*" = broadcast to all)',
    ),
  content: z.string().describe("Message content"),
  type: z
    .enum(["text", "task", "report", "question", "answer"])
    .default("text")
    .describe("Message type"),
});

/**
 * Factory: returns an AI-SDK-compatible tool object (description + inputSchema + execute)
 * bound to a specific sender name and swarm instance.
 *
 * @param onLog  Optional callback invoked after each send, for UI logging in sub-agents.
 */
export function createSendMessageTool(
  senderName: string,
  swarm: AgentSwarm,
  options?: {
    onLog?: (to: string, type: AgentMessageType, content: string) => void;
  },
) {
  return {
    description: `Send a message to another agent in the swarm or broadcast to all. Available agents: ${
      swarm.agentNames.filter((n) => n !== senderName).join(", ") || "none yet"
    }. Use "leader" to message the main agent, "*" to broadcast.`,
    inputSchema: sendMessageSchema,
    execute: async (args: z.infer<typeof sendMessageSchema>) => {
      const type = (args.type ?? "text") as AgentMessageType;
      if (args.to === "*") {
        swarm.broadcast(senderName, type, args.content);
        const targets = swarm.agentNames.filter((n) => n !== senderName);
        options?.onLog?.("*", type, args.content);
        return `Broadcast sent to ${targets.length} agent(s): ${targets.join(", ")}`;
      }
      swarm.send(senderName, args.to, type, args.content);
      options?.onLog?.(args.to, type, args.content);
      return `Message sent to "${args.to}"`;
    },
  };
}
