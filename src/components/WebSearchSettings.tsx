import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/hooks/useSettings";

export function WebSearchSettings() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">Web Search</div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Configure the Brave Search API key for AI web search. Get a key at{" "}
        <a
          href="https://brave.com/search/api/"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          brave.com/search/api
        </a>
        .
      </div>
      <div className="space-y-1">
        <Label htmlFor="brave-search-api-key" className="text-sm">
          Brave Search API Key
        </Label>
        <Input
          id="brave-search-api-key"
          type="password"
          placeholder="BSA..."
          value={settings?.braveSearchApiKey ?? ""}
          onChange={(e) => {
            updateSettings({ braveSearchApiKey: e.target.value || undefined });
          }}
          className="font-mono text-sm"
        />
      </div>
    </div>
  );
}
