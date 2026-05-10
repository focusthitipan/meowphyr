import { useState, useMemo } from "react";
import { usePrompts } from "@/hooks/usePrompts";
import { useSkills } from "@/hooks/useSkills";
import { useCustomThemes } from "@/hooks/useCustomThemes";
import { useAppMediaFiles } from "@/hooks/useAppMediaFiles";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useAddPromptDeepLink } from "@/hooks/useAddPromptDeepLink";
import { BookOpen, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CreateOrEditPromptDialog } from "@/components/CreatePromptDialog";
import { CreateOrEditSkillDialog } from "@/components/CreateOrEditSkillDialog";
import { CustomThemeDialog } from "@/components/CustomThemeDialog";
import { NewLibraryItemMenu } from "@/components/NewLibraryItemMenu";
import { LibraryCard, type LibraryItem } from "@/components/LibraryCard";
import { LibrarySearchBar } from "@/components/LibrarySearchBar";
import {
  LibraryFilterTabs,
  type FilterType,
} from "@/components/LibraryFilterTabs";
import { DyadAppMediaFolder } from "@/components/DyadAppMediaFolder";

import { filterMediaAppsByQuery } from "@/lib/mediaUtils";
// ---------------------------------------------------------------------------
// Main Library Homepage
// ---------------------------------------------------------------------------

export default function LibraryHomePage() {
  const { t } = useTranslation("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>(() => {
    const params = new URLSearchParams(window.location.search);
    const filter = params.get("filter");
    if (
      filter === "themes" ||
      filter === "prompts" ||
      filter === "skills" ||
      filter === "media"
    )
      return filter;
    return "all";
  });

  const {
    prompts,
    isLoading: promptsLoading,
    createPrompt,
    updatePrompt,
    deletePrompt,
  } = usePrompts();
  const { skills, isLoading: skillsLoading, createSkill, updateSkill, deleteSkill } = useSkills();
  const { customThemes, isLoading: themesLoading } = useCustomThemes();
  const {
    mediaApps,
    isLoading: mediaLoading,
    renameMediaFile,
    deleteMediaFile,
    moveMediaFile,
    isMutatingMedia,
  } = useAppMediaFiles();
  const { apps: allApps } = useLoadApps();
  const [createThemeDialogOpen, setCreateThemeDialogOpen] = useState(false);
  const [createSkillDialogOpen, setCreateSkillDialogOpen] = useState(false);
  // Deep link support
  const {
    prefillData,
    dialogOpen: promptDialogOpen,
    handleDialogClose: handlePromptDialogClose,
    setDialogOpen: setPromptDialogOpen,
  } = useAddPromptDeepLink();

  const isLoading =
    promptsLoading || skillsLoading || themesLoading || mediaLoading;

  const filteredItems = useMemo(() => {
    if (activeFilter === "media") return [];

    let items: LibraryItem[] = [];

    if (activeFilter === "all" || activeFilter === "themes") {
      items.push(
        ...customThemes.map((t) => ({ type: "theme" as const, data: t })),
      );
    }
    if (activeFilter === "all" || activeFilter === "prompts") {
      items.push(...prompts.map((p) => ({ type: "prompt" as const, data: p })));
    }
    if (activeFilter === "all" || activeFilter === "skills") {
      // Only show file-based (global) skills in the library — DB skills are
      // already visible under "Prompts" as editable entries.
      items.push(
        ...skills
          .filter((s) => s.source === "global")
          .map((s) => ({ type: "skill" as const, data: s })),
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((item) => {
        if (item.type === "theme") {
          return (
            item.data.name.toLowerCase().includes(q) ||
            (item.data.description?.toLowerCase().includes(q) ?? false) ||
            item.data.prompt.toLowerCase().includes(q)
          );
        }
        return (
          item.data.title.toLowerCase().includes(q) ||
          (item.data.description?.toLowerCase().includes(q) ?? false) ||
          item.data.content.toLowerCase().includes(q)
        );
      });
    }

    // Sort: themes and prompts by updatedAt desc, file skills (no updatedAt) last
    items.sort((a, b) => {
      if (a.type === "skill" && b.type !== "skill") return 1;
      if (a.type !== "skill" && b.type === "skill") return -1;
      if (a.type === "skill" || b.type === "skill") return 0;
      const dateA =
        a.data.updatedAt instanceof Date
          ? a.data.updatedAt
          : new Date(a.data.updatedAt);
      const dateB =
        b.data.updatedAt instanceof Date
          ? b.data.updatedAt
          : new Date(b.data.updatedAt);
      return dateB.getTime() - dateA.getTime();
    });

    return items;
  }, [customThemes, prompts, skills, activeFilter, searchQuery]);

  const filteredMediaApps = useMemo(() => {
    if (
      activeFilter === "themes" ||
      activeFilter === "prompts" ||
      activeFilter === "skills"
    )
      return [];

    return filterMediaAppsByQuery(mediaApps, searchQuery);
  }, [mediaApps, activeFilter, searchQuery]);

  const hasNoResults =
    filteredItems.length === 0 && filteredMediaApps.length === 0;

  return (
    <div className="min-h-screen w-full">
      <div className="px-8 py-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">
              <BookOpen className="inline-block h-8 w-8 mr-2" />
              {t("library.title")}
            </h1>
            <NewLibraryItemMenu
                onNewPrompt={() => setPromptDialogOpen(true)}
                onNewTheme={() => setCreateThemeDialogOpen(true)}
                onNewSkill={() => setCreateSkillDialogOpen(true)}
              />
          </div>

          {/* Dialogs (controlled externally) */}
          <CreateOrEditPromptDialog
            mode="create"
            onCreatePrompt={createPrompt}
            prefillData={prefillData}
            isOpen={promptDialogOpen}
            onOpenChange={handlePromptDialogClose}
            trigger={<span />}
          />
          <CreateOrEditSkillDialog
            mode="create"
            onCreateSkill={createSkill}
            isOpen={createSkillDialogOpen}
            onOpenChange={setCreateSkillDialogOpen}
          />

          {/* Search Bar */}
          <LibrarySearchBar value={searchQuery} onChange={setSearchQuery} />

          {/* Filter Tabs */}
          <LibraryFilterTabs active={activeFilter} onChange={setActiveFilter} />

          {/* Grid */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : hasNoResults ? (
            <div className="text-muted-foreground text-center py-12">
              {searchQuery
                ? t("library.noResults")
                : activeFilter === "media"
                  ? t("library.noMedia")
                  : activeFilter === "themes"
                    ? t("library.noThemes")
                    : activeFilter === "prompts"
                    ? t("library.noPrompts")
                    : activeFilter === "skills"
                      ? t("library.noSkills")
                      : t("library.noItems")}
            </div>
          ) : (
            <div
              data-testid="library-grid"
              className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4"
            >
              {filteredItems.map((item) => (
                <LibraryCard
                  key={`${item.type}-${item.type === "skill" ? item.data.slug : item.data.id}`}
                  item={item}
                  onUpdatePrompt={updatePrompt}
                  onDeletePrompt={deletePrompt}
                  onUpdateSkill={updateSkill}
                  onDeleteSkill={(slug) => deleteSkill({ slug })}
                />
              ))}
              {filteredMediaApps.map((app) => (
                <DyadAppMediaFolder
                  key={`media-${app.appId}`}
                  appId={app.appId}
                  appPath={app.appPath}
                  appName={app.appName}
                  files={app.files}
                  allApps={allApps}
                  onRenameMediaFile={renameMediaFile}
                  onDeleteMediaFile={deleteMediaFile}
                  onMoveMediaFile={moveMediaFile}
                  isMutatingMedia={isMutatingMedia}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}
        </div>

        <CustomThemeDialog
          open={createThemeDialogOpen}
          onOpenChange={setCreateThemeDialogOpen}
        />

      </div>
    </div>
  );
}
