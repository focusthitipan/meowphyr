import { useEffect, useState } from "react";
import {
  DatabaseZap,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { codeIndexClient, codeIndexEventClient } from "@/ipc/types";
import type { IndexProgressPayload } from "@/ipc/types/code_index";
import { useSettings } from "@/hooks/useSettings";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface CodeIndexButtonProps {
  appId: number;
}

type IndexState = "standby" | "indexing" | "complete" | "error";


export function CodeIndexButton({ appId }: CodeIndexButtonProps) {
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const [liveProgress, setLiveProgress] = useState<IndexProgressPayload | null>(null);
  const [indexState, setIndexState] = useState<IndexState>("standby");

  const hasEmbeddingKey = !!settings?.embeddingApiKey;

  const { data: status } = useQuery({
    queryKey: ["code-index-status", appId],
    queryFn: () => codeIndexClient.getIndexStatus({ appId }),
    refetchOnWindowFocus: false,
  });

  const indexMutation = useMutation({
    mutationFn: () => codeIndexClient.indexCodebase({ appId }),
    onMutate: () => {
      setIndexState("indexing");
      setLiveProgress(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["code-index-status", appId] });
      setIndexState("complete");
      setLiveProgress(null);
    },
    onError: () => {
      setIndexState("error");
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => codeIndexClient.clearIndex({ appId }),
    onSuccess: () => {
      // Reset cache immediately so the sync effect doesn't flip state back to "complete"
      queryClient.setQueryData(["code-index-status", appId], { chunkCount: 0 });
      queryClient.invalidateQueries({ queryKey: ["code-index-status", appId] });
      setIndexState("standby");
      setLiveProgress(null);
    },
  });

  useEffect(() => {
    const unsubscribe = codeIndexEventClient.onIndexProgress((payload) => {
      if (payload.appId !== appId) return;
      setLiveProgress(payload);
      if (payload.state === "complete") {
        setIndexState("complete");
        setLiveProgress(null);
        queryClient.invalidateQueries({ queryKey: ["code-index-status", appId] });
      } else if (payload.state === "error") {
        setIndexState("error");
        setLiveProgress(null);
      }
    });
    return unsubscribe;
  }, [appId, queryClient]);

  useEffect(() => {
    // Only promote standby→complete when chunkCount > 0 AND we're not in the middle of clearing
    if (indexState === "standby" && status?.chunkCount && !clearMutation.isPending) {
      setIndexState("complete");
    }
    // If chunkCount drops to 0 (after clear), reset to standby
    if (indexState === "complete" && status?.chunkCount === 0) {
      setIndexState("standby");
    }
  }, [status?.chunkCount, indexState, clearMutation.isPending]);

  const isIndexing = indexMutation.isPending;
  const isClearing = clearMutation.isPending;
  const isBusy = isIndexing || isClearing;

  const percent =
    liveProgress && liveProgress.total > 0
      ? Math.round((liveProgress.indexed / liveProgress.total) * 100)
      : null;

  const colorClass = !hasEmbeddingKey
    ? "text-muted-foreground hover:text-foreground"
    : {
        standby: "text-muted-foreground hover:text-foreground",
        indexing: "text-amber-500",
        complete: "text-green-500 hover:text-green-400",
        error: "text-red-500 hover:text-red-400",
      }[indexState];

  const label = (() => {
    if (isIndexing && liveProgress)
      return `IDX ${percent}% ${liveProgress.indexed}/${liveProgress.total}`;
    if (isIndexing) return "IDX...";
    if (isClearing) return "IDX...";
    if (indexState === "complete")
      return status?.chunkCount ? `IDX ${status.chunkCount}` : "IDX Ready";
    if (indexState === "error") return "IDX Error";
    return status?.chunkCount ? `IDX ${status.chunkCount}` : "IDX";
  })();

  const stateIcon = (() => {
    if (isBusy) return <Loader2 size={12} className="animate-spin shrink-0" />;
    if (indexState === "complete") return <CheckCircle2 size={12} className="shrink-0" />;
    if (indexState === "error") return <AlertCircle size={12} className="shrink-0" />;
    return <DatabaseZap size={12} className="shrink-0" />;
  })();

  const statusLabel = (() => {
    if (isIndexing && liveProgress)
      return `กำลังสร้างดัชนี... ${liveProgress.indexed}/${liveProgress.total} ไฟล์ (${percent}%)`;
    if (isIndexing) return "กำลังสร้างดัชนี...";
    if (isClearing) return "กำลังล้างข้อมูล...";
    if (indexState === "complete")
      return status?.chunkCount ? `พร้อมใช้งาน — ${status.chunkCount} chunks` : "พร้อมใช้งาน";
    if (indexState === "error") return "เกิดข้อผิดพลาด";
    return hasEmbeddingKey ? "ยังไม่ได้สร้างดัชนี" : "ต้องการ API Key";
  })();

  const statusColor = !hasEmbeddingKey
    ? "text-muted-foreground"
    : {
        standby: "text-muted-foreground",
        indexing: "text-amber-500",
        complete: "text-green-500",
        error: "text-red-500",
      }[indexState];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono transition-colors ${colorClass}`}
            data-testid="code-index-button"
          />
        }
      >
        {stateIcon}
        <span>{label}</span>
      </PopoverTrigger>

      <PopoverContent side="top" align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <DatabaseZap size={15} className="text-muted-foreground shrink-0" />
          <span className="font-semibold text-sm">Codebase Indexing</span>
        </div>

        {/* Status */}
        <div className="px-4 py-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            {isBusy ? (
              <Loader2 size={13} className={`animate-spin ${statusColor}`} />
            ) : indexState === "complete" ? (
              <CheckCircle2 size={13} className={statusColor} />
            ) : indexState === "error" ? (
              <AlertCircle size={13} className={statusColor} />
            ) : (
              <DatabaseZap size={13} className={statusColor} />
            )}
            <span className={`text-xs ${statusColor}`}>{statusLabel}</span>
          </div>

          {isIndexing && liveProgress && liveProgress.total > 0 && (
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-amber-500 h-1.5 rounded-full transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-4 py-3">
          <Button
            size="sm"
            className="flex-1 h-8 text-xs"
            disabled={isBusy || !hasEmbeddingKey}
            onClick={() => indexMutation.mutate()}
          >
            {isIndexing ? (
              <Loader2 size={12} className="animate-spin mr-1" />
            ) : (
              <DatabaseZap size={12} className="mr-1" />
            )}
            เริ่มการสร้างดัชนี
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs"
            disabled={isBusy || !status?.chunkCount}
            onClick={() => clearMutation.mutate()}
          >
            {isClearing ? (
              <Loader2 size={12} className="animate-spin mr-1" />
            ) : (
              <Trash2 size={12} className="mr-1" />
            )}
            ล้างข้อมูลดัชนี
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
