import log from "electron-log";
import {
  GEMINI_3_1_PRO_PREVIEW,
  GPT_5_2_MODEL_NAME,
  GPT_5_NANO,
  OPUS_4_6,
  SONNET_4_6,
  GEMINI_3_FLASH,
} from "./language_model_constants";

const logger = log.scope("language_model_catalog");

export type BuiltinModelAlias =
  | "dyad/theme-generator/google"
  | "dyad/theme-generator/anthropic"
  | "dyad/theme-generator/openai"
  | "dyad/auto/openai"
  | "dyad/auto/anthropic"
  | "dyad/auto/google"
  | "dyad/help-bot/default";

type ResolvedBuiltinModel = {
  providerId: string;
  apiName: string;
};

const BUILTIN_MODEL_ALIASES: Record<string, ResolvedBuiltinModel> = {
  "dyad/theme-generator/google": { providerId: "google", apiName: GEMINI_3_1_PRO_PREVIEW },
  "dyad/theme-generator/anthropic": { providerId: "anthropic", apiName: OPUS_4_6 },
  "dyad/theme-generator/openai": { providerId: "openai", apiName: GPT_5_2_MODEL_NAME },
  "dyad/auto/openai": { providerId: "openai", apiName: GPT_5_2_MODEL_NAME },
  "dyad/auto/anthropic": { providerId: "anthropic", apiName: SONNET_4_6 },
  "dyad/auto/google": { providerId: "google", apiName: GEMINI_3_FLASH },
  "dyad/help-bot/default": { providerId: "openai", apiName: GPT_5_NANO },
};

export async function resolveBuiltinModelAlias(
  aliasId: BuiltinModelAlias | string,
): Promise<ResolvedBuiltinModel | null> {
  const resolvedModel = BUILTIN_MODEL_ALIASES[aliasId] ?? null;

  logger.info("Resolved builtin model alias", {
    aliasId,
    resolvedProviderId: resolvedModel?.providerId,
    resolvedApiName: resolvedModel?.apiName,
  });

  return resolvedModel;
}
