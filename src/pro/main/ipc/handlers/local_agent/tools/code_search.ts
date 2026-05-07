import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr, escapeXmlContent } from "./types";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getEmbedding } from "../indexing/embeddings";
import { searchVectors, getChunkCount } from "../indexing/vector_store";
import { indexCodebase } from "../indexing/codebase_indexer";

const logger = log.scope("code_search");

const codeSearchSchema = z.object({
  query: z.string().describe("Search query to find relevant files"),
});

type CodeSearchArgs = z.infer<typeof codeSearchSchema>;

const DESCRIPTION = `Search the codebase semantically to find code relevant to a query. Use this tool when you need to discover code related to a specific concept, feature, or functionality. Returns the most relevant code chunks with their file paths and line numbers.

### When to Use This Tool
- Explore unfamiliar codebases
- Ask "how / where / what" questions to understand behavior
- Find code by meaning rather than exact text

### When NOT to Use
- Exact text matches (use \`grep\`)
- Reading known files (use \`read_file\`)
- Simple symbol lookups (use \`grep\`)
`;

export const codeSearchTool: ToolDefinition<CodeSearchArgs> = {
  name: "code_search",
  description: DESCRIPTION,
  inputSchema: codeSearchSchema,
  defaultConsent: "always",

  isEnabled: () => {
    const settings = readSettings();
    return !!settings.embeddingApiKey;
  },

  getConsentPreview: (args) => `Search for "${args.query}"`,

  buildXml: (args, isComplete) => {
    if (!args.query) return undefined;
    if (isComplete) return undefined;
    return `<dyad-code-search query="${escapeXmlAttr(args.query)}">`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Code search: "${args.query}"`);

    ctx.onXmlStream(`<dyad-code-search query="${escapeXmlAttr(args.query)}">`);

    try {
      // Build/update index if needed
      const chunkCount = getChunkCount(ctx.appId);
      if (chunkCount === 0) {
        logger.log("No index found, building...");
        ctx.onWarningMessage?.("Building code search index for this app, this may take a moment...");
        await indexCodebase(ctx.appId, ctx.appPath);
      }

      // Embed the query and search
      const queryEmbedding = await getEmbedding(args.query);
      const searchSettings = readSettings();
      const results = searchVectors(
        ctx.appId,
        queryEmbedding,
        searchSettings.embeddingSearchMaxResults ?? 50,
        searchSettings.embeddingSearchMinScore ?? 0.4,
      );

      if (results.length === 0) {
        ctx.onXmlComplete(`<dyad-code-search query="${escapeXmlAttr(args.query)}"></dyad-code-search>`);
        return "No relevant files found for this query.";
      }

      const resultText = results
        .map(
          (r, i) =>
            `${i + 1}. ${r.relativePath} (lines ${r.startLine}-${r.endLine})\n\`\`\`\n${r.chunkText}\n\`\`\``,
        )
        .join("\n\n");

      ctx.onXmlComplete(
        `<dyad-code-search query="${escapeXmlAttr(args.query)}">${escapeXmlContent(resultText)}</dyad-code-search>`,
      );

      logger.log(`Found ${results.length} relevant code chunks`);
      return `Relevant code chunks:\n\n${resultText}`;
    } catch (error) {
      ctx.onXmlComplete(`<dyad-code-search query="${escapeXmlAttr(args.query)}"></dyad-code-search>`);
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Code search failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
