import { z } from "zod";
import {
  defineContract,
  defineStream,
  createClient,
  createStreamClient,
} from "../contracts/core";

// =============================================================================
// Template Schemas
// =============================================================================

// Import the shared Template type
// Note: The actual Template type is defined in shared/templates.ts
// We create a compatible Zod schema here
export const TemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  imageUrl: z.string(),
  githubUrl: z.string().optional(),
  isOfficial: z.boolean(),
  isExperimental: z.boolean().optional(),
  requiresNeon: z.boolean().optional(),
});

export type Template = z.infer<typeof TemplateSchema>;

// Theme schema (similar structure)
export const ThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  prompt: z.string(),
});

export type Theme = z.infer<typeof ThemeSchema>;

export const SetAppThemeParamsSchema = z.object({
  appId: z.number(),
  themeId: z.string().nullable(),
});

export type SetAppThemeParams = z.infer<typeof SetAppThemeParamsSchema>;

export const GetAppThemeParamsSchema = z.object({
  appId: z.number(),
});

export type GetAppThemeParams = z.infer<typeof GetAppThemeParamsSchema>;

// =============================================================================
// Custom Theme Schemas
// =============================================================================

export const CustomThemeSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  prompt: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type CustomTheme = z.infer<typeof CustomThemeSchema>;

export const CreateCustomThemeParamsSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  prompt: z.string(),
});

export type CreateCustomThemeParams = z.infer<
  typeof CreateCustomThemeParamsSchema
>;

export const UpdateCustomThemeParamsSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
});

export type UpdateCustomThemeParams = z.infer<
  typeof UpdateCustomThemeParamsSchema
>;

export const DeleteCustomThemeParamsSchema = z.object({
  id: z.number(),
});

export type DeleteCustomThemeParams = z.infer<
  typeof DeleteCustomThemeParamsSchema
>;

// Theme generation types
export const ThemeGenerationModeSchema = z.enum(["inspired", "high-fidelity"]);
export type ThemeGenerationMode = z.infer<typeof ThemeGenerationModeSchema>;

export const ThemeGenerationModelSchema = z.string().min(1);
export type ThemeGenerationModel = z.infer<typeof ThemeGenerationModelSchema>;

export const ThemeGenerationModelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  supportsVision: z.boolean(),
});
export type ThemeGenerationModelOption = z.infer<
  typeof ThemeGenerationModelOptionSchema
>;

// Theme input source (images, URL, or project folder)
export const ThemeInputSourceSchema = z.enum(["images", "url", "project"]);
export type ThemeInputSource = z.infer<typeof ThemeInputSourceSchema>;

// Crawl status for UI feedback
export const CrawlStatusSchema = z.enum(["crawling", "complete", "error"]);
export type CrawlStatus = z.infer<typeof CrawlStatusSchema>;

export const GenerateThemePromptParamsSchema = z.object({
  imagePaths: z.array(z.string()),
  keywords: z.string(),
  generationMode: ThemeGenerationModeSchema,
  model: ThemeGenerationModelSchema,
});

export type GenerateThemePromptParams = z.infer<
  typeof GenerateThemePromptParamsSchema
>;

export const GenerateThemePromptResultSchema = z.object({
  prompt: z.string(),
});

export type GenerateThemePromptResult = z.infer<
  typeof GenerateThemePromptResultSchema
>;

const UrlEntrySchema = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Only HTTP and HTTPS URLs are supported" },
  );

// Project-based theme generation params
export const BrowseProjectFolderResultSchema = z.object({
  path: z.string().nullable(),
});
export type BrowseProjectFolderResult = z.infer<typeof BrowseProjectFolderResultSchema>;

export const GenerateThemeFromProjectParamsSchema = z.object({
  projectPath: z.string().min(1, "Project path is required"),
  keywords: z.string(),
  generationMode: ThemeGenerationModeSchema,
  model: ThemeGenerationModelSchema,
});
export type GenerateThemeFromProjectParams = z.infer<typeof GenerateThemeFromProjectParamsSchema>;

export const ThemeProjectGenerateStreamParamsSchema =
  GenerateThemeFromProjectParamsSchema.extend({
    sessionId: z.string(),
  });
export type ThemeProjectGenerateStreamParams = z.infer<typeof ThemeProjectGenerateStreamParamsSchema>;

// URL-based theme generation params
export const GenerateThemeFromUrlParamsSchema = z.object({
  urls: z
    .array(UrlEntrySchema)
    .min(1, "At least one URL is required")
    .max(3, "Maximum 3 URLs allowed"),
  keywords: z.string(),
  generationMode: ThemeGenerationModeSchema,
  model: ThemeGenerationModelSchema,
});

export type GenerateThemeFromUrlParams = z.infer<
  typeof GenerateThemeFromUrlParamsSchema
>;

export const SaveThemeImageParamsSchema = z.object({
  data: z.string(),
  filename: z.string(),
});

export type SaveThemeImageParams = z.infer<typeof SaveThemeImageParamsSchema>;

export const SaveThemeImageResultSchema = z.object({
  path: z.string(),
});

export type SaveThemeImageResult = z.infer<typeof SaveThemeImageResultSchema>;

export const CleanupThemeImagesParamsSchema = z.object({
  paths: z.array(z.string()),
});

export type CleanupThemeImagesParams = z.infer<
  typeof CleanupThemeImagesParamsSchema
>;

// =============================================================================
// Theme Generation Stream Schemas
// =============================================================================

export const ThemeGenerateStreamParamsSchema =
  GenerateThemePromptParamsSchema.extend({
    sessionId: z.string(),
  });
export type ThemeGenerateStreamParams = z.infer<
  typeof ThemeGenerateStreamParamsSchema
>;

export const ThemeUrlGenerateStreamParamsSchema =
  GenerateThemeFromUrlParamsSchema.extend({
    sessionId: z.string(),
  });
export type ThemeUrlGenerateStreamParams = z.infer<
  typeof ThemeUrlGenerateStreamParamsSchema
>;

export const ThemeStreamChunkSchema = z.object({
  sessionId: z.string(),
  delta: z.string(),
  type: z.enum(["text", "status"]),
});

export const ThemeStreamEndSchema = z.object({
  sessionId: z.string(),
});

export const ThemeStreamErrorSchema = z.object({
  sessionId: z.string(),
  error: z.string(),
});

// =============================================================================
// Template/Theme Contracts
// =============================================================================

export const templateContracts = {
  getTemplates: defineContract({
    channel: "get-templates",
    input: z.void(),
    output: z.array(TemplateSchema),
  }),

  getThemes: defineContract({
    channel: "get-themes",
    input: z.void(),
    output: z.array(ThemeSchema),
  }),

  setAppTheme: defineContract({
    channel: "set-app-theme",
    input: SetAppThemeParamsSchema,
    output: z.void(),
  }),

  getAppTheme: defineContract({
    channel: "get-app-theme",
    input: GetAppThemeParamsSchema,
    output: z.string().nullable(),
  }),

  // Custom theme operations
  getCustomThemes: defineContract({
    channel: "get-custom-themes",
    input: z.void(),
    output: z.array(CustomThemeSchema),
  }),

  getThemeGenerationModelOptions: defineContract({
    channel: "get-theme-generation-model-options",
    input: z.void(),
    output: z.array(ThemeGenerationModelOptionSchema),
  }),

  createCustomTheme: defineContract({
    channel: "create-custom-theme",
    input: CreateCustomThemeParamsSchema,
    output: CustomThemeSchema,
  }),

  updateCustomTheme: defineContract({
    channel: "update-custom-theme",
    input: UpdateCustomThemeParamsSchema,
    output: CustomThemeSchema,
  }),

  deleteCustomTheme: defineContract({
    channel: "delete-custom-theme",
    input: DeleteCustomThemeParamsSchema,
    output: z.void(),
  }),

  // Theme generation operations (streaming — start returns ok, chunks come via events)
  generateThemePrompt: defineContract({
    channel: "generate-theme-prompt",
    input: ThemeGenerateStreamParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  generateThemeFromUrl: defineContract({
    channel: "generate-theme-from-url",
    input: ThemeUrlGenerateStreamParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  saveThemeImage: defineContract({
    channel: "save-theme-image",
    input: SaveThemeImageParamsSchema,
    output: SaveThemeImageResultSchema,
  }),

  cleanupThemeImages: defineContract({
    channel: "cleanup-theme-images",
    input: CleanupThemeImagesParamsSchema,
    output: z.void(),
  }),

  browseProjectFolder: defineContract({
    channel: "browse-project-folder",
    input: z.void(),
    output: BrowseProjectFolderResultSchema,
  }),

  generateThemeFromProject: defineContract({
    channel: "generate-theme-from-project",
    input: ThemeProjectGenerateStreamParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),
} as const;

// =============================================================================
// Theme Generation Stream Contracts
// =============================================================================

export const themeGenerateStreamContract = defineStream({
  channel: "generate-theme-prompt",
  input: ThemeGenerateStreamParamsSchema,
  keyField: "sessionId",
  events: {
    chunk: {
      channel: "theme:generate:chunk",
      payload: ThemeStreamChunkSchema,
    },
    end: {
      channel: "theme:generate:end",
      payload: ThemeStreamEndSchema,
    },
    error: {
      channel: "theme:generate:error",
      payload: ThemeStreamErrorSchema,
    },
  },
});

export const themeUrlGenerateStreamContract = defineStream({
  channel: "generate-theme-from-url",
  input: ThemeUrlGenerateStreamParamsSchema,
  keyField: "sessionId",
  events: {
    chunk: {
      channel: "theme:url-generate:chunk",
      payload: ThemeStreamChunkSchema,
    },
    end: {
      channel: "theme:url-generate:end",
      payload: ThemeStreamEndSchema,
    },
    error: {
      channel: "theme:url-generate:error",
      payload: ThemeStreamErrorSchema,
    },
  },
});

export const themeProjectGenerateStreamContract = defineStream({
  channel: "generate-theme-from-project",
  input: ThemeProjectGenerateStreamParamsSchema,
  keyField: "sessionId",
  events: {
    chunk: {
      channel: "theme:project-generate:chunk",
      payload: ThemeStreamChunkSchema,
    },
    end: {
      channel: "theme:project-generate:end",
      payload: ThemeStreamEndSchema,
    },
    error: {
      channel: "theme:project-generate:error",
      payload: ThemeStreamErrorSchema,
    },
  },
});

// =============================================================================
// Template Client
// =============================================================================

export const templateClient = createClient(templateContracts);
export const themeGenerateStreamClient = createStreamClient(
  themeGenerateStreamContract,
);
export const themeUrlGenerateStreamClient = createStreamClient(
  themeUrlGenerateStreamContract,
);
export const themeProjectGenerateStreamClient = createStreamClient(
  themeProjectGenerateStreamContract,
);
