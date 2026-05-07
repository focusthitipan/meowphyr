import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, escapeXmlContent } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { htmlToText } from "./html_utils";

const logger = log.scope("web_crawl");

const MAX_TEXT_SNIPPET_LENGTH = 16_000;

const webCrawlSchema = z.object({
  url: z.string().describe("URL to crawl"),
});

const DESCRIPTION = `
You can crawl a website so you can clone it.

### When You MUST Trigger a Crawl
Trigger a crawl ONLY if BOTH conditions are true:

1. The user's message shows intent to CLONE / COPY / REPLICATE / RECREATE / DUPLICATE / MIMIC a website.
   - Keywords include: clone, copy, replicate, recreate, duplicate, mimic, build the same, make the same.

2. The user's message contains a URL or something that appears to be a domain name.
   - e.g. "example.com", "https://example.com"
   - Do not require 'http://' or 'https://'.
`;

const CLONE_INSTRUCTIONS = `
Replicate the website from the provided text snapshot.

**Use the snapshot below as your reference** to understand the page structure, content, and layout of the website.

**IMPORTANT: Image Handling**
- Do NOT use or reference real external image URLs.
- Instead, create a file named "placeholder.svg" at "/public/assets/placeholder.svg".
- The file must be included in the output as its own code block.
- The SVG should be a simple neutral gray rectangle, like:
  \`\`\`svg
  <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#e2e2e2"/>
  </svg>
  \`\`\`

**When generating code:**
- Replace all \`<img src="...">\` with: \`<img src="/assets/placeholder.svg" alt="placeholder" />\`
- If using Next.js Image component: \`<Image src="/assets/placeholder.svg" alt="placeholder" width={400} height={300} />\`

Always include the placeholder.svg file in your output file tree.
`;

function truncateText(value: string): string {
  if (value.length <= MAX_TEXT_SNIPPET_LENGTH) return value;
  return `${value.slice(0, MAX_TEXT_SNIPPET_LENGTH)}\n<!-- truncated -->`;
}

function formatSnippet(label: string, value: string, lang: string): string {
  const sanitized = truncateText(value).replace(/```/g, "` ` `");
  return `${label}:\n\`\`\`${lang}\n${sanitized}\n\`\`\``;
}

export { formatSnippet };

async function crawlPage(url: string): Promise<string> {
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
      `Failed to crawl ${url}: HTTP ${response.status}`,
      DyadErrorKind.External,
    );
  }

  const html = await response.text();
  return htmlToText(html);
}

export const webCrawlTool: ToolDefinition<z.infer<typeof webCrawlSchema>> = {
  name: "web_crawl",
  description: DESCRIPTION,
  inputSchema: webCrawlSchema,
  defaultConsent: "ask",
  isEnabled: () => true,

  getConsentPreview: (args) => `Crawl URL: "${args.url}"`,

  buildXml: (args, isComplete) => {
    if (!args.url) return undefined;
    let xml = `<dyad-web-crawl>${escapeXmlContent(args.url)}`;
    if (isComplete) xml += "</dyad-web-crawl>";
    return xml;
  },

  execute: async (args, ctx) => {
    logger.log(`Executing web crawl: ${args.url}`);

    const content = await crawlPage(args.url);

    if (!content) {
      throw new DyadError(
        "No content available from web crawl",
        DyadErrorKind.External,
      );
    }

    logger.log(`Web crawl completed for URL: ${args.url}`);

    ctx.appendUserMessage([
      { type: "text", text: CLONE_INSTRUCTIONS },
      {
        type: "text",
        text: formatSnippet("Text snapshot:", content, "markdown"),
      },
    ]);

    return "Web crawl completed.";
  },
};
