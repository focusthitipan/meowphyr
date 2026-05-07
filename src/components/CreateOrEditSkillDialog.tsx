import React, { useState, useEffect, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Save, Edit2, Plus } from "lucide-react";
import type { SkillDto } from "@/ipc/types/skills";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

interface SkillDialogProps {
  mode: "create" | "edit";
  skill?: SkillDto;
  onCreateSkill?: (params: {
    slug: string;
    name: string;
    description?: string;
    argumentHint?: string;
    disableModelInvocation?: boolean;
    userInvocable?: boolean;
    content: string;
  }) => Promise<any>;
  onUpdateSkill?: (params: {
    oldSlug: string;
    slug: string;
    name: string;
    description?: string;
    argumentHint?: string;
    disableModelInvocation?: boolean;
    userInvocable?: boolean;
    content: string;
  }) => Promise<any>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type Draft = {
  name: string;
  description: string;
  argumentHint: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  content: string;
};

function emptyDraft(): Draft {
  return {
    name: "",
    description: "",
    argumentHint: "",
    disableModelInvocation: false,
    userInvocable: true,
    content: "",
  };
}

function skillToDraft(skill: SkillDto): Draft {
  return {
    name: skill.title,
    description: skill.description ?? "",
    argumentHint: skill.argumentHint ?? "",
    disableModelInvocation: skill.disableModelInvocation,
    userInvocable: skill.userInvocable,
    content: skill.content,
  };
}

export function CreateOrEditSkillDialog({
  mode,
  skill,
  onCreateSkill,
  onUpdateSkill,
  isOpen,
  onOpenChange,
}: SkillDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = window.innerHeight * 0.5 - 80;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 120), max)}px`;
  };

  useEffect(() => {
    if (mode === "edit" && skill) {
      setDraft(skillToDraft(skill));
    } else {
      setDraft(emptyDraft());
    }
  }, [mode, skill, open]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [draft.content]);

  useEffect(() => {
    if (open) setTimeout(adjustTextareaHeight, 0);
  }, [open]);

  const slugTrimmed = slugify(draft.name.trim());
  const canSave =
    draft.name.trim() !== "" &&
    slugTrimmed !== "" &&
    draft.content.trim() !== "";

  const handleNameChange = (name: string) => {
    setDraft((d) => ({ ...d, name }));
  };

  const handleSave = async () => {
    if (!canSave) return;
    const params = {
      slug: slugTrimmed,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      argumentHint: draft.argumentHint.trim() || undefined,
      disableModelInvocation: draft.disableModelInvocation || undefined,
      userInvocable: draft.userInvocable === false ? false : undefined,
      content: draft.content,
    };
    if (mode === "create" && onCreateSkill) {
      await onCreateSkill({ ...params, slug: slugTrimmed });
    } else if (mode === "edit" && onUpdateSkill && skill) {
      await onUpdateSkill({ oldSlug: skill.slug, ...params, slug: slugTrimmed });
    }
    setOpen(false);
  };

  const handleCancel = () => {
    if (mode === "edit" && skill) {
      setDraft(skillToDraft(skill));
    } else {
      setDraft(emptyDraft());
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isOpen === undefined &&
        (mode === "create" ? (
          <DialogTrigger className={buttonVariants()}>
            <Plus className="mr-2 h-4 w-4" /> New Skill
          </DialogTrigger>
        ) : (
          <DialogTrigger
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            title="Edit skill"
          >
            <Edit2 className="h-4 w-4" />
          </DialogTrigger>
        ))}
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create New Skill" : "Edit Skill"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a new skill saved to your skills folder."
              : "Edit this skill file."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Name"
            value={draft.name}
            onChange={(e) => handleNameChange(e.target.value)}
          />
          {draft.name.trim() && (
            <p className="text-xs text-muted-foreground -mt-2">
              Command: <span className="font-mono">/{slugTrimmed}</span> · Saved as{" "}
              <span className="font-mono">skills/{slugTrimmed}/SKILL.md</span>
            </p>
          )}
          <Input
            placeholder="Description (optional)"
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
          <Input
            placeholder='Argument hint (optional, e.g. " <query>")'
            value={draft.argumentHint}
            onChange={(e) =>
              setDraft((d) => ({ ...d, argumentHint: e.target.value }))
            }
          />
          <Textarea
            ref={textareaRef}
            placeholder="Skill content (use $ARGUMENTS for user input)"
            value={draft.content}
            onChange={(e) => {
              setDraft((d) => ({ ...d, content: e.target.value }));
              requestAnimationFrame(adjustTextareaHeight);
            }}
            className="resize-none overflow-y-auto font-mono text-sm"
            style={{ minHeight: "120px" }}
          />
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={draft.disableModelInvocation}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    disableModelInvocation: e.target.checked,
                  }))
                }
              />
              Disable model invocation
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={draft.userInvocable}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, userInvocable: e.target.checked }))
                }
              />
              Show in slash menu
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            <Save className="mr-2 h-4 w-4" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
