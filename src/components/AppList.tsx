import { useNavigate } from "@tanstack/react-router";
import { PlusCircle, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useOpenApp } from "@/hooks/useOpenApp";
import { useMemo, useState } from "react";
import { AppSearchDialog } from "./AppSearchDialog";
import { AppItem } from "./appItem";
import { RenameAppDialog } from "./RenameAppDialog";
import { DeleteAppDialog } from "./DeleteAppDialog";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import type { ListedApp } from "@/ipc/types/app";

export function AppList({ show }: { show?: boolean }) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const openApp = useOpenApp();
  const { apps, loading, error, refreshApps } = useLoadApps();
  // search dialog state
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);

  // Rename dialog state
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameApp, setRenameApp] = useState<ListedApp | null>(null);

  // Delete dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteApp, setDeleteApp] = useState<ListedApp | null>(null);

  const allApps = useMemo(
    () =>
      apps.map((a) => ({
        id: a.id,
        name: a.name,
        createdAt: a.createdAt,
        matchedChatTitle: null,
        matchedChatMessage: null,
      })),
    [apps],
  );

  const favoriteApps = useMemo(
    () => apps.filter((app) => app.isFavorite),
    [apps],
  );

  const nonFavoriteApps = useMemo(
    () => apps.filter((app) => !app.isFavorite),
    [apps],
  );

  if (!show) {
    return null;
  }

  const handleAppClick = (id: number) => {
    setIsSearchDialogOpen(false);
    openApp(id);
  };

  const handleNewApp = () => {
    navigate({ to: "/" });
    // We'll eventually need a create app workflow
  };

  const handleRenameClick = (app: ListedApp) => {
    setRenameApp(app);
    setIsRenameDialogOpen(true);
  };

  const handleDeleteClick = (app: ListedApp) => {
    setDeleteApp(app);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteApp) return;
    try {
      await ipc.app.deleteApp({ appId: deleteApp.id });
      showSuccess("App deleted successfully");

      if (selectedAppId === deleteApp.id) {
        setSelectedAppId(null);
        navigate({ to: "/" });
      }

      await refreshApps();
    } catch (error) {
      showError(`Failed to delete app: ${(error as any).toString()}`);
    } finally {
      setIsDeleteDialogOpen(false);
      setDeleteApp(null);
    }
  };

  return (
    <>
      <SidebarGroup
        className="overflow-y-auto h-[calc(100vh-112px)]"
        data-testid="app-list-container"
      >
        <SidebarGroupLabel>{t("appList.yourApps")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col space-y-2">
            <Button
              onClick={handleNewApp}
              variant="outline"
              className="flex items-center justify-start gap-2 mx-2 py-2"
            >
              <PlusCircle size={16} />
              <span>{t("appList.newApp")}</span>
            </Button>
            <Button
              onClick={() => setIsSearchDialogOpen(!isSearchDialogOpen)}
              variant="outline"
              className="flex items-center justify-start gap-2 mx-2 py-3"
              data-testid="search-apps-button"
            >
              <Search size={16} />
              <span>{t("appList.searchApps")}</span>
            </Button>

            {loading ? (
              <div className="py-2 px-4 text-sm text-gray-500">
                {t("appList.loadingApps")}
              </div>
            ) : error ? (
              <div className="py-2 px-4 text-sm text-red-500">
                {t("appList.errorLoadingApps")}
              </div>
            ) : apps.length === 0 ? (
              <div className="py-2 px-4 text-sm text-gray-500">
                {t("appList.noAppsFound")}
              </div>
            ) : (
              <SidebarMenu className="space-y-1" data-testid="app-list">
                <SidebarGroupLabel>{t("appList.favoriteApps")}</SidebarGroupLabel>
                {favoriteApps.length === 0 ? (
                  <div className="px-4 text-xs text-gray-500 italic">
                    {t("appList.starAppHint")}
                  </div>
                ) : (
                  favoriteApps.map((app) => (
                    <AppItem
                      key={app.id}
                      app={app}
                      handleAppClick={handleAppClick}
                      selectedAppId={selectedAppId}
                      onRenameClick={handleRenameClick}
                      onDeleteClick={handleDeleteClick}
                    />
                  ))
                )}
                <SidebarGroupLabel>{t("appList.otherApps")}</SidebarGroupLabel>
                {nonFavoriteApps.map((app) => (
                  <AppItem
                    key={app.id}
                    app={app}
                    handleAppClick={handleAppClick}
                    selectedAppId={selectedAppId}
                    onRenameClick={handleRenameClick}
                    onDeleteClick={handleDeleteClick}
                  />
                ))}
              </SidebarMenu>
            )}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <AppSearchDialog
        open={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        onSelectApp={handleAppClick}
        allApps={allApps}
      />

      {renameApp && (
        <RenameAppDialog
          appId={renameApp.id}
          currentName={renameApp.name}
          currentPath={renameApp.path}
          isOpen={isRenameDialogOpen}
          onOpenChange={(open) => {
            setIsRenameDialogOpen(open);
            if (!open) setRenameApp(null);
          }}
          onRename={refreshApps}
        />
      )}

      <DeleteAppDialog
        isOpen={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteApp(null);
        }}
        onConfirmDelete={handleConfirmDelete}
        appName={deleteApp?.name}
      />
    </>
  );
}
