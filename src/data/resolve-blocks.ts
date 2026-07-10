import type {
  Block,
  BlogFeedParams,
  BlogPostItem,
  DataSource,
  FeedMeta,
  FeedResponseMeta,
  FeedSourceContext,
  FeedSourceResolver,
  InstagramFeedParams,
  InstagramPostItem,
  ResolveBlocksOptions,
} from "../types/index.js";
import { createFeedClient } from "./feed-client.js";
import {
  mapBlogFeedDetail,
  mapBlogFeedItem,
  mapInstagramFeedItem,
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
 * Resolve the bind target for a block: explicit `bindTo` → per-block default → `"posts"`.
 */
export function resolveBindTarget(block: Block): string {
  const explicit = block.dataSource?.bindTo;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return DEFAULT_BIND_TARGETS[block._type] ?? DEFAULT_BIND_TARGET;
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

/** Built-in resolvers keyed by source type. Phase 1: blog; Phase 3: instagram. */
const BUILT_IN_SOURCES: Record<string, FeedSourceResolver> = {
  blog_feed: resolveBlogFeed,
  blog_post: resolveBlogPost,
  instagram_feed: resolveInstagramFeed,
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
