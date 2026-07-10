import type {
  BlogFeedItem,
  BlogFeedDetailItem,
  BlogPostItem,
  BlogPostDetail,
  InstagramFeedItem,
  InstagramPostItem,
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
    // Defensive: wire arrays may be absent/null on partial payloads — never assume presence.
    tags: (item.blog_tags ?? []).map((tag) => tag.name),
    articles: (item.related ?? []).map(mapBlogFeedItem),
  };
}

/** Alt-text fallback when a post has no usable caption (FEED_CONTRACT §4.1b). */
const INSTAGRAM_ALT_FALLBACK = "Instagram post";
/** Max length of the caption-derived alt text before it is truncated. */
const INSTAGRAM_ALT_MAX_LENGTH = 100;

/**
 * Derive `imageAlt` from a caption (§4.1b): whitespace-collapsed, truncated to
 * {@link INSTAGRAM_ALT_MAX_LENGTH} chars (with an ellipsis), falling back to
 * `"Instagram post"` when the caption is empty/absent. Kept deterministic so the
 * dashtrack-ai hydrator can mirror it exactly (lockstep).
 */
function instagramImageAlt(caption?: string | null): string {
  if (!caption) return INSTAGRAM_ALT_FALLBACK;
  const normalized = caption.replace(/\s+/g, " ").trim();
  if (!normalized) return INSTAGRAM_ALT_FALLBACK;
  return normalized.length > INSTAGRAM_ALT_MAX_LENGTH
    ? `${normalized.slice(0, INSTAGRAM_ALT_MAX_LENGTH).trimEnd()}…`
    : normalized;
}

/**
 * Map a wire `InstagramFeedItem` (§3.7) to an `InstagramPostItem` prop shape (§4.1b).
 * This is the client-side mirror of the dashtrack-ai Instagram hydrator — keep in lockstep
 * with the §4.1b mapping table.
 *
 * Returns `null` when the post has no servable image (`files[0].image_url` absent): §4.1b
 * requires `image`, and imageless items are skipped rather than rendered without a tile image.
 * Engagement counts are inlined only when the wire value is a number — absent (`null`) counts
 * are omitted, never fabricated as `0`.
 */
export function mapInstagramFeedItem(
  item: InstagramFeedItem
): InstagramPostItem | null {
  const primary = item.files?.[0];
  const image = primary?.image_url;
  // §4.1b: `image` is required — skip items without a servable first-file image.
  if (!image) return null;

  const result: InstagramPostItem = {
    id: String(item.id),
    href: item.permalink,
    image,
    imageAlt: instagramImageAlt(item.caption),
  };

  if (item.caption) result.caption = item.caption;

  if (item.post_type === "video") {
    result.isVideo = true;
    // Only surface the video source when present (§4.1b: `videoUrl` only when `isVideo`).
    if (primary?.video_url) result.videoUrl = primary.video_url;
  }

  const date = formatFeedDate(item.posted_at);
  if (date) result.date = date;

  if (typeof item.like_count === "number") result.likeCount = item.like_count;
  if (typeof item.comment_count === "number") result.commentCount = item.comment_count;
  if (typeof item.view_count === "number") result.viewCount = item.view_count;

  return result;
}
