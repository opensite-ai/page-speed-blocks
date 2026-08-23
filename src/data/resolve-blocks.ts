import type {
  Block,
  BlogCategoryChip,
  BlogFeedParams,
  BlogFeedTaxonomy,
  BlogPostItem,
  DataSource,
  FeedClient,
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
import {
  allowListedArticleLayout,
  mapBlogDetailToArticleProps,
  rubyPosixTrim,
} from "./article-props.js";
import { createFeedClient } from "./feed-client.js";
import {
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

/**
 * SECOND bind target on a `blog_feed` block: the category filter chips (FEED_CONTRACT §2.4, R9).
 * Same mechanism as `blog-tech-insights`' side-set `featuredPost`, except this one always
 * OVERRIDES the authored array — on a FEED-BOUND block the authored chips are a themed copy of
 * the demo seed (Healthcare/Hospitality/Dental…) with nothing to do with the site's real
 * taxonomy, so hydrated data wins (§2.3 rule 2).
 *
 * SCOPE — read before "improving" this. The override reaches only blocks that carry a
 * `dataSource`, because that is the only signal that the posts are hydrated. A census of
 * production on 2026-08-16 found 21 live `blog-filtered-results` blocks: exactly ONE is
 * `blog_feed`-bound (and it is the fabricated-chips bug); the other 20 are hardcoded-content
 * pages, 15 of which author BOTH `posts` and `categories` — chips that are consistent with the
 * posts sitting next to them. Overriding those with the site taxonomy would filter authored
 * posts by categories they do not have. So this bind fixes the feed-bound blocks with no
 * payload regeneration, and the unbound onboarding-era blog pages are a
 * regenerate-existing-sites item, not something hydration can repair.
 *
 * LOCKSTEP with dashtrack-ai `Feeds::Hydrator::BLOG_CATEGORY_BIND_TARGETS`.
 */
export const BLOG_CATEGORY_BIND_TARGETS: Record<string, string> = {
  "blog-filtered-results": "categories",
};

/**
 * THIRD bind target on a `blog_feed` block (TASK-6 §2): the featured hero slot. Hydration never
 * populated `primaryPost`, so the slot was dead on every feed-bound page. Like the chips (and
 * unlike blog-tech-insights' respect-if-set `featuredPost`) this write always OVERRIDES the
 * authored value — on a FEED-BOUND block an authored primaryPost is fabricated demo content.
 *
 * Rules (LOCKSTEP with dashtrack-ai `Feeds::Hydrator#set_filtered_results_primary`):
 *   • DEFAULT `posts` bind only (an explicit `bindTo` override opts out);
 *   • page 1 only (offset absent or 0) — a later page must not rotate the hero to that page's
 *     newest item;
 *   • ANY items (≥ 1): the newest becomes `primaryPost` and the grid gets the REST (no duplicate
 *     card). A single-post site shows its post as the hero over an empty grid — owner directive
 *     2026-08-22: "as long as there is at least one blog post, it should always have the latest
 *     blog post here" (landinglab.ai/blog). Zero items clears the slot.
 */
export const BLOG_PRIMARY_POST_BIND_TARGETS: Record<string, string> = {
  "blog-filtered-results": "primaryPost",
};

/**
 * The "show everything" chip prepended to every non-empty hydrated chip list. It belongs in
 * HYDRATION (not the component) because the block's default selection is already `["all"]` and
 * the authored arrays it replaces carry their own `All` entry — emitting it here keeps the two
 * hydration implementations the single source of the chip list and needs no `@opensite/ui`
 * release. LOCKSTEP with dashtrack-ai `Feeds::Hydrator::ALL_CATEGORY_CHIP`.
 */
export const ALL_CATEGORY_CHIP: BlogCategoryChip = { label: "All", value: "all" };

/**
 * Build the `categories` chip array from the site's blog-category taxonomy (§3.1
 * `/feeds/blog_categories`, already filtered to categories with ≥1 currently-published post).
 *
 * Rules (LOCKSTEP with dashtrack-ai `Feeds::Hydrator#blog_category_chips`):
 *   • `label` is the category NAME verbatim; `value` is `name.toLowerCase()` — the block
 *     compares `post.category.toLowerCase()` against `value` and hydrated posts carry the NAME
 *     (`blog_category.name`), so any other value silently filters to nothing.
 *   • blank names are skipped, and values are de-duplicated case-insensitively (two categories
 *     differing only in case would otherwise collide on the React `key={category.value}`).
 *   • an empty result stays EMPTY — no `All`-only chip bar, and never a fabricated category.
 *
 * Ruby/JS string semantics (4.3): the hydrator trims category names with Ruby `[[:space:]]`
 * (`Feeds::Hydrator#published_category_names`), so this side trims with `rubyPosixTrim`, NOT
 * `String.trim()`. The two sets differ on exactly two codepoints - U+0085 NEL (Ruby yes, JS no)
 * and U+FEFF BOM (Ruby no, JS yes) - so `.trim()` gave a BOM-wrapped category a different LABEL
 * (and therefore a different `value`, and a different React key) on the server and the client.
 * `toLowerCase()` and Ruby `String#downcase` are both full Unicode case mappings and agree on
 * every storable name, so only the trim needed aligning.
 */
export function blogCategoryChips(
  taxonomy: BlogFeedTaxonomy[]
): BlogCategoryChip[] {
  const chips: BlogCategoryChip[] = [];
  const seen = new Set<string>();

  for (const entry of taxonomy) {
    const name = typeof entry?.name === "string" ? rubyPosixTrim(entry.name) : "";
    if (!name) continue;
    const value = name.toLowerCase();
    if (seen.has(value)) continue;
    seen.add(value);
    // TASK-6 §2: the SLUG lets the block write the platform's `?category_slug=`
    // URL filter on chip selection — `value` (downcased NAME) cannot, because
    // the server filters by slug. Additive; the `All` chip carries none.
    const slug = typeof entry?.slug === "string" ? entry.slug : "";
    chips.push(slug ? { label: name, value, slug } : { label: name, value });
  }

  if (chips.length === 0) return [];
  return [ALL_CATEGORY_CHIP, ...chips];
}

/**
 * Write ONLY the `categories` bind (no post items) — the empty-feed path, where the block keeps
 * every other authored prop but must not keep fabricated filter chips.
 */
function inlineBlogCategoryChips(
  block: Block,
  categoryChips: BlogCategoryChip[] | null
): Block {
  const target = BLOG_CATEGORY_BIND_TARGETS[blockType(block)];
  if (!target || !categoryChips) return block;

  const props = writeContainer(block);
  props[target] = categoryChips;
  return withContainer(block, props);
}

/**
 * Fetch the category chips for a block that renders a category filter bar; `null` for every
 * other block type (so the taxonomy endpoint is only called when a chip-bearing block is
 * actually present on the page).
 *
 * A taxonomy fetch that fails or returns nothing yields an EMPTY array, which makes the block
 * render no filter bar at all (`categories.length === 0` → the component returns `null`). That
 * is deliberate: leaving the authored array in place would re-display fabricated chips, which
 * §2.3 rule 5 forbids. The post list itself is unaffected.
 */
async function fetchBlogCategoryChips(
  block: Block,
  client: FeedClient
): Promise<BlogCategoryChip[] | null> {
  if (!BLOG_CATEGORY_BIND_TARGETS[blockType(block)]) return null;

  const response = await client.listBlogCategories();
  return response.error ? [] : blogCategoryChips(response.data);
}

/** Gallery blocks require coerced carousel items (FEED_CONTRACT §2.4). */
const GALLERY_BLOCK_TYPES = new Set([
  "carousel-badge-cards",
  "carousel-gradient-overlay",
  "carousel-demo-link",
  "carousel-gradient-text",
]);

// ---------------------------------------------------------------------------
// Dual block shapes (FEED_CONTRACT §2 / §4). Two shapes coexist and are NEVER normalized before
// this pass runs (the client-side `normalizeBlocks` in customer-sites runs AFTER `resolveBlocks`):
//   • Chai runtime shape  = { _type, _id, blockProps }        (dt-cms / already-normalized pages)
//   • AI wire shape       = { block_ref | block_name, data }  (octane-generated, persisted verbatim)
// customer-sites `normalizeBlocks` rebuilds `blockProps` from `data` ONLY, so for wire-shaped
// blocks the hydrated props MUST land in `data` or they are silently discarded. Both the block-type
// derivation and the write-container choice are kept byte-for-byte in LOCKSTEP with the dashtrack-ai
// reference `Feeds::Hydrator` (`app/services/feeds/hydrator.rb` — `#block_type`/`#ref_component_id`
// and `#props_hash`/`#write_target`); diverging here splits first-load (Ruby) from SPA-nav (this TS).
// ---------------------------------------------------------------------------

/**
 * Derive the component-registry id for a block. Chai blocks carry `_type`; AI wire blocks carry
 * `block_ref`/`block_name` (e.g. `"gallery/instagram-post-grid"`) — take the segment after the
 * last `/`, no-opping safely when there is no `/` (mirrors customer-sites `chai_pages.tsx`
 * `normalizeBlocks` and the dashtrack-ai `Feeds::Hydrator#ref_component_id`). Used everywhere the
 * resolver dispatches on block type (bind-target lookup, gallery/review/social branches).
 */
export function blockType(block: Block): string {
  if (block._type) return block._type;
  const ref = block.block_ref ?? block.block_name;
  if (ref) {
    const segment = ref.split("/").pop();
    if (segment) return segment;
  }
  return "";
}

/**
 * True when the block is AI-wire-shaped (`block_ref`/`block_name` present, no `_type`) and its
 * hydrated props must be written into `data` rather than `blockProps`. Chai-shaped blocks (with
 * `_type`) stay on the `blockProps` path. Lockstep with hydrator.rb `#props_hash` shape branch.
 */
function isBlockRefShaped(block: Block): boolean {
  if (block._type) return false;
  return Boolean(block.block_ref ?? block.block_name);
}

/**
 * A shallow copy of the block's hydration write container: `data` for wire-shaped blocks,
 * `blockProps` for chai-shaped blocks. Callers write the bind target (and only the bind target)
 * into it, then pass it to `withContainer` (§2.3 rule 2 — every other authored prop is untouched).
 */
function writeContainer(block: Block): Record<string, unknown> {
  return isBlockRefShaped(block)
    ? { ...(block.data ?? {}) }
    : { ...(block.blockProps ?? {}) };
}

/** Return a copy of the block with the hydrated container written back to the correct key. */
function withContainer(block: Block, container: Record<string, unknown>): Block {
  return isBlockRefShaped(block)
    ? { ...block, data: container }
    : { ...block, blockProps: container };
}

/**
 * Resolve the bind target for a block: explicit `bindTo` → single-bind default → per-block
 * array default → `"posts"`. (Single-bind and array-bind block types are disjoint, so the
 * ordering of the two default maps only matters for clarity.) The type key is derived via
 * `blockType` so `block_ref`/`block_name`-shaped blocks hit the same maps as chai blocks.
 */
export function resolveBindTarget(block: Block): string {
  const explicit = block.dataSource?.bindTo;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  const type = blockType(block);
  return (
    SINGLE_BIND_TARGETS[type] ??
    DEFAULT_BIND_TARGETS[type] ??
    DEFAULT_BIND_TARGET
  );
}

/**
 * Empty the bind target of a feed-bound block whose source resolved to ZERO items (R9).
 *
 * This pass used to be missing: an `empty` outcome returned the block UNTOUCHED, on the assumption
 * that a feed-bound block carries no authored items in the first place (the generator strips them
 * when it wires the source). Legacy payloads break that assumption - they still carry the themed
 * demo seed - so on an empty feed the block rendered FABRICATED posts as if they were the site's
 * real content, which FEED_CONTRACT 2.3 rule 5 ("Never fabricate items") forbids. Clearing the
 * target makes "no items" true rather than assumed, and lets the block's natural empty state run.
 *
 * Semantics (LOCKSTEP - dashtrack-ai `Feeds::Hydrator#clear_empty_bind_target` and the dt-cms
 * preview's `clearEmptyFeedItems`):
 *   - only a target the block ALREADY authored is touched; an absent target is left absent, so
 *     hydration never invents a prop the block did not declare;
 *   - single-bind blocks (`testimonial`, an object not an array) have no empty value, so the prop
 *     is DELETED rather than set to `[]`;
 *   - every other authored prop survives (2.3 rule 2), and `dataSource` is retained (rule 1).
 *
 * NOT applied to the EXPANDING `events_feed` source (4.1d, D6) - see `resolveEventsFeed`.
 */
function clearEmptyBindTarget(block: Block, bindTarget: string): Block {
  const props = writeContainer(block);
  if (!(bindTarget in props)) return block;

  if (blockType(block) in SINGLE_BIND_TARGETS) {
    delete props[bindTarget];
  } else {
    props[bindTarget] = [];
  }
  return withContainer(block, props);
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
  if (typeof source.category === "string" || Array.isArray(source.category)) {
    params.categorySlug = source.category;
  }
  if (typeof source.tag === "string" || Array.isArray(source.tag)) {
    params.tagSlug = source.tag;
  }
  return params;
}

/**
 * Inline resolved `BlogPostItem[]` into the bind target, applying the §2.4 special cases.
 * Only the bind target (plus, for tech-insights, an unset `featuredPost`, and for chip blocks
 * the `categories` bind) is written — every other authored prop is untouched (FEED_CONTRACT
 * §2.3 rule 2).
 */
function inlineBlogItems(
  block: Block,
  bindTarget: string,
  items: BlogPostItem[],
  categoryChips: BlogCategoryChip[] | null
): Block {
  const props = writeContainer(block);
  const type = blockType(block);

  let finalItems: BlogPostItem[] = items;
  if (GALLERY_BLOCK_TYPES.has(type)) {
    // Carousel items require a non-null image and a string id (§2.4).
    finalItems = items
      .filter((item) => Boolean(item.image))
      .map((item) => ({ ...item, id: String(item.id) }));
  }

  props[bindTarget] = finalItems;

  // blog-tech-insights: set featuredPost to the first item when unset (§2.4).
  if (
    type === "blog-tech-insights" &&
    props.featuredPost == null &&
    finalItems.length > 0
  ) {
    props.featuredPost = finalItems[0];
  }

  // blog-filtered-results: OVERRIDE the authored category chips with the site's real taxonomy
  // (§2.4, R9) — unlike featuredPost this write is unconditional, because the authored array is
  // exactly the fabricated demo seed we are replacing.
  const categoryTarget = BLOG_CATEGORY_BIND_TARGETS[type];
  if (categoryTarget && categoryChips) {
    props[categoryTarget] = categoryChips;
  }

  // blog-filtered-results: featured hero bind (TASK-6 §2). Always an override —
  // see BLOG_PRIMARY_POST_BIND_TARGETS for the rules.
  const primaryTarget = BLOG_PRIMARY_POST_BIND_TARGETS[type];
  if (primaryTarget) {
    const offset = typeof block.dataSource?.offset === "number" ? block.dataSource.offset : 0;
    if (bindTarget === DEFAULT_BIND_TARGET && offset === 0 && finalItems.length >= 1) {
      props[primaryTarget] = finalItems[0];
      props[bindTarget] = finalItems.slice(1);
    } else {
      delete props[primaryTarget];
    }
  }

  return withContainer(block, props);
}

/**
 * Delete an authored `primaryPost` on the EMPTY outcome (TASK-6 §2) — with zero real posts the
 * featured slot must render empty, never a fabricated item. Mirrors `clearEmptyBindTarget`'s
 * only-touch-what-was-authored rule.
 */
function clearPrimaryPost(block: Block): Block {
  const target = BLOG_PRIMARY_POST_BIND_TARGETS[blockType(block)];
  if (!target) return block;

  const props = writeContainer(block);
  if (!(target in props)) return block;

  delete props[target];
  return withContainer(block, props);
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

  // The chips bind is resolved for BOTH the ok and the empty outcome (§2.4, R9): a filter bar
  // advertising fabricated categories is wrong whether or not the post query came back empty.
  // Only an upstream ERROR leaves the block's authored props completely untouched.
  const categoryChips = await fetchBlogCategoryChips(block, client);

  if (items.length === 0) {
    // Clear FIRST, then write the chips: the chip bind is a SECOND target on the same block, and
    // clearing after it would blank the chips on a payload that (pathologically) points `bindTo`
    // at `categories`. The dt-cms preview orders these two the same way.
    const cleared = clearEmptyBindTarget(block, bindTarget);
    const emptied = inlineBlogCategoryChips(cleared, categoryChips);
    // An authored primaryPost is fabricated content on a feed-bound block (TASK-6 §2).
    const withoutPrimary = clearPrimaryPost(emptied);
    return [
      withFeedMeta(withoutPrimary, {
        status: "empty",
        reason: "no_published_posts",
        source: "blog_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  const inlined = inlineBlogItems(block, bindTarget, items, categoryChips);
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
      withFeedMeta(clearEmptyBindTarget(block, bindTarget), {
        status: "empty",
        reason: "no_instagram_posts",
        source: "instagram_feed",
        resolvedAt: nowIso(),
      }),
    ];
  }

  const props = writeContainer(block);
  props[bindTarget] = items;

  return [
    withFeedMeta(withContainer(block, props), okMeta("instagram_feed", response.meta)),
  ];
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
  const props = writeContainer(block);
  const type = blockType(block);

  // Single-bind: bind the first item as a single OBJECT (base TestimonialItem), never an array.
  if (type in SINGLE_BIND_TARGETS) {
    props[bindTarget] = mapTestimonialItem(wireItems[0]);
    return withContainer(block, props);
  }

  let items: unknown[];
  if (REVIEW_ITEM_BLOCK_TYPES.has(type)) {
    // filter_map mirror: `mapReviewItem` returns null for items lacking a numeric rating,
    // dropping them (rating is REQUIRED on ReviewItem — §2.3 rule 5, lockstep hydrator.rb).
    const reviewItems = wireItems
      .map(mapReviewItem)
      .filter((item): item is ReviewItem => item !== null);
    // All items dropped → nothing to render → honest empty state (handled by the caller).
    if (reviewItems.length === 0) return null;
    items = reviewItems;
  } else if (SOCIAL_TESTIMONIAL_BLOCK_TYPES.has(type)) {
    items = wireItems.map(mapSocialTestimonialItem);
  } else {
    items = wireItems.map(mapTestimonialItem);
  }

  props[bindTarget] = items;
  return withContainer(block, props);
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
      withFeedMeta(clearEmptyBindTarget(block, bindTarget), {
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
      withFeedMeta(clearEmptyBindTarget(block, bindTarget), {
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
 * Mint one `hero-event-registration` block from an event occurrence. §4.1d expansion mechanics
 * enumerate the expanded block's fields EXACTLY — `{ _id, _parent, _type, blockProps, _feedMeta }`
 * and NOTHING else. This is a minimal mint, byte-for-byte lockstep with the dashtrack-ai hydrator
 * (`Feeds::Hydrator#mint_event_block`), which builds the identical minimal hash. Authored
 * block-level presentation on the symbolic source (styles, tag, `_name`, `styles_attrs`,
 * backgroundImage, content, src, link, etc.) is DELIBERATELY DROPPED — it is NOT contract-
 * enumerated and must not leak onto the concrete heroes (that would break lockstep parity).
 *
 * `_parent` carries the symbolic block's inherited value so the heroes render as siblings in the
 * source's slot (or as roots if the source was a root). NOTE: for a root source blocks emits
 * `_parent: null` while the Ruby hydrator omits the key (`unless parent.nil?`); both resolve to
 * root (getRootBlocks treats null/absent identically) and `_parent` is contract-enumerated, so
 * this residual is benign. The `dataSource` is DROPPED: expanded heroes are concrete blocks, not
 * symbolic sources, and re-running `resolveBlocks` must not re-expand them. `blockProps` are the
 * fresh mapped occurrence props (§4.1d) — NOT merged with the symbolic block's authored props: for
 * an expanding source there is no single bind target, and each hero must show ONLY real occurrence
 * data with absent regions collapsing (contract "omit absent"), so `bindTarget` is ignored.
 */
function mintEventBlock(sourceBlock: Block, item: EventFeedItem, position: number): Block {
  // Mint EXACTLY the §4.1d-enumerated fields; do NOT spread the symbolic block.
  const eventBlock: Block = {
    _id: expandedEventId(sourceBlock._id, item, position),
    _type: HERO_EVENT_BLOCK_TYPE,
    _parent: sourceBlock._parent ?? null,
    blockProps: { ...mapEventFeedItem(item) },
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
 *
 * R9 EMPTY-CLEARING EXCEPTION (decided 2026-08-16, lockstep with the Ruby hydrator). An empty
 * outcome here does NOT run `clearEmptyBindTarget`. An expanding source has no bind target at
 * all - it mints block INSTANCES rather than writing a prop, which is why
 * `hero-event-registration` has no `DEFAULT_BIND_TARGETS` entry on either side. Running the clear
 * would therefore fall through to the generic `"posts"` fallback and blank a prop by accident of
 * the fallback rather than by contract. Nothing can be fabricated here either: an unexpanded
 * symbolic block renders its own authored empty state, and no feed items were ever written into
 * it. The dt-cms preview's generic `clearEmptyFeedItems` reaches the same outcome by a different
 * route (its `target in container` guard makes an event block a no-op), so all three agree.
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
 * The PRIMARY current-post block is the one WITHOUT a `bindTo` (it hydrates the article itself).
 * The related-articles block declares `bindTo: "articles"`, so it is never treated as primary and
 * never has its `_type` swapped. Lockstep with `BlogDetailEntry#primary_article_block?`.
 */
function isPrimaryArticleBlock(source: DataSource): boolean {
  const bindTo = source.bindTo;
  return typeof bindTo !== "string" || bindTo.trim().length === 0;
}

/**
 * Built-in `blog_post` resolver (detail). Resolves the slug from `dataSource.slug` or, for
 * `current: true`, from the last path segment (the route-pattern match is the host app's job —
 * FEED_CONTRACT §5.3), fetches the detail, and inlines the §4.3 props.
 *
 * R9: this used to write 8 THIN flat props (`title, markdownString, author (a string), date,
 * image, imageAlt, tags, articles`), of which the six `@opensite/ui` article layouts declare
 * exactly two — so a SPA click-through from /blog rendered a bare article (no breadcrumb, hero,
 * byline or TOC) until the visitor hard-refreshed. It now writes the FAT union superset
 * (`mapBlogDetailToArticleProps`, the mirror of customer-sites `BlogDetailEntry`) and applies the
 * per-post layout override, so SPA navigation renders byte-identically to first load.
 */
const resolveBlogPost: FeedSourceResolver = async ({
  block,
  dataSource,
  client,
  path,
  bindTarget,
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
        withFeedMeta(clearEmptyBindTarget(block, bindTarget), {
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
      withFeedMeta(clearEmptyBindTarget(block, bindTarget), {
        status: "empty",
        reason: "post_not_found",
        source: "blog_post",
        resolvedAt: nowIso(),
      }),
    ];
  }

  // §4.3 detail mapping — the FAT union superset every article layout renders from. Merged OVER
  // the template's authored props, exactly as Ruby's
  // `blockProps.merge(article_props)` does on first load.
  const props = Object.assign(
    writeContainer(block),
    mapBlogDetailToArticleProps(response.data)
  ) as Record<string, unknown>;

  let hydrated = withContainer(block, props);

  // Per-post layout override (FEED_CONTRACT §5.3 precedence: per-blog → site default →
  // `article-breadcrumb-social`). The SITE default is already baked into the template's `_type`
  // by dashtrack-ai, so only an allow-listed PER-POST value overrides it here — an unknown or
  // absent id leaves the template's `_type` untouched and can never emit an unrenderable type.
  const layout = allowListedArticleLayout(response.data.article_layout);
  if (layout && typeof block._type === "string" && isPrimaryArticleBlock(dataSource)) {
    hydrated = { ...hydrated, _type: layout };
  }

  return [
    withFeedMeta(hydrated, {
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
  const baseClient = createFeedClient({
    baseUrl: options.baseUrl,
    websiteToken: options.websiteToken,
    fetcher: options.fetcher,
  });

  // The blog-category taxonomy is a per-PASS constant (§2.4 chips), and blocks resolve in
  // parallel, so memoize it: N chip blocks on one page issue ONE request, mirroring the
  // dashtrack-ai hydrator's per-build `taxonomy` memo.
  let taxonomyRequest: ReturnType<FeedClient["listBlogCategories"]> | null = null;
  const client: FeedClient = {
    ...baseClient,
    listBlogCategories: () => (taxonomyRequest ??= baseClient.listBlogCategories()),
  };

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
