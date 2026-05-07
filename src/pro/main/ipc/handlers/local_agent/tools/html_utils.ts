/** Convert raw HTML to readable plain text suitable for passing to an LLM. */
export function htmlToText(html: string): string {
  let text = html;

  // Remove <script>, <style>, <noscript> blocks entirely
  text = text.replace(
    /<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );

  // Convert headings
  text = text.replace(/<h1[^>]*>/gi, "\n# ");
  text = text.replace(/<h2[^>]*>/gi, "\n## ");
  text = text.replace(/<h3[^>]*>/gi, "\n### ");
  text = text.replace(/<h4[^>]*>/gi, "\n#### ");
  text = text.replace(/<h[56][^>]*>/gi, "\n##### ");
  text = text.replace(/<\/h[1-6]>/gi, "\n");

  // Convert links: <a href="url">text</a> → [text](url)
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, content) => {
    const innerText = htmlToText(content).trim();
    if (!innerText) return "";
    if (href.startsWith("http")) return `[${innerText}](${href})`;
    return innerText;
  });

  // Block elements → newlines
  text = text.replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|figure|blockquote)[^>]*>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  text = text.replace(/<\/li>/gi, "");
  text = text.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
  text = text.replace(/<\/?(tr|td|th)[^>]*>/gi, " | ");
  text = text.replace(/<\/?(table|thead|tbody|tfoot)[^>]*>/gi, "\n");

  // Bold/italic
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_");

  // Code
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));

  // Collapse excessive whitespace/blank lines
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
