import { z } from "zod";
import { ToolDefinition, escapeXmlAttr, escapeXmlContent } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAllSkillsForPrompt } from "@/ipc/handlers/skill_handlers";

const useSkillSchema = z.object({
  name: z
    .string()
    .describe(
      "Slug of the skill to use (e.g. 'deploy', 'code-review'). Must match a skill slug from the Available Skills list.",
    ),
});

export const useSkillTool: ToolDefinition<z.infer<typeof useSkillSchema>> = {
  name: "use_skill",
  description:
    "Load full instructions for a skill listed in the Available Skills section of the system prompt. Use this when the user's request matches a skill's description, or when the user invokes a skill with /slug.",
  inputSchema: useSkillSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => `Use skill: ${args.name}`,

  buildXml: (args, isComplete) => {
    if (!args.name) return undefined;
    // When complete, return undefined so execute's onXmlComplete provides the final XML with content
    if (isComplete) return undefined;
    return `<dyad-skill name="${escapeXmlAttr(args.name)}"></dyad-skill>`;
  },

  execute: async (args, ctx) => {
    const skills = await getAllSkillsForPrompt();
    const skill = skills.find((s) => s.slug === args.name);
    if (!skill) {
      const available = skills.map((s) => s.slug).join(", ");
      throw new DyadError(
        `Skill "${args.name}" not found. Available skills: ${available || "(none)"}`,
        DyadErrorKind.NotFound,
      );
    }
    const header = skill.argumentHint
      ? `# Skill: ${skill.title} (/${skill.slug} ${skill.argumentHint})`
      : `# Skill: ${skill.title} (/${skill.slug})`;
    const result = `${header}\n\n${skill.content}`;

    ctx.onXmlComplete(
      `<dyad-skill name="${escapeXmlAttr(args.name)}">${escapeXmlContent(result)}</dyad-skill>`,
    );

    return result;
  },
};
