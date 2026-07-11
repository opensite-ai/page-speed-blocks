import type {
  Block,
  BlogFeedParams,
  BlogPostItem,
  DataSource,
  EventFeedItem,
  EventFeedParams,
  FeedMeta,
  FeedResponseMeta,
  FeedSourceContext,
  FeedSourceResolver,
  InstagramFeedParams,
  InstagramPostItem,
  ResolveBlocksOptions,
  ReviewFeedItem,
  ReviewFeedParams,
  ReviewItem,
} from "../types/index.js";
import { createFeedClient } from "./feed-client.js";
import {
  mapBlogFeedDetail,
  mapBlogFeedItem,
  mapEventFeedItem,
  mapInstagramFeedItem,
  mapReviewItem,
  mapSocialTestimonialItem,
  mapTestimonialItem,
} from "./mappers.js";

/**
 * Per-block default bind targets (FEED_CONTRACT §2.4). Blocks not listed here fall through
 * to `"posts"`. Only the non-default targets are enumerated.
 */
export const DEFAULT_BIND_TARGETS: Record<string, string> = {
  "blog-related-articles": "articles",
  "blog-tech-insights": "secondaryPosts",
  "carousel-badge-cards": "items",
  "carousel-gradient-overlay": "items",
  "carousel-demo-link": "items",
  "carousel-gradient-text": "items",
  // Phase 3: Instagram gallery block (§4.1b — lockstep with dashtrack-ai + @opensite/ui).
  "instagram-post-grid": "items",
  // Phase 2: testimonials blocks (§4.1c — lockstep with dashtrack-ai + @opensite/ui).
  // Array blocks binding `TestimonialItem[]` (+ twitter-cards' SocialTestimonialItem[]) → `testimonials`.
  "testimonials-centered-avatars": "testimonials",
  "testimonials-marquee": "testimonials",
  "testimonials-masonry-grid": "testimonials",
  "testimonials-minimal-numbered": "testimonials",
  "testimonials-quote-carousel": "testimonials",
  "testimonials-simple-grid": "testimonials",
  "testimonials-slider-minimal": "testimonials",
  "testimonials-stats-header": "testimonials",
  "testimonials-animated-split": "testimonials",
  "testimonials-bento-grid": "testimonials",
  "testimonials-carousel-image": "testimonials",
  "testimonials-logo-cards": "testimonials",
  "testimonials-mini-dividers": "testimonials",
  "testimonials-parallax-number": "testimonials",
  "testimonials-scrolling-columns": "testimonials",
  "testimonials-wall-compact": "testimonials",
  "testimonials-twitter-cards": "testimonials",
  // Blocks whose array prop is named `reviews` (§4.1c).
  "testimonials-list-verified": "reviews",
  "testimonials-images-helpful": "reviews",
  "testimonials-grid-add-review": "reviews",
};

/**
 * Blocks that bind a SINGLE item OBJECT (not an array) to their target prop (FEED_CONTRACT
 * §4.1c). Generic — any source's resolver may consult this map to bind `items[0]` as an object.
 * Phase 2 uses it for the single-quote testimonials trio (prop `testimonial`).
 */
export const SINGLE_BIND_TARGETS: Record<string, string> = {
  "testimonials-company-logo": "testimonial",
  "testimonials-large-quote": "testimonial",
  "testimonials-split-image": "testimonial",
};

/** Final fallback bind target (FEED_CONTRACT §2.3 rule 6). */
export const DEFAULT_BIND_TARGET = "posts";

/** Gallery blocks require coerced carousel items (FEED_CONTRACT §2.4). */
const GALLERY_BLOCK_TYPES = new Set([
  "carousel-badge-cards",
  "carousel-gradient-overlay",
  "carousel-demo-link",
  "carousel-gradient-text",
]);

/**
 * Resolve the bind target for a block: explicit `bindTo` → single-bind default → per-block
 * array default → `"posts"`. (Single-bind and array-bind block types are disjoint, so the
 * ordering of the two default maps only matters for clarity.)
 */
export function resolveBindTarget(block: Block): string {
  const explicit = block.dataSource?.bindTo;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return (
    SINGLE_BIND_TARGETS[block._type] ??
    DEFAULT_BIND_TARGETS[block._type] ??
    DEFAULT_BIND_TARGET
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Attach `_feedMeta` to a copy of the block; everything else (incl. `dataSource`) is retained. */
function withFeedMeta(block: Block, meta: FeedMeta): Block {
  return { ...block, _feedMeta: meta };
}

function okMeta(source: string, meta: FeedResponseMeta | null): FeedMeta {
  return {
    status: "ok",
    source,
    resolvedAt: nowIso(),
    page: meta?.page,
    perPage: meta?.per_page,
    totalPages: meta?.total_pages,
    totalRecords: meta?.total_records,
  };
}

/** Map a symbolic `dataSource` to `FeedClient` list params (client-side mirror of the hydrator). */
function dataSourceToBlogParams(source: DataSource): BlogFeedParams {
  const params: BlogFeedParams = {};
  if (typeof source.limit === "number") params.perPage = source.limit;
  if (
    typeof source.offset === "number" &&
    typeof source.limit === "number" &&
    source.limit > 0
  ) {
    params.page = Math.floor(source.offset / source.limit) + 1;
  }
  // On the client, human-named filters are already resolved to slugs by the server hydrator
  // (FEED_CONTRACT §2.3 rule 3); pass them through as slug filters.
  if (typeof source.category === "string") params.categorySlug = source.category;
  if (typeof source.tag === "string") params.tagSlug = source.tag;
  return params;
}

/**
 * Inline resolved `BlogPostItem[]` into the bind target, applying the §2.4 special cases.
 * Only the bind target (and, for tech-insights, an unset `featuredPost`) is written — every
 * other authored prop is untouched (FEED_CONTRACT §2.3 rule 2).
 */
function inlineBlogItems(
  block: Block,
  bindTarget: string,
  items: BlogPostItem[]
): Block {
  const blockProps: Record<string, unknown> = { ...(block.blockProps ?? {}) };

  let finalItems: BlogPostItem[] = items;
  if (GALLERY_BLOCK_TYPES.has(block._type)) {
    // Carousel items require a non-null image and a string id (§2.4).
    finalItems = items
      .filter((item) => Boolean(item.image))
      .map((item) => ({ ...item, id: String(item.id) }));
  }

  blockProps[bindTarget] = finalItems;

  // blog-tech-insights: set featuredPost to the first item when unset (§2.4).
  if (
    block._type === "blog-tech-insights" &&
    blockProps.featuredPost == null &&
    finalItems.length > 0
  ) {
    blockProps.featuredPost = finalItems[0];
  }

  return { ...block, blockProps };
}

/**
 * Built-in `blog_feed` resolver. Fetches the list, maps items, inlines into the bind target,
 * and attaches `_feedMeta`. Empty and error states are distinct (FEED_CONTRACT §2.3 rule 5).
 */
const resolveBlogFeed: FeedSourceResolver = async ({
  block,
  dataSource,
  client,
  bindTarget,
}) => {
  const response = await client.listBlogs(dataSourceToBlogParams(dataSource));

  if (response.error) {
    return [
      withFeedMeta(block, {
        status: "error",
        reason: "upstream_error",
        source: "blog_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  const items = response.data.map(mapBlogFeedItem);
  if (items.length === 0) {
    return [
      withFeedMeta(block, {
        status: "empty",
        reason: "no_published_posts",
        source: "blog_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  const inlined = inlineBlogItems(block, bindTarget, items);
  return [withFeedMeta(inlined, okMeta("blog_feed", response.meta))];
};

/** Map a symbolic `instagram_feed` `dataSource` to `FeedClient` Instagram list params (§3.7). */
function dataSourceToInstagramParams(source: DataSource): InstagramFeedParams {
  const params: InstagramFeedParams = {};
  if (typeof source.limit === "number") params.perPage = source.limit;
  if (typeof source.hashtag === "string") params.hashtag = source.hashtag;
  return params;
}

/**
 * Built-in `instagram_feed` resolver. Fetches the list, maps items (skipping imageless posts
 * per §4.1b), inlines the survivors into the bind target, and attaches `_feedMeta`. Empty and
 * error states are distinct (FEED_CONTRACT §2.3 rule 5), mirroring `blog_feed` conventions.
 */
const resolveInstagramFeed: FeedSourceResolver = async ({
  block,
  dataSource,
  client,
  bindTarget,
}) => {
  const response = await client.listInstagram(dataSourceToInstagramParams(dataSource));

  if (response.error) {
    return [
      withFeedMeta(block, {
        status: "error",
        reason: "upstream_error",
        source: "instagram_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  // Skip imageless posts (§4.1b): `mapInstagramFeedItem` returns null when `files[0].image_url`
  // is absent (e.g. a video whose thumbnail hasn't re-hosted yet).
  const items = response.data
    .map(mapInstagramFeedItem)
    .filter((item): item is InstagramPostItem => item !== null);

  if (items.length === 0) {
    return [
      withFeedMeta(block, {
        status: "empty",
        reason: "no_instagram_posts",
        source: "instagram_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  const blockProps: Record<string, unknown> = { ...(block.blockProps ?? {}) };
  blockProps[bindTarget] = items;

  return [withFeedMeta({ ...block, blockProps }, okMeta("instagram_feed", response.meta))];
};

/** Map a symbolic `testimonials_feed` `dataSource` to `FeedClient` review list params (§3.8). */
function dataSourceToReviewParams(source: DataSource): ReviewFeedParams {
  const params: ReviewFeedParams = {};
  if (typeof source.limit === "number") params.perPage = source.limit;
  if (typeof source.minRating === "number") params.minRating = source.minRating;
  if (Array.isArray(source.platforms)) {
    params.platforms = source.platforms.filter(
      (platform): platform is string => typeof platform === "string"
    );
  }
  if (typeof source.locationId === "number" || typeof source.locationId === "string") {
    params.locationId = source.locationId;
  }
  return params;
}

/** Blocks whose `reviews` prop expects the `ReviewItem` shape (§4.1c). */
const REVIEW_ITEM_BLOCK_TYPES = new Set([
  "testimonials-list-verified",
  "testimonials-images-helpful",
]);

/** Blocks whose prop expects the `SocialTestimonialItem` shape (§4.1c). */
const SOCIAL_TESTIMONIAL_BLOCK_TYPES = new Set(["testimonials-twitter-cards"]);

/**
 * Inline resolved review items into the bind target, choosing the per-block item shape (§4.1c):
 * `ReviewItem` for list-verified/images-helpful, `SocialTestimonialItem` for twitter-cards, and
 * the base `TestimonialItem` for everything else. Single-bind blocks (§4.1c) receive `items[0]`
 * as a single OBJECT rather than an array. Only the bind target is written — every other
 * authored prop is untouched (§2.3 rule 2).
 *
 * Returns `null` when the `ReviewItem` coercion DROPS every item (none carried a numeric
 * rating). Lockstep with the dashtrack-ai reference `Feeds::Hydrator#coerce_testimonials`
 * (`filter_map { review_item_shape }`) + the `items.empty?` guard in `#hydrate_testimonials_feed`:
 * a block with nothing to render is an honest empty state, not `ok`. Only the two ReviewItem
 * blocks can drop; base (incl. grid-add-review) and social shapes never drop.
 */
function inlineTestimonialItems(
  block: Block,
  bindTarget: string,
  wireItems: ReviewFeedItem[]
): Block | null {
  const blockProps: Record<string, unknown> = { ...(block.blockProps ?? {}) };

  // Single-bind: bind the first item as a single OBJECT (base TestimonialItem), never an array.
  if (block._type in SINGLE_BIND_TARGETS) {
    blockProps[bindTarget] = mapTestimonialItem(wireItems[0]);
    return { ...block, blockProps };
  }

  let items: unknown[];
  if (REVIEW_ITEM_BLOCK_TYPES.has(block._type)) {
    // filter_map mirror: `mapReviewItem` returns null for items lacking a numeric rating,
    // dropping them (rating is REQUIRED on ReviewItem — §2.3 rule 5, lockstep hydrator.rb).
    const reviewItems = wireItems
      .map(mapReviewItem)
      .filter((item): item is ReviewItem => item !== null);
    // All items dropped → nothing to render → honest empty state (handled by the caller).
    if (reviewItems.length === 0) return null;
    items = reviewItems;
  } else if (SOCIAL_TESTIMONIAL_BLOCK_TYPES.has(block._type)) {
    items = wireItems.map(mapSocialTestimonialItem);
  } else {
    items = wireItems.map(mapTestimonialItem);
  }

  blockProps[bindTarget] = items;
  return { ...block, blockProps };
}

/**
 * Built-in `testimonials_feed` resolver (FEED_CONTRACT §3.8 / §4.1c). Fetches the reviews list,
 * coerces to the per-block item shape, inlines into the bind target (array, or a single object
 * for the single-bind trio), and attaches `_feedMeta`. Empty (`no_reviews`) and error
 * (`upstream_error`) states are distinct (§2.3 rule 5), mirroring the blog / instagram siblings.
 */
const resolveReviewsFeed: FeedSourceResolver = async ({
  block,
  dataSource,
  client,
  bindTarget,
}) => {
  const response = await client.listReviews(dataSourceToReviewParams(dataSource));

  if (response.error) {
    return [
      withFeedMeta(block, {
        status: "error",
        reason: "upstream_error",
        source: "testimonials_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  if (response.data.length === 0) {
    return [
      withFeedMeta(block, {
        status: "empty",
        reason: "no_reviews",
        source: "testimonials_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  const inlined = inlineTestimonialItems(block, bindTarget, response.data);

  // The ReviewItem coercion can drop every fetched item (none carried a numeric rating);
  // that is an honest empty state, not `ok`. Mirrors hydrator.rb `#hydrate_testimonials_feed`
  // `items.empty?` → `status: 'empty', reason: 'no_reviews'` (EMPTY_REASON).
  if (inlined === null) {
    return [
      withFeedMeta(block, {
        status: "empty",
        reason: "no_reviews",
        source: "testimonials_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  return [withFeedMeta(inlined, okMeta("testimonials_feed", response.meta))];
};

// ---------------------------------------------------------------------------
// Events feed (FEED_CONTRACT §3.9 / §4.1d, D6) — the FIRST expanding source: ONE symbolic block
// hydrates into N `hero-event-registration` block instances (one per occurrence). Keep the
// expansion mechanics, `_id` scheme, and `_feedMeta` contract in lockstep with the dashtrack-ai
// `Feeds::Hydrator` events expansion.
// ---------------------------------------------------------------------------

/** The block type every expanded event occurrence is minted as (§4.1d). */
const HERO_EVENT_BLOCK_TYPE = "hero-event-registration";
/** Default number of event heroes to render when `dataSource.limit` is unset (§4.1d). */
const EVENT_LIMIT_DEFAULT = 6;
/** Hard cap on rendered event heroes — N-hero pages are visually heavy (§4.1d). */
const EVENT_LIMIT_MAX = 12;

/**
 * Resolve the number of event heroes to render: `dataSource.limit` when a positive number, else
 * the default (6); always capped at 12 (§4.1d). This doubles as the fetch `per_page` so we never
 * pull occurrences we won't render.
 */
function eventLimit(source: DataSource): number {
  const raw = typeof source.limit === "number" ? Math.trunc(source.limit) : NaN;
  const base = Number.isFinite(raw) && raw > 0 ? raw : EVENT_LIMIT_DEFAULT;
  return Math.min(base, EVENT_LIMIT_MAX);
}

/**
 * Map a symbolic `events_feed` `dataSource` to `FeedClient` event list params (§3.9). `per_page`
 * is set to the render limit (default 6, hard cap 12) so the request and the expansion align.
 * `upcomingOnly` has no §3.9 wire param (the server's default window starts at "now"), so it is
 * intentionally not forwarded here.
 */
function dataSourceToEventParams(source: DataSource): EventFeedParams {
  const params: EventFeedParams = { perPage: eventLimit(source) };
  if (typeof source.startDate === "string") params.startDate = source.startDate;
  if (typeof source.endDate === "string") params.endDate = source.endDate;
  if (Array.isArray(source.locationIds)) {
    params.locationIds = source.locationIds.filter(
      (id): id is number | string =>
        typeof id === "number" || typeof id === "string"
    );
  }
  return params;
}

/**
 * Mint the unique `_id` for an expanded event block (§4.1d):
 * `"<symbolic_id>__ev_<event_id>_<occurrence_index>"`. The occurrence index is parsed from the
 * wire `occurrence_id` (`"<event_id>:<index>"`); if it is malformed (no `:`), the array position
 * is used as a deterministic fallback so the `_id` is always globally unique (duplicate `_id`s
 * corrupt React keys and child lookups — the primary expansion failure mode).
 */
function expandedEventId(sourceId: string, item: EventFeedItem, position: number): string {
  const occurrenceId = item.occurrence_id ?? "";
  const colon = occurrenceId.lastIndexOf(":");
  const index = colon >= 0 ? occurrenceId.slice(colon + 1) : String(position);
  return `${sourceId}__ev_${item.id}_${index}`;
}

/**
 * Mint one `hero-event-registration` block from an event occurrence. Block-level presentation
 * (styles, tag, `_name`) is inherited from the symbolic block; `_parent` is inherited so the
 * heroes render as siblings in the source's slot (or as roots if the source was a root).
 *
 * The `dataSource` is DELIBERATELY DROPPED: the expanded heroes are concrete blocks, not symbolic
 * sources, and re-running `resolveBlocks` must not re-expand them. `blockProps` are the fresh
 * mapped occurrence props (§4.1d) — NOT merged with the symbolic block's authored props: for an
 * expanding source there is no single bind target, and each hero must show ONLY real occurrence
 * data with absent regions collapsing (contract "omit absent"), so `bindTarget` is ignored.
 */
function mintEventBlock(sourceBlock: Block, item: EventFeedItem, position: number): Block {
  const {
    dataSource: _omitDataSource,
    blockProps: _omitBlockProps,
    _feedMeta: _omitFeedMeta,
    ...rest
  } = sourceBlock;
  const blockProps: Record<string, unknown> = { ...mapEventFeedItem(item) };
  const eventBlock: Block = {
    ...rest,
    _id: expandedEventId(sourceBlock._id, item, position),
    _type: HERO_EVENT_BLOCK_TYPE,
    _parent: sourceBlock._parent ?? null,
    blockProps,
  };
  return withFeedMeta(eventBlock, {
    status: "ok",
    source: "events_feed",
    expandedFrom: sourceBlock._id,
    resolvedAt: nowIso(),
  });
}

/**
 * Built-in `events_feed` resolver (FEED_CONTRACT §3.9 / §4.1d, D6). Fetches the occurrence list
 * and EXPANDS into N `hero-event-registration` blocks (`limit` default 6, hard cap 12), each
 * carrying `{status:'ok', source:'events_feed', expandedFrom:<symbolic_id>}` meta. On empty
 * (`no_upcoming_events`) or error (`upstream_error`) the ORIGINAL symbolic block stays in place
 * UNEXPANDED with the usual `_feedMeta`, so the empty / error renderers work unchanged (§2.3
 * rule 5 — empty / error are first-class and there is no wrapper-block concept).
 */
const resolveEventsFeed: FeedSourceResolver = async ({ block, dataSource, client }) => {
  const response = await client.listEvents(dataSourceToEventParams(dataSource));

  if (response.error) {
    return [
      withFeedMeta(block, {
        status: "error",
        reason: "upstream_error",
        source: "events_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  // Cap the rendered occurrences (the server already limits via per_page; this is the belt-and-
  // suspenders render cap — default 6, hard cap 12).
  const occurrences = response.data.slice(0, eventLimit(dataSource));

  if (occurrences.length === 0) {
    return [
      withFeedMeta(block, {
        status: "empty",
        reason: "no_upcoming_events",
        source: "events_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  return occurrences.map((item, index) => mintEventBlock(block, item, index));
};

/** Extract a slug from the last non-empty path segment. */
function lastPathSegment(path?: string): string | undefined {
  if (!path) return undefined;
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

/**
 * Built-in `blog_post` resolver (detail). Resolves the slug from `dataSource.slug` or, for
 * `current: true`, from the last path segment (the route-pattern match is the host app's job —
 * FEED_CONTRACT §5.3), fetches the detail, and inlines the §4.3 props.
 */
const resolveBlogPost: FeedSourceResolver = async ({
  block,
  dataSource,
  client,
  path,
}) => {
  const slug =
    typeof dataSource.slug === "string" && dataSource.slug.length > 0
      ? dataSource.slug
      : dataSource.current
        ? lastPathSegment(path)
        : undefined;

  if (!slug) {
    return [
      withFeedMeta(block, {
        status: "error",
        reason: "unresolved_slug",
        source: "blog_post",
        resolvedAt: nowIso(),
      }),
    ];
  }

  const response = await client.getBlog(slug);
  if (response.error) {
    // A 404 is "matched route, missing post" — an empty state, not an upstream failure.
    // Customer-sites' SPA not-found detection keys on reason === "post_not_found"
    // (FEED_CONTRACT §2.3 rule 5), so a 404 must never collapse into upstream_error.
    if (response.error.status === 404) {
      return [
        withFeedMeta(block, {
          status: "empty",
          reason: "post_not_found",
          source: "blog_post",
          resolvedAt: nowIso(),
        }),
      ];
    }
    return [
      withFeedMeta(block, {
        status: "error",
        reason: "upstream_error",
        source: "blog_post",
        resolvedAt: nowIso(),
      }),
    ];
  }
  // Defensive fallback: a 2xx with no `data` payload is still "not found".
  if (!response.data) {
    return [
      withFeedMeta(block, {
        status: "empty",
        reason: "post_not_found",
        source: "blog_post",
        resolvedAt: nowIso(),
      }),
    ];
  }

  const detail = mapBlogFeedDetail(response.data);
  const blockProps: Record<string, unknown> = { ...(block.blockProps ?? {}) };
  // §4.3 detail mapping — these are the dynamic content props for the article block.
  blockProps.title = detail.title;
  blockProps.markdownString = detail.markdownString;
  blockProps.author = detail.author;
  blockProps.date = detail.date;
  blockProps.image = detail.image;
  blockProps.imageAlt = detail.imageAlt;
  blockProps.tags = detail.tags;
  blockProps.articles = detail.articles;

  return [
    withFeedMeta({ ...block, blockProps }, {
      status: "ok",
      source: "blog_post",
      resolvedAt: nowIso(),
    }),
  ];
};

/**
 * Built-in resolvers keyed by source type. Phase 1: blog; Phase 2: reviews; Phase 3: instagram;
 * Phase 4: events (the first EXPANDING source — one block → N `hero-event-registration` blocks).
 */
const BUILT_IN_SOURCES: Record<string, FeedSourceResolver> = {
  blog_feed: resolveBlogFeed,
  blog_post: resolveBlogPost,
  instagram_feed: resolveInstagramFeed,
  testimonials_feed: resolveReviewsFeed,
  events_feed: resolveEventsFeed,
};

/**
 * Pre-render async pass (FEED_CONTRACT §7.1). Finds blocks carrying a `dataSource`, resolves
 * each via its source resolver, inlines resolved props per §2.3/§4, and attaches `_feedMeta`.
 *
 * Pure: it does not touch the registry or the sync render engine. Supports one-to-many
 * expansion (D6) — a resolver may return more blocks than it received. Unknown source types are
 * left untouched with an `unknown_source:<type>` error meta. A single failing block never breaks
 * the rest (partial resolution is fine).
 */
export async function resolveBlocks(
  blocks: Block[],
  options: ResolveBlocksOptions
): Promise<Block[]> {
  const client = createFeedClient({
    baseUrl: options.baseUrl,
    websiteToken: options.websiteToken,
    fetcher: options.fetcher,
  });

  const sources: Record<string, FeedSourceResolver> = {
    ...BUILT_IN_SOURCES,
    ...(options.sources ?? {}),
  };

  const resolved = await Promise.all(
    blocks.map(async (block): Promise<Block[]> => {
      const dataSource = block.dataSource;
      if (!dataSource) return [block];

      const resolver = sources[dataSource.type];
      if (!resolver) {
        return [
          withFeedMeta(block, {
            status: "error",
            reason: `unknown_source:${dataSource.type}`,
            source: dataSource.type,
            resolvedAt: nowIso(),
          }),
        ];
      }

      const ctx: FeedSourceContext = {
        block,
        dataSource,
        client,
        path: options.path,
        bindTarget: resolveBindTarget(block),
      };
      // Per-block error isolation (FEED_CONTRACT §2.3 rule 5): a resolver that throws or
      // rejects must degrade only its own block, never the whole `Promise.all`. The failed
      // block carries an error meta; every other block resolves normally.
      try {
        return await resolver(ctx);
      } catch {
        return [
          withFeedMeta(block, {
            status: "error",
            reason: "resolver_threw",
            source: dataSource.type,
            resolvedAt: nowIso(),
          }),
        ];
      }
    })
  );

  return resolved.flat();
}
