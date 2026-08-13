# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Blog feed category/tag filters now accept scalar or array values. Scalars retain the existing
  `category_slug` / `tag_slug` wire keys; arrays serialize as repeated `category_slug[]` /
  `tag_slug[]` keys and remain attached to every paginated request.

## [0.5.7] - 2026-08-13

### Changed

- **Dependency ranges loosened so first-party patch fixes can actually reach consumers.**
  `@page-speed/router` `1.2.1` → `^1.2.1` and `@page-speed/pressable` `0.1.1` → `^0.1.1`.
  The exact pins made npm install a *nested* old copy under `@page-speed/blocks/node_modules/`
  whenever the app hoisted a newer version, so a published router/pressable fix was a silent
  no-op for anything rendered through this runtime (verified: an app resolving
  `@page-speed/router@1.2.0` with `@page-speed/blocks@0.5.5` ends up with three router copies —
  root `1.2.0`, `blocks/node_modules` `1.2.1`, `pressable/node_modules` `1.2.1`).
  No source changes; both packages remain `external` in the bundle, so the consumer's hoisted
  copy is what executes at runtime.

## [0.5.0] - 2026-07-11

### Added
- **Events feed support** in the data layer (`@page-speed/blocks/data`), implementing
  FEED_CONTRACT §3.9 / §4.1d (Dynamic Data Feeds, Phase 4). `events_feed` is the first
  **EXPANDING** source (`expands: true`, D6): ONE symbolic block hydrates into **N
  `hero-event-registration` block instances** (one per occurrence). New minor because it adds a
  new source type to the public data API.
  - `FeedClient.listEvents({ page?, perPage?, startDate?, endDate?, locationIds? })` — hits
    `/public_services/websites/{token}/feeds/events` with the same URL-building, `per_page` clamp
    (≤ 50), filter-on-every-page, and error-envelope conventions as the blog / instagram / reviews
    clients. `locationIds` serializes as **repeated `location_ids[]` params** (Rack array binding);
    empty/blank ids are dropped (0 is kept). The server returns pre-expanded OCCURRENCES — RRULE
    internals never reach the client.
  - `mapEventFeedItem` — wire (`EventFeedItem`, §3.9) → `hero-event-registration` blockProps
    (`EventHeroProps`, §4.1d), a pure item→props mapper (client-side mirror of the dashtrack-ai
    `Feeds::Hydrator` events expansion, lockstep with §4.1d). Rules (never fabricate; omit absent):
    `heading` = `title` truncated ≤ 50 codepoints at a word boundary; `description` ≤ 130
    codepoints (omitted when blank); `badgeText` = uppercased short date (`"JUL 18"`) and
    `locationLabel` = `"%b %-d, %Y · %-l:%M %p"` both formatted **in the event timezone**;
    `locationSublabel` = `location_name` or `custom_address`; `image` `{ src, alt: title }` only
    when present; `stats` REAL-only (`price_from` → "From", `recurring_summary` → "Schedule",
    **omitted entirely when neither exists**); `actions` = `[{ label: "Register", href }]` only
    when `registration_url` is present. Constraint caps enforced in the mapper: **`actions ≤ 2`,
    `stats ≤ 4`**.
  - `resolveEventsFeed` resolver in `resolveBlocks` — expands the occurrence list into N heroes
    (`limit` default **6**, hard cap **12**; `per_page` is set to the render limit so we never
    over-fetch). Each expanded block gets a unique, deterministic `_id`
    (`"<symbolic_id>__ev_<event_id>_<occurrence_index>"`, parsed from `occurrence_id`), inherits
    the symbolic block's `_parent` (heroes render as siblings in its slot), and carries
    `_feedMeta { status: "ok", source: "events_feed", expandedFrom: <symbolic_id> }`. The
    `dataSource` is **dropped** on expanded heroes so a re-resolve never re-expands them, and
    `blockProps` are the fresh mapped occurrence props (not merged with the symbolic block's
    authored placeholder props — for an expanding source there is no single bind target).
  - On **empty** (`no_upcoming_events`) or **error** (`upstream_error`) the ORIGINAL symbolic
    block stays in place UNEXPANDED with the usual `_feedMeta` (dataSource retained), so the empty
    / error renderers work unchanged (§2.3 rule 5 — there is no wrapper-block concept).
  - `truncateAtWordBoundary(text, maxCodepoints)` — extracted shared helper for the Unicode
    whitespace-collapse + codepoint-slice + word-boundary truncation rule (§4.1c / §4.1d).
    `reviewTitle` now delegates to it (byte-identical behaviour, guarded by the existing Phase 2
    title tests). NBSP (U+00A0) and ideographic space (U+3000) collapse identically to an ASCII
    space; surrogate-pair emoji are never split.
- New feed types in `src/types/index.ts`: `EventFeedItem`, `EventFeedParams`, `EventHeroProps`,
  `EventHeroStat`, `EventHeroAction`, `EventHeroImage`; `DataSource` gains optional `startDate` /
  `endDate` / `locationIds` / `upcomingOnly`; `FeedMeta` gains `expandedFrom`; `FeedClient` gains
  `listEvents`. These are local string-typed wire/prop shapes (assignable to the block's
  `React.ReactNode` props), matching the Phase 2/3 convention — no new `@opensite/ui` APIs.

### Fixed
- **ICU / Ruby lockstep for event date-times:** the event `locationLabel` / `badgeText` formatter
  normalises the narrow / regular no-break space that some ICU builds insert before AM/PM
  (U+202F / U+00A0) to an ASCII space, so the output is byte-identical across Node/ICU versions
  AND with Ruby's `strftime` `"%-l:%M %p"`. An unknown/invalid IANA timezone degrades to UTC
  rather than throwing; an unparseable `starts_at` omits the badge/label (never a fabricated date).
- **`block_ref` / `data` dual-shape hydration** (Dynamic Data Feeds, Phase 5 shape-fix,
  FEED_CONTRACT §2 / §4). `resolveBlocks` previously assumed every block was chai-shaped
  (`{ _type, blockProps }`), but AI-generated pages arrive as the wire shape
  (`{ block_ref: "gallery/instagram-post-grid", data, dataSource }`) and are normalized to chai
  LAZILY by customer-sites `normalizeBlocks` — which runs AFTER `resolveBlocks` and rebuilds
  `blockProps` from `data` ONLY. So hydrated props written to `blockProps` on a wire block were
  silently discarded (feeds never reached the component on `block_ref`-shaped pages).
  - **Block-type derivation** — new `blockType(block)` helper: uses `_type` when present, else
    derives the component id from `block_ref`/`block_name` via `split("/").pop()` (no-op when
    there is no `/`), mirroring `normalizeBlocks` and the dashtrack-ai `Feeds::Hydrator`. Every
    bind-target / gallery / review / social dispatch now keys off `blockType` so wire blocks hit
    the same `SINGLE_BIND_TARGETS` / `DEFAULT_BIND_TARGETS` maps as chai blocks.
  - **Write target** — new `writeContainer` / `withContainer` helpers: for a wire-shaped block
    (`block_ref`/`block_name`, no `_type`) the hydrated bind target is written into `data`; chai
    blocks keep writing `blockProps` unchanged (no regression). Applied to the blog / instagram /
    testimonials list resolvers and the `blog_post` detail resolver. Only the bind target is
    written — every other authored prop is untouched (§2.3 rule 2).
  - The `events_feed` expansion mint is **unchanged**: expanded `hero-event-registration` blocks
    stay chai-shaped (`{ _type, _id, _parent, blockProps, _feedMeta }`) and render via the
    `normalizeBlocks` passthrough, even from a `block_ref`-shaped symbolic source.
  - Lockstep with the dashtrack-ai reference `Feeds::Hydrator`
    (`app/services/feeds/hydrator.rb` — `#block_type` / `#ref_component_id` and
    `#props_hash` / `#write_target`); the Ruby (build-time) and TS (SPA-nav) resolvers must derive
    the type id and choose the write container identically.
- `Block` type (`src/types/index.ts`) gains optional `block_ref` / `block_name` / `data`
  (AI wire shape). `_type` stays required for the post-normalization render engine.

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
