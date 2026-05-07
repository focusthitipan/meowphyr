import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { codeSearchTool } from "./code_search";
import type { AgentContext } from "./types";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const mockGetEmbedding = vi.fn();
const mockSearchVectors = vi.fn();
const mockGetChunkCount = vi.fn();
const mockIndexCodebase = vi.fn();

vi.mock("../indexing/embeddings", () => ({
  getEmbedding: (...args: any[]) => mockGetEmbedding(...args),
}));

vi.mock("../indexing/vector_store", () => ({
  searchVectors: (...args: any[]) => mockSearchVectors(...args),
  getChunkCount: (...args: any[]) => mockGetChunkCount(...args),
}));

vi.mock("../indexing/codebase_indexer", () => ({
  indexCodebase: (...args: any[]) => mockIndexCodebase(...args),
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => ({ embeddingApiKey: "test-key" }),
}));

describe("codeSearchTool", () => {
  let testDir: string;
  let mockContext: AgentContext;

  beforeEach(async () => {
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "code-search-test-"),
    );

    mockContext = {
      event: {} as any,
      appId: 1,
      appPath: testDir,
      referencedApps: new Map(),
      chatId: 1,
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
      neonProjectId: null,
      neonActiveBranchId: null,
      frameworkType: null,
      messageId: 1,
      isSharedModulesChanged: false,
      isDyadPro: true,
      todos: [],
      dyadRequestId: "test-request",
      fileEditTracker: {},
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
      onWarningMessage: vi.fn(),
      requireConsent: vi.fn().mockResolvedValue(true),
      appendUserMessage: vi.fn(),
      onUpdateTodos: vi.fn(),
    };

    mockGetEmbedding.mockReset();
    mockSearchVectors.mockReset();
    mockGetChunkCount.mockReset();
    mockIndexCodebase.mockReset();
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("schema", () => {
    it("has the correct name", () => {
      expect(codeSearchTool.name).toBe("code_search");
    });

    it("accepts query field", () => {
      const parsed = codeSearchTool.inputSchema.parse({ query: "foo" });
      expect(parsed.query).toBe("foo");
    });
  });

  describe("getConsentPreview", () => {
    it("returns preview with query", () => {
      const preview = codeSearchTool.getConsentPreview?.({ query: "foo" });
      expect(preview).toBe('Search for "foo"');
    });
  });

  describe("buildXml", () => {
    it("returns streaming XML with query while not complete", () => {
      const xml = codeSearchTool.buildXml?.({ query: "foo" }, false);
      expect(xml).toContain('query="foo"');
    });

    it("returns undefined when complete", () => {
      const xml = codeSearchTool.buildXml?.({ query: "foo" }, true);
      expect(xml).toBeUndefined();
    });
  });

  describe("execute", () => {
    it("returns relevant files when index exists", async () => {
      const fakeEmbedding = [0.1, 0.2, 0.3];
      mockGetChunkCount.mockReturnValue(100);
      mockGetEmbedding.mockResolvedValue(fakeEmbedding);
      mockSearchVectors.mockReturnValue([
        { relativePath: "src/foo.ts", score: 0.9 },
        { relativePath: "src/bar.ts", score: 0.7 },
      ]);

      const result = await codeSearchTool.execute({ query: "foo" }, mockContext);

      expect(mockIndexCodebase).not.toHaveBeenCalled();
      expect(result).toContain("src/foo.ts");
      expect(result).toContain("src/bar.ts");
    });

    it("builds index when no chunks exist", async () => {
      mockGetChunkCount.mockReturnValue(0);
      mockGetEmbedding.mockResolvedValue([0.1, 0.2]);
      mockIndexCodebase.mockResolvedValue({ indexed: 5, skipped: 0, total: 5 });
      mockSearchVectors.mockReturnValue([
        { relativePath: "src/foo.ts", score: 0.8 },
      ]);

      await codeSearchTool.execute({ query: "bar" }, mockContext);

      expect(mockIndexCodebase).toHaveBeenCalledWith(1, testDir);
      expect(mockContext.onWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining("Building code search index"),
      );
    });

    it("returns no-results message when search returns empty", async () => {
      mockGetChunkCount.mockReturnValue(50);
      mockGetEmbedding.mockResolvedValue([0.1, 0.2]);
      mockSearchVectors.mockReturnValue([]);

      const result = await codeSearchTool.execute({ query: "nonexistent" }, mockContext);

      expect(result).toContain("No relevant files found");
    });
  });
});
