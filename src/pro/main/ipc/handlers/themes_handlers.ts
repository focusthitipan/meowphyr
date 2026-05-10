import { createLoggedHandler } from "../../../../ipc/handlers/safe_handle";
import { createTypedHandler } from "../../../../ipc/handlers/base";
import { templateContracts } from "@/ipc/types/templates";
import { safeSend } from "../../../../ipc/utils/safe_sender";
import log from "electron-log";
import crypto from "crypto";
import path from "path";
import os from "os";
import fs from "fs";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { readFileTool } from "./local_agent/tools/read_file";
import { listFilesTool } from "./local_agent/tools/list_files";
import { grepTool } from "./local_agent/tools/grep";
import { globTool } from "./local_agent/tools/glob_tool";
import type { AgentContext } from "./local_agent/tools/types";
import type { IpcMainInvokeEvent } from "electron";
import { themesData, type Theme } from "../../../../shared/themes";
import { db } from "../../../../db";
import { apps, customThemes } from "../../../../db/schema";
import { eq, sql } from "drizzle-orm";
import { streamText, TextPart, ImagePart, stepCountIs } from "ai";
import { readSettings } from "../../../../main/settings";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { getModelClient } from "../../../../ipc/utils/get_model_client";
import { cancelOrphanedBaseStream } from "../../../../ipc/utils/stream_text_utils";
import type {
  SetAppThemeParams,
  GetAppThemeParams,
  CustomTheme,
  CreateCustomThemeParams,
  UpdateCustomThemeParams,
  DeleteCustomThemeParams,
  SaveThemeImageParams,
  SaveThemeImageResult,
  CleanupThemeImagesParams,
  ThemeGenerationModelOption,
} from "@/ipc/types";
import {
  resolveBuiltinModelAlias,
} from "@/ipc/shared/remote_language_model_catalog";
import {
  getLanguageModelProviders,
  getLanguageModels,
} from "@/ipc/shared/language_model_helpers";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { BrowserWindow, dialog } from "electron";
import {
  type UserSettings,
  type AzureProviderSetting,
  type VertexProviderSetting,
} from "@/lib/schemas";

const logger = log.scope("themes_handlers");
const handle = createLoggedHandler(logger);

// Timeout for web crawl requests (120 seconds)
const WEB_CRAWL_TIMEOUT_MS = 120_000;

/**
 * Checks if a provider has credentials configured in settings.
 */
function isProviderConfiguredInSettings(
  providerId: string,
  settings: UserSettings,
): boolean {
  if (providerId === "auto") return false;
  const ps = settings.providerSettings;
  if (!ps) return false;

  if (providerId === "vertex") {
    const vs = ps["vertex"] as VertexProviderSetting | undefined;
    return !!(vs?.serviceAccountKey?.value && vs?.projectId && vs?.location);
  }

  if (providerId === "azure") {
    const as = ps["azure"] as AzureProviderSetting | undefined;
    return !!(as?.apiKey?.value && as?.resourceName);
  }

  return !!(ps[providerId]?.apiKey?.value);
}

/**
 * Resolves a model param which can be either:
 * - A builtin alias (e.g. "dyad/theme-generator/google")
 * - A direct provider::model format (e.g. "google::gemini-3.1-pro-preview")
 */
async function resolveModelParam(
  model: string,
): Promise<{ providerId: string; apiName: string } | null> {
  // Try builtin alias first
  const builtinResolved = await resolveBuiltinModelAlias(model);
  if (builtinResolved) {
    return {
      providerId: builtinResolved.providerId,
      apiName: builtinResolved.apiName,
    };
  }

  // Try direct provider::model format
  // Use lastIndexOf so custom provider IDs (e.g. "custom::my-provider::model")
  // are split correctly into provider "custom::my-provider" and model "model".
  const separatorIdx = model.lastIndexOf("::");
  if (separatorIdx !== -1) {
    const providerId = model.slice(0, separatorIdx);
    const apiName = model.slice(separatorIdx + 2);
    if (providerId && apiName) {
      return { providerId, apiName };
    }
  }

  return null;
}

/**
 * Sanitizes external content before including it in LLM prompts.
 * Escapes markdown code block delimiters to prevent prompt injection.
 */
function sanitizeForPrompt(content: string): string {
  // Escape backtick sequences that could break out of code blocks
  // Replace ``` with escaped version to prevent code block injection
  return content.replace(/`{3,}/g, (match) => "\\`".repeat(match.length));
}

/**
 * Sanitizes user-provided keywords for use in prompts.
 * Limits length and removes potentially dangerous patterns.
 */
function sanitizeKeywords(keywords: string): string {
  // Trim and limit length
  let sanitized = keywords.trim().slice(0, 500);
  // Remove potential prompt injection patterns
  sanitized = sanitized.replace(/<\/?[^>]+(>|$)/g, ""); // Strip HTML-like tags
  sanitized = sanitized.replace(/`{3,}/g, ""); // Remove code block markers
  return sanitized;
}

// Directory for storing temporary theme images
const THEME_IMAGES_TEMP_DIR = path.join(os.tmpdir(), "dyad-theme-images");

// Ensure temp directory exists
if (!fs.existsSync(THEME_IMAGES_TEMP_DIR)) {
  fs.mkdirSync(THEME_IMAGES_TEMP_DIR, { recursive: true });
}

// Get mime type from extension
function getMimeTypeFromExtension(
  ext: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const mimeMap: Record<
    string,
    "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  > = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return mimeMap[ext.toLowerCase()] || "image/png";
}

const THEME_GENERATION_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that extracts a reusable UI DESIGN SYSTEM from provided images.
- This is a visual ruleset, not a website blueprint.
- Extract constraints, scales, and principles — never layouts or compositions.
- You are NOT recreating, cloning, or reverse-engineering a specific website.
- The resulting system must be applicable to unrelated products without visual resemblance.

SCOPE & LIMITATIONS (MANDATORY)
- Do NOT reproduce:
  - Page layouts
  - Component hierarchies
  - Spatial arrangements
  - Relative positioning between elements
  - Information architecture
- Do NOT describe the original interface.
- Do NOT reference screen structure, sections, or flows.
- The output must remain abstract, systemic, and transferable.

INPUTS
- One or more UI images
- Optional reference name (popular product or known design system)
- Visual input defines stylistic constraints only (tokens, shapes, motion, density)

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Hard Rules:
  - Never ship default shadcn styles
  - No inline styles
  - No arbitrary values outside defined scales
  - All styling must be token-driven

OUTPUT RULES
- Wrap the entire theme system prompt in <theme> and </theme> tags. You may write brief reasoning before the opening tag, but nothing after the closing tag.
- The theme system prompt must:
  - Name the inspiration strictly as a stylistic reference, not a target
  - Define enforceable rules, never descriptions
  - Use imperative language only ("must", "never", "always")
  - Never mention images, screenshots, or visual analysis
  - Produce a system that cannot recreate the original UI even if followed precisely

REQUIRED STRUCTURE
- Visual Objective (abstract, non-descriptive)
- Layout & Spacing Rules (scales only, no patterns)
- Typography System (roles, hierarchy, constraints)
- Color & Surfaces (tokens, elevation logic)
- Components & Shape Language (geometry, affordances — no layouts)
- Motion & Interaction (timing, intent, limits)
- Forbidden Patterns (explicit anti-cloning rules)
- Self-Check (verifies abstraction & non-replication)
`;

const HIGH_FIDELITY_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that allows an AI to recreate a UI visual system from a provided image.
- This is a visual subsystem. Do not define roles or personas.
- Extract rules, not descriptions.

INPUTS
- One or more UI images
- Optional reference name (popular product / design system)
- Image always takes priority.

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Rules:
  - Never ship default shadcn styles
  - No inline styles
  - No arbitrary values outside defined scales

OUTPUT RULES
- Wrap the entire theme system prompt in <theme> and </theme> tags. You may write brief reasoning before the opening tag, but nothing after the closing tag.
- The theme system prompt must:
  - Explicitly name the inspiration as a guiding reference
  - Use hard, enforceable rules only
  - Be technical and unambiguous
  - Never mention the image
  - Avoid vague language ("might", "appears", etc.)

REQUIRED STRUCTURE
- Visual Objective
- Layout & Spacing Rules
- Typography System
- Color & Surfaces
- Components & Shape Language
- Motion & Interaction
- Forbidden Patterns
- Self-Check
`;

// Web crawl "inspired" mode prompt - separate from image-based prompt
const WEB_CRAWL_THEME_GENERATION_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that extracts a reusable UI DESIGN SYSTEM from a crawled website.
- You are provided with screenshots, HTML structure, and CSS custom properties of a live website.
- This is a visual ruleset, not a website blueprint.
- Extract constraints, scales, and principles from the visual appearance and design tokens.
- You are NOT recreating, cloning, or reverse-engineering the specific website.
- The resulting system must be applicable to unrelated products without visual resemblance.

INPUTS
- Screenshot image(s) of the website (PRIMARY reference for visual style)
- HTML structure / outerHTML (for component hierarchy and semantic patterns — secondary)
- CSS custom properties from :root (extracted design tokens: colors, spacing, radii, typography — use directly when available)
- Optional keywords for style guidance

SCOPE & LIMITATIONS (MANDATORY)
- Do NOT reproduce:
  - Page layouts
  - Component hierarchies
  - Spatial arrangements
  - Relative positioning between elements
  - Information architecture
- Do NOT describe the original interface or reference the crawled URL.
- The output must remain abstract, systemic, and transferable.

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Hard Rules:
  - Never ship default shadcn styles
  - No inline styles
  - No arbitrary values outside defined scales
  - All styling must be token-driven

OUTPUT RULES
- Wrap the entire theme system prompt in <theme> and </theme> tags. You may write brief reasoning before the opening tag, but nothing after the closing tag.
- The theme system prompt must:
  - Name any inspiration strictly as a stylistic reference, not a target
  - Define enforceable rules, never descriptions
  - Use imperative language only ("must", "never", "always")
  - Never mention the screenshot, URL, or crawled content
  - Produce a system that cannot recreate the original UI even if followed precisely

REQUIRED STRUCTURE
- Visual Objective (abstract, non-descriptive)
- Layout & Spacing Rules (scales only, no patterns)
- Typography System (roles, hierarchy, constraints)
- Color & Surfaces (tokens, elevation logic)
- Components & Shape Language (geometry, affordances — no layouts)
- Motion & Interaction (timing, intent, limits)
- Forbidden Patterns (explicit anti-cloning rules)
- Self-Check (verifies abstraction & non-replication)
`;

// Web crawl "high-fidelity" mode prompt - separate from image-based prompt
const WEB_CRAWL_HIGH_FIDELITY_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that allows an AI to recreate a UI visual system from a crawled website.
- You are provided with screenshots, HTML structure, and CSS custom properties of a live website.
- This is a visual subsystem. Do not define roles or personas.
- Extract rules, not descriptions. Use the screenshot as primary visual reference.

INPUTS
- Screenshot image(s) of the website (PRIMARY reference — use for visual accuracy)
- HTML structure / outerHTML (secondary — component patterns and semantic structure)
- CSS custom properties from :root (extracted design tokens — use directly as token values when present)
- Optional reference name for the design inspiration
- Screenshots always take priority; CSS vars provide ground-truth token values.

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Rules:
  - Never ship default shadcn styles
  - No inline styles
  - No arbitrary values outside defined scales

OUTPUT RULES
- Wrap the entire theme system prompt in <theme> and </theme> tags. You may write brief reasoning before the opening tag, but nothing after the closing tag.
- The theme system prompt must:
  - Explicitly name the inspiration as a guiding reference
  - Use hard, enforceable rules only
  - Be technical and unambiguous
  - Never mention the screenshot or crawled URL
  - Avoid vague language ("might", "appears", etc.)

REQUIRED STRUCTURE
- Visual Objective
- Layout & Spacing Rules
- Typography System
- Color & Surfaces
- Components & Shape Language
- Motion & Interaction
- Forbidden Patterns
- Self-Check
`;

// Project exploration system prompts — AI uses tools to explore then generates theme
const PROJECT_THEME_GENERATION_META_PROMPT = `PURPOSE
- You are a UI design analyst with access to file exploration tools.
- Use the tools to explore the project codebase and extract a reusable UI DESIGN SYSTEM.
- Then generate a strict SYSTEM PROMPT encoding that design system.
- This is a visual ruleset — not a code blueprint.

EXPLORATION STRATEGY
1. Call list_files to see the root project structure
2. Prioritize reading these files (use glob or list_files to find them):
   - tailwind.config.ts / tailwind.config.js (most important — authoritative design tokens)
   - components.json (shadcn/ui config)
   - globals.css, index.css, app.css, or any root CSS file
   - src/styles/**/*.css or similar style directories
3. Use grep to find CSS custom properties: search for "--" patterns in CSS files
4. Optionally sample a few component files to observe className usage patterns
5. Stop exploring when you have enough design token data — do not read every file

OUTPUT RULES
- Wrap the entire theme system prompt in <theme> and </theme> tags. You may write brief reasoning before the opening tag, but nothing after the closing tag.
- The theme system prompt must:
  - Name the codebase style strictly as a stylistic reference, not a target
  - Define enforceable rules only — never descriptions
  - Use imperative language ("must", "never", "always")
  - Never reference file paths, component names, or the original project
  - Produce a transferable system that cannot recreate the original project

REQUIRED STRUCTURE
- Visual Objective (abstract, non-descriptive)
- Layout & Spacing Rules (scales only, no patterns)
- Typography System (roles, hierarchy, constraints)
- Color & Surfaces (tokens, elevation logic)
- Components & Shape Language (geometry, affordances — no layouts)
- Motion & Interaction (timing, intent, limits)
- Forbidden Patterns (explicit anti-cloning rules)
- Self-Check (verifies abstraction & non-replication)

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Hard Rules: never ship default shadcn styles, no inline styles, no arbitrary values.
`;

const PROJECT_HIGH_FIDELITY_META_PROMPT = `PURPOSE
- You are a UI design analyst with access to file exploration tools.
- Use the tools to explore the project codebase and extract its UI visual system.
- Then generate a strict SYSTEM PROMPT that allows an AI to recreate that visual system.
- Extract rules, not descriptions. Config files provide ground-truth token values.

EXPLORATION STRATEGY
1. Call list_files to see the root project structure
2. Prioritize reading these files:
   - tailwind.config.ts / tailwind.config.js (PRIMARY — authoritative design tokens)
   - components.json (shadcn/ui config)
   - globals.css, index.css, app.css, or any root CSS file
   - src/styles/**/*.css or similar style directories
3. Use grep to find CSS custom properties (search for "--" patterns)
4. Sample component files to see how tokens are applied
5. Stop exploring when you have sufficient token data

OUTPUT RULES
- Wrap the entire theme system prompt in <theme> and </theme> tags. You may write brief reasoning before the opening tag, but nothing after the closing tag.
- The theme system prompt must:
  - Explicitly name the style as a guiding reference
  - Use hard, enforceable rules only — technical and unambiguous
  - Never reference file paths, component names, or the original project
  - Avoid vague language ("might", "appears", etc.)

REQUIRED STRUCTURE
- Visual Objective
- Layout & Spacing Rules
- Typography System
- Color & Surfaces
- Components & Shape Language
- Motion & Interaction
- Forbidden Patterns
- Self-Check

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Rules: never ship default shadcn styles, no inline styles, no arbitrary values.
`;

/**
 * Creates a minimal AgentContext pointing at the project folder.
 * All file tools resolve paths relative to ctx.appPath.
 */
function createThemeExplorationContext(
  projectPath: string,
  event: IpcMainInvokeEvent,
): AgentContext {
  return {
    event,
    appId: -1,
    appPath: projectPath,
    referencedApps: new Map(),
    chatId: -1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: -1,
    isSharedModulesChanged: false,
    todos: [],
    dyadRequestId: crypto.randomUUID(),
    fileEditTracker: {},
    isDyadPro: false,
    onXmlStream: () => {},
    onXmlComplete: () => {},
    requireConsent: async () => true,
    appendUserMessage: () => {},
    onUpdateTodos: () => {},
  };
}

const TOOL_LABEL: Record<string, string> = {
  read_file: "Reading file",
  list_files: "Listing files",
  grep: "Searching",
  glob_tool: "Finding files",
};

/**
 * Builds a read-only tool set for project exploration (file tools only).
 * Auto-approves all tool calls — no user consent prompts.
 */
function buildThemeExplorationTools(ctx: AgentContext) {
  const explorationTools = [readFileTool, listFilesTool, grepTool, globTool];
  const toolSet: Record<string, any> = {};
  for (const tool of explorationTools) {
    toolSet[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args: any) => {
        try {
          return await tool.execute(args, ctx);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    };
  }
  return toolSet;
}

/**
 * Crawls a URL using a hidden Electron BrowserWindow.
 * Returns outerHTML, CSS custom properties from :root, and a PNG screenshot (base64).
 */
async function crawlWithElectron(
  url: string,
): Promise<{ html: string; cssVars: string; screenshot: string }> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        javascript: true,
        images: true,
        contextIsolation: true,
      },
    });

    const timeout = setTimeout(() => {
      win.destroy();
      reject(
        new Error(
          "Website crawl timed out. The website may be too slow or unresponsive.",
        ),
      );
    }, WEB_CRAWL_TIMEOUT_MS);

    win.webContents.on("did-finish-load", async () => {
      try {
        clearTimeout(timeout);
        const image = await win.webContents.capturePage();
        const screenshot = image.toPNG().toString("base64");

        const html: string = await win.webContents.executeJavaScript(
          "document.documentElement.outerHTML",
        );

        const cssVars: string = await win.webContents.executeJavaScript(`
          (function() {
            const style = getComputedStyle(document.documentElement);
            const vars = [];
            for (const prop of style) {
              if (prop.trim().startsWith('--') && vars.length < 200) {
                vars.push(prop.trim() + ': ' + style.getPropertyValue(prop).trim());
              }
            }
            return vars.join('\\n');
          })()
        `);

        win.destroy();
        resolve({ html, cssVars, screenshot });
      } catch (err) {
        win.destroy();
        reject(err);
      }
    });

    win.webContents.on(
      "did-fail-load",
      (_event, _code, errorDescription) => {
        clearTimeout(timeout);
        win.destroy();
        reject(new Error(`Failed to load website: ${errorDescription}`));
      },
    );

    win.loadURL(url).catch((err) => {
      clearTimeout(timeout);
      win.destroy();
      reject(err);
    });
  });
}

export function registerThemesHandlers() {
  // Get built-in themes
  handle("get-themes", async (): Promise<Theme[]> => {
    return themesData;
  });

  // Set app theme (built-in or custom theme ID)
  handle(
    "set-app-theme",
    async (_, params: SetAppThemeParams): Promise<void> => {
      const { appId, themeId } = params;
      // Use raw SQL to properly set NULL when themeId is null (representing "no theme")
      if (!themeId) {
        await db
          .update(apps)
          .set({ themeId: sql`NULL` })
          .where(eq(apps.id, appId));
      } else {
        await db.update(apps).set({ themeId }).where(eq(apps.id, appId));
      }
    },
  );

  // Get app theme
  handle(
    "get-app-theme",
    async (_, params: GetAppThemeParams): Promise<string | null> => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.appId),
        columns: { themeId: true },
      });
      return app?.themeId ?? null;
    },
  );

  // Get all custom themes
  handle("get-custom-themes", async (): Promise<CustomTheme[]> => {
    const themes = await db.query.customThemes.findMany({
      orderBy: (themes, { desc }) => [desc(themes.createdAt)],
    });

    return themes.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      prompt: t.prompt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  });

  handle(
    "get-theme-generation-model-options",
    async (): Promise<ThemeGenerationModelOption[]> => {
      const settings = readSettings();
      const allProviders = await getLanguageModelProviders();
      const options: ThemeGenerationModelOption[] = [];

      for (const provider of allProviders) {
        // Skip local providers (ollama, lmstudio) and Meowphyr Pro
        if (provider.type === "local" || provider.id === "auto") continue;

        // Only include providers that have credentials in settings
        if (!isProviderConfiguredInSettings(provider.id, settings)) continue;

        // Get all models for this provider (builtin + custom)
        const models = await getLanguageModels({ providerId: provider.id });
        for (const model of models) {
          options.push({
            id: `${provider.id}::${model.apiName}`,
            label: `${provider.name} / ${model.displayName}`,
            providerId: provider.id,
            providerName: provider.name,
            supportsVision: model.supportsVision ?? false,
          });
        }
      }

      return options;
    },
  );

  // Create custom theme
  handle(
    "create-custom-theme",
    async (_, params: CreateCustomThemeParams): Promise<CustomTheme> => {
      // Validate and sanitize inputs
      const trimmedName = params.name.trim();
      const trimmedDescription = params.description?.trim();
      const trimmedPrompt = params.prompt.trim();

      // Validate name
      if (!trimmedName) {
        throw new DyadError("Theme name is required", DyadErrorKind.Validation);
      }
      if (trimmedName.length > 100) {
        throw new DyadError(
          "Theme name must be less than 100 characters",
          DyadErrorKind.Validation,
        );
      }

      // Validate description
      if (trimmedDescription && trimmedDescription.length > 500) {
        throw new DyadError(
          "Theme description must be less than 500 characters",
          DyadErrorKind.Validation,
        );
      }

      // Validate prompt
      if (!trimmedPrompt) {
        throw new DyadError(
          "Theme prompt is required",
          DyadErrorKind.Validation,
        );
      }
      if (trimmedPrompt.length > 50000) {
        throw new DyadError(
          "Theme prompt must be less than 50,000 characters",
          DyadErrorKind.Validation,
        );
      }

      // Check for duplicate theme name (case-insensitive)
      const existingTheme = await db.query.customThemes.findFirst({
        where: sql`LOWER(${customThemes.name}) = LOWER(${trimmedName})`,
      });

      if (existingTheme) {
        throw new Error(
          `A theme named "${trimmedName}" already exists. Please choose a different name.`,
        );
      }

      const result = await db
        .insert(customThemes)
        .values({
          name: trimmedName,
          description: trimmedDescription || null,
          prompt: trimmedPrompt,
        })
        .returning();

      const theme = result[0];
      return {
        id: theme.id,
        name: theme.name,
        description: theme.description,
        prompt: theme.prompt,
        createdAt: theme.createdAt,
        updatedAt: theme.updatedAt,
      };
    },
  );

  // Update custom theme
  handle(
    "update-custom-theme",
    async (_, params: UpdateCustomThemeParams): Promise<CustomTheme> => {
      const updateData: Partial<{
        name: string;
        description: string | null;
        prompt: string;
        updatedAt: Date;
      }> = {
        updatedAt: new Date(),
      };

      // Get the current theme to verify it exists
      const currentTheme = await db.query.customThemes.findFirst({
        where: eq(customThemes.id, params.id),
      });

      if (!currentTheme) {
        throw new DyadError("Theme not found", DyadErrorKind.NotFound);
      }

      // Validate and sanitize name if provided
      if (params.name !== undefined) {
        const trimmedName = params.name.trim();
        if (!trimmedName) {
          throw new DyadError(
            "Theme name is required",
            DyadErrorKind.Validation,
          );
        }
        if (trimmedName.length > 100) {
          throw new DyadError(
            "Theme name must be less than 100 characters",
            DyadErrorKind.Validation,
          );
        }

        // Check for duplicate theme name (case-insensitive), excluding current theme
        const existingTheme = await db.query.customThemes.findFirst({
          where: sql`LOWER(${customThemes.name}) = LOWER(${trimmedName}) AND ${customThemes.id} != ${params.id}`,
        });

        if (existingTheme) {
          throw new Error(
            `A theme named "${trimmedName}" already exists. Please choose a different name.`,
          );
        }

        updateData.name = trimmedName;
      }

      // Validate and sanitize description if provided
      if (params.description !== undefined) {
        const trimmedDescription = params.description.trim();
        if (trimmedDescription.length > 500) {
          throw new DyadError(
            "Theme description must be less than 500 characters",
            DyadErrorKind.Validation,
          );
        }
        updateData.description = trimmedDescription || null;
      }

      // Validate and sanitize prompt if provided
      if (params.prompt !== undefined) {
        const trimmedPrompt = params.prompt.trim();
        if (!trimmedPrompt) {
          throw new DyadError(
            "Theme prompt is required",
            DyadErrorKind.Validation,
          );
        }
        if (trimmedPrompt.length > 50000) {
          throw new DyadError(
            "Theme prompt must be less than 50,000 characters",
            DyadErrorKind.Validation,
          );
        }
        updateData.prompt = trimmedPrompt;
      }

      const result = await db
        .update(customThemes)
        .set(updateData)
        .where(eq(customThemes.id, params.id))
        .returning();

      const theme = result[0];
      if (!theme) {
        throw new DyadError("Theme not found", DyadErrorKind.NotFound);
      }

      return {
        id: theme.id,
        name: theme.name,
        description: theme.description,
        prompt: theme.prompt,
        createdAt: theme.createdAt,
        updatedAt: theme.updatedAt,
      };
    },
  );

  // Delete custom theme
  handle(
    "delete-custom-theme",
    async (_, params: DeleteCustomThemeParams): Promise<void> => {
      await db.delete(customThemes).where(eq(customThemes.id, params.id));
    },
  );

  // Save theme image to temp directory
  handle(
    "save-theme-image",
    async (_, params: SaveThemeImageParams): Promise<SaveThemeImageResult> => {
      const { data, filename } = params;

      // Validate base64 data
      if (!data || typeof data !== "string") {
        throw new DyadError("Invalid image data", DyadErrorKind.Validation);
      }

      // Validate and extract extension
      const ext = path.extname(filename).toLowerCase();
      const validExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
      if (!validExtensions.includes(ext)) {
        throw new Error(
          `Invalid image extension: ${ext}. Supported: ${validExtensions.join(", ")}`,
        );
      }

      // Generate unique filename
      const uniqueFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}${ext}`;
      const filePath = path.join(THEME_IMAGES_TEMP_DIR, uniqueFilename);

      // Validate size (base64 to bytes approximation)
      const sizeInBytes = (data.length * 3) / 4;
      if (sizeInBytes > 10 * 1024 * 1024) {
        throw new DyadError(
          "Image size exceeds 10MB limit",
          DyadErrorKind.Validation,
        );
      }

      // Ensure temp directory exists
      await mkdir(THEME_IMAGES_TEMP_DIR, { recursive: true });

      // Write file
      const buffer = Buffer.from(data, "base64");
      await writeFile(filePath, buffer);

      return { path: filePath };
    },
  );

  // Cleanup theme images from temp directory
  handle(
    "cleanup-theme-images",
    async (_, params: CleanupThemeImagesParams): Promise<void> => {
      const { paths } = params;

      for (const filePath of paths) {
        // Security: only delete files in our temp directory
        // Use path.resolve() to normalize and prevent path traversal attacks
        const normalizedPath = path.resolve(filePath);
        const normalizedTempDir = path.resolve(THEME_IMAGES_TEMP_DIR);
        if (!normalizedPath.startsWith(normalizedTempDir + path.sep)) {
          throw new Error(
            "Invalid path: cannot delete files outside temp directory",
          );
        }

        try {
          await unlink(filePath);
          logger.log(`Cleaned up theme image: ${filePath}`);
        } catch (error) {
          // File might already be deleted (ENOENT), that's okay
          // But other errors (permissions, etc.) should be reported
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw new DyadError(
              "Failed to cleanup temporary image file",
              DyadErrorKind.External,
            );
          }
        }
      }
    },
  );

  createTypedHandler(
    templateContracts.generateThemePrompt,
    async (event, params) => {
      const { sessionId } = params;
      const settings = readSettings();

      if (params.imagePaths.length === 0) {
        throw new DyadError(
          "Please upload at least one image to generate a theme",
          DyadErrorKind.External,
        );
      }
      if (params.imagePaths.length > 5) {
        throw new DyadError(
          "Maximum 5 images allowed",
          DyadErrorKind.External,
        );
      }
      if (params.keywords.length > 500) {
        throw new DyadError(
          "Keywords must be less than 500 characters",
          DyadErrorKind.Validation,
        );
      }
      if (!["inspired", "high-fidelity"].includes(params.generationMode)) {
        throw new DyadError(
          "Invalid generation mode",
          DyadErrorKind.Validation,
        );
      }

      (async () => {
        try {
          if (IS_TEST_BUILD) {
            const mockPrompt = `<theme>\n# Test Mode Theme\n\n## Visual Objective\nModern dark theme with purple accents for testing.\n\n</theme>`;
            safeSend(event.sender, "theme:generate:chunk", {
              sessionId,
              delta: mockPrompt,
              type: "text",
            });
            safeSend(event.sender, "theme:generate:end", { sessionId });
            return;
          }

          const selectedModel = await resolveModelParam(params.model);
          if (!selectedModel) {
            throw new Error(
              `Invalid model selection: "${params.model}" could not be resolved`,
            );
          }

          const { modelClient } = await getModelClient(
            { provider: selectedModel.providerId, name: selectedModel.apiName },
            settings,
          );

          const systemPrompt =
            params.generationMode === "high-fidelity"
              ? HIGH_FIDELITY_META_PROMPT
              : THEME_GENERATION_META_PROMPT;

          const keywordsPart = sanitizeKeywords(params.keywords) || "N/A";
          const imagesPart = `${params.imagePaths.length} image(s) attached`;
          const userInput = `inspired by: ${keywordsPart}\nimages: ${imagesPart}`;

          const contentParts: (TextPart | ImagePart)[] = [
            { type: "text", text: userInput },
          ];

          for (const imagePath of params.imagePaths) {
            const normalizedImagePath = path.resolve(imagePath);
            const normalizedTempDir = path.resolve(THEME_IMAGES_TEMP_DIR);
            if (
              !normalizedImagePath.startsWith(normalizedTempDir + path.sep)
            ) {
              throw new Error(
                "Invalid image path: images must be uploaded through the theme dialog",
              );
            }
            const imageBuffer = await readFile(imagePath).catch(() => {
              throw new Error(
                `Failed to read image file: ${path.basename(imagePath)}`,
              );
            });
            const base64Data = imageBuffer.toString("base64");
            const ext = path.extname(imagePath).toLowerCase();
            contentParts.push({
              type: "image",
              image: base64Data,
              mimeType: getMimeTypeFromExtension(ext),
            } as ImagePart);
          }

          const stream = streamText({
            model: modelClient.model,
            system: systemPrompt,
            maxRetries: 1,
            messages: [{ role: "user", content: contentParts }],
          });

          const fullStream = stream.fullStream;
          cancelOrphanedBaseStream(stream);

          for await (const part of fullStream) {
            if (part.type === "text-delta") {
              safeSend(event.sender, "theme:generate:chunk", {
                sessionId,
                delta: part.text,
                type: "text",
              });
            }
          }

          safeSend(event.sender, "theme:generate:end", { sessionId });
        } catch (err) {
          logger.error("generate-theme-prompt stream error", err);
          safeSend(event.sender, "theme:generate:error", {
            sessionId,
            error:
              err instanceof Error
                ? err.message
                : "Failed to process images for theme generation. Please try with fewer or smaller images, or use manual mode.",
          });
        }
      })();

      return { ok: true } as const;
    },
  );

  // Generate theme prompt from website URL(s) via web crawl
  createTypedHandler(
    templateContracts.generateThemeFromUrl,
    async (event, params) => {
      const { sessionId } = params;

      const blockedPatterns = [
        /^localhost$/i,
        /^127\.\d+\.\d+\.\d+$/,
        /^10\.\d+\.\d+\.\d+$/,
        /^192\.168\.\d+\.\d+$/,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/,
        /^169\.254\.\d+\.\d+$/,
        /^::1$/,
        /\.local$/i,
      ];

      // Synchronous validation of all URLs — throws before fire-and-forget
      for (const url of params.urls) {
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          throw new DyadError(
            `Invalid URL format: "${url}"`,
            DyadErrorKind.Validation,
          );
        }
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          throw new Error(
            `Invalid URL protocol for "${url}". Only HTTP and HTTPS are supported.`,
          );
        }
        const hostname = parsedUrl.hostname.toLowerCase();
        if (blockedPatterns.some((p) => p.test(hostname))) {
          throw new DyadError(
            `Cannot crawl internal network address: "${url}"`,
            DyadErrorKind.External,
          );
        }
      }

      if (params.keywords.length > 500) {
        throw new DyadError(
          "Keywords must be less than 500 characters",
          DyadErrorKind.Validation,
        );
      }

      if (!["inspired", "high-fidelity"].includes(params.generationMode)) {
        throw new DyadError(
          "Invalid generation mode",
          DyadErrorKind.Validation,
        );
      }

      (async () => {
        try {
          if (IS_TEST_BUILD) {
            const mockPrompt = `<theme>\n# Test Mode Theme (from URL)\n\n## Visual Objective\nModern theme extracted from website for testing.\n\n</theme>`;
            safeSend(event.sender, "theme:url-generate:chunk", {
              sessionId,
              delta: mockPrompt,
              type: "text",
            });
            safeSend(event.sender, "theme:url-generate:end", { sessionId });
            return;
          }

          const selectedModel = await resolveModelParam(params.model);
          if (!selectedModel) {
            throw new Error(
              `Invalid model selection: "${params.model}" could not be resolved`,
            );
          }

          // Crawl each URL sequentially, emitting status per URL
          const crawlResults: Array<{
            url: string;
            html: string;
            cssVars: string;
            screenshot: string;
          }> = [];

          for (let i = 0; i < params.urls.length; i++) {
            const url = params.urls[i];
            const label =
              params.urls.length > 1
                ? `URL ${i + 1} of ${params.urls.length}: ${url}`
                : url;

            logger.log(`Crawling website for theme: ${url}`);
            safeSend(event.sender, "theme:url-generate:chunk", {
              sessionId,
              delta: `Crawling ${label}...`,
              type: "status",
            });

            let crawlResult: { html: string; cssVars: string; screenshot: string };
            try {
              crawlResult = await crawlWithElectron(url);
            } catch (error) {
              throw new Error(
                error instanceof Error
                  ? error.message
                  : `Failed to crawl "${url}": ${String(error)}`,
              );
            }

            if (!crawlResult.html) {
              throw new Error(
                `Failed to extract content from "${url}". Please try a different URL.`,
              );
            }

            logger.log(`Website crawled successfully: ${url}`);
            crawlResults.push({ url, ...crawlResult });
          }

          // Generating phase — notify UI that all crawls are done
          safeSend(event.sender, "theme:url-generate:chunk", {
            sessionId,
            delta: "Analyzing design system...",
            type: "status",
          });

          const settings = readSettings();
          const { modelClient } = await getModelClient(
            { provider: selectedModel.providerId, name: selectedModel.apiName },
            settings,
          );

          const systemPrompt =
            params.generationMode === "high-fidelity"
              ? WEB_CRAWL_HIGH_FIDELITY_META_PROMPT
              : WEB_CRAWL_THEME_GENERATION_META_PROMPT;

          const keywordsPart = sanitizeKeywords(params.keywords) || "N/A";
          const urlList = params.urls.join(", ");
          const userInput = `inspired by: ${keywordsPart}\nsource: ${params.urls.length} live website(s) — ${urlList} (screenshots, HTML, and CSS tokens provided)`;

          const contentParts: (TextPart | ImagePart)[] = [
            { type: "text", text: userInput },
          ];

          // Add screenshots for all crawled URLs
          for (const result of crawlResults) {
            contentParts.push({
              type: "image",
              image: result.screenshot,
              mimeType: "image/png",
            } as ImagePart);
          }

          // Build combined HTML + CSS vars content per URL
          const MAX_HTML_PER_URL = 6000;
          const MAX_CSS_VARS_PER_URL = 1500;

          const combinedContent = crawlResults
            .map((result, i) => {
              const header =
                crawlResults.length > 1
                  ? `=== URL ${i + 1}: ${result.url} ===\n`
                  : "";

              const truncatedHtml =
                result.html.length > MAX_HTML_PER_URL
                  ? result.html.slice(0, MAX_HTML_PER_URL) + "\n<!-- truncated -->"
                  : result.html;

              const truncatedCssVars =
                result.cssVars.length > MAX_CSS_VARS_PER_URL
                  ? result.cssVars.slice(0, MAX_CSS_VARS_PER_URL) +
                    "\n/* truncated */"
                  : result.cssVars;

              const sanitizedHtml = sanitizeForPrompt(truncatedHtml);

              let section = header;
              section += `HTML Structure:\n\`\`\`html\n${sanitizedHtml}\n\`\`\`\n`;
              if (truncatedCssVars) {
                section += `\nCSS Custom Properties:\n\`\`\`css\n${truncatedCssVars}\n\`\`\`\n`;
              }
              return section;
            })
            .join("\n\n");

          contentParts.push({
            type: "text",
            text: `Website content:\n${combinedContent}`,
          });

          const stream = streamText({
            model: modelClient.model,
            system: systemPrompt,
            maxRetries: 1,
            messages: [{ role: "user", content: contentParts }],
          });

          const fullStream = stream.fullStream;
          cancelOrphanedBaseStream(stream);

          for await (const part of fullStream) {
            if (part.type === "text-delta") {
              safeSend(event.sender, "theme:url-generate:chunk", {
                sessionId,
                delta: part.text,
                type: "text",
              });
            }
          }

          safeSend(event.sender, "theme:url-generate:end", { sessionId });
        } catch (err) {
          logger.error("generate-theme-from-url stream error", err);
          safeSend(event.sender, "theme:url-generate:error", {
            sessionId,
            error:
              err instanceof Error
                ? err.message
                : "Failed to generate theme from website. Please try again.",
          });
        }
      })();

      return { ok: true } as const;
    },
  );

  // Browse for a project folder via native file dialog
  createTypedHandler(
    templateContracts.browseProjectFolder,
    async (_event, _params) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select Project Folder",
      });
      return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
    },
  );

  // Generate theme prompt from local project folder
  createTypedHandler(
    templateContracts.generateThemeFromProject,
    async (event, params) => {
      const { sessionId, projectPath } = params;

      if (!projectPath || !projectPath.trim()) {
        throw new DyadError(
          "Please select a project folder",
          DyadErrorKind.Validation,
        );
      }

      if (params.keywords.length > 500) {
        throw new DyadError(
          "Keywords must be less than 500 characters",
          DyadErrorKind.Validation,
        );
      }

      if (!["inspired", "high-fidelity"].includes(params.generationMode)) {
        throw new DyadError(
          "Invalid generation mode",
          DyadErrorKind.Validation,
        );
      }

      // Verify the path exists and is a directory
      try {
        const stats = fs.statSync(projectPath);
        if (!stats.isDirectory()) {
          throw new DyadError(
            "Selected path is not a directory",
            DyadErrorKind.Validation,
          );
        }
      } catch (err) {
        if (err instanceof DyadError) throw err;
        throw new DyadError(
          "Project folder not found or inaccessible",
          DyadErrorKind.Validation,
        );
      }

      (async () => {
        try {
          if (IS_TEST_BUILD) {
            const mockPrompt = `<theme>\n# Test Mode Theme (from project)\n\n## Visual Objective\nModern theme extracted from project codebase for testing.\n\n</theme>`;
            safeSend(event.sender, "theme:project-generate:chunk", {
              sessionId,
              delta: mockPrompt,
              type: "text",
            });
            safeSend(event.sender, "theme:project-generate:end", { sessionId });
            return;
          }

          const selectedModel = await resolveModelParam(params.model);
          if (!selectedModel) {
            throw new Error(
              `Invalid model selection: "${params.model}" could not be resolved`,
            );
          }

          const settings = readSettings();
          const { modelClient } = await getModelClient(
            { provider: selectedModel.providerId, name: selectedModel.apiName },
            settings,
          );

          const systemPrompt =
            params.generationMode === "high-fidelity"
              ? PROJECT_HIGH_FIDELITY_META_PROMPT
              : PROJECT_THEME_GENERATION_META_PROMPT;

          const keywordsPart = sanitizeKeywords(params.keywords) || "N/A";
          const folderName = path.basename(projectPath);
          const userInput =
            `Explore the project "${folderName}" using the available tools, then generate a theme prompt.\n` +
            `Style keywords: ${keywordsPart}`;

          // Create minimal AgentContext pointing at the project folder
          const explorationCtx = createThemeExplorationContext(projectPath, event);
          const themeTools = buildThemeExplorationTools(explorationCtx);

          safeSend(event.sender, "theme:project-generate:chunk", {
            sessionId,
            delta: "Exploring project...",
            type: "status",
          });

          const stream = streamText({
            model: modelClient.model,
            system: systemPrompt,
            maxRetries: 1,
            stopWhen: stepCountIs(100),
            messages: [{ role: "user", content: userInput }],
            tools: themeTools,
          });

          const fullStream = stream.fullStream;
          cancelOrphanedBaseStream(stream);

          for await (const part of fullStream) {
            if (part.type === "text-delta") {
              safeSend(event.sender, "theme:project-generate:chunk", {
                sessionId,
                delta: part.text,
                type: "text",
              });
            } else if (part.type === "tool-call") {
              const input = (part as any).input ?? (part as any).args ?? {};
              const label = TOOL_LABEL[part.toolName] ?? part.toolName.replace(/_/g, " ");
              const detail =
                "path" in input
                  ? `: ${input.path}`
                  : "pattern" in input
                    ? `: ${input.pattern}`
                    : "query" in input
                      ? `: ${input.query}`
                      : "directory" in input
                        ? `: ${input.directory ?? "/"}`
                        : "";
              safeSend(event.sender, "theme:project-generate:chunk", {
                sessionId,
                delta: `${label}${detail}`,
                type: "status",
              });
            }
          }

          safeSend(event.sender, "theme:project-generate:end", { sessionId });
        } catch (err) {
          logger.error("generate-theme-from-project stream error", err);
          safeSend(event.sender, "theme:project-generate:error", {
            sessionId,
            error:
              err instanceof Error
                ? err.message
                : "Failed to generate theme from project. Please try again.",
          });
        }
      })();

      return { ok: true } as const;
    },
  );
}
