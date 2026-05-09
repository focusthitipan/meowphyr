import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";

const MAX_SECONDS = 300;

const sleepSchema = z.object({
  seconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_SECONDS)
    .describe(`Number of seconds to sleep (1–${MAX_SECONDS})`),
  reason: z
    .string()
    .optional()
    .describe("Optional human-readable reason for the delay"),
});

export const sleepTool: ToolDefinition<z.infer<typeof sleepSchema>> = {
  name: "sleep",
  description: `Pause execution for a specified number of seconds (max ${MAX_SECONDS}s). Use when you need to wait before polling again, let a background process settle, or introduce a deliberate delay between operations.`,
  inputSchema: sleepSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    const label = args.reason ? `${args.seconds}s — ${args.reason}` : `${args.seconds}s`;
    return `Sleep ${label}`;
  },

  // No buildXml — execute manages the UI cards directly via onXmlStream/onXmlComplete
  // so the in-progress card appears while sleeping and finished card appears after.

  execute: async (args, ctx: AgentContext) => {
    const seconds = Math.min(args.seconds, MAX_SECONDS);
    const reason = args.reason ? ` — ${args.reason}` : "";

    ctx.onXmlStream(
      `<dyad-status title="${escapeXmlAttr(`⏳ Sleeping ${seconds}s${reason}...`)}" state="in-progress"></dyad-status>`,
    );

    await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));

    ctx.onXmlComplete(
      `<dyad-status title="${escapeXmlAttr(`⏳ Slept ${seconds}s${reason}`)}" state="finished"></dyad-status>`,
    );

    return `Slept for ${seconds} second${seconds === 1 ? "" : "s"}${args.reason ? ` (${args.reason})` : ""}.`;
  },
};
