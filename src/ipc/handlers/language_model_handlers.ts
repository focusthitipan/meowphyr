import type {
  LanguageModelProvider,
  LanguageModel,
  CreateCustomLanguageModelProviderParams,
  CreateCustomLanguageModelParams,
} from "@/ipc/types";
import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import {
  CUSTOM_PROVIDER_PREFIX,
  getLanguageModelProviders,
  getLanguageModels,
  getLanguageModelsByProviders,
} from "../shared/language_model_helpers";
import { db } from "@/db";
import {
  language_models,
  language_model_providers as languageModelProvidersSchema,
  language_models as languageModelsSchema,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";

const logger = log.scope("language_model_handlers");
const handle = createLoggedHandler(logger);

export function registerLanguageModelHandlers() {
  handle(
    "get-language-model-providers",
    async (): Promise<LanguageModelProvider[]> => {
      return getLanguageModelProviders();
    },
  );

  handle(
    "create-custom-language-model-provider",
    async (
      event: IpcMainInvokeEvent,
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      const { id, name, apiBaseUrl, envVarName } = params;

      // Validation
      if (!id) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      if (!name) {
        throw new DyadError(
          "Provider name is required",
          DyadErrorKind.Validation,
        );
      }

      if (!apiBaseUrl) {
        throw new DyadError(
          "API base URL is required",
          DyadErrorKind.Validation,
        );
      }

      // Check if a provider with this ID already exists
      const existingProvider = db
        .select()
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, id))
        .get();

      if (existingProvider) {
        throw new DyadError(
          `A provider with ID "${id}" already exists`,
          DyadErrorKind.Conflict,
        );
      }

      // Insert the new provider
      await db.insert(languageModelProvidersSchema).values({
        // Make sure we will never have accidental collisions with builtin providers
        id: CUSTOM_PROVIDER_PREFIX + id,
        name,
        api_base_url: apiBaseUrl,
        env_var_name: envVarName || null,
      });

      // Return the newly created provider
      return {
        id,
        name,
        apiBaseUrl,
        envVarName,
        type: "custom",
      };
    },
  );

  handle(
    "create-custom-language-model",
    async (
      event: IpcMainInvokeEvent,
      params: CreateCustomLanguageModelParams,
    ): Promise<void> => {
      const {
        apiName,
        displayName,
        providerId,
        description,
        maxOutputTokens,
        contextWindow,
        supportsVision,
      } = params;

      // Validation
      if (!apiName) {
        throw new DyadError(
          "Model API name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!displayName) {
        throw new DyadError(
          "Model display name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!providerId) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      // Check if provider exists
      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }

      // Insert the new model
      await db.insert(languageModelsSchema).values({
        displayName,
        apiName,
        builtinProviderId: provider.type === "cloud" ? providerId : undefined,
        customProviderId: provider.type === "custom" ? providerId : undefined,
        description: description || null,
        max_output_tokens: maxOutputTokens || null,
        context_window: contextWindow || null,
        supports_vision: supportsVision ?? false,
      });
    },
  );
  handle(
    "edit-custom-language-model-provider",
    async (
      event: IpcMainInvokeEvent,
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      const { id, name, apiBaseUrl, envVarName } = params;

      if (!id) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }
      if (!name) {
        throw new DyadError(
          "Provider name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!apiBaseUrl) {
        throw new DyadError(
          "API base URL is required",
          DyadErrorKind.Validation,
        );
      }

      // Check if the provider being edited exists
      const existingProvider = db
        .select()
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, CUSTOM_PROVIDER_PREFIX + id))
        .get();

      if (!existingProvider) {
        throw new DyadError(
          `Provider with ID "${id}" not found`,
          DyadErrorKind.NotFound,
        );
      }

      // Use transaction to ensure atomicity when updating provider and potentially its models
      const result = db.transaction((tx) => {
        // Update the provider
        const updateResult = tx
          .update(languageModelProvidersSchema)
          .set({
            id: CUSTOM_PROVIDER_PREFIX + id,
            name,
            api_base_url: apiBaseUrl,
            env_var_name: envVarName || null,
          })
          .where(
            eq(languageModelProvidersSchema.id, CUSTOM_PROVIDER_PREFIX + id),
          )
          .run();

        if (updateResult.changes === 0) {
          throw new DyadError(
            `Failed to update provider with ID "${id}"`,
            DyadErrorKind.External,
          );
        }

        return {
          id,
          name,
          apiBaseUrl,
          envVarName,
          type: "custom" as const,
        };
      });
      logger.info(`Successfully updated provider`);
      return result;
    },
  );

  handle(
    "delete-custom-language-model",
    async (
      event: IpcMainInvokeEvent,
      params: { modelId: string },
    ): Promise<void> => {
      const { modelId: apiName } = params;

      // Validation
      if (!apiName) {
        throw new DyadError(
          "Model API name (modelId) is required",
          DyadErrorKind.Validation,
        );
      }

      logger.info(
        `Handling delete-custom-language-model for apiName: ${apiName}`,
      );

      const existingModel = await db
        .select()
        .from(languageModelsSchema)
        .where(eq(languageModelsSchema.apiName, apiName))
        .get();

      if (!existingModel) {
        throw new Error(
          `A model with API name (modelId) "${apiName}" was not found`,
        );
      }

      await db
        .delete(languageModelsSchema)
        .where(eq(languageModelsSchema.apiName, apiName));
    },
  );

  handle(
    "delete-custom-model",
    async (
      _event: IpcMainInvokeEvent,
      params: { providerId: string; modelApiName: string },
    ): Promise<void> => {
      const { providerId, modelApiName } = params;
      logger.info(
        `Handling delete-custom-model for ${providerId} / ${modelApiName}`,
      );
      if (!providerId || !modelApiName) {
        throw new DyadError(
          "Provider ID and Model API Name are required.",
          DyadErrorKind.External,
        );
      }
      logger.info(
        `Attempting to delete custom model ${modelApiName} for provider ${providerId}`,
      );

      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }
      if (provider.type === "local") {
        throw new DyadError(
          "Local models cannot be deleted",
          DyadErrorKind.External,
        );
      }
      const result = db
        .delete(language_models)
        .where(
          and(
            provider.type === "cloud"
              ? eq(language_models.builtinProviderId, providerId)
              : eq(language_models.customProviderId, providerId),

            eq(language_models.apiName, modelApiName),
          ),
        )
        .run();

      if (result.changes === 0) {
        logger.warn(
          `No custom model found matching providerId=${providerId} and apiName=${modelApiName} for deletion.`,
        );
      } else {
        logger.info(
          `Successfully deleted ${result.changes} custom model(s) with apiName=${modelApiName} for provider=${providerId}`,
        );
      }
    },
  );

  handle(
    "delete-custom-language-model-provider",
    async (
      event: IpcMainInvokeEvent,
      params: { providerId: string },
    ): Promise<void> => {
      const { providerId } = params;

      // Validation
      if (!providerId) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      logger.info(
        `Handling delete-custom-language-model-provider for providerId: ${providerId}`,
      );

      // Check if the provider exists before attempting deletion
      const existingProvider = await db
        .select({ id: languageModelProvidersSchema.id })
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, providerId))
        .get();

      if (!existingProvider) {
        // If the provider doesn't exist, maybe it was already deleted. Log and return.
        logger.warn(
          `Provider with ID "${providerId}" not found. It might have been deleted already.`,
        );
        // Optionally, throw new Error(`Provider with ID "${providerId}" not found`);
        // Deciding to return gracefully instead of throwing an error if not found.
        return;
      }

      // Use a transaction to ensure atomicity
      db.transaction((tx) => {
        // 1. Delete associated models
        const deleteModelsResult = tx
          .delete(languageModelsSchema)
          .where(eq(languageModelsSchema.customProviderId, providerId))
          .run();
        logger.info(
          `Deleted ${deleteModelsResult.changes} model(s) associated with provider ${providerId}`,
        );

        // 2. Delete the provider
        const deleteProviderResult = tx
          .delete(languageModelProvidersSchema)
          .where(eq(languageModelProvidersSchema.id, providerId))
          .run();

        if (deleteProviderResult.changes === 0) {
          // This case should ideally not happen if existingProvider check passed,
          // but adding safety check within transaction.
          logger.error(
            `Failed to delete provider with ID "${providerId}" during transaction, although it was found initially. Rolling back.`,
          );
          throw new Error(
            `Failed to delete provider with ID "${providerId}" which should have existed.`,
          );
        }
        logger.info(`Successfully deleted provider with ID "${providerId}".`);
      });
    },
  );

  handle(
    "get-language-models",
    async (
      event: IpcMainInvokeEvent,
      params: { providerId: string },
    ): Promise<LanguageModel[]> => {
      if (!params || typeof params.providerId !== "string") {
        throw new DyadError(
          "Invalid parameters: providerId (string) is required.",
          DyadErrorKind.Validation,
        );
      }
      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === params.providerId);
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${params.providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }
      if (provider.type === "local") {
        throw new DyadError(
          "Local models cannot be fetched",
          DyadErrorKind.External,
        );
      }
      return getLanguageModels({ providerId: params.providerId });
    },
  );

  handle(
    "get-language-models-by-providers",
    async (): Promise<Record<string, LanguageModel[]>> => {
      return getLanguageModelsByProviders();
    },
  );

  handle(
    "fetch-provider-model-list",
    async (
      _event: IpcMainInvokeEvent,
      params: { providerId: string },
    ): Promise<{ models: string[]; alreadyAdded: string[] }> => {
      const { providerId } = params;

      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === providerId);

      if (!provider || provider.type !== "custom") {
        throw new DyadError(
          `Provider "${providerId}" not found or is not a custom provider`,
          DyadErrorKind.NotFound,
        );
      }

      if (!provider.apiBaseUrl) {
        throw new DyadError(
          "Provider has no API base URL configured",
          DyadErrorKind.Validation,
        );
      }

      const settings = readSettings();
      const apiKey = settings.providerSettings?.[providerId]?.apiKey?.value;
      const envApiKey = provider.envVarName
        ? process.env[provider.envVarName]
        : undefined;
      const effectiveApiKey = apiKey || envApiKey;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (effectiveApiKey) {
        headers["Authorization"] = `Bearer ${effectiveApiKey}`;
      }

      const baseUrl = provider.apiBaseUrl.replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/models`, { headers });

      if (!response.ok) {
        throw new DyadError(
          `Failed to fetch models from provider: ${response.status} ${response.statusText}`,
          DyadErrorKind.External,
        );
      }

      const json = await response.json();
      const modelData: Array<{ id: string }> = Array.isArray(json)
        ? json
        : (json.data ?? []);

      const fetchedIds = modelData
        .filter((m: any) => typeof m.id === "string" && m.id)
        .map((m: any) => m.id as string);

      const existingModels = await db
        .select({ apiName: languageModelsSchema.apiName })
        .from(languageModelsSchema)
        .where(eq(languageModelsSchema.customProviderId, providerId));

      const existingApiNames = new Set(existingModels.map((m) => m.apiName));
      const alreadyAdded = fetchedIds.filter((id) => existingApiNames.has(id));
      const models = fetchedIds.filter((id) => !existingApiNames.has(id));

      return { models, alreadyAdded };
    },
  );

  handle(
    "import-selected-provider-models",
    async (
      _event: IpcMainInvokeEvent,
      params: { providerId: string; modelIds: string[] },
    ): Promise<{ added: number }> => {
      const { providerId, modelIds } = params;

      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === providerId);

      if (!provider || provider.type !== "custom") {
        throw new DyadError(
          `Provider "${providerId}" not found or is not a custom provider`,
          DyadErrorKind.NotFound,
        );
      }

      for (const modelId of modelIds) {
        await db.insert(languageModelsSchema).values({
          displayName: modelId,
          apiName: modelId,
          customProviderId: providerId,
          description: null,
          max_output_tokens: null,
          context_window: null,
        });
      }

      logger.info(
        `Imported ${modelIds.length} selected models for provider "${providerId}"`,
      );

      return { added: modelIds.length };
    },
  );
}
