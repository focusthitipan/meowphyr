import { Palette, FileText, BookOpen, Image, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type FilterType = "all" | "themes" | "prompts" | "skills" | "media";

export function LibraryFilterTabs({
  active,
  onChange,
}: {
  active: FilterType;
  onChange: (f: FilterType) => void;
}) {
  const { t } = useTranslation("home");

  const FILTER_OPTIONS: {
    key: FilterType;
    label: string;
    icon: typeof BookOpen;
  }[] = [
    { key: "all", label: t("library.filterAll"), icon: BookOpen },
    { key: "themes", label: t("library.filterThemes"), icon: Palette },
    { key: "prompts", label: t("library.filterPrompts"), icon: FileText },
    { key: "skills", label: t("library.filterSkills"), icon: Zap },
    { key: "media", label: t("library.filterMedia"), icon: Image },
  ];

  return (
    <div className="flex gap-2 mb-6" role="group" aria-label="Library filters">
      {FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={active === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            active === opt.key
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
        >
          <opt.icon className="h-3.5 w-3.5" />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
