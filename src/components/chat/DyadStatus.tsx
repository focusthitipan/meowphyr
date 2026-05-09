import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import {
  DyadCard,
  DyadCardHeader,
  DyadExpandIcon,
  DyadFinishedIcon,
  DyadCardContent,
} from "./DyadCardPrimitives";
import { CircleX, Loader2 } from "lucide-react";

interface DyadStatusProps {
  node: {
    properties: {
      title?: string;
      state?: CustomTagState;
      activity?: string;
    };
  };
  children?: React.ReactNode;
  renderContent?: (text: string) => React.ReactNode;
}

export function DyadStatus({ node, children, renderContent }: DyadStatusProps) {
  const { title = "Processing...", state, activity } = node.properties;
  const isInProgress = state === "pending";
  const isAborted = state === "aborted";
  const isFinished = state === "finished";
  const content = typeof children === "string" ? children : "";
  const [isContentVisible, setIsContentVisible] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom while streaming and expanded
  useEffect(() => {
    if (isInProgress && isContentVisible && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isInProgress, isContentVisible]);

  // Pick accent color based on state
  const accentColor = isAborted ? "red" : isInProgress ? "amber" : "green";

  // Pick the left icon based on state
  const icon = isInProgress ? (
    <Loader2 size={15} className="animate-spin" />
  ) : isAborted ? (
    <CircleX size={15} />
  ) : (
    <DyadFinishedIcon />
  );

  return (
    <DyadCard
      state={state}
      accentColor={accentColor}
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      <DyadCardHeader icon={icon} accentColor={accentColor}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`font-medium text-sm truncate ${
                isInProgress
                  ? "bg-gradient-to-r from-foreground via-muted-foreground to-foreground bg-[length:200%_100%] animate-[shimmer_2s_ease-in-out_infinite] bg-clip-text text-transparent"
                  : isFinished
                    ? "text-foreground"
                    : "text-muted-foreground"
              }`}
            >
              {title}
            </span>
            <div className="ml-auto shrink-0">
              <DyadExpandIcon isExpanded={isContentVisible} />
            </div>
          </div>
          {isInProgress && activity && (
            <p className="text-xs text-muted-foreground truncate">{activity}</p>
          )}
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isContentVisible}>
        {content && (
          <div
            ref={scrollRef}
            className="p-3 max-h-60 overflow-y-auto bg-muted/20 rounded-lg cursor-text text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground">
              {renderContent ? (
                renderContent(content)
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ code: CodeHighlight }}
                >
                  {content
                    .split("\n")
                    .map((line) => (line.trimEnd() ? line + "  " : ""))
                    .join("\n")}
                </ReactMarkdown>
              )}
            </div>
          </div>
        )}
      </DyadCardContent>
    </DyadCard>
  );
}
