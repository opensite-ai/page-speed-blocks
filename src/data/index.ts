/**
 * @page-speed/blocks/data
 *
 * Dynamic data feed layer (FEED_CONTRACT §7). A pre-render async pass (`resolveBlocks`) plus a
 * typed feed client (`FeedClient`) that resolve symbolic `dataSource`s on blocks into real props.
 * Pure — the synchronous render engine is untouched.
 */

// Feed client (single place that builds feed URLs).
export {
  createFeedClient,
  MAX_PER_PAGE,
  TAXONOMY_PER_PAGE,
} from "./feed-client.js";

// Block resolution pass + bind-target helpers.
export {
  resolveBlocks,
  resolveBindTarget,
  blogCategoryChips,
  DEFAULT_BIND_TARGETS,
  SINGLE_BIND_TARGETS,
  DEFAULT_BIND_TARGET,
  BLOG_CATEGORY_BIND_TARGETS,
  ALL_CATEGORY_CHIP,
} from "./resolve-blocks.js";

// Wire → prop mappers (client-side mirror of the §4.1 / §4.3 / §4.1b / §4.1c / §4.1d hydrator tables).
export {
  mapBlogFeedItem,
  mapBlogFeedDetail,
  mapInstagramFeedItem,
  mapTestimonialItem,
  mapReviewItem,
  mapSocialTestimonialItem,
  mapEventFeedItem,
  platformLabel,
  formatFeedDate,
  truncateAtWordBoundary,
} from "./mappers.js";

// Blog-detail → article-layout props (§4.3 FAT union; mirror of customer-sites BlogDetailEntry).
export {
  mapBlogDetailToArticleProps,
  allowListedArticleLayout,
  articleBreadcrumbs,
  articleSections,
  articleChapters,
  articleReadTime,
  normalizedText,
  slugify,
  cgiEscape,
  rubyPosixTrim,
  ARTICLE_LAYOUT_COMPONENT_IDS,
  DEFAULT_BLOG_INDEX_PATH,
  HERO_PROSE_DATE_FORMAT,
} from "./article-props.js";

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
  BlogFeedSiteSettings,
  BlogCategoryChip,
  BlogPostItem,
  BlogPostDetail,
  BlogFeedParams,
  ArticleBreadcrumb,
  ArticleSection,
  ArticleChapter,
  ArticleAuthor,
  ArticlePost,
  ArticleDetailProps,
  InstagramFeedFile,
  InstagramFeedItem,
  InstagramPostItem,
  InstagramFeedParams,
  ReviewFeedItem,
  ReviewFeedParams,
  TestimonialItem,
  ReviewItem,
  SocialTestimonialItem,
  EventFeedItem,
  EventFeedParams,
  EventHeroProps,
  EventHeroStat,
  EventHeroAction,
  EventHeroImage,
  CreateFeedClientOptions,
  FeedClient,
  ResolveBlocksOptions,
  FeedSourceContext,
  FeedSourceResolver,
} from "../types/index.js";
