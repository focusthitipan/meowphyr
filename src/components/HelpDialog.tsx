import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  BookOpenIcon,
  BugIcon,
} from "lucide-react";
import { ipc } from "@/ipc/types";
import {
  type ReactNode,
  useState,
  useEffect,
  useRef,
} from "react";
import { type SystemDebugInfo } from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { BugScreenshotDialog } from "./BugScreenshotDialog";
import { type UserSettings } from "@/lib/schemas";
import { motion, AnimatePresence } from "framer-motion";

// =============================================================================
// Animation constants
// =============================================================================

type DialogScreen = "main" | "review" | "upload-complete";

const SCREEN_ORDER: DialogScreen[] = ["main", "review", "upload-complete"];

const screenVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction < 0 ? 80 : -80,
    opacity: 0,
  }),
};

const screenTransition = {
  x: { type: "spring" as const, stiffness: 400, damping: 35 },
  opacity: { duration: 0.15 },
};

// =============================================================================
// GitHub issue helpers (shared between Report a Bug & Upload Chat Session)
// =============================================================================

const GITHUB_ISSUES_BASE =
  "https://github.com/dyad-sh/dyad/issues/new" as const;

function formatSettingsLines(settings: UserSettings | null): string {
  if (!settings) return "Settings not available";
  return [
    `- Selected Model: ${settings.selectedModel?.provider}:${settings.selectedModel?.name}`,
    `- Chat Mode: ${settings.selectedChatMode ?? "default"}`,
    `- Auto Approve Changes: ${settings.autoApproveChanges ?? "n/a"}`,
    `- Meowphyr Pro Enabled: ${settings.enableDyadPro ?? "n/a"}`,
    `- Thinking Budget: ${settings.thinkingBudget ?? "n/a"}`,
    `- Runtime Mode: ${settings.runtimeMode2 ?? "n/a"}`,
    `- Release Channel: ${settings.releaseChannel ?? "n/a"}`,
    `- Auto Fix Problems: ${settings.enableAutoFixProblems ?? "n/a"}`,
    `- Native Git: ${settings.enableNativeGit ?? "n/a"}`,
  ].join("\n");
}

function formatSystemInfoSection(debugInfo: SystemDebugInfo): string {
  return `## System Information
- Meowphyr Version: ${debugInfo.dyadVersion}
- Platform: ${debugInfo.platform}
- Architecture: ${debugInfo.architecture}
- Node Version: ${debugInfo.nodeVersion || "n/a"}
- PNPM Version: ${debugInfo.pnpmVersion || "n/a"}
- Node Path: ${debugInfo.nodePath || "n/a"}
- Telemetry ID: ${debugInfo.telemetryId || "n/a"}
- Model: ${debugInfo.selectedLanguageModel || "n/a"}`;
}

function formatLogsSection(debugInfo: SystemDebugInfo): string {
  return `## Logs
\`\`\`
${debugInfo.logs.slice(-3_500) || "No logs available"}
\`\`\``;
}

function openGitHubIssue(params: {
  title: string;
  labels: string[];
  body: string;
}) {
  const labels = [...params.labels];
  const qs = new URLSearchParams({
    title: params.title,
    labels: labels.join(","),
    body: params.body,
  });
  ipc.system.openExternalUrl(`${GITHUB_ISSUES_BASE}?${qs.toString()}`);
}

// =============================================================================
// Reusable sub-components
// =============================================================================

/** Animated wrapper applied to every dialog screen. */
function AnimatedScreen({
  screenKey,
  direction,
  skipInitial,
  className,
  children,
}: {
  screenKey: string;
  direction: number;
  skipInitial?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      key={screenKey}
      custom={direction}
      variants={screenVariants}
      initial={skipInitial ? false : "enter"}
      animate="center"
      exit="exit"
      transition={screenTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
}



// =============================================================================
// Main component
// =============================================================================

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpDialog({ isOpen, onClose }: HelpDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [screen, setScreen] = useState<DialogScreen>("main");
  const [direction, setDirection] = useState(0);
  const [isBugScreenshotOpen, setIsBugScreenshotOpen] = useState(false);
  const hasNavigated = useRef(false);
  const { settings } = useSettings();
  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const resetDialogState = () => {
    setIsLoading(false);
    setScreen("main");
    setDirection(0);
    hasNavigated.current = false;
  };

  useEffect(() => {
    if (!isOpen) resetDialogState();
  }, [isOpen]);

  const handleClose = () => onClose();

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleReportBug = async () => {
    setIsLoading(true);
    try {
      const debugInfo = await ipc.system.getSystemDebugInfo();
      const body = `\
<!-- Please fill in all fields in English -->

## Bug Description (required)
<!-- Please describe the issue you're experiencing and how to reproduce it -->

## Screenshot (recommended)
<!-- Screenshot of the bug -->

${formatSystemInfoSection(debugInfo)}

## Settings
${formatSettingsLines(settings)}

${formatLogsSection(debugInfo)}
`;
      openGitHubIssue({
        title: "[bug] <WRITE TITLE HERE>",
        labels: ["bug"],
        body,
      });
    } catch (error) {
      console.error("Failed to prepare bug report:", error);
      ipc.system.openExternalUrl(GITHUB_ISSUES_BASE);
    } finally {
      setIsLoading(false);
    }
  };



  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  const renderMainScreen = () => (
    <AnimatedScreen
      screenKey="main"
      direction={direction}
      skipInitial={!hasNavigated.current}
    >
      <DialogHeader>
        <DialogTitle>Need help with Meowphyr?</DialogTitle>
      </DialogHeader>
      <DialogDescription>
        If you need help or want to report an issue, here are some options:
      </DialogDescription>
      <div className="flex flex-col w-full mt-4 space-y-5">
        {/* Self-service help */}
        <Button
          variant="outline"
          onClick={() =>
            ipc.system.openExternalUrl("https://www.dyad.sh/docs")
          }
          className="w-full py-6 bg-(--background-lightest)"
        >
          <BookOpenIcon className="mr-2 h-5 w-5" /> Open Docs
        </Button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Report an issue
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Report options */}
        <div className="grid grid-cols-1 gap-3">
          {/* Report a Bug */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <BugIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Non-AI issues</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Includes error logs to troubleshoot non-AI issues with Meowphyr (UI
              bugs, crashes, setup problems, etc.).
            </p>
            <Button
              variant="outline"
              onClick={() => {
                handleClose();
                setIsBugScreenshotOpen(true);
              }}
              disabled={isLoading}
              className="w-full bg-(--background-lightest)"
            >
              <BugIcon className="mr-2 h-4 w-4" />{" "}
              {isLoading ? "Preparing Report..." : "Report a Bug"}
            </Button>
          </div>
        </div>
      </div>
    </AnimatedScreen>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent>
          <AnimatePresence mode="wait" custom={direction}>
            {screen === "main" && renderMainScreen()}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
      <BugScreenshotDialog
        isOpen={isBugScreenshotOpen}
        onClose={() => setIsBugScreenshotOpen(false)}
        handleReportBug={handleReportBug}
        isLoading={isLoading}
      />
    </>
  );
}
