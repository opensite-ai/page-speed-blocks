import type {
  BlogFeedItem,
  BlogFeedDetailItem,
  BlogPostItem,
  BlogPostDetail,
} from "../types/index.js";

/**
 * Display date formatter. Contract §4.1: `"%b %-d, %Y"` (e.g. "Jul 1, 2026").
 * UTC is pinned so the rendered day matches the wire timestamp regardless of runtime TZ.
 */
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Format an ISO-8601 timestamp for display per FEED_CONTRACT §4.1.
 * Returns `undefined` for missing/invalid input (never a fabricated date).
 */
export function formatFeedDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return DATE_FORMATTER.format(parsed);
}

/**
 * Map a wire `BlogFeedItem` (§3.4) to a `BlogPostItem` prop shape (§4.1).
 * This is the client-side mirror of the dashtrack-ai list hydrator — keep in lockstep
 * with the §4.1 mapping table.
 */
export function mapBlogFeedItem(item: BlogFeedItem): BlogPostItem {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    category: item.blog_category?.name,
    author: item.author,
    date: formatFeedDate(item.published_at),
    href: item.link_path,
    image: item.image_url ?? undefined,
    imageAlt: item.image_alt ?? undefined,
  };
}

/**
 * Map a wire `BlogFeedDetailItem` (§3.5) to `BlogPostDetail` props (§4.3).
 */
export function mapBlogFeedDetail(item: BlogFeedDetailItem): BlogPostDetail {
  return {
    ...mapBlogFeedItem(item),
    markdownString: item.body,
    tags: item.blog_tags.map((tag) => tag.name),
    articles: (item.related ?? []).map(mapBlogFeedItem),
  };
}
