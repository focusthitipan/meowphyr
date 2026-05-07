import type { FC, ReactNode } from "react";
import { useState } from "react";
import { Globe } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";
import { CustomTagState } from "./stateTypes";

interface DyadWebFetchProps {
  children?: ReactNode;
  node?: {
    properties: {
      url?: string;
      state?: CustomTagState;
    };
  };
}

export const DyadWebFetch: FC<DyadWebFetchProps> = ({ children, node }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const state = node?.properties?.state as CustomTagState;
  const url = node?.properties?.url || (typeof children === "string" && !children.includes("\n") ? children : "");
  const inProgress = state === "pending";
  const hasContent = !!children && children !== url;

  return (
    <DyadCard
      state={state}
      accentColor="blue"
      isExpanded={isExpanded}
      onClick={hasContent ? () => setIsExpanded(!isExpanded) : undefined}
    >
      <DyadCardHeader icon={<Globe size={15} />} accentColor="blue">
        <DyadBadge color="blue">Web Fetch</DyadBadge>
        {!isExpanded && url && (
          <span className="text-sm text-muted-foreground italic truncate">
            {url}
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Fetching..." />
        )}
        {hasContent && (
          <div className="ml-auto">
            <DyadExpandIcon isExpanded={isExpanded} />
          </div>
        )}
      </DyadCardHeader>
      {hasContent && (
        <DyadCardContent isExpanded={isExpanded}>
          <div className="text-sm text-muted-foreground space-y-2">
            {url && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  URL:
                </span>
                <div className="italic mt-0.5 text-foreground break-all">{url}</div>
              </div>
            )}
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Content:
              </span>
              <div className="mt-0.5 text-foreground whitespace-pre-wrap text-xs max-h-64 overflow-y-auto">
                {children}
              </div>
            </div>
          </div>
        </DyadCardContent>
      )}
    </DyadCard>
  );
};
