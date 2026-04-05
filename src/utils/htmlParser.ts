/**
 * HTMLRewriter-based utilities for structured data extraction.
 * Workers' HTMLRewriter is a streaming parser — more efficient than
 * loading the full HTML string.
 */

export interface ExtractedElement {
  tag: string;
  text: string;
  attrs: Record<string, string>;
  children: ExtractedElement[];
}

/**
 * Collect text content from matching CSS selectors via HTMLRewriter.
 * Returns an array of { text, attrs } objects, one per matched element.
 */
export async function extractElements(
  response: Response,
  selector: string
): Promise<Array<{ text: string; attrs: Record<string, string> }>> {
  const results: Array<{ text: string; attrs: Record<string, string> }> = [];
  let current: { text: string; attrs: Record<string, string> } | null = null;

  const transformed = new HTMLRewriter()
    .on(selector, {
      element(el) {
        const attrs: Record<string, string> = {};
        // Iterate attributes via index — Workers HTMLRewriter NamedNodeMap
        const attrMap = el.attributes as unknown as {
          length: number;
          item(i: number): { name: string; value: string } | null;
        };
        for (let i = 0; i < attrMap.length; i++) {
          const attr = attrMap.item(i);
          if (attr) attrs[attr.name] = attr.value;
        }
        current = { text: "", attrs };
        results.push(current);
      },
      text(chunk) {
        if (current && chunk.text) {
          current.text += chunk.text;
        }
      },
    })
    .transform(response);

  // Consume the transformed response to trigger handlers
  await transformed.text();
  return results;
}

/**
 * Extract all href attributes from anchor tags matching a selector.
 */
export async function extractLinks(
  response: Response,
  selector: string = "a"
): Promise<string[]> {
  const links: string[] = [];

  const transformed = new HTMLRewriter()
    .on(selector, {
      element(el) {
        const href = el.getAttribute("href");
        if (href) links.push(href);
      },
    })
    .transform(response);

  await transformed.text();
  return links;
}

/**
 * Parse a simple RSS/Atom XML string into items.
 * Uses regex for compatibility with Cloudflare Workers (no DOM parser).
 */
export function parseRssXml(xml: string): Array<{
  title: string;
  link: string;
  description: string;
  pubDate: string;
}> {
  const items: Array<{
    title: string;
    link: string;
    description: string;
    pubDate: string;
  }> = [];

  // Match both <item> (RSS) and <entry> (Atom) elements
  const itemPattern = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];

    const title = extractXmlTag(block, "title");
    const link = extractXmlTag(block, "link") || extractXmlAttr(block, "link", "href");
    const description =
      extractXmlTag(block, "description") ||
      extractXmlTag(block, "summary") ||
      extractXmlTag(block, "content");
    const pubDate =
      extractXmlTag(block, "pubDate") ||
      extractXmlTag(block, "published") ||
      extractXmlTag(block, "updated") ||
      new Date().toISOString();

    if (title && link) {
      items.push({
        title: cleanText(title),
        link: cleanText(link),
        description: stripHtml(cleanText(description || "")),
        pubDate: cleanText(pubDate),
      });
    }
  }

  return items;
}

function extractXmlTag(xml: string, tag: string): string {
  const pattern = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`,
    "is"
  );
  const m = xml.match(pattern);
  return m ? m[1].trim() : "";
}

function extractXmlAttr(xml: string, tag: string, attr: string): string {
  const pattern = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, "i");
  const m = xml.match(pattern);
  return m ? m[1] : "";
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ").trim();
}

/**
 * Truncate text to a maximum number of characters, ending at a word boundary.
 */
export function truncate(text: string, maxLength = 200): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "…";
}
