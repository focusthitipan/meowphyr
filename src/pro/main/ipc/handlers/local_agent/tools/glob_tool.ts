import { z } from "zod";
import { glob } from "glob";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  DYAD_INTERNAL_GLOB,
  resolveTargetAppPath,
} from "./resolve_app_context";

const MAX_RESULTS = 100;
const MAX_DISPLAY_RESULTS = 20;

const globSchema = z.object({
  pattern: z
    .string()
    .describe(
      "Glob pattern to match files (e.g. '**/*.ts', 'src/**/*.{js,jsx}', '*.config.*')",
    ),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
});

export const globTool: ToolDefinition<z.infer<typeof globSchema>> = {
  name: "glob",
  description: `Find files matching a glob pattern in the application directory.

- Supports glob syntax: *, **, ?, {a,b}, [abc]
- Always ignores: .git/**, node_modules/**, .dyad internals
- Results are capped at ${MAX_RESULTS} paths; narrow your pattern if you hit the limit
- Use for file path discovery; use grep for searching file contents`,
  inputSchema: globSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    args.app_name
      ? `Find "${args.pattern}" in app: ${args.app_name}`
      : `Find "${args.pattern}"`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    if (!args.pattern) return undefined;
    return `<dyad-list-files pattern="${escapeXmlAttr(args.pattern)}"></dyad-list-files>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    // glob on Windows needs forward slashes for the cwd
    const normalizedAppPath = targetAppPath.replace(/\\/g, "/");

    const ignoreGlobs = args.app_name
      ? ["**/.git/**", "**/node_modules/**", DYAD_INTERNAL_GLOB]
      : ["**/.git/**", "**/node_modules/**"];

    const matches = await glob(args.pattern, {
      cwd: normalizedAppPath,
      nodir: false,
      dot: true,
      ignore: ignoreGlobs,
    });

    // Sort by modification time (newest first), same as ripgrep --sort=modified.
    // Falls back to alphabetical for files that can't be stat'd.
    const cwd = targetAppPath;
    const sortedMatches = [...matches]
      .map((p) => p.replace(/\\/g, "/"))
      .sort((a, b) => {
        try {
          const mA = statSync(join(cwd, a)).mtimeMs;
          const mB = statSync(join(cwd, b)).mtimeMs;
          return mB - mA;
        } catch {
          return a.localeCompare(b);
        }
      });

    const cappedMatches = sortedMatches.slice(0, MAX_RESULTS);
    const wasTruncated = sortedMatches.length > MAX_RESULTS;

    const patternAttr = `pattern="${escapeXmlAttr(args.pattern)}"`;
    const countAttr = `count="${cappedMatches.length}"`;
    const truncatedAttrs = wasTruncated
      ? ` total="${sortedMatches.length}" truncated="true"`
      : "";

    if (cappedMatches.length === 0) {
      ctx.onXmlComplete(
        `<dyad-list-files ${patternAttr} count="0"></dyad-list-files>`,
      );
      return "No files matched.";
    }

    // Full list for AI
    let resultText = cappedMatches.join("\n");
    if (wasTruncated) {
      resultText += `\n\n[TRUNCATED: Showing ${cappedMatches.length} of ${sortedMatches.length} matches. Use a more specific pattern to narrow results.]`;
    }

    // Abbreviated list for UI
    const displayLines = cappedMatches.slice(0, MAX_DISPLAY_RESULTS).join("\n");
    const extraNote =
      cappedMatches.length > MAX_DISPLAY_RESULTS
        ? `\n... and ${cappedMatches.length - MAX_DISPLAY_RESULTS} more (${cappedMatches.length} total)`
        : `\n(${cappedMatches.length} ${cappedMatches.length === 1 ? "file" : "files"})`;

    ctx.onXmlComplete(
      `<dyad-list-files ${patternAttr} ${countAttr}${truncatedAttrs}>\n${escapeXmlContent(displayLines + extraNote)}\n</dyad-list-files>`,
    );

    return resultText;
  },
};
