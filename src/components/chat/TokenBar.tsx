import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCountTokens } from "@/hooks/useCountTokens";
import { ArrowDown, ArrowUp, Zap } from "lucide-react";
import { chatInputValueAtom } from "@/atoms/chatAtoms";
import { useAtom } from "jotai";

interface TokenBarProps {
  chatId?: number;
}

export function TokenBar({ chatId }: TokenBarProps) {
  const [inputValue] = useAtom(chatInputValueAtom);
  const { result, error } = useCountTokens(chatId ?? null, inputValue);
  if (!chatId || !result) {
    return null;
  }

  const { actualInputTokens, actualOutputTokens, actualCachedInputTokens, contextWindow } =
    result;

  // Only show when we have real API-reported token data.
  if (actualInputTokens === null) {
    return null;
  }

  // For Anthropic/DeepSeek: inputTokens = non-cached only, cachedTokens = cache hits.
  // Total context usage = inputTokens + cachedTokens.
  const nonCachedInputTokens = actualInputTokens;
  const outputTokens = actualOutputTokens ?? 0;
  const cachedTokens = actualCachedInputTokens ?? 0;
  const totalInputTokens = nonCachedInputTokens + cachedTokens;

  const percentUsed = Math.min((totalInputTokens / contextWindow) * 100, 100);
  const nonCachedInputPercent = (nonCachedInputTokens / contextWindow) * 100;
  const outputPercent = (outputTokens / contextWindow) * 100;
  const cachedPercent = (cachedTokens / contextWindow) * 100;

  return (
    <div className="px-4 pb-2 text-xs" data-testid="token-bar">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger className="w-full">
            <div className="w-full">
              <div className="flex gap-3 mb-1 text-xs text-muted-foreground">
                <span>Tokens: {totalInputTokens.toLocaleString()}</span>
                <span>{Math.round(percentUsed)}%</span>
                <span>
                  Context window: {(contextWindow / 1000).toFixed(0)}K
                </span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden flex">
                {/* Cached input tokens */}
                <div
                  className="h-full bg-green-400"
                  style={{ width: `${cachedPercent}%` }}
                />
                {/* Non-cached input tokens */}
                <div
                  className="h-full bg-blue-400"
                  style={{ width: `${nonCachedInputPercent}%` }}
                />
                {/* Output tokens */}
                <div
                  className="h-full bg-purple-400"
                  style={{ width: `${outputPercent}%` }}
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="w-56 p-2">
            <div className="space-y-1">
              <div className="font-medium mb-2">Token Usage (from API)</div>
              <div className="grid grid-cols-[16px_1fr_auto] gap-x-2 items-center gap-y-1">
                <ArrowUp size={12} className="text-blue-400" />
                <span>Input</span>
                <span>{nonCachedInputTokens.toLocaleString()}</span>

                <ArrowDown size={12} className="text-purple-400" />
                <span>Output</span>
                <span>{outputTokens.toLocaleString()}</span>

                <Zap size={12} className="text-green-400" />
                <span>Cached</span>
                <span>{cachedTokens.toLocaleString()}</span>
              </div>
              <div className="pt-1 border-t border-border">
                <div className="flex justify-between font-medium">
                  <span>Context window</span>
                  <span>{(contextWindow / 1000).toFixed(0)}K</span>
                </div>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {error && (
        <div className="text-red-500 text-xs mt-1">Failed to count tokens</div>
      )}
    </div>
  );
}
