import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "../../atoms/appAtoms";
import { useSkills } from "@/hooks/useSkills";
import { useLoadApp } from "@/hooks/useLoadApp";
import { Globe, FolderCode, Zap } from "lucide-react";

export function SkillsPanel() {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { app } = useLoadApp(selectedAppId);
  const { skills, isLoading } = useSkills();

  const globalSkills = skills.filter((s) => s.source === "global" || s.source === "db");
  const projectSkills = skills.filter(
    (s) => s.source === "project" && s.appName === app?.name,
  );

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Loading skills...</div>
    );
  }

  return (
    <div className="p-4 space-y-5 overflow-y-auto h-full">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4" />
        <h2 className="text-sm font-semibold">Skills</h2>
      </div>

      {/* Project Skills */}
      <section>
        <div className="flex items-center gap-1.5 mb-2">
          <FolderCode className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Project
          </span>
        </div>
        {projectSkills.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No project skills. Add{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              .meowphyr/skills/&lt;name&gt;/SKILL.md
            </code>
          </p>
        ) : (
          <ul className="space-y-1">
            {projectSkills.map((skill) => (
              <li
                key={skill.key}
                className="rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">/{skill.slug}</span>
                  {skill.argumentHint && (
                    <span className="text-xs text-muted-foreground italic">
                      {skill.argumentHint}
                    </span>
                  )}
                </div>
                {skill.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {skill.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Global Skills */}
      <section>
        <div className="flex items-center gap-1.5 mb-2">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Global
          </span>
        </div>
        {globalSkills.length === 0 ? (
          <p className="text-xs text-muted-foreground">No global skills.</p>
        ) : (
          <ul className="space-y-1">
            {globalSkills.map((skill) => (
              <li
                key={skill.key}
                className="rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">/{skill.slug}</span>
                  {skill.argumentHint && (
                    <span className="text-xs text-muted-foreground italic">
                      {skill.argumentHint}
                    </span>
                  )}
                </div>
                {skill.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {skill.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
