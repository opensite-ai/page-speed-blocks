import type {
  BlogFeedItem,
  BlogFeedDetailItem,
  BlogPostItem,
  BlogPostDetail,
  EventFeedItem,
  EventHeroAction,
  EventHeroProps,
  EventHeroStat,
  InstagramFeedItem,
  InstagramPostItem,
  ReviewFeedItem,
  ReviewItem,
  SocialTestimonialItem,
  TestimonialItem,
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
 * Truncate `text` to at most `maxCodepoints`, cutting at the last word boundary and appending an
 * ellipsis (U+2026). Shared by the review-title (§4.1c) and event heading/description (§4.1d)
 * rules — the algorithm is byte-identical to the Ruby reference (`[[:space:]]` collapse), and it
 * MUST stay in lockstep across the two codebases (the Unicode-whitespace + codepoint behaviour has
 * been review-flagged twice). The exact rule (identical words in both codebases):
 *   1. collapse runs of Unicode whitespace to a single ASCII space (JS `/\s+/gu` ↔ Ruby
 *      `[[:space:]]+`; NBSP U+00A0 and ideographic space U+3000 collapse identically)
 *   2. trim Unicode whitespace from both ends
 *   3. length is measured in CODEPOINTS (`Array.from`), never UTF-16 code units — surrogate-pair
 *      emoji are never split
 *   4. `<= maxCodepoints` → return the collapsed/trimmed string as-is (no ellipsis)
 *   5. else take the first `maxCodepoints` codepoints, cut back to the last ASCII space when one
 *      is present in the window, right-trim, and append `…`
 */
export function truncateAtWordBoundary(text: string, maxCodepoints: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const codepoints = Array.from(normalized);
  if (codepoints.length <= maxCodepoints) return normalized;
  const window = codepoints.slice(0, maxCodepoints).join("");
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > 0 ? window.slice(0, lastSpace) : window;
  return `${cut.replace(/\s+$/u, "")}…`;
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
 * Derive `imageAlt` from a caption (§4.1b). Byte-exact lockstep with the
 * dashtrack-ai `InstagramFeedResolver#image_alt` hydrator — do NOT change one
 * side without the other. The rule (identical words in both codebases):
 *   1. collapse runs of Unicode whitespace to a single space
 *   2. trim Unicode whitespace from both ends
 *   3. if empty -> "Instagram post"
 *   4. length is measured in CODEPOINTS (not bytes / UTF-16 code units), so
 *      surrogate-pair emoji are never split
 *   5. if <= 100 codepoints return as-is, else take the first 100 codepoints,
 *      strip trailing Unicode whitespace from the cut, and append "…"
 * JS /\s/u and Ruby [[:space:]] agree on the practical whitespace set
 * (space, NBSP U+00A0, newline, tab, ideographic space U+3000).
 */
function instagramImageAlt(caption?: string | null): string {
  if (!caption) return INSTAGRAM_ALT_FALLBACK;
  const normalized = caption.replace(/\s+/gu, " ").trim();
  if (!normalized) return INSTAGRAM_ALT_FALLBACK;
  const codepoints = Array.from(normalized);
  if (codepoints.length <= INSTAGRAM_ALT_MAX_LENGTH) return normalized;
  return `${codepoints
    .slice(0, INSTAGRAM_ALT_MAX_LENGTH)
    .join("")
    .replace(/\s+$/u, "")}…`;
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

/**
 * Human-readable platform labels for the `review_type` enum keys (§3.8). Used to build the
 * `linkConfig` label (`"Read on <Platform>"`, §4.1c). Unknown keys fall back to a capitalized
 * form; a blank key falls back to a generic phrase (never `"Read on "`).
 */
const PLATFORM_LABELS: Record<string, string> = {
  yelp: "Yelp",
  google: "Google",
  applemaps: "Apple Maps",
  doordash: "DoorDash",
  facebook: "Facebook",
  foursquare: "Foursquare",
  grubhub: "Grubhub",
  opentable: "OpenTable",
  // "TripAdvisor" (capital A) — byte-for-byte parity with dashtrack-ai
  // TestimonialsFeedResolver::PLATFORM_LABELS (lockstep reference, §4.1c).
  tripadvisor: "TripAdvisor",
  ubereats: "Uber Eats",
  bbb: "BBB",
  bing: "Bing",
  booking: "Booking.com",
  citysearch: "Citysearch",
  expedia: "Expedia",
  justeat: "Just Eat",
  orbitz: "Orbitz",
  travelocity: "Travelocity",
};

/** Resolve a display label for a `review_type` enum key (§4.1c). */
export function platformLabel(platform?: string | null): string {
  if (!platform) return "the review site";
  return (
    PLATFORM_LABELS[platform] ??
    platform.charAt(0).toUpperCase() + platform.slice(1)
  );
}

/**
 * Build the `linkConfig` for a review (§4.1c) — `{ label: "Read on <Platform>", href }`.
 * Returns `undefined` when `profile_url` is absent (a dead link degrades harmlessly, but we
 * still do not synthesize one). Shared by the base and social testimonial mappers.
 */
function reviewLinkConfig(
  item: ReviewFeedItem
): { label: string; href: string } | undefined {
  if (!item.profile_url) return undefined;
  return { label: `Read on ${platformLabel(item.platform)}`, href: item.profile_url };
}

/** Max length (codepoints) of the review `title` derived from `content` (§4.1c, ~40 chars). */
const REVIEW_TITLE_MAX_LENGTH = 40;

/**
 * Derive a `ReviewItem.title` from review `content` (§4.1c): whitespace-collapsed and, when
 * longer than ~40 codepoints, cut at the last word boundary within the window with an ellipsis
 * appended. Delegates to the shared {@link truncateAtWordBoundary} (lockstep with the IG alt and
 * event heading/description rules, and with the dashtrack-ai `#review_title` reference).
 */
function reviewTitle(content: string): string {
  return truncateAtWordBoundary(content, REVIEW_TITLE_MAX_LENGTH);
}

/**
 * Map a wire `ReviewFeedItem` (§3.8) to the base `TestimonialItem` prop shape (§4.1c).
 * Client-side mirror of the dashtrack-ai testimonials hydrator — keep in lockstep with the
 * §4.1c mapping table. `rating` is inlined only when numeric (never fabricated); `avatar_url`
 * is deliberately NOT mapped (§3.8 media caveat).
 */
export function mapTestimonialItem(item: ReviewFeedItem): TestimonialItem {
  const result: TestimonialItem = { quote: item.content };
  if (item.reviewer_name) result.author = item.reviewer_name;
  if (typeof item.rating === "number") result.rating = item.rating;
  const linkConfig = reviewLinkConfig(item);
  if (linkConfig) result.linkConfig = linkConfig;
  return result;
}

/**
 * Coerce a wire `ReviewFeedItem` into the `ReviewItem` shape (§4.1c) for
 * `testimonials-list-verified` / `testimonials-images-helpful`: `content` (renamed from
 * `quote`), a required word-boundary `title`, a formatted `date`, and `verified: true`
 * (every feed item is platform-ingested).
 *
 * Returns `null` for an item WITHOUT a numeric rating — the item is DROPPED (not rendered
 * without a rating). Lockstep with the dashtrack-ai reference
 * `Feeds::Hydrator#review_item_shape` (`return nil unless rating.is_a?(Numeric)`): `rating`
 * is REQUIRED on `ReviewItem` and must never be fabricated (§2.3 rule 5). Callers filter the
 * nulls (mirror of the Ruby `filter_map`); if every item drops, an empty state is yielded.
 * Unreachable today (the server filters `rating >= min_rating`, excluding NULLs) but §3.8's
 * wire type is `rating int|null`, so the coercion enforces the invariant regardless.
 */
export function mapReviewItem(item: ReviewFeedItem): ReviewItem | null {
  if (typeof item.rating !== "number") return null;
  const result: ReviewItem = {
    content: item.content,
    title: reviewTitle(item.content),
    rating: item.rating,
    verified: true,
  };
  if (item.reviewer_name) result.author = item.reviewer_name;
  const date = formatFeedDate(item.time_created);
  if (date) result.date = date;
  return result;
}

/**
 * Coerce a wire `ReviewFeedItem` into the `SocialTestimonialItem` shape (§4.1c) for
 * `testimonials-twitter-cards`: `content` (renamed from `quote`); `handle` is unmapped.
 */
export function mapSocialTestimonialItem(item: ReviewFeedItem): SocialTestimonialItem {
  const result: SocialTestimonialItem = { content: item.content };
  if (item.reviewer_name) result.author = item.reviewer_name;
  const linkConfig = reviewLinkConfig(item);
  if (linkConfig) result.linkConfig = linkConfig;
  return result;
}

// ---------------------------------------------------------------------------
// Events feed (FEED_CONTRACT §3.9 / §4.1d) — client-side mirror of the dashtrack-ai
// `Feeds::Hydrator` events expansion. Keep the mapping table, truncation caps, date/time
// formats, and stat/action rules in lockstep with §4.1d and the Ruby reference.
// ---------------------------------------------------------------------------

/** Max heading length in codepoints (§4.1d). */
const EVENT_HEADING_MAX_LENGTH = 50;
/** Max description length in codepoints (§4.1d). */
const EVENT_DESCRIPTION_MAX_LENGTH = 130;
/** Constraint caps enforced in the mapper (§4.1d). */
const EVENT_MAX_STATS = 4;
const EVENT_MAX_ACTIONS = 2;

/**
 * Format an ISO-8601 instant (which already carries the event's offset) in the event's IANA
 * timezone. `timezone` is applied so the rendered wall-clock date/time matches §3.9's intent
 * ("tz-naive columns + timezone column applied"). Falls back to UTC when the timezone is
 * missing or not recognised by the runtime (never throws). Returns `undefined` for an
 * unparseable timestamp (never a fabricated date).
 */
function formatInEventZone(
  iso: string,
  options: Intl.DateTimeFormatOptions,
  timezone?: string | null
): string | undefined {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-US", { ...options, timeZone: tz }).format(parsed);
  } catch {
    // Unknown/invalid IANA zone → degrade to UTC rather than throw.
    formatted = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(parsed);
  }
  // Normalise the narrow / regular no-break space that some ICU builds insert before AM/PM
  // (U+202F / U+00A0) to an ASCII space, so the output is byte-identical across Node/ICU
  // versions AND with Ruby's `strftime` "%-l:%M %p" (which uses an ASCII space) — lockstep.
  return formatted.replace(/[\u202f\u00a0]/g, " ");
}

/**
 * Short date badge from `starts_at`, e.g. `"JUL 18"` (§4.1d `badgeText`). Uppercased
 * `"%b %-d"` in the event timezone. Returns `undefined` for an unparseable timestamp.
 */
function eventBadgeText(iso: string, timezone?: string | null): string | undefined {
  const formatted = formatInEventZone(
    iso,
    { month: "short", day: "numeric" },
    timezone
  );
  return formatted ? formatted.toUpperCase() : undefined;
}

/**
 * Formatted occurrence datetime `"%b %-d, %Y · %-l:%M %p"` in the event timezone (§4.1d
 * `locationLabel`), e.g. `"Jul 18, 2026 · 7:00 PM"`. The date and time halves are formatted
 * separately so the ` · ` separator is exact (Intl would otherwise use a locale comma). Returns
 * `undefined` for an unparseable timestamp.
 */
function eventDateTimeLabel(iso: string, timezone?: string | null): string | undefined {
  const datePart = formatInEventZone(
    iso,
    { month: "short", day: "numeric", year: "numeric" },
    timezone
  );
  const timePart = formatInEventZone(
    iso,
    { hour: "numeric", minute: "2-digit", hour12: true },
    timezone
  );
  if (!datePart || !timePart) return undefined;
  return `${datePart} · ${timePart}`;
}

/** First non-blank value among the candidates (Unicode-whitespace aware); else `undefined`. */
function firstReal(...candidates: Array<string | null | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate && candidate.replace(/\s+/gu, "").length > 0) return candidate;
  }
  return undefined;
}

/**
 * Map ONE event occurrence (wire `EventFeedItem`, §3.9) to `hero-event-registration` blockProps
 * (`EventHeroProps`, §4.1d). Client-side mirror of the dashtrack-ai `Feeds::Hydrator` events
 * expansion — keep in lockstep with the §4.1d mapping table.
 *
 * Rules (never fabricate; omit absent regions — the block null-guards every one):
 *   - `heading` = `title` truncated ≤ 50 codepoints at a word boundary.
 *   - `description` = `description` truncated ≤ 130 codepoints; OMITTED when blank.
 *   - `badgeText` = short date badge (`"JUL 18"`) from `starts_at` in the event tz.
 *   - `locationLabel` = formatted occurrence datetime in the event tz.
 *   - `locationSublabel` = `location_name` or `custom_address` (whichever real); omitted when neither.
 *   - `image` = `{ src: image_url, alt: title }` ONLY when `image_url` present.
 *   - `stats` = REAL only (`price_from` → "From"; `recurring_summary` → "Schedule"); the array is
 *     OMITTED entirely when no real stat exists (the registry `minItems: 1` is an AI-authoring
 *     constraint, not a runtime one). Capped at 4.
 *   - `actions` = `[{ label: "Register", href: registration_url }]` ONLY when present; capped at 2.
 *
 * The block minting (unique `_id`, inherited `_parent`, `_type`, `_feedMeta`) is the resolver's
 * job (`resolveEventsFeed`) — this stays a pure item→props mapper per repo convention.
 */
export function mapEventFeedItem(item: EventFeedItem): EventHeroProps {
  const props: EventHeroProps = {
    heading: truncateAtWordBoundary(item.title, EVENT_HEADING_MAX_LENGTH),
  };

  const description = truncateAtWordBoundary(
    item.description ?? "",
    EVENT_DESCRIPTION_MAX_LENGTH
  );
  if (description.length > 0) props.description = description;

  const badgeText = eventBadgeText(item.starts_at, item.timezone);
  if (badgeText) props.badgeText = badgeText;

  const locationLabel = eventDateTimeLabel(item.starts_at, item.timezone);
  if (locationLabel) props.locationLabel = locationLabel;

  const sublabel = firstReal(item.location_name, item.custom_address);
  if (sublabel) props.locationSublabel = sublabel;

  if (item.image_url) props.image = { src: item.image_url, alt: item.title };

  // REAL stats only — price first, then schedule; omit the whole array when neither exists.
  const stats: EventHeroStat[] = [];
  if (item.price_from) stats.push({ value: `$${item.price_from}`, label: "From" });
  if (item.recurring_summary) {
    stats.push({ value: item.recurring_summary, label: "Schedule" });
  }
  if (stats.length > 0) props.stats = stats.slice(0, EVENT_MAX_STATS);

  // Registration CTA only when the event links out (use_external_booking_site server-side).
  if (item.registration_url) {
    const actions: EventHeroAction[] = [
      { label: "Register", href: item.registration_url },
    ];
    props.actions = actions.slice(0, EVENT_MAX_ACTIONS);
  }

  return props;
}
