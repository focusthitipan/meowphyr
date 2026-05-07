export interface SkillFrontmatter {
  name?: string;
  description?: string;
  "argument-hint"?: string;
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;
}

export interface ParsedSkillMd {
  frontmatter: SkillFrontmatter;
  content: string;
}

export function serializeSkillMd(params: {
  name: string;
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  content: string;
}): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${params.name}`);
  if (params.description) lines.push(`description: ${params.description}`);
  if (params.argumentHint) lines.push(`argument-hint: "${params.argumentHint}"`);
  if (params.disableModelInvocation) lines.push(`disable-model-invocation: true`);
  if (params.userInvocable === false) lines.push(`user-invocable: false`);
  lines.push("---", "", params.content);
  return lines.join("\n");
}

export function parseSkillMd(fileContent: string): ParsedSkillMd {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(
    fileContent,
  );

  if (!match) {
    return { frontmatter: {}, content: fileContent.trim() };
  }

  const yamlStr = match[1];
  const content = match[2].trim();
  const frontmatter: SkillFrontmatter = {};

  for (const line of yamlStr.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key === "disable-model-invocation" || key === "user-invocable") {
      (frontmatter as Record<string, unknown>)[key] = value === "true";
    } else {
      (frontmatter as Record<string, unknown>)[key] = value;
    }
  }

  return { frontmatter, content };
}
