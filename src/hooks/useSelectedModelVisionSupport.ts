import { useSettings } from "@/hooks/useSettings";
import { useLanguageModelsForProvider } from "@/hooks/useLanguageModelsForProvider";

const CUSTOM_PROVIDER_PREFIX = "custom::";

/**
 * Returns whether the currently selected model is known to NOT support vision.
 * - For custom models: checks the `supportsVision` flag stored in DB.
 * - For cloud (builtin) models: returns false (vision assumed supported or not tracked).
 */
export function useSelectedModelVisionSupport(): {
  modelSupportsVision: boolean;
  isLoading: boolean;
} {
  const { settings } = useSettings();
  const selectedModel = settings?.selectedModel;
  const isCustomProvider = selectedModel?.provider?.startsWith(CUSTOM_PROVIDER_PREFIX) ?? false;

  const { data: models, isLoading } = useLanguageModelsForProvider(
    isCustomProvider ? selectedModel?.provider : undefined,
  );

  if (!isCustomProvider) {
    return { modelSupportsVision: true, isLoading: false };
  }

  if (isLoading || !models) {
    return { modelSupportsVision: true, isLoading };
  }

  const found = models.find((m) => m.apiName === selectedModel?.name);
  // If model not found, allow through (don't block)
  const supportsVision = found ? (found.supportsVision ?? false) : true;

  return { modelSupportsVision: supportsVision, isLoading: false };
}
