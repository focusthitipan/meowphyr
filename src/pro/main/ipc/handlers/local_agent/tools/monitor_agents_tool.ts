import { z } from "zod";
import { AgentSwarm } from "./agent_swarm";

const monitorAgentsSchema = z.object({});

/**
 * Factory: returns a tool that lets the leader check the live status of every
 * spawned sub-agent without blocking.  Use this to decide whether to wait,
 * retry, or give up before calling wait_for_reply.
 */
export function createMonitorAgentsTool(
  agentName: string,
  swarm: AgentSwarm,
  options?: {
    onLog?: (result: string) => void;
  },
) {
  return {
    description: `Check the live status of all spawned sub-agents (running / completed / failed) and whether they have unread messages waiting in the leader's inbox. Use this before calling wait_for_reply to avoid unnecessary timeouts, or after a timeout to see if any agent has already finished.`,
    inputSchema: monitorAgentsSchema,
    execute: async (_args: z.infer<typeof monitorAgentsSchema>) => {
      const lifecycles = swarm.getAllAgentLifecycles();
      if (lifecycles.size === 0) {
        const msg = "No sub-agents have been spawned yet.";
        options?.onLog?.(msg);
        return msg;
      }

      // Count unread messages per sender so the leader knows who reported back
      const leaderInbox = swarm.readAll(agentName);
      const unreadByFrom = new Map<string, number>();
      for (const msg of leaderInbox) {
        if (!msg.read) {
          unreadByFrom.set(msg.from, (unreadByFrom.get(msg.from) ?? 0) + 1);
        }
      }

      const lines: string[] = [];
      for (const [name, state] of lifecycles) {
        const elapsed = state.endedAt
          ? `${((state.endedAt - state.startedAt) / 1000).toFixed(1)}s`
          : `${((Date.now() - state.startedAt) / 1000).toFixed(1)}s (still running)`;

        const unread = unreadByFrom.get(name) ?? 0;
        const msgNote = unread > 0 ? ` | ${unread} unread message(s) in inbox` : "";

        if (state.status === "failed") {
          lines.push(`[${name}] ❌ FAILED after ${elapsed}: ${state.error ?? "unknown error"}${msgNote}`);
        } else if (state.status === "completed") {
          lines.push(`[${name}] ✅ COMPLETED in ${elapsed}${msgNote}`);
        } else {
          lines.push(`[${name}] ⏳ RUNNING for ${elapsed}${msgNote}`);
        }
      }

      const result = lines.join("\n");
      options?.onLog?.(result);
      return result;
    },
  };
}
