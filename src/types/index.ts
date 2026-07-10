import type { ReactNode } from "react";

/**
 * Block definition for component rendering
 * Compatible with Chai design payloads but optimized for @opensite/ui components
 */
export interface Block {
  /** Unique block identifier */
  _id: string;
  /** Block type - maps to component name from @opensite/ui */
  _type: string;
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
 * All five source types ship as contract types; `blog_feed` / `blog_post` (Phase 1) and
 * `instagram_feed` (Phase 3) are implemented, `testimonials_feed` / `events_feed` are types-only.
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
  /** Human-named category filter (name first, slug second — resolved by the server hydrator). */
  category?: string;
  /** Human-named tag filter. */
  tag?: string;
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
 * Normalized `FeedClient` list params. The client is the single place that builds feed URLs
 * (FEED_CONTRACT §7.2) and serializes every provided filter on every call.
 */
export interface BlogFeedParams {
  page?: number;
  /** Clamped to ≤ 50 client-side. */
  perPage?: number;
  categorySlug?: string;
  tagSlug?: string;
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
