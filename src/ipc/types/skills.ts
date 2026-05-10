import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

export const SkillDtoSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  content: z.string(),
  slug: z.string(),
  argumentHint: z.string().nullable(),
  disableModelInvocation: z.boolean(),
  userInvocable: z.boolean(),
  source: z.enum(["db", "global", "project"]),
  appName: z.string().nullable().optional(),
});

export type SkillDto = z.infer<typeof SkillDtoSchema>;

export const CreateSkillParamsSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  argumentHint: z.string().optional(),
  disableModelInvocation: z.boolean().optional(),
  userInvocable: z.boolean().optional(),
  content: z.string(),
});
export type CreateSkillParams = z.infer<typeof CreateSkillParamsSchema>;

export const UpdateSkillParamsSchema = CreateSkillParamsSchema.extend({
  oldSlug: z.string(),
});
export type UpdateSkillParams = z.infer<typeof UpdateSkillParamsSchema>;

export const DeleteSkillParamsSchema = z.object({ slug: z.string() });
export type DeleteSkillParams = z.infer<typeof DeleteSkillParamsSchema>;

export const skillContracts = {
  list: defineContract({
    channel: "skills:list",
    input: z.void(),
    output: z.array(SkillDtoSchema),
  }),
  create: defineContract({
    channel: "skills:create",
    input: CreateSkillParamsSchema,
    output: SkillDtoSchema,
  }),
  update: defineContract({
    channel: "skills:update",
    input: UpdateSkillParamsSchema,
    output: SkillDtoSchema,
  }),
  delete: defineContract({
    channel: "skills:delete",
    input: DeleteSkillParamsSchema,
    output: z.void(),
  }),
} as const;

export const skillClient = createClient(skillContracts);
