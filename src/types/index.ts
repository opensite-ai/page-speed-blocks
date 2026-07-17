import type { ReactNode } from "react";

/**
 * Block definition for component rendering
 * Compatible with Chai design payloads but optimized for @opensite/ui components
 */
export interface Block {
  /** Unique block identifier */
  _id: string;
  /**
   * Chai runtime block type — maps to the component name in the @opensite/ui registry.
   * Present on chai-shaped blocks. AI-generated wire blocks carry `block_ref`/`block_name`
   * instead (see below) and are normalized to `_type` lazily by the customer-sites renderer
   * (`chai_pages.tsx` `normalizeBlocks`), so at the data layer `_type` may be absent at runtime.
   * The data layer derives the component id with `blockType()` (FEED_CONTRACT §2/§4).
   */
  _type: string;
  /**
   * AI-generated wire block reference, e.g. `"gallery/instagram-post-grid"` (FEED_CONTRACT §2).
   * Present on octane-generated / persisted-verbatim pages instead of `_type`. The component id
   * is the segment after the last `/`. Lockstep with dashtrack-ai `Feeds::Hydrator#ref_component_id`
   * (`app/services/feeds/hydrator.rb`) and customer-sites `normalizeBlocks`.
   */
  block_ref?: string;
  /** AI-generated wire block name (fallback for `block_ref`); same `split("/").pop()` id rule. */
  block_name?: string;
  /**
   * AI-generated wire props container (FEED_CONTRACT §2). The customer-sites renderer rebuilds
   * `blockProps` from `data` ONLY, so hydration must write the bind target into `data` (not
   * `blockProps`) for `block_ref`/`block_name`-shaped blocks — see `resolveBlocks`.
   */
  data?: Record<string, unknown>;
  /** Optional human-readable name */
  _name?: string;
  /** Parent block ID (null for root blocks) */
  _parent?: string | null;
  /** HTML tag override */
  tag?: string;
  /** Tailwind CSS classes (can be pre-compiled or runtime) */
  styles?: string;
  /** Additional HTML attributes */
  styles_attrs?: Record<string, string | number | boolean | null>;
  /** Background image configuration */
  backgroundImage?: string;
  /** Text content */
  content?: string;
  /** Link configuration */
  link?: {
    href?: string;
    target?: string;
    rel?: string;
  };
  /** Image source */
  src?: string;
  /** Image alt text */
  alt?: string;
  /** Width (for images/videos) */
  width?: number | string;
  /** Height (for images/videos) */
  height?: number | string;
  /** Media reference for CDN integration */
  mediaReference?: {
    mediaRecordId?: number;
    mediaToken?: string;
    fallbackUrl?: string;
  };
  /** Additional component props */
  blockProps?: Record<string, unknown>;
  /**
   * Symbolic dynamic data source (FEED_CONTRACT §2). Describes *what data the block wants*,
   * never the data itself. Resolved into props by `resolveBlocks` (client) or the
   * dashtrack-ai hydrator (build time). Retained on the block after resolution so the
   * client can re-query (pagination / filtering).
   */
  dataSource?: DataSource;
  /**
   * Machine-readable feed resolution status (FEED_CONTRACT §2.3 rule 5). Attached at the
   * block level next to `blockProps`. `empty` and `error` are distinct and first-class.
   */
  _feedMeta?: FeedMeta;
  /** Allow any additional properties */
  [key: string]: unknown;
}

/**
 * Symbolic dynamic data source (FEED_CONTRACT §2.1 / §2.2).
 * All five source types are implemented: `blog_feed` / `blog_post` (Phase 1),
 * `testimonials_feed` (Phase 2), `instagram_feed` (Phase 3), and `events_feed` (Phase 4).
 * `events_feed` is the first EXPANDING source (`expands: true`) — one symbolic block hydrates
 * into N `hero-event-registration` block instances (§4.1d / D6).
 */
export interface DataSource {
  /** Source type — maps to a resolver in `resolveBlocks`. */
  type:
    | "blog_feed"
    | "blog_post"
    | "testimonials_feed"
    | "instagram_feed"
    | "events_feed";
  /** Max items to request (maps to `per_page`, clamped ≤ 50). */
  limit?: number;
  /** Item offset — combined with `limit` to derive a 1-based page. */
  offset?: number;
  /** Human-named category filter(s) (name first, slug second — resolved by the server hydrator). */
  category?: string | string[];
  /** Human-named tag filter(s). */
  tag?: string | string[];
  /** Most-recent ordering hint (no real `featured` flag exists yet — see §2.2). */
  featuredOnly?: boolean;
  /** `blog_post` selector: pin a specific post by slug. */
  slug?: string;
  /** `blog_post` selector: resolve the post from the current route. */
  current?: boolean;
  /** `instagram_feed` selector: profile hint (resolved server-side; §2.2 optionalFields). */
  profile?: string;
  /** `instagram_feed` caption filter — `ILIKE %#hashtag%` (§3.7); leading `#` optional. */
  hashtag?: string;
  /**
   * `testimonials_feed` curation floor (§3.8). Absent → server defaults to `4`; an explicit
   * `1` shows every rated review. `min_rating` implies `rating IS NOT NULL` server-side.
   */
  minRating?: number;
  /** `testimonials_feed` platform filter — `review_type` enum keys (§3.8); unknown key → empty. */
  platforms?: string[];
  /** `testimonials_feed` location filter — must be a member of the website's locations (§3.8). */
  locationId?: number | string;
  /**
   * `events_feed` window start — ISO-8601 date/datetime (§3.9). Absent → the server defaults
   * to now (occurrences are expanded within a mandatory bounded window, default now → +90d).
   */
  startDate?: string;
  /** `events_feed` window end — ISO-8601 (§3.9). Absent → server default +90d, capped at +366d. */
  endDate?: string;
  /**
   * `events_feed` location filter — repeated `location_ids[]` (§3.9). Each id must be a member
   * of the website's assigned locations (unknown/foreign id → empty result, never unfiltered).
   */
  locationIds?: (number | string)[];
  /**
   * `events_feed` upcoming-only hint (§2.2 optionalFields). The server's default window already
   * starts at "now" (i.e. upcoming-only by construction), so there is NO wire param for this on
   * the §3.9 endpoint; it is a symbolic hint the build-time hydrator may honor. The client mirror
   * does not serialize it (see `dataSourceToEventParams`).
   */
  upcomingOnly?: boolean;
  /** Override the bind target prop (else per-block default, else `"posts"`). */
  bindTo?: string;
  /** Sources are intentionally open (future filters). */
  [key: string]: unknown;
}

/**
 * Feed resolution status attached to a block after hydration (FEED_CONTRACT §2.3 rule 5).
 * `ok` carries pagination; `empty` / `error` carry a machine-readable `reason`.
 */
export interface FeedMeta {
  status: "ok" | "empty" | "error";
  /** Machine-readable reason, e.g. `no_published_posts`, `unknown_category:News`, `upstream_timeout`. */
  reason?: string;
  /** The source type this meta describes, e.g. `blog_feed`. */
  source: string;
  /** ISO-8601 timestamp of when resolution happened. */
  resolvedAt?: string;
  /** Present on `status: "ok"`. */
  page?: number;
  perPage?: number;
  totalPages?: number;
  totalRecords?: number;
  /**
   * For blocks minted by an expanding source (`expands: true`, FEED_CONTRACT §4.1d / D6):
   * the `_id` of the symbolic block this expanded block was hydrated from. Set on every
   * `hero-event-registration` instance produced by the `events_feed` resolver.
   */
  expandedFrom?: string;
}

/**
 * Transport-level error surfaced by `FeedClient` (FEED_CONTRACT §7.2 — errors are returned,
 * never thrown, never swallowed). `status` is the HTTP status, or `0` for network failures.
 */
export interface FeedError {
  status: number;
  message: string;
}

/**
 * Response envelope meta (wire shape, FEED_CONTRACT §3.3 — snake_case, locked for Phases 2–4).
 */
export interface FeedResponseMeta {
  page: number;
  per_page: number;
  total_pages: number;
  total_records: number;
}

/**
 * List response envelope returned by `FeedClient` list methods (FEED_CONTRACT §7.2).
 * `error` is set (and `data` is empty, `meta` is null) on any expected failure.
 */
export interface FeedListResponse<T> {
  data: T[];
  meta: FeedResponseMeta | null;
  error?: FeedError;
}

/**
 * Single-item response envelope (blog detail). `data` is null on failure / not-found.
 */
export interface FeedItemResponse<T> {
  data: T | null;
  error?: FeedError;
}

/** A named + slugged taxonomy entry (blog category / tag). */
export interface BlogFeedTaxonomy {
  name: string;
  slug: string;
}

/**
 * Blog feed list item — the wire shape (FEED_CONTRACT §3.4, snake_case).
 * Produced by `PublicFeeds::BlogSerializer` on toastability-service.
 */
export interface BlogFeedItem {
  id: number;
  token: string;
  slug: string;
  title: string;
  summary: string;
  /** `Blog#link_path` — null-link_path blogs are excluded from feeds server-side. */
  link_path: string;
  published_at: string;
  /** Display name only. */
  author: string;
  /** Featured/first image; null when none. */
  image_url: string | null;
  image_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  /** Null when uncategorized. */
  blog_category: BlogFeedTaxonomy | null;
  blog_tags: BlogFeedTaxonomy[];
}

/**
 * Blog detail item — list item plus body/related (FEED_CONTRACT §3.5).
 */
export interface BlogFeedDetailItem extends BlogFeedItem {
  /** Markdown or sanitized HTML (see `body_format`). */
  body: string;
  body_format: "markdown" | "html";
  updated_at: string;
  /** Up to 3 related list items — server-computed. */
  related: BlogFeedItem[];
}

/**
 * `BlogPostItem` — the resolved prop shape bound onto blocks (FEED_CONTRACT §4.1).
 * The wire→prop mapping table in §4.1 is the single source of truth for these fields.
 */
export interface BlogPostItem {
  id: number | string;
  title: string;
  summary?: string;
  /** From `blog_category.name`. */
  category?: string;
  author?: string;
  /** From `published_at`, formatted `"%b %-d, %Y"` (e.g. "Jul 1, 2026"). */
  date?: string;
  /** From `link_path` — already URL-encoded server-side. */
  href?: string;
  /** From `image_url`. */
  image?: string;
  /** From `image_alt`. */
  imageAlt?: string;
}

/**
 * `blog_post` detail props inlined into `article/*` blocks (FEED_CONTRACT §4.3).
 */
export interface BlogPostDetail extends BlogPostItem {
  /** From `body` — rendered via `@page-speed/markdown-to-jsx`. */
  markdownString?: string;
  /** From `blog_tags[].name`. */
  tags?: string[];
  /** From `related`, mapped per §4.1 (for templates that include blog-related-articles). */
  articles?: BlogPostItem[];
}

/**
 * A single servable Instagram media file (FEED_CONTRACT §3.7, snake_case).
 *
 * **Media URL rule (load-bearing, §3.7):** these URLs are the *re-hosted* MediaRecord CDN
 * URLs — never the expiring `instagram_post_files.img_url`/`video_url` columns. Files whose
 * re-hosting hasn't completed are omitted server-side, so a shipped file always has at least
 * its primary URL (`image_url` for images, `video_url` for videos). A video thumbnail
 * (`image_url` on a `video` file) MAY still be null when the thumb hasn't re-hosted yet.
 */
export interface InstagramFeedFile {
  media_type: "image" | "video";
  /** Re-hosted image / video-thumbnail CDN URL; null when unavailable. */
  image_url: string | null;
  /** Re-hosted video source CDN URL; null on image files. */
  video_url: string | null;
}

/**
 * Instagram feed list item — the wire shape (FEED_CONTRACT §3.7, snake_case).
 * Produced by `PublicFeeds::InstagramPostSerializer` on toastability-service. Engagement
 * counts are `number | null` (e.g. images carry no `view_count`); null counts are omitted
 * from the mapped prop (never fabricated as `0`).
 */
export interface InstagramFeedItem {
  id: string;
  /** `instagram_posts.url` permalink; opens instagram.com in a new tab. */
  permalink: string;
  caption: string | null;
  post_type: "image" | "video" | "gallery";
  /** Original post date (`created_at`, overwritten at ingest with `taken_at_timestamp`). */
  posted_at: string;
  like_count: number | null;
  comment_count: number | null;
  view_count: number | null;
  play_count: number | null;
  location_name: string | null;
  /** Servable, re-hosted media files (§3.7). Gallery posts carry N; the block uses the first. */
  files: InstagramFeedFile[];
}

/**
 * `InstagramPostItem` — the resolved prop shape bound onto the `instagram-post-grid` block
 * (FEED_CONTRACT §4.1b). Declared locally as the data-layer wire/prop shape (string-typed —
 * assignable to the block's `React.ReactNode` caption/date props); requires no `@opensite/ui`
 * dependency. The §4.1b wire→prop mapping table is the single source of truth for these fields.
 */
export interface InstagramPostItem {
  /** From `id` — string-coerced. */
  id: string;
  /** From `permalink` — opens instagram.com in a new tab. */
  href: string;
  /** From `files[0].image_url` — required; items without it are skipped (§4.1b). */
  image: string;
  /** Truncated `caption`, fallback `"Instagram post"`. */
  imageAlt?: string;
  /** From `caption` (the block truncates for display). */
  caption?: string;
  /** From `post_type == "video"`. */
  isVideo?: boolean;
  /** From `files[0].video_url` — only when `isVideo`. */
  videoUrl?: string;
  /** From `posted_at`, formatted `"%b %-d, %Y"` (§4.1). */
  date?: string;
  /** From `like_count` — omitted when the wire count is null. */
  likeCount?: number;
  /** From `comment_count` — omitted when the wire count is null. */
  commentCount?: number;
  /** From `view_count` — omitted when the wire count is null. */
  viewCount?: number;
}

/**
 * Normalized `FeedClient` Instagram list params (FEED_CONTRACT §3.7). `per_page` is clamped
 * ≤ 50 client-side; every provided filter is serialized on every call.
 */
export interface InstagramFeedParams {
  page?: number;
  /** Clamped to ≤ 50 client-side. */
  perPage?: number;
  /** Caption filter (`ILIKE %#hashtag%`); leading `#` is optional. */
  hashtag?: string;
}

/**
 * Reviews / testimonials feed list item — the wire shape (FEED_CONTRACT §3.8, snake_case).
 * Produced by `PublicFeeds::ReviewSerializer` on toastability-service. The field list is
 * locked: nothing beyond these eight fields is present on the wire.
 */
export interface ReviewFeedItem {
  /** `location_reviews.id` — a uuid, string-coerced. */
  id: string;
  reviewer_name: string;
  /** `int | null` passthrough — recommendation-only reviews coerce to 5 at ingest. */
  rating: number | null;
  content: string;
  /** `review_type` enum KEY string (e.g. `"google"`, `"yelp"`). */
  platform: string;
  time_created: string;
  /** Reviewer's platform profile URL; null when absent. Maps to `linkConfig` (§4.1c). */
  profile_url: string | null;
  /**
   * ⚠ Hotlinked platform avatar URL (§3.8 media caveat). Present on the wire for future use
   * but **intentionally NOT mapped by Phase 2 hydration** (rot-prone images must not reach
   * client sites). The mappers below never read this field.
   */
  avatar_url: string | null;
}

/**
 * Base testimonial prop shape (FEED_CONTRACT §4.1c). Declared locally as a string-typed
 * wire/prop shape (assignable to the block's `React.ReactNode` text props) — requires no
 * `@opensite/ui` dependency, mirroring `InstagramPostItem`. `avatarSrc` is intentionally
 * absent (Phase 2 does not map avatars).
 */
export interface TestimonialItem {
  /** From `content` — plain string. */
  quote: string;
  /** From `reviewer_name`. */
  author?: string;
  /** From `rating` — only when numeric (never fabricated). */
  rating?: number;
  /** From `profile_url` + `platform` — `{ label: "Read on <Platform>", href }`, only when `profile_url`. */
  linkConfig?: { label: string; href: string };
}

/**
 * `ReviewItem` prop shape for `testimonials-list-verified` / `testimonials-images-helpful`
 * (FEED_CONTRACT §4.1c). Coerced from `TestimonialItem`: `quote` → `content`, plus a required
 * `title` (content truncated at a word boundary) and a `date`. `verified` is always `true` —
 * every feed item is a platform-ingested review.
 */
export interface ReviewItem {
  /** From `content` (renamed from `quote`). */
  content: string;
  /** Required — `content` truncated at a word boundary (~40 chars). */
  title: string;
  /** From `rating` — only when numeric (never fabricated). */
  rating?: number;
  /** From `reviewer_name`. */
  author?: string;
  /** From `time_created`, formatted `"%b %-d, %Y"` (§4.1). */
  date?: string;
  /** Always `true` — feed items are platform-ingested reviews (§4.1c). */
  verified: boolean;
}

/**
 * `SocialTestimonialItem` prop shape for `testimonials-twitter-cards` (FEED_CONTRACT §4.1c).
 * Uses `content` (not `quote`); `handle` is intentionally unmapped.
 */
export interface SocialTestimonialItem {
  /** From `content` (renamed from `quote`). */
  content: string;
  /** From `reviewer_name`. */
  author?: string;
  /** From `profile_url` + `platform`, only when `profile_url` present. */
  linkConfig?: { label: string; href: string };
}

/**
 * Normalized `FeedClient` reviews list params (FEED_CONTRACT §3.8). `perPage` is clamped ≤ 50
 * client-side; `platforms` serializes as repeated `platforms[]` params; every provided filter
 * is resent on every call.
 */
export interface ReviewFeedParams {
  page?: number;
  /** Clamped to ≤ 50 client-side. */
  perPage?: number;
  /** Maps to `min_rating`; server defaults to 4 when absent. */
  minRating?: number;
  /** `review_type` enum keys; serialized as repeated `platforms[]` params. */
  platforms?: string[];
  /** Maps to `location_id`. */
  locationId?: number | string;
  sortBy?: "time_created" | "rating";
  sortDir?: "asc" | "desc";
}

/**
 * Events feed list item — the wire shape (FEED_CONTRACT §3.9, snake_case, FLAT).
 * Produced by `PublicFeeds::EventSerializer` on toastability-service. The feed returns
 * OCCURRENCES (not raw events): recurrence is expanded server-side within a bounded window and
 * RRULE internals NEVER ship. The field list is locked — nothing beyond these is on the wire
 * (FORBIDDEN: head counts, job fields, nested org/location objects, package/recurrence internals).
 */
export interface EventFeedItem {
  /** Event id, string-coerced. */
  id: string;
  /** Event id + occurrence index within the window, e.g. `"123:2"` (§3.9). */
  occurrence_id: string;
  title: string;
  /** Plain text. */
  description: string;
  /** ISO-8601 WITH offset (tz-naive columns + `timezone` applied). */
  starts_at: string;
  /** ISO-8601 WITH offset; null when the event has no end. */
  ends_at: string | null;
  /** IANA timezone, e.g. `"America/Phoenix"`. */
  timezone: string;
  location_name: string | null;
  custom_address: string | null;
  /** MediaRecord CDN URL ONLY (§3.7 re-hosting rule); null when none. */
  image_url: string | null;
  /** Only present when `use_external_booking_site`; null otherwise. */
  registration_url: string | null;
  booking_behavior: string;
  /** MIN over `event_packages`, only when packages exist; null otherwise. Decimal string. */
  price_from: string | null;
  /** Server-built human string, e.g. `"Weekly on Fridays"`; null for single events. */
  recurring_summary: string | null;
}

/**
 * A single stat chip on an expanded event hero (FEED_CONTRACT §4.1d). REAL data only — the
 * `stats` array is omitted entirely when no real stat exists (never fabricated / zero-filled).
 */
export interface EventHeroStat {
  value: string;
  label: string;
}

/** A single CTA on an expanded event hero (FEED_CONTRACT §4.1d). */
export interface EventHeroAction {
  label: string;
  href: string;
}

/** The image slot on an expanded event hero (FEED_CONTRACT §4.1d); present only when real. */
export interface EventHeroImage {
  src: string;
  alt: string;
}

/**
 * `hero-event-registration` blockProps produced by mapping ONE event occurrence
 * (FEED_CONTRACT §4.1d). Declared locally as a string-typed prop shape (assignable to the
 * block's `React.ReactNode` text regions), mirroring `InstagramPostItem` / `TestimonialItem` —
 * requires no `@opensite/ui` dependency. Every optional region is OMITTED when the occurrence
 * has no real value for it (the block null-guards each region; §4.1d "omit absent"). Constraint
 * caps are enforced by the mapper: `actions ≤ 2`, `stats ≤ 4`.
 */
export interface EventHeroProps {
  /** From `title` — truncated ≤ 50 codepoints at a word boundary (§4.1d). */
  heading: string;
  /** From `description` — truncated ≤ 130 codepoints; omitted when blank. */
  description?: string;
  /** Short date badge from `starts_at` in the event tz, e.g. `"JUL 18"`. */
  badgeText?: string;
  /** Formatted occurrence datetime `"%b %-d, %Y · %-l:%M %p"` in the event tz. */
  locationLabel?: string;
  /** `location_name` or `custom_address` (whichever is real); omitted when neither. */
  locationSublabel?: string;
  /** `{ src, alt: title }` only when `image_url` is present. */
  image?: EventHeroImage;
  /** REAL stats only (`price_from` → "From"; `recurring_summary` → "Schedule"); omitted when none. */
  stats?: EventHeroStat[];
  /** `[{ label: "Register", href }]` only when `registration_url` is present; omitted otherwise. */
  actions?: EventHeroAction[];
}

/**
 * Normalized `FeedClient` events list params (FEED_CONTRACT §3.9). `perPage` is clamped ≤ 50
 * client-side; `locationIds` serializes as repeated `location_ids[]` params; every provided
 * filter is resent on every call.
 */
export interface EventFeedParams {
  page?: number;
  /** Clamped to ≤ 50 client-side (events additionally cap the render count at 12 — §4.1d). */
  perPage?: number;
  /** Maps to `start_date` (ISO-8601). */
  startDate?: string;
  /** Maps to `end_date` (ISO-8601). */
  endDate?: string;
  /** `websites.website_location_assignments` ids; serialized as repeated `location_ids[]`. */
  locationIds?: (number | string)[];
}

/**
 * Normalized `FeedClient` list params. The client is the single place that builds feed URLs
 * (FEED_CONTRACT §7.2) and serializes every provided filter on every call.
 */
export interface BlogFeedParams {
  page?: number;
  /** Clamped to ≤ 50 client-side. */
  perPage?: number;
  /** Scalar uses `category_slug`; arrays use repeated `category_slug[]`. */
  categorySlug?: string | string[];
  /** Scalar uses `tag_slug`; arrays use repeated `tag_slug[]`. */
  tagSlug?: string | string[];
  query?: string;
  sortBy?: "published_at" | "title";
  sortDir?: "asc" | "desc";
}

/** Options for {@link createFeedClient}. */
export interface CreateFeedClientOptions {
  /** Feeds API origin — never hardcoded (legacy bug #6). */
  baseUrl: string;
  /** `websites.token` — the single scoping identifier (legacy bug #7). */
  websiteToken: string;
  /** Injectable fetch (tests / non-global environments). Defaults to the global `fetch`. */
  fetcher?: typeof fetch;
}

/**
 * Typed client for the §3 feed endpoints. The single place that builds feed URLs.
 * Never throws for expected failures — surfaces `{ data, meta, error }`.
 */
export interface FeedClient {
  listBlogs(params?: BlogFeedParams): Promise<FeedListResponse<BlogFeedItem>>;
  getBlog(slug: string): Promise<FeedItemResponse<BlogFeedDetailItem>>;
  listBlogCategories(): Promise<FeedListResponse<BlogFeedTaxonomy>>;
  listBlogTags(): Promise<FeedListResponse<BlogFeedTaxonomy>>;
  listInstagram(
    params?: InstagramFeedParams
  ): Promise<FeedListResponse<InstagramFeedItem>>;
  listReviews(
    params?: ReviewFeedParams
  ): Promise<FeedListResponse<ReviewFeedItem>>;
  listEvents(
    params?: EventFeedParams
  ): Promise<FeedListResponse<EventFeedItem>>;
}

/** Options for {@link resolveBlocks} (FEED_CONTRACT §7.1). */
export interface ResolveBlocksOptions {
  fetcher?: typeof fetch;
  /** Feeds API origin — never hardcoded (legacy bug #6). */
  baseUrl: string;
  /** `websites.token`. */
  websiteToken: string;
  /** Current route path — resolves `blog_post { current: true }` slugs from the last segment. */
  path?: string;
  /**
   * Extension point (D6, `expands: true`). Override or add source resolvers keyed by
   * `DataSource["type"]`; merged over the built-in `blog_feed` / `blog_post` resolvers.
   * A resolver may return more blocks than it received (one-to-many expansion).
   */
  sources?: Record<string, FeedSourceResolver>;
}

/** Context handed to a {@link FeedSourceResolver}. */
export interface FeedSourceContext {
  /** The input block carrying the `dataSource`. */
  block: Block;
  /** The block's `dataSource`. */
  dataSource: DataSource;
  /** Shared feed client for this resolution pass. */
  client: FeedClient;
  /** Current route path (for `current: true` selectors). */
  path?: string;
  /** Resolved bind target prop (FEED_CONTRACT §2.3 rule 6). */
  bindTarget: string;
}

/**
 * A source resolver turns one input block into zero-or-more output blocks (FEED_CONTRACT D6).
 * `expands: true` sources return arrays longer than 1; the default blog sources return `[block]`.
 */
export type FeedSourceResolver = (
  ctx: FeedSourceContext
) => Promise<Block[]>;

/**
 * Design payload containing block tree
 */
export interface DesignPayload {
  version: string;
  blocks: Block[];
}

/**
 * Context passed to block renderers
 */
export interface BlockRenderContext {
  /** All blocks in the payload */
  blocks: Block[];
  /** Function to render child blocks */
  renderChildren: (parentId: string) => ReactNode | ReactNode[] | null;
  /**
   * Optional arbitrary data bag threaded from `BlocksRenderer`'s `data` prop
   * (FEED_CONTRACT §7.3). Lets renderers read route-injected / hydrated data.
   */
  data?: Record<string, unknown>;
}

/**
 * Props for block renderer functions
 */
export interface BlockRendererProps {
  block: Block;
  context: BlockRenderContext;
}

/**
 * Block renderer function signature
 */
export type BlockRenderer = (props: BlockRendererProps) => ReactNode;

/**
 * Component registry entry
 */
export interface RegistryEntry {
  /** Component name */
  name: string;
  /** Renderer function */
  renderer: BlockRenderer;
  /** Optional metadata */
  metadata?: {
    category?: string;
    description?: string;
    version?: string;
  };
}
