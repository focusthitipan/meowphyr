import { z } from "zod";
import { ToolDefinition, escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const agentSchema = z.object({
  name: z
    .string()
    .describe(
      "Unique name for this agent in the swarm (e.g. 'frontend-agent', 'backend-agent'). Other agents can send messages to this name via send_message.",
    ),
  prompt: z
    .string()
    .describe("The task for the sub-agent to complete. Be specific."),
  description: z
    .string()
    .describe(
      "A short one-line description of what this sub-agent is doing (shown in UI, e.g. 'Implement the auth module')",
    ),
  background: z
    .boolean()
    .optional()
    .describe(
      "If true, spawn the agent in the background and return immediately. The agent will send results back via send_message(to: 'leader', type: 'report', ...). Use this to run multiple agents in parallel while you continue working.",
    ),
  initial_message: z
    .string()
    .optional()
    .describe(
      "Optional message pre-sent to this agent's inbox before it starts (useful for passing context or instructions from the leader).",
    ),
});

export const agentTool: ToolDefinition<z.infer<typeof agentSchema>> = {
  name: "agent",
  description: `Spawn a named sub-agent to complete a task in parallel with other agents.

- Each agent gets a unique name and can communicate with others via send_message / read_messages
- Agents can use all tools: read_file, write_file, bash, grep, web_search, etc.
- Use parallel agents to implement independent modules simultaneously
- Agents cannot spawn further agents (no nesting)
- Set background: true to spawn without waiting — agent reports back via send_message(to: "leader", type: "report", ...)
- The leader (you) can send initial context via initial_message
- Without background (default), waits for the agent to complete and returns its final output`,
  inputSchema: agentSchema,
  defaultConsent: "ask",

  getConsentPreview: (args) =>
    args.name
      ? `${args.name}: ${args.description || args.prompt.slice(0, 60)}`
      : args.description || args.prompt.slice(0, 80),

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    if (!args.description) return undefined;
    const prefix = args.background ? "BgAgent" : "Agent";
    const label = args.name
      ? `${prefix}[${args.name}]: ${args.description}`
      : `${prefix}: ${args.description}`;
    return `<dyad-status title="${escapeXmlAttr(label)}" state="pending"></dyad-status>`;
  },

  execute: async (args, ctx) => {
    if (!ctx.runSubAgent) {
      throw new DyadError(
        "Sub-agent execution is not available in this context",
        DyadErrorKind.Internal,
      );
    }

    // runSubAgent handles all XML streaming and the final onXmlComplete call.
    // This tool just returns the result text to the AI.
    return ctx.runSubAgent(args.prompt, args.description, {
      name: args.name,
      background: args.background,
      initialMessage: args.initial_message,
    });
  },
};
