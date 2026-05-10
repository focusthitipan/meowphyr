import {
  Home,
  Inbox,
  Settings,
  HelpCircle,
  Store,
  BookOpen,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useSidebar } from "@/components/ui/sidebar"; // import useSidebar hook
import { useEffect, useState, useRef } from "react";
import { useAtom } from "jotai";
import { dropdownOpenAtom } from "@/atoms/uiAtoms";
import { useTranslation } from "react-i18next";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ChatList } from "./ChatList";
import { AppList } from "./AppList";
import { SettingsList } from "./SettingsList";
import { LibraryList } from "./LibraryList";


// Hover state types
type HoverState =
  | "start-hover:app"
  | "start-hover:chat"
  | "start-hover:settings"
  | "start-hover:library"
  | "clear-hover"
  | "no-hover";

export function AppSidebar() {
  const { t } = useTranslation();
  const { state, toggleSidebar } = useSidebar(); // retrieve current sidebar state
  const [hoverState, setHoverState] = useState<HoverState>("no-hover");
  const expandedByHover = useRef(false);
const [isDropdownOpen] = useAtom(dropdownOpenAtom);

  useEffect(() => {
    if (hoverState.startsWith("start-hover") && state === "collapsed") {
      expandedByHover.current = true;
      toggleSidebar();
    }
    if (
      hoverState === "clear-hover" &&
      state === "expanded" &&
      expandedByHover.current &&
      !isDropdownOpen
    ) {
      toggleSidebar();
      expandedByHover.current = false;
      setHoverState("no-hover");
    }
  }, [hoverState, toggleSidebar, state, setHoverState, isDropdownOpen]);

  const routerState = useRouterState();
  const isAppRoute =
    routerState.location.pathname === "/" ||
    routerState.location.pathname.startsWith("/app-details");
  const isChatRoute = routerState.location.pathname === "/chat";
  const isSettingsRoute = routerState.location.pathname.startsWith("/settings");
  const isLibraryRoute = routerState.location.pathname.startsWith("/library");

  let selectedItem: string | null = null;
  if (hoverState === "start-hover:app") {
    selectedItem = "apps";
  } else if (hoverState === "start-hover:chat") {
    selectedItem = "chat";
  } else if (hoverState === "start-hover:settings") {
    selectedItem = "settings";
  } else if (hoverState === "start-hover:library") {
    selectedItem = "library";
  } else if (state === "expanded") {
    if (isAppRoute) {
      selectedItem = "apps";
    } else if (isChatRoute) {
      selectedItem = "chat";
    } else if (isSettingsRoute) {
      selectedItem = "settings";
    } else if (isLibraryRoute) {
      selectedItem = "library";
    }
  }

  return (
    <Sidebar
      collapsible="icon"
      onMouseLeave={() => {
        if (!isDropdownOpen) {
          setHoverState("clear-hover");
        }
      }}
    >
      <SidebarContent className="overflow-hidden">
        <div className="flex mt-8">
          {/* Left Column: Menu items */}
          <div className="">
            <SidebarTrigger
              onMouseEnter={() => {
                setHoverState("clear-hover");
              }}
            />
            <AppIcons onHoverChange={setHoverState} />
          </div>
          {/* Right Column: Chat List Section */}
          <div className="w-[272px]">
            <AppList show={selectedItem === "apps"} />
            <ChatList show={selectedItem === "chat"} />
            <SettingsList show={selectedItem === "settings"} />
            <LibraryList show={selectedItem === "library"} />
          </div>
        </div>
      </SidebarContent>

      <SidebarFooter className="hidden">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              disabled
              className="font-medium w-14 flex flex-col items-center gap-1 h-14 mb-2 rounded-2xl opacity-40 cursor-not-allowed"
            >
              <HelpCircle className="h-5 w-5" />
              <span className={"text-xs"}>{t("nav.help")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function AppIcons({
  onHoverChange,
}: {
  onHoverChange: (state: HoverState) => void;
}) {
  const { t } = useTranslation();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  const items = [
    { key: "apps", title: t("nav.apps"), to: "/", icon: Home, hover: "start-hover:app" as const },
    { key: "chat", title: t("nav.chat"), to: "/chat", icon: Inbox, hover: "start-hover:chat" as const },
    { key: "settings", title: t("nav.settings"), to: "/settings", icon: Settings, hover: "start-hover:settings" as const },
    { key: "library", title: t("nav.library"), to: "/library", icon: BookOpen, hover: "start-hover:library" as const },
    { key: "hub", title: t("nav.hub"), to: "/hub", icon: Store, hover: null },
  ];

  return (
    // When collapsed: only show the main menu
    <SidebarGroup className="pr-0">
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive =
              (item.to === "/" && pathname === "/") ||
              (item.to !== "/" && pathname.startsWith(item.to));

            return (
              <SidebarMenuItem key={item.key}>
                <SidebarMenuButton
                  as={Link}
                  to={item.to}
                  size="sm"
                  className={`font-medium w-14 flex flex-col items-center gap-1 h-14 mb-2 rounded-2xl ${
                    isActive ? "bg-sidebar-accent" : ""
                  }`}
                  onMouseEnter={() => {
                    if (item.hover) onHoverChange(item.hover);
                  }}
                >
                  <div className="flex flex-col items-center gap-1">
                    <item.icon className="h-5 w-5" />
                    <span className={"text-xs"}>{item.title}</span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
