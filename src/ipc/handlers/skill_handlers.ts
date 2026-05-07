import path from "node:path";
import fs from "node:fs";
import { db } from "@/db";
import { prompts as promptsTable } from "@/db/schema";
import { createTypedHandler } from "./base";
import { skillContracts, type SkillDto } from "../types/skills";
import { parseSkillMd, serializeSkillMd } from "@/lib/skillParser";
import { getUserDataPath } from "@/paths/paths";
import log from "electron-log";

const logger = log.scope("skill_handlers");

const SKILLS_DIR_NAME = "skills";

async function loadFileSkills(): Promise<SkillDto[]> {
  const skillsDir = path.join(getUserDataPath(), SKILLS_DIR_NAME);
  const skills: SkillDto[] = [];

  try {
    await fs.promises.access(skillsDir);
  } catch {
    return skills;
  }

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
  } catch (e) {
    logger.error("Failed to read skills directory:", e);
    return skills;
  }

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry.name);

    if (entry.isDirectory()) {
      const skillFilePath = path.join(entryPath, "SKILL.md");
      try {
        const fileContent = await fs.promises.readFile(skillFilePath, "utf-8");
        const { frontmatter, content } = parseSkillMd(fileContent);
        // Directory name is the slug; frontmatter name is the display title
        const slug = entry.name;
        const title = frontmatter.name || slug;
        skills.push({
          key: `global:${slug}`,
          title,
          description: frontmatter.description ?? null,
          content,
          slug,
          argumentHint: frontmatter["argument-hint"] ?? null,
          disableModelInvocation:
            frontmatter["disable-model-invocation"] ?? false,
          userInvocable: frontmatter["user-invocable"] !== false,
          source: "global",
        });
      } catch {
        // No SKILL.md or unreadable — skip
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        const fileContent = await fs.promises.readFile(entryPath, "utf-8");
        const { frontmatter, content } = parseSkillMd(fileContent);
        // Filename (without .md) is the slug; frontmatter name is the display title
        const slug = path.basename(entry.name, ".md");
        const title = frontmatter.name || slug;
        skills.push({
          key: `global:${slug}`,
          title,
          description: frontmatter.description ?? null,
          content,
          slug,
          argumentHint: frontmatter["argument-hint"] ?? null,
          disableModelInvocation:
            frontmatter["disable-model-invocation"] ?? false,
          userInvocable: frontmatter["user-invocable"] !== false,
          source: "global",
        });
      } catch (e) {
        logger.error(`Failed to read skill file ${entryPath}:`, e);
      }
    }
  }

  return skills;
}

function loadDbSkills(): SkillDto[] {
  const allPrompts = db.select().from(promptsTable).all();
  return allPrompts
    .filter((p) => p.slug)
    .map((p) => ({
      key: `db:${p.id}`,
      title: p.title,
      description: p.description ?? null,
      content: p.content,
      slug: p.slug!,
      argumentHint: null,
      disableModelInvocation: false,
      userInvocable: true,
      source: "db" as const,
    }));
}

export interface SkillMeta {
  slug: string;
  title: string;
  description: string | null;
  argumentHint: string | null;
  content: string;
}

/**
 * Returns full skill data for system prompt injection (metadata + content).
 * File-based global skills override DB skills with the same slug.
 * Only returns skills that are user-invocable.
 */
export async function getAllSkillsForPrompt(): Promise<SkillMeta[]> {
  const bySlug = new Map<string, SkillMeta>();
  for (const s of loadDbSkills()) {
    if (s.userInvocable) {
      bySlug.set(s.slug, {
        slug: s.slug,
        title: s.title,
        description: s.description,
        argumentHint: s.argumentHint,
        content: s.content,
      });
    }
  }
  for (const s of await loadFileSkills()) {
    if (s.userInvocable) {
      bySlug.set(s.slug, {
        slug: s.slug,
        title: s.title,
        description: s.description,
        argumentHint: s.argumentHint,
        content: s.content,
      });
    }
  }
  return Array.from(bySlug.values());
}

/**
 * Returns a merged slug→content map for use in chat stream expansion.
 * File-based global skills override DB skills with the same slug.
 */
export async function getAllSkillsBySlug(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};

  for (const s of loadDbSkills()) {
    map[s.slug] = s.content;
  }

  for (const s of await loadFileSkills()) {
    map[s.slug] = s.content;
  }

  return map;
}

function getSkillFilePath(slug: string): string {
  return path.join(getUserDataPath(), SKILLS_DIR_NAME, slug, "SKILL.md");
}

async function ensureSkillDir(slug: string): Promise<void> {
  const dir = path.join(getUserDataPath(), SKILLS_DIR_NAME, slug);
  await fs.promises.mkdir(dir, { recursive: true });
}

function buildSkillDto(slug: string, params: {
  name: string;
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  content: string;
}): SkillDto {
  return {
    key: `global:${slug}`,
    title: params.name,
    description: params.description ?? null,
    content: params.content,
    slug,
    argumentHint: params.argumentHint ?? null,
    disableModelInvocation: params.disableModelInvocation ?? false,
    userInvocable: params.userInvocable !== false,
    source: "global",
  };
}

export function registerSkillHandlers() {
  createTypedHandler(skillContracts.list, async () => {
    const dbSkills = loadDbSkills();
    const fileSkills = await loadFileSkills();

    // File skills override DB skills with the same slug
    const bySlug = new Map<string, SkillDto>();
    for (const s of dbSkills) bySlug.set(s.slug, s);
    for (const s of fileSkills) bySlug.set(s.slug, s);

    return Array.from(bySlug.values());
  });

  createTypedHandler(skillContracts.create, async (_event, params) => {
    await ensureSkillDir(params.slug);
    const filePath = getSkillFilePath(params.slug);
    const content = serializeSkillMd({
      name: params.name,
      description: params.description,
      argumentHint: params.argumentHint,
      disableModelInvocation: params.disableModelInvocation,
      userInvocable: params.userInvocable,
      content: params.content,
    });
    await fs.promises.writeFile(filePath, content, "utf-8");
    return buildSkillDto(params.slug, params);
  });

  createTypedHandler(skillContracts.update, async (_event, params) => {
    await ensureSkillDir(params.slug);
    const newPath = getSkillFilePath(params.slug);
    const content = serializeSkillMd({
      name: params.name,
      description: params.description,
      argumentHint: params.argumentHint,
      disableModelInvocation: params.disableModelInvocation,
      userInvocable: params.userInvocable,
      content: params.content,
    });
    await fs.promises.writeFile(newPath, content, "utf-8");
    if (params.oldSlug !== params.slug) {
      const oldDir = path.join(getUserDataPath(), SKILLS_DIR_NAME, params.oldSlug);
      try {
        await fs.promises.rm(oldDir, { recursive: true, force: true });
      } catch {
        // old directory may not exist
      }
    }
    return buildSkillDto(params.slug, params);
  });

  createTypedHandler(skillContracts.delete, async (_event, params) => {
    const skillDir = path.join(getUserDataPath(), SKILLS_DIR_NAME, params.slug);
    const skillFile = path.join(
      getUserDataPath(),
      SKILLS_DIR_NAME,
      `${params.slug}.md`,
    );
    try {
      await fs.promises.rm(skillDir, { recursive: true, force: true });
    } catch (e) {
      logger.error(`Failed to delete skill directory ${skillDir}:`, e);
      throw new Error(`Could not delete skill: ${params.slug}`);
    }
    // Also delete flat .md file format (legacy/alternative storage)
    try {
      await fs.promises.unlink(skillFile);
    } catch {
      // OK if flat file doesn't exist
    }
  });
}
