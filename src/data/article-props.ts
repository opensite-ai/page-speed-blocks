/**
 * Blog-detail → article-layout props (FEED_CONTRACT §4.3).
 *
 * This is the SPA-navigation mirror of customer-sites
 * `app/services/blog_detail_entry.rb#blog_to_article_props` — the FAT union superset that feeds
 * ALL SIX longform article layouts from one payload. Before R9 the SPA path wrote only 8 thin
 * flat props (`title, markdownString, author, date, image, imageAlt, tags, articles`), of which
 * the layouts declare exactly two, so a click-through from /blog rendered a bare article until
 * the visitor hard-refreshed. See `docs/shared-components/blogs-engine-impl/R9-softnav-report.md`.
 *
 * ── LOCKSTEP CONTRACT (read before editing) ────────────────────────────────────────────────
 * Every derivation below is a deliberate, byte-for-byte port of the Ruby reference:
 *
 *   customer-sites app/services/blog_detail_entry.rb
 *     #blog_to_article_props  (the prop union + omission rules)
 *     #breadcrumbs / #category_index_path / #normalize_index_path
 *     #read_time / #plain_text_from_markdown
 *     #sections / #chapters / #each_heading / #heading_id / #heading_plain_text / #slugify
 *     #build_post            (pubDate is a Unix-MS INTEGER — date-fns throws on strings)
 *     #normalized_text       (the "summary merely restates the title" suppression)
 *
 * The guard that keeps the two honest is the shared fixture
 * `src/__tests__/fixtures/blog-detail-parity.json`, whose twin lives at
 * `utility-modules/customer-sites/spec/fixtures/blog_detail_parity.json`. Both sides assert
 * their own output equals it, so a change on one side turns the OTHER repo's suite red.
 *
 * Ruby/JS string-semantics rules applied throughout (the platform's recurring lockstep trap):
 *   • Ruby `String#strip` is ASCII-only → {@link rubyStrip}, never JS `trim()`.
 *   • Ruby `\s` (in `split`) is ASCII-only → `ASCII_WHITESPACE_SPLIT`, never JS `/\s+/`.
 *   • Ruby `[[:space:]]` is Unicode-aware but is NOT JS `/\s/u` → `RUBY_POSIX_SPACE`. The two
 *     sets differ on exactly two codepoints (U+0085 and U+FEFF); see that constant.
 *   • Ruby `.` (no /m) excludes ONLY `\n`, while JS `.` (no /s) also excludes `\r`, U+2028 and
 *     U+2029 → line-scoped patterns use `[^\n]`, never `.`; see {@link HEADING_LINE}.
 *   • Ruby `\w` and JS `\w` are both ASCII — accents strip identically in {@link slugify}.
 */

import type {
  ArticleBreadcrumb,
  ArticleChapter,
  ArticleDetailProps,
  ArticlePost,
  ArticleSection,
  BlogFeedDetailItem,
  BlogPostItem,
} from "../types/index.js";
import { formatFeedDate, mapBlogFeedItem } from "./mappers.js";

/**
 * The six longform article layout components a blog-detail page may render.
 *
 * LOCKSTEP COPY #4 — the authoritative list is customer-sites
 * `BlogDetailEntry::ARTICLE_LAYOUT_COMPONENT_IDS`, mirrored in dashtrack-ai
 * `WebsiteRoutingConfigBuilder::ARTICLE_LAYOUT_COMPONENT_IDS` and dt-cms
 * `ARTICLE_LAYOUT_COMPONENT_IDS`. Keep all four in lockstep (FEED_CONTRACT §5.3).
 *
 * It exists here so a wire `article_layout` can never promote a `_type` that has no renderer —
 * exactly the defect class that shipped once already (four picker ids that never existed in
 * `@opensite/ui` silently degraded to the default).
 */
export const ARTICLE_LAYOUT_COMPONENT_IDS = [
  "article-hero-prose",
  "article-sidebar-sticky",
  "article-toc-sidebar",
  "article-breadcrumb-social",
  "article-compact-toc",
  "article-chapters-author",
] as const;

/** Blog index route used when the site's blog config names no page category. */
export const DEFAULT_BLOG_INDEX_PATH = "/blog";

/**
 * date-fns token `article-hero-prose` formats `post.pubDate` with (its own default is
 * "MMMM d, yyyy"; passed explicitly so the layout never depends on that default).
 */
export const HERO_PROSE_DATE_FORMAT = "MMMM d, yyyy";

/** Words per minute used for the read-time estimate (Ruby `#read_time`). */
const READ_TIME_WPM = 200;

/**
 * Return `componentId` when it names one of the six article layouts, else `undefined`.
 * Mirror of `BlogDetailEntry#allow_listed_layout`.
 */
export function allowListedArticleLayout(
  componentId?: string | null
): string | undefined {
  if (typeof componentId !== "string") return undefined;
  return (ARTICLE_LAYOUT_COMPONENT_IDS as readonly string[]).includes(componentId)
    ? componentId
    : undefined;
}

// ─── Ruby string primitives ────────────────────────────────────────────────────────────────

/** ASCII-only whitespace class Ruby's `String#strip` removes (plus NUL). */
const RUBY_STRIP_LEADING = /^[\0\t\n\v\f\r ]+/;
const RUBY_STRIP_TRAILING = /[\0\t\n\v\f\r ]+$/;

/** Port of Ruby `String#strip` (ASCII whitespace + NUL only — NOT JS `trim()`). */
function rubyStrip(value: string): string {
  return value.replace(RUBY_STRIP_LEADING, "").replace(RUBY_STRIP_TRAILING, "");
}

/** Ruby `\s` inside `split(/\s+/)` — ASCII only, so NBSP does NOT split a word. */
const ASCII_WHITESPACE_SPLIT = /[ \t\r\n\f\v]+/;

/**
 * Ruby's POSIX `[[:space:]]` class, character-for-character.
 *
 * JS `/\s/u` is NOT the same set and using it here is a real (twice-shipped) parity bug:
 *   • U+0085 NEXT LINE      — Ruby `[[:space:]]` YES, JS `\s` no
 *   • U+FEFF ZWNBSP / BOM   — Ruby `[[:space:]]` no,  JS `\s` YES
 * Every other member (TAB, LF, VT, FF, CR, SP, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029,
 * U+202F, U+205F, U+3000) is shared. Both were verified empirically against Ruby 3.3 and
 * Node 22 before this constant was written.
 *
 * Consequence if you use `/\s+/u` instead: a heading `A<U+FEFF>B` slugifies to `a-b` here and
 * `ab` in Ruby (JS collapses the BOM to a dash; Ruby leaves it for `[^\w-]` to delete), and
 * `A<U+0085>B` slugifies to `ab` here and `a-b` in Ruby — i.e. the TOC anchor emitted on SPA
 * navigation points at an id the server-rendered heading does not have.
 *
 * Mirror of every `[[:space:]]` in `BlogDetailEntry` (`#slugify`, `#normalized_text`).
 */
const RUBY_POSIX_SPACE =
  /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

/**
 * Ruby `gsub(/\A[[:space:]]+|[[:space:]]+\z/, '')` - the POSIX-space trim.
 *
 * DERIVED from `RUBY_POSIX_SPACE.source` on purpose: a hand-copied character class is exactly how
 * this parity bug ships twice. `^`/`$` (no `m` flag) are string anchors, so they mean `\A`/`\z`.
 *
 * Use this - never `String.trim()` - anywhere a Ruby `[[:space:]]` trim has to be mirrored
 * byte-for-byte. The two sets differ on precisely two codepoints (U+0085 NEL: Ruby yes / JS no;
 * U+FEFF BOM: Ruby no / JS yes), so a BOM-wrapped value trims differently on the two paths.
 */
const RUBY_POSIX_TRIM = new RegExp(
  `^(?:${RUBY_POSIX_SPACE.source})|(?:${RUBY_POSIX_SPACE.source})$`,
  "g"
);

/**
 * Port of Ruby `gsub(/\A[[:space:]]+|[[:space:]]+\z/, '')`. Exported because the R9 category-chip
 * bind (`blogCategoryChips`, `src/data/resolve-blocks.ts`) mirrors the same Ruby trim in
 * `Feeds::Hydrator#published_category_names` and must not re-derive the class.
 */
export function rubyPosixTrim(value: string): string {
  return value.replace(RUBY_POSIX_TRIM, "");
}

/** True when the value is a non-empty string after Ruby-strip (mirror of `String#presence`). */
function presence(value?: string | null): string | undefined {
  if (typeof value !== "string") return undefined;
  return rubyStrip(value).length > 0 ? value : undefined;
}

/**
 * Case/whitespace-insensitive comparison key for the standfirst-vs-title check.
 * Mirror of `BlogDetailEntry#normalized_text` (`[[:space:]]` → Unicode-aware collapse).
 */
export function normalizedText(value?: string | null): string {
  return rubyStrip(
    String(value ?? "").toLowerCase().replace(RUBY_POSIX_SPACE, " ")
  );
}

/**
 * Port of Ruby `CGI.escape` for the `?category_slug=` crumb href. Category slugs are
 * friendly_id output (`[a-z0-9-]`), where this is the identity — but the two escapers disagree
 * on `~!*'()` and on how a space is encoded (`+` vs `%20`), so the crumb href is only
 * byte-identical to first load if we mirror Ruby rather than call `encodeURIComponent`.
 */
export function cgiEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/~/g, "%7E")
    .replace(/%20/g, "+");
}

/**
 * Port of `@page-speed/markdown-to-jsx` `slugify` (utils/slugify.ts) — and of the Ruby mirror in
 * `BlogDetailEntry#slugify`. The renderer slugifies the RAW inline markdown of the heading, so
 * the TOC anchor must too, or "On this page" links point at nothing.
 */
export function slugify(text: string): string {
  return rubyStrip(String(text ?? "").toLowerCase())
    .replace(RUBY_POSIX_SPACE, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

// ─── Heading extraction (TOC sections + chapters) ──────────────────────────────────────────

/**
 * ATX heading matcher — a deliberate mirror of `BlogDetailEntry::HEADING_LINE`, itself a mirror
 * of the two regexes `@page-speed/markdown-to-jsx` applies in sequence (the `{#id}` preprocessor
 * and markdown-to-jsx's own heading rule). Up to 3 leading spaces (4+ is an indented code block,
 * which the parser matches BEFORE headings), optional space after the hashes, and closing ATX
 * hashes only when preceded by whitespace.
 *
 * The heading text is `[^\n]+?`, NOT `.+?`. Ruby's `.` (without /m) excludes only `\n`, but JS's
 * `.` (without /s) also excludes `\r`, U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR —
 * and neither language's line splitter breaks on U+2028/U+2029 (Ruby `each_line` and JS
 * `split("\n")` both split on `\n` only). So a heading containing one of those separators
 * matched in Ruby and silently did NOT match here: the H2 vanished from `sections`/`chapters`
 * on SPA navigation while first load still rendered the TOC entry. Editors paste U+2028 from
 * Word/Pages/Google Docs routinely, so this is reachable content, not a theoretical case.
 */
const HEADING_LINE =
  /^[ \t]{0,3}(#{1,6})[ \t]*([^\n]+?)(?:[ \t]*\{#([A-Za-z0-9_-]+)\}[ \t]*)?(?:[ \t]+#*)?[ \t]*\r?$/;

/**
 * Opening/closing fence of a fenced code block. Lines inside a fence are code, never headings —
 * without this a `## heading` (or a shell `# comment`) inside a ``` block became a phantom TOC
 * entry pointing at no DOM element. Mirror of `BlogDetailEntry::CODE_FENCE_LINE`.
 */
const CODE_FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})/;

interface RawHeading {
  level: number;
  rawText: string;
  customId?: string;
}

/**
 * `[level, rawInlineText, customId]` for every ATX heading in document order, skipping fenced
 * code blocks. Mirror of `BlogDetailEntry#each_heading`.
 */
function eachHeading(markdown: string): RawHeading[] {
  const headings: RawHeading[] = [];
  let openFence: string | null = null;

  for (const line of String(markdown ?? "").split("\n")) {
    const fenceMatch = line.match(CODE_FENCE_LINE);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      if (openFence === null) {
        openFence = fence;
      } else if (fence[0] === openFence[0] && fence.length >= openFence.length) {
        openFence = null;
      }
      continue;
    }
    if (openFence !== null) continue;

    const match = line.match(HEADING_LINE);
    if (!match) continue;

    headings.push({
      level: match[1].length,
      rawText: rubyStrip(match[2]),
      customId: match[3],
    });
  }

  return headings;
}

/**
 * `{#custom-id}` is used verbatim by the renderer (mapped straight to the heading's id during
 * preprocessing); everything else is slugified. Mirror of `BlogDetailEntry#heading_id`.
 */
function headingId(rawText: string, customId?: string): string {
  return presence(customId) ? (customId as string) : slugify(rawText);
}

/**
 * Reduce a raw markdown heading to plain text for the TOC LABEL. The anchor id is NOT derived
 * from this — the renderer slugifies the raw inline markdown, so {@link headingId} does too.
 * Mirror of `BlogDetailEntry#heading_plain_text`.
 */
function headingPlainText(raw: string): string {
  return rubyStrip(
    rubyStrip(String(raw ?? ""))
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links  -> label
      .replace(/`([^`]*)`/g, "$1") // inline code
      .replace(/(\*\*|\*|__|_|~~)/g, "") // emphasis / strike
  );
}

/**
 * TOC sections from ATX H2 headings: `{id, title}` where `id` is byte-identical to the id
 * `@page-speed/markdown-to-jsx` puts on the rendered `<h2>`.
 *
 * Ids are STABLE across re-renders (markdown-to-jsx's compiler-supplied id wins over
 * `HeadingWithId`'s module-counter value, which never reaches the DOM) and are NOT de-duplicated
 * (two identical H2s render the same id twice, so both TOC entries point at the first
 * occurrence — the only thing the DOM offers). Mirror of `BlogDetailEntry#sections`.
 *
 * NOTE: `enableTocTracking` / `enableBackToTop` / `enableChapterTracking` stay FALSE regardless —
 * they install scroll listeners that re-render the whole article every frame.
 */
export function articleSections(markdown: string): ArticleSection[] {
  return eachHeading(markdown)
    .filter((heading) => heading.level === 2)
    .map((heading) => ({
      id: headingId(heading.rawText, heading.customId),
      title: headingPlainText(heading.rawText),
    }));
}

/** Chapters for `article-chapters-author`, from the SAME H2s. Mirror of `BlogDetailEntry#chapters`. */
export function articleChapters(sections: ArticleSection[]): ArticleChapter[] {
  return sections.map((section, index) => ({
    id: section.id,
    number: index + 1,
    title: section.title,
  }));
}

// ─── Read time ─────────────────────────────────────────────────────────────────────────────

/**
 * Rough markdown → plain text for word counting. Mirror of
 * `BlogDetailEntry#plain_text_from_markdown` (an estimate; exactness is not required, but the
 * two implementations must agree or the byline read-time flickers between first load and SPA nav).
 */
function plainTextFromMarkdown(markdown: string): string {
  return String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/[#>*_~-]+/g, " ");
}

/**
 * Estimated read time from the body word count (~200 wpm), or `undefined` when the body has no
 * words. Mirror of `BlogDetailEntry#read_time`.
 */
export function articleReadTime(markdown: string): string | undefined {
  const words = plainTextFromMarkdown(markdown)
    .split(ASCII_WHITESPACE_SPLIT)
    .filter((word) => word.length > 0).length;
  if (words === 0) return undefined;
  return `${Math.ceil(words / READ_TIME_WPM)} min read`;
}

// ─── Breadcrumbs ───────────────────────────────────────────────────────────────────────────

/**
 * The site's blog index path, taken from the §3.5 wire (already normalized server-side to a
 * leading-slash, no-trailing-slash route) and defaulting to `/blog` when the field is absent —
 * which is both the Ruby default (`BlogDetailEntry::DEFAULT_BLOG_INDEX_PATH`) and the safe
 * behaviour against a pre-R9 toastability that does not emit `site_blog`.
 */
function blogIndexPath(item: BlogFeedDetailItem): string {
  return presence(item.site_blog?.index_path) ?? DEFAULT_BLOG_INDEX_PATH;
}

/**
 * The index route carrying the list filter the Chai list blocks understand
 * (`?category_slug=<slug>` — §3.2). There is no dedicated per-category ROUTE on this platform,
 * so the filtered index is the only rendering of "posts in this category" that exists. A
 * category with no slug degrades to the bare index rather than emitting an empty filter value
 * (which the feed fails closed on). Mirror of `BlogDetailEntry#category_index_path`.
 */
function categoryIndexPath(item: BlogFeedDetailItem, indexPath: string): string {
  const slug = rubyStrip(String(item.blog_category?.slug ?? ""));
  if (slug.length === 0) return indexPath;
  return `${indexPath}?category_slug=${cgiEscape(slug)}`;
}

/** Breadcrumb trail: a "Blog" root plus the post's category when present. */
export function articleBreadcrumbs(item: BlogFeedDetailItem): ArticleBreadcrumb[] {
  const indexPath = blogIndexPath(item);
  const crumbs: ArticleBreadcrumb[] = [{ label: "Blog", href: indexPath }];
  const label = presence(item.blog_category?.name);
  if (label) crumbs.push({ label, href: categoryIndexPath(item, indexPath) });
  return crumbs;
}

// ─── The fat mapper ────────────────────────────────────────────────────────────────────────

/**
 * `article-hero-prose` reads everything from a nested `post` object and formats `post.pubDate`
 * with date-fns `format(pubDate, dateFormat)`. date-fns accepts a Date or a Unix-MS NUMBER but
 * THROWS on a string, and design_payload is JSON (it cannot carry a JS Date) — so `pubDate` is
 * emitted as a Unix-ms integer, truncated to whole seconds exactly like Ruby's
 * `published_at.to_i * 1000`. Mirror of `BlogDetailEntry#build_post`.
 *
 * `description` here is the RAW summary — the "restates the title" suppression applies only to
 * the top-level `description`/`subtitle`/`summary` props, matching the Ruby call site.
 * `authorImage`/`authorHref` are OMITTED (a Blog has neither) — never fabricated.
 */
function buildPost(
  item: BlogFeedDetailItem,
  hero: string | undefined,
  description: string | undefined,
  authorName: string | undefined,
  showByline: boolean
): ArticlePost {
  const post: ArticlePost = { title: item.title };
  if (description) post.description = description;
  if (authorName) post.authorName = authorName;
  if (hero) post.image = hero;

  if (showByline && item.published_at) {
    const parsed = Date.parse(item.published_at);
    if (!Number.isNaN(parsed)) post.pubDate = Math.floor(parsed / 1000) * 1000;
  }

  return post;
}

/** Related posts (§4.1), dropping the ones with no href exactly as the Ruby `filter_map` does. */
function relatedItems(item: BlogFeedDetailItem): BlogPostItem[] {
  return (item.related ?? [])
    .filter((related) => presence(related?.link_path))
    .map(mapBlogFeedItem);
}

/**
 * Map a §3.5 detail wire item to the FAT article-layout prop union (§4.3).
 *
 * Absent fields are OMITTED, never fabricated: a Blog carries no author image/role/bio/social
 * links and often no hero image. When the site's `show_byline` is false the author, publish
 * date and read time are treated exactly like absent fields, so each layout's own
 * `if (!authorName) return null` guard drops the whole byline row — nothing is hidden with CSS.
 */
export function mapBlogDetailToArticleProps(
  item: BlogFeedDetailItem
): ArticleDetailProps {
  const body = item.body ?? "";
  const showByline = item.site_blog?.show_byline !== false;
  const authorName = showByline ? presence(item.author) : undefined;
  const description = presence(item.summary);
  const hero = presence(item.image_url);
  const heroAlt = hero ? presence(item.image_alt) : undefined;
  const publishDate = showByline ? formatFeedDate(item.published_at) : undefined;
  const readTime = showByline ? articleReadTime(body) : undefined;
  const sections = articleSections(body);
  const chapters = articleChapters(sections);

  const props: ArticleDetailProps = {
    // The one uniform field across all six components.
    markdownString: body,

    // Flat fields (sidebar-sticky / toc-sidebar / breadcrumb-social / compact-toc).
    title: item.title,
    currentPage: item.title,

    // Breadcrumbs (breadcrumb-social / compact-toc / chapters-author).
    breadcrumbs: articleBreadcrumbs(item),

    // ALL false — scroll listeners re-render the whole article on every scroll frame for a
    // highlight the design does not need. TOC/chapter anchors are stable regardless.
    // NO `background` key: these props are merged OVER the template's authored blockProps, so
    // emitting one clobbers whatever the theme asked for (half of the old "blog detail looks
    // unthemed" defect). Absent -> the component default.
    enableTocTracking: false,
    enableBackToTop: false,
    enableChapterTracking: false,

    // Consumed by the related-articles block (bindTo: 'articles'); harmless on the article
    // block (undeclared props are dropped by React).
    tags: (item.blog_tags ?? []).map((tag) => tag.name),
    articles: relatedItems(item),

    // hero-prose is the outlier: it nests article fields under a `post` object.
    post: buildPost(item, hero, description, authorName, showByline),
    dateFormat: HERO_PROSE_DATE_FORMAT,
  };

  // description (toc/breadcrumb/compact) + subtitle (chapters-author) + summary
  // (sidebar-sticky, which declares `summary` and NO `description`). Suppressed entirely when it
  // merely restates the title: the AI engine's summary occasionally equals the title verbatim,
  // and rendering the same sentence twice under the headline reads as a bug.
  if (description && normalizedText(description) !== normalizedText(item.title)) {
    props.description = description;
    props.subtitle = description;
    props.summary = description;
  }

  // Publish date, preformatted (5 of 6; chapters-author has no date prop).
  if (publishDate) props.publishDate = publishDate;

  // Author, BOTH shapes: flat string (hero via post / sidebar / toc / compact) AND an object
  // `{ name }` (breadcrumb-social + chapters-author). Only `name` is known — role/image/bio/
  // socialLinks are omitted, never fabricated.
  if (authorName) {
    props.authorName = authorName;
    props.author = { name: authorName };
  }

  // Hero image, flat shape (5 of 6).
  if (hero) {
    props.heroImageSrc = hero;
    if (heroAlt) props.heroImageAlt = heroAlt;
  }

  // readTime (toc / breadcrumb / compact); omitted for an empty body and when the byline is off
  // (it lives INSIDE that same meta row).
  if (readTime) props.readTime = readTime;

  // TOC sections from H2s (toc / breadcrumb / compact) and chapters from the SAME H2s
  // (chapters-author); both omitted when the body has no H2s (no empty TOC).
  if (sections.length > 0) props.sections = sections;
  if (chapters.length > 0) props.chapters = chapters;

  return props;
}
