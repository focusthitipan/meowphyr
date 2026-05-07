import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, escapeXmlContent, escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { htmlToText } from "./html_utils";

const logger = log.scope("web_fetch");

const MAX_CONTENT_LENGTH = 80_000;

function truncateContent(value: string): string {
  if (value.length <= MAX_CONTENT_LENGTH) return value;
  return `${value.slice(0, MAX_CONTENT_LENGTH)}\n\n<!-- truncated -->`;
}

function validateHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DyadError(`Invalid URL: ${url}`, DyadErrorKind.Validation);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DyadError(
      `Unsupported URL scheme "${parsed.protocol}" — only http and https are allowed`,
      DyadErrorKind.Validation,
    );
  }
}

const webFetchSchema = z.object({
  url: z.string().describe("URL to fetch content from"),
});

const DESCRIPTION = `Fetch and read the content of a web page as text given its URL.

### When to Use This Tool
Use this tool when the user's message contains a URL (or domain name) and they want to:
- **Read** the page's content (e.g. documentation, blog post, article)
- **Reference** information from the page (e.g. API docs, tutorials, guides)
- **Extract** data or context from a live web page to inform their code
- **Follow a link** someone shared to understand its contents

Examples:
- "Use the docs at docs.example.com/api to set up the client"
- "What does this page say? https://example.com/blog/post"
- "Follow the guide at example.com/tutorial"

### When NOT to Use This Tool
- The user wants to **visually clone or replicate** a website → use \`web_crawl\` instead
- The user needs to **search the web** for information without a specific URL → use \`web_search\` instead
`;

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; DyadBot/1.0; +https://dyad.sh)",
      Accept: "text/html,application/xhtml+xml,*/*",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new DyadError(
      `Failed to fetch ${url}: HTTP ${response.status}`,
      DyadErrorKind.External,
    );
  }

  const html = await response.text();
  return htmlToText(html);
}

export const webFetchTool: ToolDefinition<z.infer<typeof webFetchSchema>> = {
  name: "web_fetch",
  description: DESCRIPTION,
  inputSchema: webFetchSchema,
  defaultConsent: "always",
  isEnabled: () => true,

  getConsentPreview: (args) => `Fetch URL: "${args.url}"`,

  buildXml: (args, isComplete) => {
    if (!args.url) return undefined;
    if (isComplete) return undefined;
    return `<dyad-web-fetch url="${escapeXmlAttr(args.url)}">`;
  },

  execute: async (args, ctx) => {
    logger.log(`Executing web fetch: ${args.url}`);

    validateHttpUrl(args.url);

    ctx.onXmlStream(`<dyad-web-fetch url="${escapeXmlAttr(args.url)}">`);

    try {
      const content = await fetchPage(args.url);

      if (!content) {
        throw new DyadError(
          "No content available from web fetch",
          DyadErrorKind.NotFound,
        );
      }

      logger.log(`Web fetch completed for URL: ${args.url}`);

      ctx.onXmlComplete(
        `<dyad-web-fetch url="${escapeXmlAttr(args.url)}">${escapeXmlContent(content)}</dyad-web-fetch>`,
      );

      return truncateContent(`## ${args.url}\n\n${content}`);
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-web-fetch url="${escapeXmlAttr(args.url)}"></dyad-web-fetch>`,
      );
      throw error;
    }
  },
};
