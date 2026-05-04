import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { toast } from "sonner";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface FetchModelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  providerId: string;
}

export function FetchModelsDialog({
  isOpen,
  onClose,
  onSuccess,
  providerId,
}: FetchModelsDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["fetchProviderModelList", providerId],
    queryFn: () => ipc.languageModel.fetchProviderModelList({ providerId }),
    enabled: isOpen,
    staleTime: 0,
  });

  const availableModels = data?.models ?? [];
  const alreadyAdded = data?.alreadyAdded ?? [];

  const allSelected =
    availableModels.length > 0 &&
    availableModels.every((id) => selectedIds.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(availableModels));
    }
  };

  const toggleModel = (modelId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const importMutation = useMutation({
    mutationFn: () =>
      ipc.languageModel.importSelectedProviderModels({
        providerId,
        modelIds: Array.from(selectedIds),
      }),
    onSuccess: (result) => {
      toast.success(
        `Added ${result.added} model${result.added !== 1 ? "s" : ""}`,
      );
      setSelectedIds(new Set());
      onSuccess();
      onClose();
    },
    onError: (err: any) => {
      showError(err.message || "Failed to import models");
    },
  });

  const handleClose = () => {
    setSelectedIds(new Set());
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fetch Models from API</DialogTitle>
          <DialogDescription>
            Select the models you want to add from this provider.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto space-y-1 pr-1">
          {isLoading && (
            <div className="space-y-2 py-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {(error as any).message || "Failed to fetch model list"}
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !error && availableModels.length === 0 && alreadyAdded.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No models found from this provider.
            </p>
          )}

          {!isLoading && !error && (availableModels.length > 0 || alreadyAdded.length > 0) && (
            <>
              {availableModels.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-2 py-1.5 border-b mb-1">
                    <Checkbox
                      id="select-all"
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                    />
                    <label
                      htmlFor="select-all"
                      className="text-sm font-medium cursor-pointer select-none"
                    >
                      Select all ({availableModels.length})
                    </label>
                  </div>
                  {availableModels.map((modelId) => (
                    <div
                      key={modelId}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      onClick={() => toggleModel(modelId)}
                    >
                      <Checkbox
                        id={`model-${modelId}`}
                        checked={selectedIds.has(modelId)}
                        onCheckedChange={() => toggleModel(modelId)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <label
                        htmlFor={`model-${modelId}`}
                        className="text-sm cursor-pointer select-none flex-1 truncate"
                        title={modelId}
                      >
                        {modelId}
                      </label>
                    </div>
                  ))}
                </>
              )}

              {alreadyAdded.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground px-2 py-1">
                    Already added ({alreadyAdded.length})
                  </p>
                  {alreadyAdded.map((modelId) => (
                    <div
                      key={modelId}
                      className="flex items-center gap-2 px-2 py-1.5 opacity-50"
                    >
                      <Checkbox checked disabled />
                      <span
                        className="text-sm select-none flex-1 truncate"
                        title={modelId}
                      >
                        {modelId}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={selectedIds.size === 0 || importMutation.isPending}
          >
            {importMutation.isPending
              ? "Adding…"
              : `Add ${selectedIds.size > 0 ? selectedIds.size : ""} Model${selectedIds.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
