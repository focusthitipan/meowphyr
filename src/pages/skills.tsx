import { useState } from "react";
import { useSkills } from "@/hooks/useSkills";
import { LibraryCard } from "@/components/LibraryCard";
import { CreateOrEditSkillDialog } from "@/components/CreateOrEditSkillDialog";
import { Button } from "@/components/ui/button";
import { Plus, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function SkillsPage() {
  const { t } = useTranslation("home");
  const { t: tCommon } = useTranslation();
  const { skills, isLoading, createSkill, updateSkill, deleteSkill } =
    useSkills();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const globalSkills = skills.filter((s) => s.source === "global" || s.source === "db");

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="flex items-center text-2xl font-bold sm:text-3xl">
            <Zap className="mr-2 h-7 w-7 sm:h-8 sm:w-8" />
            {t("library.filterSkills")}
          </h1>
          <Button
            className="w-full sm:w-auto"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> {t("library.newSkill")}
          </Button>
        </div>

        {isLoading ? (
          <div>{tCommon("loading")}</div>
        ) : globalSkills.length === 0 ? (
          <div className="text-muted-foreground">
            {t("library.noSkills")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {globalSkills.map((skill) => (
              <LibraryCard
                key={skill.slug}
                item={{ type: "skill", data: skill }}
                onUpdateSkill={updateSkill}
                onDeleteSkill={(slug) => deleteSkill({ slug })}
              />
            ))}
          </div>
        )}

        <CreateOrEditSkillDialog
          mode="create"
          onCreateSkill={createSkill}
          isOpen={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
      </div>
    </div>
  );
}
