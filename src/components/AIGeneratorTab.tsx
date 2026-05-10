import { useState, useCallback, useRef, useEffect, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, X, Sparkles, Link, Check, FolderOpen } from "lucide-react";
import {
  useGenerateThemePrompt,
  useGenerateThemeFromUrl,
  useGenerateThemeFromProject,
  useThemeGenerationModelOptions,
} from "@/hooks/useCustomThemes";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { toast } from "sonner";
import type {
  ThemeGenerationMode,
  ThemeGenerationModel,
  ThemeInputSource,
} from "@/ipc/types";

function extractThemeContent(text: string): string {
  const open = text.indexOf("<theme>");
  const close = text.lastIndexOf("</theme>");
  if (open !== -1 && close !== -1 && close > open) {
    return text.slice(open + "<theme>".length, close).trim();
  }
  return text.trim();
}

// Image upload constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image (raw file size)
const MAX_IMAGES = 5;

// Image stored with file path (for IPC) and blob URL (for preview)
interface ThemeImage {
  path: string; // File path in temp directory
  preview: string; // Blob URL for displaying thumbnail
}

interface AIGeneratorTabProps {
  aiName: string;
  setAiName: (name: string) => void;
  aiDescription: string;
  setAiDescription: (desc: string) => void;
  aiGeneratedPrompt: string;
  setAiGeneratedPrompt: (prompt: string) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  isDialogOpen: boolean;
}

export function AIGeneratorTab({
  aiName,
  setAiName,
  aiDescription,
  setAiDescription,
  aiGeneratedPrompt,
  setAiGeneratedPrompt,
  onSave,
  isSaving,
  isDialogOpen,
}: AIGeneratorTabProps) {
  const { t } = useTranslation("home");
  const [aiImages, setAiImages] = useState<ThemeImage[]>([]);
  const [aiKeywords, setAiKeywords] = useState("");
  const [aiGenerationMode, setAiGenerationMode] =
    useState<ThemeGenerationMode>("inspired");
  const [aiSelectedModel, setAiSelectedModel] =
    useState<ThemeGenerationModel>("");
  const [aiSelectedProvider, setAiSelectedProvider] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track if dialog is open to prevent orphaned uploads from adding images after close
  const isDialogOpenRef = useRef(isDialogOpen);

  // Input source state
  const [inputSource, setInputSource] = useState<ThemeInputSource>("images");
  const [websiteUrls, setWebsiteUrls] = useState<string[]>([""]);
  const [projectPath, setProjectPath] = useState<string>("");
  const [isBrowsing, setIsBrowsing] = useState(false);

  const generatePromptStream = useGenerateThemePrompt();
  const generateFromUrlStream = useGenerateThemeFromUrl();
  const generateFromProjectStream = useGenerateThemeFromProject();
  const isGenerating =
    generatePromptStream.isPending ||
    generateFromUrlStream.isPending ||
    generateFromProjectStream.isPending;
  const streamingText =
    generatePromptStream.streamingText ||
    generateFromUrlStream.streamingText ||
    generateFromProjectStream.streamingText;
  const statusMessage =
    generateFromUrlStream.statusMessage ||
    generateFromProjectStream.statusMessage;
  const { themeGenerationModelOptions, isLoadingThemeGenerationModelOptions } =
    useThemeGenerationModelOptions();

  // Cleanup function to revoke blob URLs and delete temp files
  const cleanupImages = useCallback(
    async (images: ThemeImage[], showErrors = false) => {
      // Revoke blob URLs to free memory
      images.forEach((img) => {
        URL.revokeObjectURL(img.preview);
      });

      // Delete temp files via IPC
      const paths = images.map((img) => img.path);
      if (paths.length > 0) {
        try {
          await ipc.template.cleanupThemeImages({ paths });
        } catch {
          if (showErrors) {
            showError("Failed to cleanup temporary image files");
          }
        }
      }
    },
    [],
  );

  // Keep ref in sync with isDialogOpen prop
  useEffect(() => {
    isDialogOpenRef.current = isDialogOpen;
  }, [isDialogOpen]);

  // "images" and "url" modes send screenshots, so vision is required; "project" does not
  const requiresVision = inputSource === "images" || inputSource === "url";

  // Derived: unique providers from model options (filtered by vision capability)
  const providers = themeGenerationModelOptions.reduce(
    (acc, option) => {
      if (requiresVision && !option.supportsVision) return acc;
      if (option.providerId && !acc.some((p) => p.id === option.providerId)) {
        acc.push({ id: option.providerId, name: option.providerName });
      }
      return acc;
    },
    [] as { id: string; name: string }[],
  );

  // Derived: models filtered by selected provider (and vision capability)
  const modelsForSelectedProvider = themeGenerationModelOptions.filter(
    (option) =>
      (option.providerId === aiSelectedProvider || (providers.length === 1 && !aiSelectedProvider)) &&
      (!requiresVision || option.supportsVision),
  );

  useEffect(() => {
    if (themeGenerationModelOptions.length === 0) return;

    const firstProviderId = providers[0]?.id ?? "";
    if (!aiSelectedProvider || !providers.some((p) => p.id === aiSelectedProvider)) {
      setAiSelectedProvider(firstProviderId);
    }
  }, [themeGenerationModelOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (modelsForSelectedProvider.length === 0) return;

    if (
      !aiSelectedModel ||
      !modelsForSelectedProvider.some((model) => model.id === aiSelectedModel)
    ) {
      setAiSelectedModel(modelsForSelectedProvider[0]?.id ?? "");
    }
  }, [aiSelectedProvider, modelsForSelectedProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a ref to current images for cleanup without causing effect re-runs
  const aiImagesRef = useRef<ThemeImage[]>([]);
  useEffect(() => {
    aiImagesRef.current = aiImages;
  }, [aiImages]);

  // Cleanup images and reset state when dialog closes
  useEffect(() => {
    if (!isDialogOpen) {
      // Use ref to get current images to avoid dependency on aiImages
      const imagesToCleanup = aiImagesRef.current;
      if (imagesToCleanup.length > 0) {
        cleanupImages(imagesToCleanup);
        setAiImages([]);
      }
      setAiKeywords("");
      setAiGenerationMode("inspired");
      setAiSelectedProvider(providers[0]?.id ?? "");
      setAiSelectedModel(themeGenerationModelOptions[0]?.id ?? "");
      setInputSource("images");
      setWebsiteUrls([""]);
      setProjectPath("");
    }
  }, [isDialogOpen, cleanupImages, themeGenerationModelOptions]);

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const availableSlots = MAX_IMAGES - aiImages.length;
      if (availableSlots <= 0) {
        showError(t("aiGenerator.imagesSkipped_other", { count: MAX_IMAGES, skipped: 0 }));
        return;
      }

      const filesToProcess = Array.from(files).slice(0, availableSlots);
      const skippedCount = files.length - filesToProcess.length;

      if (skippedCount > 0) {
        showError(
          t("aiGenerator.imagesSkipped_other", { count: availableSlots, skipped: skippedCount }),
        );
      }

      setIsUploading(true);

      try {
        const newImages: ThemeImage[] = [];

        for (const file of filesToProcess) {
          // Validate file type
          if (!file.type.startsWith("image/")) {
            showError(t("aiGenerator.imageFilesOnly", { name: file.name }));
            continue;
          }

          // Validate file size (raw file size)
          if (file.size > MAX_FILE_SIZE) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
            showError(t("aiGenerator.fileTooLarge", { name: file.name, size: sizeMB }));
            continue;
          }

          try {
            // Read file as base64 for upload
            const base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error(t("aiGenerator.uploading")));
              reader.onload = () => {
                const base64 = reader.result as string;
                const data = base64.split(",")[1];
                if (!data) {
                  reject(new Error(t("aiGenerator.uploading")));
                  return;
                }
                resolve(data);
              };
              reader.readAsDataURL(file);
            });

            // Save to temp file via IPC
            const result = await ipc.template.saveThemeImage({
              data: base64Data,
              filename: file.name,
            });

            // Create blob URL for preview (much more memory efficient than base64 in DOM)
            const preview = URL.createObjectURL(file);

            newImages.push({
              path: result.path,
              preview,
            });
          } catch (err) {
            showError(
              t("aiGenerator.errorProcessingFile", {
                name: file.name,
                error: err instanceof Error ? err.message : "Unknown error",
              }),
            );
          }
        }

        if (newImages.length > 0) {
          // Check if dialog was closed while upload was in progress
          if (!isDialogOpenRef.current) {
            // Dialog closed - cleanup orphaned images immediately
            await cleanupImages(newImages);
            return;
          }

          setAiImages((prev) => {
            // Double-check limit in case of race conditions
            const remaining = MAX_IMAGES - prev.length;
            return [...prev, ...newImages.slice(0, remaining)];
          });
        }
      } finally {
        setIsUploading(false);
        // Reset input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [aiImages.length, cleanupImages],
  );

  const handleRemoveImage = useCallback(
    async (index: number) => {
      const imageToRemove = aiImages[index];
      if (imageToRemove) {
        // Cleanup the removed image - show errors since this is a user action
        await cleanupImages([imageToRemove], true);
      }
      setAiImages((prev) => prev.filter((_, i) => i !== index));
    },
    [aiImages, cleanupImages],
  );

  const handleBrowseProject = useCallback(async () => {
    setIsBrowsing(true);
    try {
      const result = await ipc.template.browseProjectFolder();
      if (result.path) setProjectPath(result.path);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to open folder browser");
    } finally {
      setIsBrowsing(false);
    }
  }, []);

  const handleGenerate = useCallback(() => {
    if (inputSource === "images") {
      if (aiImages.length === 0) {
        showError(t("aiGenerator.pleaseUploadImage"));
        return;
      }

      const selectedModelOption = themeGenerationModelOptions.find(
        (o) => o.id === aiSelectedModel,
      );
      if (selectedModelOption && !selectedModelOption.supportsVision) {
        showError(t("aiGenerator.modelNoVision", { model: selectedModelOption.label }));
        return;
      }

      generatePromptStream.start(
        {
          imagePaths: aiImages.map((img) => img.path),
          keywords: aiKeywords,
          generationMode: aiGenerationMode,
          model: aiSelectedModel,
        },
        {
          onEnd: (fullText) => {
            setAiGeneratedPrompt(extractThemeContent(fullText));
            toast.success("Theme prompt generated successfully");
          },
          onError: (error) => {
            showError(`Failed to generate theme: ${error}`);
          },
        },
      );
    } else if (inputSource === "url") {
      const validUrls = websiteUrls.map((u) => u.trim()).filter(Boolean);
      if (validUrls.length === 0) {
        showError(t("aiGenerator.pleaseEnterUrl"));
        return;
      }

      generateFromUrlStream.start(
        {
          urls: validUrls,
          keywords: aiKeywords,
          generationMode: aiGenerationMode,
          model: aiSelectedModel,
        },
        {
          onEnd: (fullText) => {
            setAiGeneratedPrompt(extractThemeContent(fullText));
            toast.success("Theme prompt generated from website");
          },
          onError: (error) => {
            showError(`Failed to generate theme: ${error}`);
          },
        },
      );
    } else {
      if (!projectPath.trim()) {
        showError(t("aiGenerator.pleaseSelectProject"));
        return;
      }

      generateFromProjectStream.start(
        {
          projectPath,
          keywords: aiKeywords,
          generationMode: aiGenerationMode,
          model: aiSelectedModel,
        },
        {
          onEnd: (fullText) => {
            setAiGeneratedPrompt(extractThemeContent(fullText));
            toast.success("Theme prompt generated from project");
          },
          onError: (error) => {
            showError(`Failed to generate theme: ${error}`);
          },
        },
      );
    }
  }, [
    inputSource,
    aiImages,
    websiteUrls,
    projectPath,
    aiKeywords,
    aiGenerationMode,
    aiSelectedModel,
    themeGenerationModelOptions,
    generatePromptStream,
    generateFromUrlStream,
    generateFromProjectStream,
    setAiGeneratedPrompt,
  ]);

  // Progress tracking for URL/project generation
  const validUrlCount = websiteUrls.filter((u) => u.trim()).length || 1;
  const crawlLabels =
    validUrlCount > 1
      ? Array.from({ length: validUrlCount }, (_, i) => t("aiGenerator.progressCrawlN", { n: i + 1 }))
      : [t("aiGenerator.progressCrawl")];

  const progressSteps =
    inputSource === "project"
      ? [t("aiGenerator.progressExplore"), t("aiGenerator.progressGenerate")]
      : [...crawlLabels, t("aiGenerator.progressAnalyze"), t("aiGenerator.progressGenerate")];
  const totalProgressSteps = progressSteps.length;

  const showProgress = isGenerating && (inputSource === "url" || inputSource === "project");

  let currentProgressStep = 0;
  if (showProgress) {
    if (streamingText) {
      currentProgressStep = totalProgressSteps - 1;
    } else if (inputSource === "project") {
      // While tool calls are happening, stay on step 0 (Explore)
      currentProgressStep = 0;
    } else if (statusMessage?.startsWith("Analyzing")) {
      currentProgressStep = validUrlCount;
    } else if (statusMessage?.startsWith("Crawling")) {
      const match = statusMessage.match(/URL (\d+) of/);
      currentProgressStep = match ? parseInt(match[1]) - 1 : 0;
    }
  }

  const progressPercent = showProgress
    ? Math.round(((currentProgressStep + 0.5) / totalProgressSteps) * 100)
    : 0;

  return (
    <div className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label htmlFor="ai-name">{t("aiGenerator.themeName")}</Label>
        <Input
          id="ai-name"
          placeholder={t("aiGenerator.themeNamePlaceholder")}
          value={aiName}
          onChange={(e) => setAiName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ai-description">{t("aiGenerator.descriptionOptional")}</Label>
        <Input
          id="ai-description"
          placeholder={t("aiGenerator.descriptionPlaceholder")}
          value={aiDescription}
          onChange={(e) => setAiDescription(e.target.value)}
        />
      </div>

      {/* Input Source Toggle */}
      <div className="space-y-3">
        <Label>{t("aiGenerator.referenceSource")}</Label>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setInputSource("images")}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              inputSource === "images"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <Upload className="h-5 w-5 mb-1" />
            <span className="font-medium text-xs">{t("aiGenerator.uploadImagesTitle")}</span>
            <span className="text-[10px] text-muted-foreground mt-1 leading-tight">
              {t("aiGenerator.uploadImagesDesc")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setInputSource("url")}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              inputSource === "url"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <Link className="h-5 w-5 mb-1" />
            <span className="font-medium text-xs">{t("aiGenerator.websiteUrlTitle")}</span>
            <span className="text-[10px] text-muted-foreground mt-1 leading-tight">
              {t("aiGenerator.websiteUrlDesc")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setInputSource("project")}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              inputSource === "project"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <FolderOpen className="h-5 w-5 mb-1" />
            <span className="font-medium text-xs">{t("aiGenerator.projectFolderTitle")}</span>
            <span className="text-[10px] text-muted-foreground mt-1 leading-tight">
              {t("aiGenerator.projectFolderDesc")}
            </span>
          </button>
        </div>
      </div>

      {/* Image Upload Section - only shown when inputSource is "images" */}
      {inputSource === "images" && (
        <div className="space-y-2">
          <Label>{t("aiGenerator.referenceImages")}</Label>
          <div
            className={`border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageUpload}
              disabled={isUploading}
            />
            {isUploading ? (
              <Loader2 className="h-8 w-8 mx-auto text-muted-foreground mb-2 animate-spin" />
            ) : (
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            )}
            <p className="text-sm text-muted-foreground">
              {isUploading ? t("aiGenerator.uploading") : t("aiGenerator.clickToUpload")}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {t("aiGenerator.uploadHint")}
            </p>
          </div>

          {/* Image counter */}
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {t("aiGenerator.imageCount", { current: aiImages.length, max: MAX_IMAGES })}
            {aiImages.length >= MAX_IMAGES && (
              <span className="text-destructive ml-2">{t("aiGenerator.maximumReached")}</span>
            )}
          </p>

          {/* Image Preview */}
          {aiImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {aiImages.map((img, index) => (
                <div key={img.path} className="relative group">
                  <img
                    src={img.preview}
                    alt={`Upload ${index + 1}`}
                    className="h-16 w-16 object-cover rounded-md border"
                  />
                  <button
                    onClick={() => handleRemoveImage(index)}
                    className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* URL Input Section - only shown when inputSource is "url" */}
      {inputSource === "url" && (
        <div className="space-y-2">
          <Label>{t("aiGenerator.websiteUrls")} <span className="text-muted-foreground font-normal">{t("aiGenerator.upTo3")}</span></Label>
          <div className="space-y-2">
            {websiteUrls.map((url, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  type="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => {
                    const updated = [...websiteUrls];
                    updated[index] = e.target.value;
                    setWebsiteUrls(updated);
                  }}
                  disabled={isGenerating}
                />
                {websiteUrls.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setWebsiteUrls(websiteUrls.filter((_, i) => i !== index))
                    }
                    disabled={isGenerating}
                    className="flex-shrink-0 rounded-md border p-2 text-muted-foreground hover:text-destructive hover:border-destructive transition-colors disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {websiteUrls.length < 3 && (
            <button
              type="button"
              onClick={() => setWebsiteUrls([...websiteUrls, ""])}
              disabled={isGenerating}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {t("aiGenerator.addAnotherUrl")}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            {t("aiGenerator.multipleUrlsHint")}
          </p>
        </div>
      )}

      {/* Project Folder Section - only shown when inputSource is "project" */}
      {inputSource === "project" && (
        <div className="space-y-2">
          <Label>{t("aiGenerator.projectFolder")}</Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={projectPath}
              placeholder={t("aiGenerator.projectFolderPlaceholder")}
              className="flex-1 font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleBrowseProject}
              disabled={isBrowsing || isGenerating}
            >
              {isBrowsing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderOpen className="h-4 w-4" />
              )}
              <span className="ml-2">{t("aiGenerator.browse")}</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("aiGenerator.projectFolderHint")}
          </p>
        </div>
      )}

      {/* Keywords Input */}
      <div className="space-y-2">
        <Label htmlFor="ai-keywords">{t("aiGenerator.keywordsOptional")}</Label>
        <Input
          id="ai-keywords"
          placeholder={t("aiGenerator.keywordsPlaceholder")}
          value={aiKeywords}
          onChange={(e) => setAiKeywords(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t("aiGenerator.keywordsHint")}
        </p>
      </div>

      {/* Generation Mode Selection */}
      <div className="space-y-3">
        <Label>{t("aiGenerator.generationMode")}</Label>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setAiGenerationMode("inspired")}
            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
              aiGenerationMode === "inspired"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <span className="font-medium">{t("aiGenerator.inspired")}</span>
            <span className="text-xs text-muted-foreground mt-1">
              {t("aiGenerator.inspiredDesc")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAiGenerationMode("high-fidelity")}
            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
              aiGenerationMode === "high-fidelity"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <span className="font-medium">{t("aiGenerator.highFidelity")}</span>
            <span className="text-xs text-muted-foreground mt-1">
              {t("aiGenerator.highFidelityDesc")}
            </span>
          </button>
        </div>
      </div>

      {/* Provider & Model Selection */}
      <div className="space-y-3">
        {isLoadingThemeGenerationModelOptions ? (
          <div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("aiGenerator.loadingModels")}
          </div>
        ) : themeGenerationModelOptions.length === 0 ? (
          <div className="text-center py-3 text-sm text-muted-foreground">
            {t("aiGenerator.noModels")}
          </div>
        ) : requiresVision && providers.length === 0 ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t("aiGenerator.noVisionModels")}
          </div>
        ) : (
          <>
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label>{t("aiGenerator.provider")}</Label>
              <div
                className="flex flex-wrap gap-2"
                role="radiogroup"
                aria-label="Provider Selection"
              >
                {providers.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    role="radio"
                    aria-checked={aiSelectedProvider === provider.id}
                    onClick={() => setAiSelectedProvider(provider.id)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      aiSelectedProvider === provider.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    {provider.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Model Selection */}
            <div className="space-y-2">
              <Label>{t("aiGenerator.model")}</Label>
              <div
                className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3"
                role="radiogroup"
                aria-label="Model Selection"
              >
                {modelsForSelectedProvider.map((modelOption) => (
                  <button
                    key={modelOption.id}
                    type="button"
                    role="radio"
                    aria-checked={aiSelectedModel === modelOption.id}
                    onClick={() => setAiSelectedModel(modelOption.id)}
                    className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
                      aiSelectedModel === modelOption.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="font-medium text-sm">
                      {modelOption.label.split(" / ")[1] ?? modelOption.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Generate Button */}
      <Button
        onClick={handleGenerate}
        disabled={
          isLoadingThemeGenerationModelOptions ||
          !aiSelectedModel ||
          isGenerating ||
          (inputSource === "images" && aiImages.length === 0) ||
          (inputSource === "url" && !websiteUrls.some((u) => u.trim())) ||
          (inputSource === "project" && !projectPath.trim())
        }
        variant="secondary"
        className="w-full"
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {statusMessage ||
              (inputSource === "url"
                ? t("aiGenerator.generatingFromWebsite")
                : inputSource === "project"
                  ? t("aiGenerator.generatingFromProject")
                  : t("aiGenerator.generatingPrompt"))}
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            {t("aiGenerator.generateThemePrompt")}
          </>
        )}
      </Button>

      {/* URL / Project Generation Progress Tracker */}
      {showProgress && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          {/* Step indicators */}
          <div className="flex items-center">
            {progressSteps.map((label, i) => {
              const isDone = i < currentProgressStep;
              const isCurrent = i === currentProgressStep;
              return (
                <Fragment key={i}>
                  <div
                    className={`flex flex-col items-center gap-1 ${
                      isDone
                        ? "text-primary"
                        : isCurrent
                          ? "text-foreground"
                          : "text-muted-foreground/40"
                    }`}
                  >
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                        isDone
                          ? "bg-primary text-primary-foreground"
                          : isCurrent
                            ? "border-2 border-foreground bg-foreground/10"
                            : "border border-muted-foreground/30"
                      }`}
                    >
                      {isDone ? (
                        <Check className="h-3 w-3" />
                      ) : isCurrent ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span className="text-[10px] font-semibold">{i + 1}</span>
                      )}
                    </div>
                    <span className="text-[10px] leading-tight text-center w-12 truncate">
                      {label}
                    </span>
                  </div>
                  {i < progressSteps.length - 1 && (
                    <div
                      className={`flex-1 h-px mb-4 transition-colors duration-500 ${
                        isDone ? "bg-primary" : "bg-muted-foreground/20"
                      }`}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Status label */}
          <p className="text-xs text-muted-foreground text-center">
            {statusMessage ||
              (streamingText ? t("aiGenerator.generatingThemePrompt") : t("aiGenerator.starting"))}
          </p>
        </div>
      )}

      {/* Generated Prompt Display */}
      <div className="space-y-2">
        <Label htmlFor="ai-prompt">{t("aiGenerator.generatedPrompt")}</Label>
        {isGenerating && streamingText ? (
          <Textarea
            id="ai-prompt"
            className="min-h-[200px] font-mono text-sm"
            value={streamingText}
            readOnly
          />
        ) : aiGeneratedPrompt ? (
          <Textarea
            id="ai-prompt"
            className="min-h-[200px] font-mono text-sm"
            value={aiGeneratedPrompt}
            onChange={(e) => setAiGeneratedPrompt(e.target.value)}
            placeholder={t("aiGenerator.generatedPromptPlaceholder")}
          />
        ) : (
          <div className="min-h-[100px] border rounded-md p-4 flex items-center justify-center text-muted-foreground text-sm text-center">
            {t("aiGenerator.noPromptYet")}{" "}
            {inputSource === "images"
              ? t("aiGenerator.noPromptImagesHint")
              : inputSource === "project"
                ? t("aiGenerator.noPromptProjectHint")
                : t("aiGenerator.noPromptUrlHint")}
          </div>
        )}
      </div>

      {/* Save Button - only show when prompt is generated */}
      {aiGeneratedPrompt && (
        <Button
          onClick={onSave}
          disabled={isSaving || !aiName.trim()}
          className="w-full"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("aiGenerator.saving")}
            </>
          ) : (
            t("customTheme.saveTheme")
          )}
        </Button>
      )}
    </div>
  );
}
