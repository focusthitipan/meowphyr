import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { useCallback, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  CustomTheme,
  CreateCustomThemeParams,
  UpdateCustomThemeParams,
  ThemeGenerationModelOption,
} from "@/ipc/types";
import type {
  ThemeGenerateStreamParams,
  ThemeUrlGenerateStreamParams,
} from "@/ipc/types/templates";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Hook to fetch all custom themes.
 */
export function useCustomThemes() {
  const query = useQuery({
    queryKey: queryKeys.customThemes.all,
    queryFn: async (): Promise<CustomTheme[]> => {
      return ipc.template.getCustomThemes();
    },
    meta: {
      showErrorToast: true,
    },
  });

  return {
    customThemes: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateCustomTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: CreateCustomThemeParams,
    ): Promise<CustomTheme> => {
      return ipc.template.createCustomTheme(params);
    },
    onSuccess: () => {
      // Invalidate all custom theme queries using prefix matching
      queryClient.invalidateQueries({
        queryKey: queryKeys.customThemes.all,
      });
    },
  });
}

export function useUpdateCustomTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: UpdateCustomThemeParams,
    ): Promise<CustomTheme> => {
      return ipc.template.updateCustomTheme(params);
    },
    onSuccess: () => {
      // Invalidate all custom theme queries using prefix matching
      queryClient.invalidateQueries({
        queryKey: queryKeys.customThemes.all,
      });
    },
  });
}

export function useDeleteCustomTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await ipc.template.deleteCustomTheme({ id });
    },
    onSuccess: () => {
      // Invalidate all custom theme queries using prefix matching
      queryClient.invalidateQueries({
        queryKey: queryKeys.customThemes.all,
      });
    },
  });
}

export function useGenerateThemePrompt() {
  const [isPending, setIsPending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const sessionIdRef = useRef("");
  const textBufferRef = useRef("");

  const start = useCallback(
    (
      params: Omit<ThemeGenerateStreamParams, "sessionId">,
      callbacks: {
        onChunk?: (delta: string, type: "text" | "status") => void;
        onEnd?: (fullText: string) => void;
        onError?: (error: string) => void;
      },
    ) => {
      const sessionId = uuidv4();
      sessionIdRef.current = sessionId;
      textBufferRef.current = "";
      setStreamingText("");
      setIsPending(true);

      ipc.themeGenerateStream.start(
        { ...params, sessionId },
        {
          onChunk: (data) => {
            if (data.type === "text") {
              textBufferRef.current += data.delta;
              setStreamingText(textBufferRef.current);
            }
            callbacks.onChunk?.(data.delta, data.type);
          },
          onEnd: () => {
            setIsPending(false);
            callbacks.onEnd?.(textBufferRef.current);
          },
          onError: (data) => {
            setIsPending(false);
            callbacks.onError?.(data.error);
          },
        },
      );
    },
    [],
  );

  return { start, isPending, streamingText };
}

export function useGenerateThemeFromUrl() {
  const [isPending, setIsPending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const textBufferRef = useRef("");

  const start = useCallback(
    (
      params: Omit<ThemeUrlGenerateStreamParams, "sessionId">,
      callbacks: {
        onChunk?: (delta: string, type: "text" | "status") => void;
        onEnd?: (fullText: string) => void;
        onError?: (error: string) => void;
      },
    ) => {
      const sessionId = uuidv4();
      textBufferRef.current = "";
      setStreamingText("");
      setStatusMessage("");
      setIsPending(true);

      ipc.themeUrlGenerateStream.start(
        { ...params, sessionId },
        {
          onChunk: (data) => {
            if (data.type === "text") {
              textBufferRef.current += data.delta;
              setStreamingText(textBufferRef.current);
              setStatusMessage("");
            } else {
              setStatusMessage(data.delta);
            }
            callbacks.onChunk?.(data.delta, data.type);
          },
          onEnd: () => {
            setIsPending(false);
            setStatusMessage("");
            callbacks.onEnd?.(textBufferRef.current);
          },
          onError: (data) => {
            setIsPending(false);
            setStatusMessage("");
            callbacks.onError?.(data.error);
          },
        },
      );
    },
    [],
  );

  return { start, isPending, streamingText, statusMessage };
}

export function useThemeGenerationModelOptions() {
  const query = useQuery({
    queryKey: queryKeys.themeGenerationModelOptions.all,
    queryFn: async (): Promise<ThemeGenerationModelOption[]> => {
      return ipc.template.getThemeGenerationModelOptions();
    },
    meta: {
      showErrorToast: true,
    },
  });

  return {
    themeGenerationModelOptions: query.data ?? [],
    isLoadingThemeGenerationModelOptions: query.isLoading,
  };
}
