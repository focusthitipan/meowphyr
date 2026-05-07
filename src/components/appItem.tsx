import { formatDistanceToNow } from "date-fns";
import { Star, MoreVertical, Edit3, Trash2 } from "lucide-react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ListedApp } from "@/ipc/types/app";

type AppItemProps = {
  app: ListedApp;
  handleAppClick: (id: number) => void;
  selectedAppId: number | null;
  onRenameClick?: (app: ListedApp) => void;
  onDeleteClick?: (app: ListedApp) => void;
};

export function AppItem({
  app,
  handleAppClick,
  selectedAppId,
  onRenameClick,
  onDeleteClick,
}: AppItemProps) {
  const isSelected = selectedAppId === app.id;

  return (
    <SidebarMenuItem className="mb-1 relative">
      <div className="flex w-[175px] items-center" title={app.name}>
        <Button
          variant="ghost"
          onClick={() => handleAppClick(app.id)}
          className={`justify-start w-full text-left py-3 pr-1 hover:bg-sidebar-accent/80 ${
            isSelected ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
          }`}
          data-testid={`app-list-item-${app.name}`}
        >
          <div className="flex flex-col w-4/5">
            <div className="flex items-center gap-1">
              <span className="truncate">{app.name}</span>
              {app.isFavorite && (
                <Star
                  size={12}
                  className="fill-[#6c55dc] text-[#6c55dc] flex-shrink-0"
                />
              )}
            </div>
            <span className="text-xs text-gray-500">
              {formatDistanceToNow(new Date(app.createdAt), {
                addSuffix: true,
              })}
            </span>
          </div>
        </Button>

        <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              className={buttonVariants({
                variant: "ghost",
                size: "icon",
                className:
                  "ml-1 opacity-0 group-hover/menu-item:opacity-100 [&[aria-expanded=true]]:opacity-100",
              })}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="space-y-1 p-2">
              <DropdownMenuItem
                onClick={() => onRenameClick?.(app)}
                className="px-3 py-2"
              >
                <Edit3 className="mr-2 h-4 w-4" />
                <span>Rename App</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDeleteClick?.(app)}
                className="px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 focus:bg-red-50 dark:focus:bg-red-950/50"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete App</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
              </div>
    </SidebarMenuItem>
  );
}
