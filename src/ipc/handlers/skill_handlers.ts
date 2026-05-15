import path from "node:path";
import fs from "node:fs";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { prompts as promptsTable, apps as appsTable } from "@/db/schema";
import { createTypedHandler } from "./base";
import { skillContracts, type SkillDto } from "../types/skills";
import { parseSkillMd, serializeSkillMd } from "@/lib/skillParser";
import { getUserDataPath, getDyadAppPath } from "@/paths/paths";
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

async function loadProjectSkillsFromPath(appPath: string): Promise<SkillDto[]> {
  const skillsDir = path.join(appPath, ".meowphyr", "skills");
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
    logger.error(`Failed to read project skills directory at ${skillsDir}:`, e);
    return skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFilePath = path.join(skillsDir, entry.name, "SKILL.md");
    try {
      const fileContent = await fs.promises.readFile(skillFilePath, "utf-8");
      const { frontmatter, content } = parseSkillMd(fileContent);
      const slug = entry.name;
      const title = frontmatter.name || slug;
      skills.push({
        key: `project:${slug}`,
        title,
        description: frontmatter.description ?? null,
        content,
        slug,
        argumentHint: frontmatter["argument-hint"] ?? null,
        disableModelInvocation: frontmatter["disable-model-invocation"] ?? false,
        userInvocable: frontmatter["user-invocable"] !== false,
        source: "project",
      });
    } catch {
      // No SKILL.md or unreadable — skip
    }
  }

  return skills;
}

async function loadProjectSkills(appId?: number): Promise<SkillDto[]> {
  if (appId === undefined) return [];
  const allApps = db.select({ name: appsTable.name, path: appsTable.path }).from(appsTable).where(eq(appsTable.id, appId)).all();
  const skills: SkillDto[] = [];

  for (const app of allApps) {
    const appDir = getDyadAppPath(app.path);
    const skillsDir = path.join(appDir, ".meowphyr", "skills");

    try {
      await fs.promises.access(skillsDir);
    } catch {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
    } catch (e) {
      logger.error(`Failed to read project skills directory for ${app.name}:`, e);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFilePath = path.join(skillsDir, entry.name, "SKILL.md");
      try {
        const fileContent = await fs.promises.readFile(skillFilePath, "utf-8");
        const { frontmatter, content } = parseSkillMd(fileContent);
        const slug = entry.name;
        const title = frontmatter.name || slug;
        skills.push({
          key: `project:${app.name}:${slug}`,
          title,
          description: frontmatter.description ?? null,
          content,
          slug,
          argumentHint: frontmatter["argument-hint"] ?? null,
          disableModelInvocation: frontmatter["disable-model-invocation"] ?? false,
          userInvocable: frontmatter["user-invocable"] !== false,
          source: "project",
          appName: app.name,
        });
      } catch {
        // No SKILL.md or unreadable — skip
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
 * Project skills (appPath/.meowphyr/skills/) are appended after global skills.
 * Only returns skills that are user-invocable.
 */
export async function getAllSkillsForPrompt(appPath?: string): Promise<SkillMeta[]> {
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
  if (appPath) {
    for (const s of await loadProjectSkillsFromPath(appPath)) {
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
  }
  return Array.from(bySlug.values());
}

/**
 * Returns a merged slug→content map for use in chat stream expansion.
 * File-based global skills override DB skills with the same slug.
 * Project skills (appPath/.meowphyr/skills/) are appended after global skills.
 */
export async function getAllSkillsBySlug(appPath?: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};

  for (const s of loadDbSkills()) {
    map[s.slug] = s.content;
  }

  for (const s of await loadFileSkills()) {
    map[s.slug] = s.content;
  }

  if (appPath) {
    for (const s of await loadProjectSkillsFromPath(appPath)) {
      map[s.slug] = s.content;
    }
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
  createTypedHandler(skillContracts.list, async (_event, { appId }) => {
    const dbSkills = loadDbSkills();
    const fileSkills = await loadFileSkills();
    const projectSkills = await loadProjectSkills(appId);

    // File skills override DB skills with the same slug (global scope)
    const bySlug = new Map<string, SkillDto>();
    for (const s of dbSkills) bySlug.set(s.slug, s);
    for (const s of fileSkills) bySlug.set(s.slug, s);

    // Project skills use unique key (project:appName:slug) so they never override global
    const result = Array.from(bySlug.values());
    for (const s of projectSkills) result.push(s);

    return result;
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
