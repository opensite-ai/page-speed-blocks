# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-07-10

### Added
- **Instagram feed support** in the data layer (`@page-speed/blocks/data`), implementing
  FEED_CONTRACT §3.7 / §4.1b (Dynamic Data Feeds, Phase 3):
  - `FeedClient.listInstagram({ page?, perPage?, hashtag? })` — hits
    `/public_services/websites/{token}/feeds/instagram` with the same URL-building, `per_page`
    clamp (≤ 50), filter-on-every-page, and error-envelope conventions as `listBlogs`.
  - `mapInstagramFeedItem` — wire (`InstagramFeedItem`, §3.7) → `InstagramPostItem` prop mapper
    (client-side mirror of the dashtrack-ai hydrator, lockstep with §4.1b). String-coerces `id`,
    maps `files[0].image_url` → `image` (**skips imageless posts — returns `null`**),
    `files[0].video_url` → `videoUrl` (only when `post_type === "video"`), formats `posted_at`,
    derives a truncated `imageAlt` (fallback `"Instagram post"`), and **omits absent (`null`)
    engagement counts rather than fabricating zeros**.
  - `instagram_feed` resolver in `resolveBlocks` — inlines survivors into the bind target with
    `ok` / `empty` (`no_instagram_posts`) / `error` (`upstream_error`) `_feedMeta`, mirroring
    `blog_feed`.
  - `DEFAULT_BIND_TARGETS` gains `'instagram-post-grid' => 'items'` (lockstep with dashtrack-ai
    + `@opensite/ui`).
- New feed types in `src/types/index.ts`: `InstagramFeedFile`, `InstagramFeedItem`,
  `InstagramPostItem`, `InstagramFeedParams`; `DataSource` gains optional `profile` / `hashtag`;
  `FeedClient` gains `listInstagram`. No `@opensite/ui` dependency bump — these are local
  wire/prop shapes (string-typed, assignable to the block's `React.ReactNode` props).

### Security
- The data layer only ever consumes the re-hosted MediaRecord CDN URLs the server ships in
  `files[]`; the expiring `instagram_post_files.img_url`/`video_url` columns are never present on
  the wire and never handled client-side (FEED_CONTRACT §3.7 media-URL rule).

## [0.2.0] - 2026-07-09

### Added
- **Dynamic data feed layer** (`@page-speed/blocks/data`) implementing FEED_CONTRACT §7 (Phase 1: blogs):
  - `resolveBlocks(blocks, opts)` — pre-render async pass that resolves symbolic `dataSource`
    descriptors into props, inlines them into the bind target, and attaches machine-readable
    `_feedMeta` (distinct `ok` / `empty` / `error` states). Supports one-to-many expansion (D6).
  - `createFeedClient({ baseUrl, websiteToken, fetcher? })` — typed client for the
    `/public_services/websites/{token}/feeds/*` endpoints; single place that builds feed URLs,
    resends every filter on every page, clamps `per_page` ≤ 50, and returns errors instead of throwing.
  - `mapBlogFeedItem` / `mapBlogFeedDetail` / `formatFeedDate` wire→prop mappers, `DEFAULT_BIND_TARGETS`,
    and `resolveBindTarget`.
- New feed types in `src/types/index.ts` (`DataSource`, `FeedMeta`, `FeedError`, `FeedListResponse`,
  `BlogFeedItem`, `BlogPostItem`, `FeedClient`, …); `Block` gains optional `dataSource` and `_feedMeta`.
- `BlockRenderContext.data` — arbitrary data bag threaded from the new `BlocksRenderer` / `EnhancedBlocksRenderer` `data` prop.
- `FALLBACK_RENDERER_KEY` and `FEED_ERROR_RENDERER_KEY` exported constants. `renderBlock` routes
  error-state blocks to a registered `__feed_error__` renderer (distinct from empty).

### Fixed
- The built-in button / link / pressable renderers now read the canonical `blockProps`
  (falling back to the legacy `props` key), aligning them with the declared `Block` type.

## [0.1.0] - 2026-03-19

### Added
- Initial release of @page-speed/blocks
- Core BlocksRenderer component for rendering block trees
- Registry system for custom block renderers
- Tree-shakable module architecture with granular exports
- Full TypeScript support with comprehensive type definitions
- Utility functions for block manipulation and styling
- Support for pre-compiled Tailwind CSS
- Compatibility with @opensite/ui components
- Integration with @page-speed/img, @opensite/video, and @page-speed/pressable
- Comprehensive test suite with Vitest
- Documentation and usage examples

### Features
- **Performance-first**: Optimized for minimal bundle size and fast runtime
- **Tree-shakable**: Granular exports for optimal bundle optimization
- **Extensible**: Custom renderer registry for component overrides
- **Type-safe**: Full TypeScript coverage
- **Compatible**: Works with Chai design payloads and @opensite/ui
- **Flexible**: Supports both pre-compiled and runtime Tailwind CSS
