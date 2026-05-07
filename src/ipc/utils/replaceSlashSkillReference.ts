/**
 * Replaces slash-skill references with `<dyad-skill name="slug"/>` tags for display purposes.
 * This keeps the user-visible message clean (badge only) while the full content is sent to AI.
 */
export function replaceSlashSkillBadge(
  userPrompt: string,
  skillsBySlug: Record<string, string>,
): string {
  if (typeof userPrompt !== "string" || userPrompt.length === 0)
    return userPrompt;
  if (Object.keys(skillsBySlug).length === 0) return userPrompt;

  // Pass 1: /slug with trailing args
  let result = userPrompt.replace(
    /(^|\s)\/([a-zA-Z0-9-]+)([ \t]+[^\n]+)/g,
    (match, before: string, slug: string, argsPart: string) => {
      if (skillsBySlug[slug] === undefined) return match;
      const argsText = argsPart.trim();
      return `${before}<dyad-skill name="${slug}"/> ${argsText}`;
    },
  );

  // Pass 2: plain /slug
  result = result.replace(
    /(^|\s)\/([a-zA-Z0-9-]+)(?=\s|$)/g,
    (match: string, before: string, slug: string) => {
      return skillsBySlug[slug] !== undefined
        ? `${before}<dyad-skill name="${slug}"/>`
        : match;
    },
  );

  return result;
}

/**
 * Returns the explicit slug for a prompt, or null if none is set.
 */
export function slugForPrompt(p: {
  title: string;
  slug: string | null;
}): string | null {
  return p.slug || null;
}

/**
 * Replaces slash-skill references like /webapp-testing with the corresponding
 * skill content. Supports $ARGUMENTS, $0, $1 … substitution for skills whose
 * template contains those placeholders.
 *
 * Two-pass strategy (both passes are backwards-compatible):
 *  Pass 1 — `/slug args…` — consumed only when the template uses $ARGUMENTS/$N.
 *  Pass 2 — `/slug` alone — original behaviour, args left untouched.
 */
export function replaceSlashSkillReference(
  userPrompt: string,
  skillsBySlug: Record<string, string>,
): string {
  if (typeof userPrompt !== "string" || userPrompt.length === 0)
    return userPrompt;
  if (Object.keys(skillsBySlug).length === 0) return userPrompt;

  // Pass 1: /slug with trailing args on the same line — only for templates
  // that reference $ARGUMENTS or positional $0–$9 placeholders.
  let result = userPrompt.replace(
    /(^|\s)\/([a-zA-Z0-9-]+)([ \t]+[^\n]+)/g,
    (match, before: string, slug: string, argsPart: string) => {
      const content = skillsBySlug[slug];
      if (content === undefined) return match;
      if (!content.includes("$ARGUMENTS") && !/\$\d/.test(content))
        return match;

      const argsText = argsPart.trim();
      const args = argsText ? argsText.split(/\s+/) : [];
      let expanded = content;
      expanded = expanded.replace(/\$ARGUMENTS/g, argsText);
      expanded = expanded.replace(/\$(\d+)/g, (_, i) => args[Number(i)] ?? "");
      return `${before}${expanded}`;
    },
  );

  // Pass 2: plain /slug (original behaviour — trailing text is preserved as-is)
  result = result.replace(
    /(^|\s)\/([a-zA-Z0-9-]+)(?=\s|$)/g,
    (match: string, before: string, slug: string) => {
      const content = skillsBySlug[slug];
      return content !== undefined ? `${before}${content}` : match;
    },
  );

  return result;
}
