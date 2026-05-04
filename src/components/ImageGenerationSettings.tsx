import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/hooks/useSettings";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-1";

export function ImageGenerationSettings() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">Image Generation</div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Configure the API used for AI image generation. Compatible with OpenAI
        and any OpenAI-compatible provider.
      </div>

      <div className="space-y-1">
        <Label htmlFor="image-gen-base-url" className="text-sm">
          Base URL
        </Label>
        <Input
          id="image-gen-base-url"
          placeholder={DEFAULT_BASE_URL}
          value={settings?.imageGenerationBaseUrl ?? ""}
          onChange={(e) => {
            updateSettings({ imageGenerationBaseUrl: e.target.value || undefined });
          }}
          className="font-mono text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="image-gen-api-key" className="text-sm">
          API Key
        </Label>
        <Input
          id="image-gen-api-key"
          type="password"
          placeholder="sk-..."
          value={settings?.imageGenerationApiKey ?? ""}
          onChange={(e) => {
            updateSettings({ imageGenerationApiKey: e.target.value || undefined });
          }}
          className="font-mono text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="image-gen-model" className="text-sm">
          Model
        </Label>
        <Input
          id="image-gen-model"
          placeholder={DEFAULT_MODEL}
          value={settings?.imageGenerationModel ?? ""}
          onChange={(e) => {
            updateSettings({ imageGenerationModel: e.target.value || undefined });
          }}
          className="font-mono text-sm"
        />
        <div className="text-xs text-gray-500 dark:text-gray-400">
          e.g. gpt-image-1, dall-e-3
        </div>
      </div>
    </div>
  );
}
