import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, escapeXmlAttr, escapeXmlContent } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";

const logger = log.scope("web_search");

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

const webSearchSchema = z.object({
  query: z.string().describe("The search query to look up on the web"),
});

const braveWebResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
});

const braveResponseSchema = z.object({
  web: z
    .object({
      results: z.array(braveWebResultSchema).optional(),
    })
    .optional(),
});

const DESCRIPTION = `
Use this tool to access real-time information beyond your training data cutoff.

When to Search:
- Current API documentation, library versions, or breaking changes
- Latest best practices, security advisories, or bug fixes
- Specific error messages or troubleshooting solutions
- Recent framework updates or deprecation notices

Query Tips:
- Be specific: Include version numbers, exact error messages, or technical terms
- Add context: "React 19 useEffect cleanup" not just "React hooks"

Examples:

<example>
OpenAI GPT-5 API model names
</example>

<example>
NextJS 14 app router middleware auth
</example>
`;

async function callBraveSearch(query: string, apiKey: string): Promise<string> {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "10");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new DyadError(
      `Brave Search failed: HTTP ${response.status}`,
      DyadErrorKind.External,
    );
  }

  const raw = await response.json();
  const parsed = braveResponseSchema.parse(raw);
  const results = parsed.web?.results ?? [];

  if (results.length === 0) {
    return "No results found.";
  }

  return results
    .map((r, i) => {
      const desc = r.description ? `\n   ${r.description}` : "";
      return `${i + 1}. **${r.title}**\n   ${r.url}${desc}`;
    })
    .join("\n\n");
}

export const webSearchTool: ToolDefinition<z.infer<typeof webSearchSchema>> = {
  name: "web_search",
  description: DESCRIPTION,
  inputSchema: webSearchSchema,
  defaultConsent: "ask",

  isEnabled: () => {
    const settings = readSettings();
    return !!settings.braveSearchApiKey;
  },

  getConsentPreview: (args) => `Search the web: "${args.query}"`,

  buildXml: (args, isComplete) => {
    if (!args.query) return undefined;
    if (isComplete) return undefined;
    return `<dyad-web-search query="${escapeXmlAttr(args.query)}">`;
  },

  execute: async (args, ctx) => {
    logger.log(`Executing web search: ${args.query}`);

    const settings = readSettings();
    const apiKey = settings.braveSearchApiKey;

    if (!apiKey) {
      throw new DyadError(
        "Brave Search API key is not configured. Please set it in Settings > Advanced > Web Search.",
        DyadErrorKind.Auth,
      );
    }

    ctx.onXmlStream(`<dyad-web-search query="${escapeXmlAttr(args.query)}">`);

    const result = await callBraveSearch(args.query, apiKey);

    ctx.onXmlComplete(
      `<dyad-web-search query="${escapeXmlAttr(args.query)}">${escapeXmlContent(result)}</dyad-web-search>`,
    );

    logger.log(`Web search completed for query: ${args.query}`);
    return result;
  },
};
