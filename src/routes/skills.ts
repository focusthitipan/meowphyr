import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import SkillsPage from "@/pages/skills";

export const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library/skills",
  component: SkillsPage,
});
