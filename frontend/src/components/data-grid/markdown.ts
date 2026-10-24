/**
 * Markdown utility functions for notes fields.
 *
 * Provides helper functions to strip markdown syntax and generate plain text excerpts.
 */

// Matches internal AI citation markers of the form 【digits†identifier】
const CITATION_MARKER_RE = /\s*【[^】]*†[^】]*】/g;

/**
 * Remove AI-generated citation markers (e.g. 【941131680077198†L4162-L4178】) from text.
 * These are internal retrieval references that should not be shown to users.
 *
 * Kept even though the AI enrichment feature that used to generate these markers
 * was removed (see git history: "Remove AI enrichment feature") — existing notes
 * saved while that feature was active can still contain markers, so this stays a
 * defensive display-time cleanup rather than dead code.
 */
export function stripCitationMarkers(text: string): string {
  if (!text) return text;
  return text.replace(CITATION_MARKER_RE, '');
}

// Invisible format characters (zero-width space, word joiner, BOM, soft hyphen)
// touching an emphasis delimiter run. CommonMark counts them as neither
// whitespace nor punctuation, so `**Hülsen.**\u200B` no longer closes the bold
// and the asterisks render literally.
const INVISIBLE_AFTER_DELIMITER_RE = /([*_])[\u200B\u2060\uFEFF\u00AD]+/g;
const INVISIBLE_BEFORE_DELIMITER_RE = /[\u200B\u2060\uFEFF\u00AD]+([*_])/g;

/**
 * Prepare stored notes text for markdown rendering: drop citation markers and
 * invisible characters that would break `**bold**`/`_emphasis_` delimiters.
 */
export function normalizeMarkdownSource(text: string): string {
  if (!text) return text;
  return stripCitationMarkers(text)
    .replace(INVISIBLE_AFTER_DELIMITER_RE, '$1')
    .replace(INVISIBLE_BEFORE_DELIMITER_RE, '$1');
}

/**
 * Strip common markdown syntax tokens from text.
 * Removes headers, bold, italic, links, code blocks, lists, etc.
 * 
 * @param markdown The markdown text to strip
 * @returns Plain text without markdown syntax
 */
export function stripMarkdown(markdown: string): string {
  if (!markdown) return '';
  
  let text = markdown;
  
  // Remove code blocks (```...``` and `...`)
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`([^`]+)`/g, '$1');
  
  // Remove headers (# ## ###, etc.)
  text = text.replace(/^#{1,6}\s+/gm, '');
  
  // Remove bold and italic (**text**, *text*, __text__, _text_)
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  
  // Remove links [text](url)
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Remove images ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  
  // Remove horizontal rules (---, ***, ___)
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');
  
  // Remove list markers (-, *, +, numbers)
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  
  // Remove blockquotes (>)
  text = text.replace(/^>\s+/gm, '');
  
  // Normalize whitespace
  text = text.replace(/\n\s*\n/g, '\n');
  text = text.trim();
  
  return text;
}

/**
 * Get a plain text excerpt from markdown, stripping syntax.
 * Useful for tooltips and previews.
 * 
 * @param markdown The markdown text to excerpt
 * @param maxLength Maximum length of the excerpt (default: 120)
 * @returns Plain text excerpt, truncated if necessary
 */
export function getPlainExcerpt(markdown: string, maxLength: number = 120): string {
  if (!markdown || markdown.trim() === '') {
    return '';
  }
  
  const plain = stripMarkdown(markdown);
  
  if (plain.length <= maxLength) {
    return plain;
  }
  
  // Truncate and add ellipsis
  return plain.substring(0, maxLength).trim() + '...';
}
