import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/hooks/useSettings";
import { RotateCcw } from "lucide-react";

const DEFAULT_BASE_URL = "https://api.mistral.ai/v1";
const DEFAULT_MODEL = "codestral-embed-2505";
const DEFAULT_SEARCH_MIN_SCORE = 0.4;
const DEFAULT_SEARCH_MAX_RESULTS = 50;
const DEFAULT_BATCH_SIZE = 60;
const DEFAULT_MAX_RETRIES = 3;

interface SliderRowProps {
  label: string;
  hint: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function SliderRow({ label, hint, value, defaultValue, min, max, step, onChange }: SliderRowProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-sm">{label}</Label>
        <span
          title={hint}
          className="text-xs text-muted-foreground cursor-help border border-muted-foreground/40 rounded-full w-4 h-4 flex items-center justify-center leading-none select-none"
        >
          i
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-primary cursor-pointer"
        />
        <span className="w-10 text-right text-sm tabular-nums">{value}</span>
        <button
          onClick={() => onChange(defaultValue)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Reset to default"
          type="button"
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}

export function EmbeddingSettings() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">Code Search (Embeddings)</div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Configure the embedding API used for semantic code search. Compatible
        with OpenAI and any OpenAI-compatible provider (Ollama, OpenRouter,
        Mistral, etc.).
      </div>

      {/* API Config */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="embedding-base-url" className="text-sm">Base URL</Label>
          <Input
            id="embedding-base-url"
            placeholder={DEFAULT_BASE_URL}
            value={settings?.embeddingBaseUrl ?? ""}
            onChange={(e) => updateSettings({ embeddingBaseUrl: e.target.value || undefined })}
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="embedding-api-key" className="text-sm">API Key</Label>
          <Input
            id="embedding-api-key"
            type="password"
            placeholder="Enter API key..."
            value={settings?.embeddingApiKey ?? ""}
            onChange={(e) => updateSettings({ embeddingApiKey: e.target.value || undefined })}
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="embedding-model" className="text-sm">Model</Label>
          <Input
            id="embedding-model"
            placeholder={DEFAULT_MODEL}
            value={settings?.embeddingModel ?? ""}
            onChange={(e) => updateSettings({ embeddingModel: e.target.value || undefined })}
            className="font-mono text-sm"
          />
          <div className="text-xs text-gray-500 dark:text-gray-400">
            e.g. mistral-embed, text-embedding-3-small, nomic-embed-text (Ollama)
          </div>
        </div>
      </div>

      {/* Advanced tuning */}
      <div className="border-t pt-4 space-y-4">
        <div className="text-sm font-medium text-muted-foreground">Advanced Settings</div>

        <SliderRow
          label="Search Score Threshold"
          hint="Minimum cosine similarity score for search results (0–1)"
          value={settings?.embeddingSearchMinScore ?? DEFAULT_SEARCH_MIN_SCORE}
          defaultValue={DEFAULT_SEARCH_MIN_SCORE}
          min={0.0}
          max={1.0}
          step={0.05}
          onChange={(v) => updateSettings({ embeddingSearchMinScore: v })}
        />

        <SliderRow
          label="Max Search Results"
          hint="Maximum number of chunks to return from search"
          value={settings?.embeddingSearchMaxResults ?? DEFAULT_SEARCH_MAX_RESULTS}
          defaultValue={DEFAULT_SEARCH_MAX_RESULTS}
          min={1}
          max={100}
          step={1}
          onChange={(v) => updateSettings({ embeddingSearchMaxResults: v })}
        />

        <SliderRow
          label="Embedding Batch Size"
          hint="Number of chunks sent to the Embedding API per request"
          value={settings?.embeddingBatchSize ?? DEFAULT_BATCH_SIZE}
          defaultValue={DEFAULT_BATCH_SIZE}
          min={1}
          max={128}
          step={1}
          onChange={(v) => updateSettings({ embeddingBatchSize: v })}
        />

        <SliderRow
          label="Scanner Max Retries"
          hint="Maximum number of retries when rate limited (429)"
          value={settings?.embeddingScannerMaxRetries ?? DEFAULT_MAX_RETRIES}
          defaultValue={DEFAULT_MAX_RETRIES}
          min={1}
          max={10}
          step={1}
          onChange={(v) => updateSettings({ embeddingScannerMaxRetries: v })}
        />
      </div>
    </div>
  );
}
