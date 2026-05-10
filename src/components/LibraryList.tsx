import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, Palette, FileText, Image, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

export function LibraryList({ show }: { show: boolean }) {
  const { t } = useTranslation("home");
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  const LIBRARY_SECTIONS = [
    { id: "all", label: t("library.filterAll"), to: "/library", icon: BookOpen },
    { id: "themes", label: t("library.filterThemes"), to: "/library/themes", icon: Palette },
    { id: "prompts", label: t("library.filterPrompts"), to: "/library/prompts", icon: FileText },
    { id: "skills", label: t("library.filterSkills"), to: "/library/skills", icon: Zap },
    { id: "media", label: t("library.filterMedia"), to: "/library/media", icon: Image },
  ];

  if (!show) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-4">
        <h2 className="text-lg font-semibold tracking-tight">{t("library.title")}</h2>
      </div>
      <ScrollArea className="flex-grow">
        <div className="space-y-1 p-4 pt-0">
          {LIBRARY_SECTIONS.map((section) => {
            const fullLocation = pathname + routerState.location.searchStr;
            const isActive =
              section.to === fullLocation ||
              section.to === pathname ||
              (section.to !== "/" &&
                section.to !== "/library" &&
                !section.to.includes("?") &&
                pathname.startsWith(section.to));

            return (
              <Link
                key={section.id}
                to={section.to}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "hover:bg-sidebar-accent",
                )}
              >
                <section.icon className="h-4 w-4" />
                {section.label}
              </Link>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
