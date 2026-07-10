/**
 * @page-speed/blocks/data
 *
 * Dynamic data feed layer (FEED_CONTRACT §7). A pre-render async pass (`resolveBlocks`) plus a
 * typed feed client (`FeedClient`) that resolve symbolic `dataSource`s on blocks into real props.
 * Pure — the synchronous render engine is untouched.
 */

// Feed client (single place that builds feed URLs).
export { createFeedClient, MAX_PER_PAGE } from "./feed-client.js";

// Block resolution pass + bind-target helpers.
export {
  resolveBlocks,
  resolveBindTarget,
  DEFAULT_BIND_TARGETS,
  DEFAULT_BIND_TARGET,
} from "./resolve-blocks.js";

// Wire → prop mappers (client-side mirror of the §4.1 / §4.3 / §4.1b hydrator tables).
export {
  mapBlogFeedItem,
  mapBlogFeedDetail,
  mapInstagramFeedItem,
  formatFeedDate,
} from "./mappers.js";

// Reserved renderer keys for dynamic-block affordances (FEED_CONTRACT §7.3).
export {
  FALLBACK_RENDERER_KEY,
  FEED_ERROR_RENDERER_KEY,
} from "../registry/index.js";

// Re-export the data-layer types (declared in the single source of truth, src/types).
export type {
  DataSource,
  FeedMeta,
  FeedError,
  FeedResponseMeta,
  FeedListResponse,
  FeedItemResponse,
  BlogFeedTaxonomy,
  BlogFeedItem,
  BlogFeedDetailItem,
  BlogPostItem,
  BlogPostDetail,
  BlogFeedParams,
  InstagramFeedFile,
  InstagramFeedItem,
  InstagramPostItem,
  InstagramFeedParams,
  CreateFeedClientOptions,
  FeedClient,
  ResolveBlocksOptions,
  FeedSourceContext,
  FeedSourceResolver,
} from "../types/index.js";
