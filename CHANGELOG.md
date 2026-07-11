# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-07-10

### Added
- **Reviews / testimonials feed support** in the data layer (`@page-speed/blocks/data`),
  implementing FEED_CONTRACT §3.8 / §4.1c (Dynamic Data Feeds, Phase 2):
  - `FeedClient.listReviews({ page?, perPage?, minRating?, platforms?, locationId?, sortBy?, sortDir? })`
    — hits `/public_services/websites/{token}/feeds/reviews` with the same URL-building,
    `per_page` clamp (≤ 50), filter-on-every-page, and error-envelope conventions as the blog /
    instagram clients. `platforms` serializes as **repeated `platforms[]` params** (Rack array
    binding) to match the Rails endpoint; empty platform entries are dropped.
  - `mapTestimonialItem` — wire (`ReviewFeedItem`, §3.8) → base `TestimonialItem` prop mapper
    (client-side mirror of the dashtrack-ai hydrator, lockstep with §4.1c): `content` → `quote`,
    `reviewer_name` → `author`, numeric-only `rating` (**never fabricated**), and a
    `{ label: "Read on <Platform>", href }` `linkConfig` **only when `profile_url` is present**.
    `avatar_url` is present on the wire but **intentionally never mapped** (§3.8 hotlinked-URL rot).
  - Coercion layer for the two custom item shapes: `mapReviewItem` (`ReviewItem` for
    `testimonials-list-verified` / `testimonials-images-helpful` — `quote` → `content`, a required
    word-boundary `title`, formatted `date`, `verified: true`) and `mapSocialTestimonialItem`
    (`SocialTestimonialItem` for `testimonials-twitter-cards` — `content`, `handle` unmapped).
  - `platformLabel` — maps `review_type` enum keys to display labels (e.g. `google` → `Google`,
    `applemaps` → `Apple Maps`); unknown keys capitalize, blank falls back generically.
  - `testimonials_feed` resolver in `resolveBlocks` — chooses the per-block item shape, inlines
    into the bind target, and attaches `ok` / `empty` (`no_reviews`) / `error` (`upstream_error`)
    `_feedMeta`, mirroring the blog / instagram resolvers.
  - `DEFAULT_BIND_TARGETS` gains all 20 array-bound testimonials blocks (`testimonials` for the 17
    array/social blocks, `reviews` for list-verified / images-helpful / grid-add-review).
  - **New `SINGLE_BIND_TARGETS` mechanism** — a generic map (any source may use it) that binds
    `items[0]` as a single OBJECT (not an array) to the target prop; Phase 2 uses it for the
    single-quote trio `testimonials-company-logo` / `-large-quote` / `-split-image` (prop
    `testimonial`). `resolveBindTarget` consults it ahead of the array-default map.
- New feed types in `src/types/index.ts`: `ReviewFeedItem`, `ReviewFeedParams`, `TestimonialItem`,
  `ReviewItem`, `SocialTestimonialItem`; `DataSource` gains optional `minRating` / `platforms` /
  `locationId`; `FeedClient` gains `listReviews`. These are local string-typed wire/prop shapes
  (assignable to the block's `React.ReactNode` props), matching the Phase 3 convention — the code
  does not depend on new `@opensite/ui` APIs.

### Changed
- `@opensite/ui` **3.12.1 → 3.13.0** (exact pin). Not required by the code above, but the pin is
  what consumers resolve through — 3.13.0 carries the testimonials StarRating fixes
  (per-item real ratings on `testimonials-grid-add-review` / `testimonials-stats-header`) and the
  `testimonials_feed` contract notes, so blocks must not strand downstream installs at 3.12.1.

### Security
- The data layer never maps review avatars or `review_photos`: `avatar_url` ships on the wire for
  future use but is dropped by every mapper (FEED_CONTRACT §3.8 media caveat — hotlinked external
  platform URLs are rot-prone and must not reach client sites). `profile_url` maps (a dead link
  degrades harmlessly). Visibility filtering (`show_on_site` / `is_hidden` / `deleted_at`) is the
  server's responsibility and is never assumed client-side.

### Fixed
- **Lockstep parity with the dashtrack-ai reference** (`app/services/feeds/hydrator.rb` +
  `testimonials_feed_resolver.rb`, FEED_CONTRACT §4.1c):
  - `platformLabel` — the `tripadvisor` label was `"Tripadvisor"`; corrected to **`"TripAdvisor"`**
    (capital A) to match `TestimonialsFeedResolver::PLATFORM_LABELS` byte-for-byte. All 18
    `review_type` enum keys now match the Ruby map exactly; a hardcoded-pairs test guards against
    future drift on either side. (The 18 keys are the full `LocationReview::REVIEW_TYPE_VALUES`
    enum set, so the capitalize fallback is unreachable for any valid `review_type`.)
  - `mapReviewItem` now returns **`ReviewItem | null`**, DROPPING any item without a numeric
    `rating` for the two `ReviewItem` blocks (`testimonials-list-verified` /
    `testimonials-images-helpful`) instead of rendering it rating-less — `rating` is REQUIRED and
    must never be fabricated (§2.3 rule 5). The `testimonials_feed` resolver filters the dropped
    items (mirror of the Ruby `filter_map`) and yields the `empty` / `no_reviews` state when every
    item drops, matching `Feeds::Hydrator#review_item_shape` / `#hydrate_testimonials_feed`.
    `testimonials-grid-add-review` (base-shape passthrough), single-bind, social, and default
    targets are unchanged. Unreachable today (the server excludes NULL ratings) but enforced for
    lockstep integrity against §3.8's `rating int|null` wire type.

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
