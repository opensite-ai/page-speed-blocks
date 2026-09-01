# AGENTS.md — @page-speed/blocks

> AI Coding Agent reference for `@page-speed/blocks`. Read this file before making any changes to
> the repository. It is the canonical source of truth for architecture, conventions, danger zones,
> and step-by-step task recipes.

---

## Table of Contents

1. [Package Identity](#1-package-identity)
2. [Repository Map](#2-repository-map)
3. [Architecture Mental Model](#3-architecture-mental-model)
4. [Core Data Structures](#4-core-data-structures)
5. [Module Exports & Import Paths](#5-module-exports--import-paths)
6. [Auto-Initialization Behavior](#6-auto-initialization-behavior)
7. [Registry System](#7-registry-system)
8. [Renderer Pipeline](#8-renderer-pipeline)
9. [Styling Rules](#9-styling-rules)
10. [Built-in Renderers](#10-built-in-renderers)
11. [Utility Functions](#11-utility-functions)
12. [Build System](#12-build-system)
13. [Testing](#13-testing)
14. [Task Recipes](#14-task-recipes)
15. [Critical Constraints & Danger Zones](#15-critical-constraints--danger-zones)
16. [Dependency Graph & Consumers](#16-dependency-graph--consumers)
17. [TypeScript Rules](#17-typescript-rules)
18. [Checklist Before Every Commit](#18-checklist-before-every-commit)
19. [Dynamic Data Feed Layer (`src/data`)](#19-dynamic-data-feed-layer-srcdata)

---

## 1. Package Identity

| Field | Value |
|---|---|
| NPM name | `@page-speed/blocks` |
| Version | `0.6.13` |
| License | BSD-3-Clause |
| Package manager | **pnpm** (`packageManager: "pnpm@11.20.0"`; `engines.pnpm: ">=9.0.0"`) |
| Node requirement | `>=18.0.0` |
| Module format | Dual: ESM (`.js`) + CJS (`.cjs`); `.d.ts` / `.d.cts` declarations |
| Build tool | `tsup` |
| Test framework | `vitest` (jsdom) + `@testing-library/react` + `@testing-library/jest-dom` |
| JSX transform | `react-jsx` (no `import React` needed in TSX) |
| `"use client"` banner | Injected on every output file via `esbuildOptions.banner` in `tsup.config.ts` |

The package is `"sideEffects": false` — **do not introduce actual side effects at module scope**.
The auto-init in `src/index.ts` is guarded by `typeof window !== "undefined"` **and**
`typeof document !== "undefined"` for this reason.

---

## 2. Repository Map

```
page-speed-blocks/
├── src/
│   ├── index.ts                        ← Barrel: re-exports everything + auto-init
│   ├── types/
│   │   └── index.ts                    ← ALL TypeScript interfaces/types (single source of truth)
│   ├── registry/
│   │   └── index.ts                    ← Singleton Map<string, BlockRenderer> + reserved keys
│   ├── core/
│   │   ├── index.ts                    ← Core barrel
│   │   ├── renderer.tsx                ← BlocksRenderer + genericBlockRenderer + renderBlock
│   │   ├── BlocksProvider.tsx          ← RouterProvider wrapper (needed by Pressable)
│   │   └── EnhancedBlocksRenderer.tsx  ← BlocksProvider + BlocksRenderer composed
│   ├── renderers/
│   │   ├── index.ts                    ← Renderers barrel
│   │   ├── button-renderer.tsx         ← Pressable-based button renderer
│   │   ├── link-renderer.tsx           ← Pressable-based link renderer
│   │   └── pressable-renderer.tsx      ← Generic Pressable renderer
│   ├── data/
│   │   ├── index.ts                    ← Data-layer barrel (re-exports + data types)
│   │   ├── feed-client.ts              ← createFeedClient (single place that builds feed URLs)
│   │   ├── resolve-blocks.ts           ← resolveBlocks + bind-target maps + block-shape helpers
│   │   ├── mappers.ts                  ← wire → prop mappers + formatFeedDate + truncateAtWordBoundary
│   │   └── article-props.ts            ← blog-detail → article-layout props (mirror of BlogDetailEntry)
│   ├── utils/
│   │   └── index.ts                    ← Pure helper functions (no React)
│   └── __tests__/
│       ├── setup.ts                    ← jest-dom import
│       ├── registry.test.ts            ← Registry unit tests
│       ├── renderer.test.tsx           ← BlocksRenderer component tests
│       ├── data-renderer.test.tsx      ← context.data threading, blockProps shim, __feed_error__
│       ├── utils.test.ts               ← Util unit tests
│       ├── feed-client.test.ts         ← URL building / filters / clamp / errors
│       ├── mappers.test.ts             ← every wire→prop mapper (blog/ig/reviews/events)
│       ├── resolve-blocks.test.ts      ← resolvers, bind targets, empty-vs-error, expansion
│       ├── resolve-blog-post.test.ts   ← SPA article-layout parity + per-post layout override
│       ├── article-props.test.ts       ← article-props cross-impl parity (Ruby/JS)
│       ├── blog-category-chips.test.ts ← blogCategoryChips + Ruby/JS trim parity
│       └── fixtures/
│           └── blog-detail-parity.json ← shared lockstep fixture (see §19)
├── examples/
│   └── basic-usage.tsx                 ← Reference usage (not shipped; partially stale)
├── dist/                               ← Generated — never edit manually
├── tsup.config.ts                      ← Build entry points + dual-format config
├── tsconfig.json                       ← NodeNext module resolution, strict mode
├── vitest.config.ts                    ← jsdom environment, v8 coverage
├── .eslintrc.cjs                       ← TypeScript ESLint rules
├── ARCHITECTURE.md                     ← Human-oriented architecture docs
├── CHANGELOG.md                        ← Semver changelog
└── package.json                        ← Exports map, scripts, deps
```

**Key rule:** `dist/` is generated by `pnpm run build`. Never edit files inside it.

---

## 3. Architecture Mental Model

```
Consumer passes Block[] array
         │
         ▼  (optional, BEFORE rendering)
┌─────────────────────────────┐
│        resolveBlocks        │  ← pre-render ASYNC pass (§19). Resolves dataSource → props.
│  (only when blocks carry    │     Pure; never touches the registry or the sync renderer.
│   a `dataSource`)           │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│    EnhancedBlocksRenderer   │  ← Use this in most real apps
│  (= BlocksProvider wrapping │
│     BlocksRenderer)         │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│      BlocksProvider         │  ← Injects RouterProvider for @page-speed/pressable
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│      BlocksRenderer         │  ← React component; owns the render loop
│  1. getRootBlocks(blocks)   │
│  2. For each root block:    │
│     renderTree(block)       │
│       └─ renderBlock()      │
│           ├─ __feed_error__  (if _feedMeta.status === "error" and registered)
│           ├─ getBlockRenderer(block._type)   ← custom from registry
│           │   OR getBlockRenderer("__fallback__")
│           │   OR genericBlockRenderer         ← built-in fallback
│           └─ context.renderChildren(id)      ← recursive
└─────────────────────────────┘
           │
           ▼
    React element tree
```

The **synchronous** render engine is unchanged by the data layer. `resolveBlocks` is a separate
pre-render async pass (§19). The render loop itself remains synchronous and recursive.

`BlocksRenderer` uses `useMemo` for `getRootBlocks`. `renderChildBlocks` is defined inside the
component closure so it captures `blocks` (and the new `data` bag) from props.

Two block shapes coexist and are **not** normalized before `resolveBlocks` runs (see §19):

- **Chai runtime shape** — `{ _type, _id, blockProps }` (dt-cms / already-normalized pages).
- **AI wire shape** — `{ block_ref | block_name, data }` (octane-generated, persisted verbatim).

The host app (`customer-sites/chai_pages.tsx`) normalizes wire → chai **after** `resolveBlocks`,
so hydrated props on wire-shaped blocks must land in `data` (handled by `writeContainer`).

---

## 4. Core Data Structures

All types live exclusively in `src/types/index.ts`. Do not duplicate them anywhere.

### `Block` (the core unit)

```typescript
interface Block {
  _id: string;           // REQUIRED. Unique ID. Used as React key and parent lookup.
  _type: string;         // Declared REQUIRED for the post-normalization render engine.
                         // ⚠ At the DATA layer a wire-shaped block (block_ref/block_name) may
                         // arrive WITHOUT it; resolvers derive the component id via blockType().
  block_ref?: string;    // AI wire block reference, e.g. "gallery/instagram-post-grid".
  block_name?: string;   // AI wire block name (fallback for block_ref). Same split("/").pop() rule.
  data?: Record<string, unknown>; // AI wire props container (hydrated into for wire-shaped blocks).
  dataSource?: DataSource; // Symbolic dynamic data source (§19). Retained after resolution.
  _feedMeta?: FeedMeta;  // Machine-readable feed resolution status (ok | empty | error).
  _name?: string;        // Optional human label — not used at runtime.
  _parent?: string | null; // null / undefined = root block. String = child of that _id.
  tag?: string;          // HTML tag override for genericBlockRenderer.
  styles?: string;       // Tailwind classes OR "#styles:,tailwind-classes" (Chai format).
  styles_attrs?: Record<string, string | number | boolean | null>; // Extra HTML attrs.
  backgroundImage?: string; // URL — converted to inline style backgroundImage.
  content?: string;      // Text content rendered as first child.
  link?: { href?; target?; rel? };
  src?: string;          // Image/video source.
  alt?: string;
  width?: number | string;
  height?: number | string;
  mediaReference?: { mediaRecordId?; mediaToken?; fallbackUrl? }; // CDN integration.
  blockProps?: Record<string, unknown>; // CANONICAL component props container.
  [key: string]: unknown; // Index signature — blocks are intentionally open.
}
```

> `props` (the legacy key) is **not** declared on `Block`. It works only because of the index
> signature. The three built-in renderers read `block.blockProps ?? block.props` as a legacy shim;
> `genericBlockRenderer` / `buildElementProps` use **only** `blockProps`.

### `BlockRenderContext`

Passed into every renderer:

```typescript
interface BlockRenderContext {
  blocks: Block[];                                              // Full flat array
  renderChildren: (parentId: string) => ReactNode | ReactNode[] | null; // Recursive renderer
  data?: Record<string, unknown>;                               // Arbitrary data bag from BlocksRenderer `data`
}
```

Always call `context.renderChildren(block._id)` inside custom renderers to render nested blocks.

### `BlockRenderer` / `BlockRendererProps`

```typescript
interface BlockRendererProps { block: Block; context: BlockRenderContext; }
type BlockRenderer = (props: BlockRendererProps) => ReactNode;
```

Every renderer — built-in or custom — must match this signature exactly.

---

## 5. Module Exports & Import Paths

The `exports` map in `package.json` defines **ten** sub-paths. Use the most specific one to
maximize tree-shaking.

| Import path | What it gives you |
|---|---|
| `@page-speed/blocks` | Everything (barrel) — use sparingly |
| `@page-speed/blocks/core` | `BlocksRenderer`, `BlocksProvider`, `EnhancedBlocksRenderer`, `renderBlock`, `genericBlockRenderer` |
| `@page-speed/blocks/core/renderer` | Only `BlocksRenderer`, `renderBlock`, `genericBlockRenderer` (+ `BlocksRendererProps`) |
| `@page-speed/blocks/core/provider` | Only `BlocksProvider` (+ `BlocksProviderProps`) |
| `@page-speed/blocks/core/enhanced` | Only `EnhancedBlocksRenderer` (+ `EnhancedBlocksRendererProps`) |
| `@page-speed/blocks/registry` | Registry CRUD functions + `FALLBACK_RENDERER_KEY` / `FEED_ERROR_RENDERER_KEY` |
| `@page-speed/blocks/types` | TypeScript types only (no runtime code) |
| `@page-speed/blocks/utils` | Pure utility functions |
| `@page-speed/blocks/data` | Dynamic data feed layer — full public API (§19) |
| `@page-speed/blocks/renderers` | Built-in renderer functions + block-type arrays |

**Prefer granular imports.** The barrel still tree-shakes, but granular imports give bundlers a
clearer signal.

Important barrel nuance: `@page-speed/blocks` re-exports only a **curated subset** of the data
layer — `createFeedClient`, `MAX_PER_PAGE`, `resolveBlocks`, `resolveBindTarget`,
`DEFAULT_BIND_TARGETS`, `DEFAULT_BIND_TARGET`, `mapBlogFeedItem`, `mapBlogFeedDetail`,
`formatFeedDate`. The rest of the data API (`mapInstagramFeedItem`, `mapTestimonialItem`,
`mapReviewItem`, `mapSocialTestimonialItem`, `mapEventFeedItem`, `platformLabel`,
`truncateAtWordBoundary`, `SINGLE_BIND_TARGETS`, `BLOG_CATEGORY_BIND_TARGETS`,
`BLOG_PRIMARY_POST_BIND_TARGETS`, `ALL_CATEGORY_CHIP`, `blogCategoryChips`, `blockType`, all the
`article-props` helpers, etc.) is available only from `@page-speed/blocks/data`.

The barrel also re-exports `Pressable` from `@page-speed/pressable` and default-exports
`EnhancedBlocksRenderer`.

`./renderers` maps to the barrel `dist/renderers/index.js`. Although `tsup.config.ts` builds
`dist/renderers/{pressable,button,link}-renderer.*`, those individual entry points are **not**
listed in `package.json` `exports` — import them through `@page-speed/blocks/renderers` (or the
barrel), never as `@page-speed/blocks/renderers/button-renderer` (Node's exports enforcement
blocks it).

---

## 6. Auto-Initialization Behavior

`src/index.ts` runs `initializeDefaultRenderers()` automatically **only in browser environments**
(`typeof window !== "undefined" && typeof document !== "undefined"`). This registers
`pressableRenderer`, `buttonRenderer`, and `linkRenderer` for their associated block type arrays.

Consumers can opt out by setting:

```javascript
window.__PAGE_SPEED_BLOCKS_NO_AUTO_INIT__ = true;
// Must be set BEFORE importing @page-speed/blocks
```

**SSR / Node.js:** Auto-init never runs. You must call `initializeDefaultRenderers()` manually if
you need the default renderers on the server (and register any custom / `__feed_error__`
renderers).

**Tests:** Always call `clearRegistry()` in `beforeEach` to prevent renderer state leaking between
test cases. The singleton registry persists across tests within the same Vitest worker.

---

## 7. Registry System

The registry is a **module-level singleton** (`Map<string, BlockRenderer>` in
`src/registry/index.ts`). It is shared across the entire application.

### API

```typescript
registerBlockRenderer(type: string, renderer: BlockRenderer): void
getBlockRenderer(type: string): BlockRenderer | undefined
hasBlockRenderer(type: string): boolean
unregisterBlockRenderer(type: string): boolean   // returns true if it existed
clearRegistry(): void
getRegisteredTypes(): string[]
registerRenderers(map: Record<string, BlockRenderer>): void  // batch register
```

### Reserved keys

Both constants are exported from `src/registry/index.ts`, the barrel, and `./data`:

```typescript
FALLBACK_RENDERER_KEY   // "__fallback__"
FEED_ERROR_RENDERER_KEY // "__feed_error__"
```

- `__fallback__` — `renderBlock()` consults it before falling back to `genericBlockRenderer`.
- `__feed_error__` — `renderBlock()` routes blocks whose `_feedMeta.status === "error"` here when
  it is registered, so error states stay visually distinct from empty states (§19). When absent,
  the block renders normally (its empty state).

### Registration order

`registerBlockRenderer` silently **overwrites** an existing entry for the same type. There is no
warning. When integrating multiple libraries that register renderers, be deliberate about order.

---

## 8. Renderer Pipeline

### `genericBlockRenderer` (fallback)

Used when no custom renderer is registered for a `_type`. Behavior:

1. Determines HTML tag: `block.tag` → `DEFAULT_TAG_BY_TYPE[block._type]` → `"div"`
2. Calls `buildElementProps(block)` → `{ className, ...attrs, style?, ...blockProps }`
3. Renders `block.content` as first child (text node)
4. Calls `context.renderChildren(block._id)` for tree children
5. Calls `createElement(tag, props, children)`

Default tag map (complete):

```
Box → div     Heading → h2   Paragraph → p   Span → span
Text → span   Link → a       Button → button  List → ul
ListItem → li  Icon → span   Divider → hr     Image → div
Video → div
```

### `renderBlock`

Wraps a single block render. Resolution order:

1. If `block._feedMeta?.status === "error"` **and** `__feed_error__` is registered → use it.
2. Else `getBlockRenderer(block._type)` → `getBlockRenderer("__fallback__")` → `genericBlockRenderer`.

On error: logs to `console.error` and renders a red error box
(`border-red-300 bg-red-50`) using `genericBlockRenderer` — children are still attempted.

### `BlocksRenderer`

- Returns `null` for empty `blocks` array.
- Root blocks render in array order.
- Each block is wrapped in `<Fragment key={block._id}>`.
- Threads the `data` prop into every renderer's `context.data`.
- Without a `wrapper` prop, the outer element is `<div style={{ display: "contents" }}>`. This
  means the wrapper div has **zero layout impact** — it does not create a flex/grid container.
- A `className` prop is applied only to that default wrapper div (not when `wrapper` is supplied).

---

## 9. Styling Rules

### `styles` field formats

The `extractClassName` utility handles two formats:

| Format | Example | Result |
|---|---|---|
| Plain Tailwind | `"p-4 bg-gray-100"` | `"p-4 bg-gray-100"` |
| Chai builder prefix | `"#styles:,p-4 bg-gray-100"` | `"p-4 bg-gray-100"` |

The `#styles:` prefix comes from the Chai design payload format. Always use `extractClassName()`
when reading `block.styles` — never access it raw.

### `backgroundImage`

If `block.backgroundImage` is set, `buildElementProps` adds an inline `style.backgroundImage`.
This merges with any existing `style` from `styles_attrs`. The Tailwind `bg-*` classes and inline
`backgroundImage` can coexist.

### `styles_attrs`

A flat object of HTML attributes (`data-*`, `aria-*`, `id`, `style`, etc.). Null/undefined values
are filtered out by `normalizeAttributes`. The result is spread directly onto the React element.

### `blockProps`

`buildElementProps` spreads `block.blockProps` last, so it wins over derived `className`/attrs.
This is the generic renderer's prop path. The three built-in renderers instead destructure their
declared props from `block.blockProps ?? block.props` and forward them to `Pressable`.

### Pre-compiled Tailwind (recommended approach)

Extract all `styles` strings from block data, run Tailwind CLI to generate a minimal CSS file,
and include it in the app. Do **not** embed the Tailwind CDN runtime in production builds.

---

## 10. Built-in Renderers

All three live in `src/renderers/` and use `@page-speed/pressable`'s `Pressable` component.

### `buttonRenderer`

Registered for: `Button`, `SubmitButton`, `ActionButton`, `FormButton`

- Reads props from `block.blockProps ?? block.props` (cast to `ButtonBlockProps`)
- Sets `asButton={true}` on `Pressable`
- Combines `block.content` + `blockProps.children` + `context.renderChildren(block._id)`

### `linkRenderer`

Registered for: `Link`, `NavLink`, `CTALink`, `ExternalLink`

- Reads `href`, `target`, `rel`, `variant`, `size`, `className` from props
- Default `variant="link"` on `Pressable`
- Does **not** set `asButton`

### `pressableRenderer`

Registered for: `Pressable`, `PressableButton`, `PressableLink`, `CTAButton`, `ActionButton`

- Most generic of the three
- Reads `href`, `onClick`, `variant`, `size`, `asButton`, `className` from props
- Defaults `variant="default"`, `size="default"`, `asButton={false}`

### `ActionButton` collision — read carefully

`ActionButton` appears in **both** `PRESSABLE_BLOCK_TYPES` and `BUTTON_BLOCK_TYPES`.
`initializeDefaultRenderers()` registers **pressable first, then button, then link**:

```typescript
PRESSABLE_BLOCK_TYPES.forEach(type => registerBlockRenderer(type, pressableRenderer));
BUTTON_BLOCK_TYPES.forEach(type => registerBlockRenderer(type, buttonRenderer));
LINK_BLOCK_TYPES.forEach(type => registerBlockRenderer(type, linkRenderer));
```

Therefore the **button** registration wins for `ActionButton` (registered last among the two
colliding loops). This is the OPPOSITE of older documentation that claimed pressable wins. If you
change the loop order in `initializeDefaultRenderers()`, you change observable behavior.

---

## 11. Utility Functions

All in `src/utils/index.ts`. Pure functions — no React, no side effects.

| Function | Signature | Purpose |
|---|---|---|
| `extractClassName` | `(styles?: string) => string` | Strip `#styles:,` prefix; trim |
| `normalizeAttributes` | `(attrs?) => Record<string, unknown>` | Filter null/undefined |
| `extractBackgroundStyle` | `(backgroundImage?) => Record<string,string> \| null` | Build inline `backgroundImage` style object |
| `getRootBlocks` | `(blocks: Block[]) => Block[]` | Filter where `!_parent \|\| _parent === null` |
| `getChildBlocks` | `(blocks: Block[], parentId: string) => Block[]` | Filter where `_parent === parentId` |
| `buildElementProps` | `(block: Block) => Record<string, unknown>` | Compose className + attrs + style + `blockProps` |
| `parseDesignPayload` | `(payload: string \| object) => { blocks: Block[] }` | JSON.parse with fallback |

`buildElementProps` is the most important: it is the single place where `styles`, `styles_attrs`,
`backgroundImage`, and `blockProps` are merged into React-ready props. It spreads `blockProps`
last (winning over derived values), and does **not** read the legacy `props` key.

`parseDesignPayload` returns `{ blocks: Block[] }` — note it does **not** return the full
`DesignPayload` (`version` is not in the runtime shape even though `DesignPayload` declares it).
Consumers that need `DesignPayload` cast the result (see `customer-sites/chai_pages.tsx`).

---

## 12. Build System

### `tsup.config.ts`

- Outputs **both** ESM (`.js`) and CJS (`.cjs`) for every entry.
- Generates `.d.ts` and `.d.cts` declaration files (`dts: true`).
- Generates `.map` sourcemaps (`sourcemap: true`).
- `clean: true` — `dist/` is wiped before each build.
- `splitting: false` — no code-splitting chunks (important for predictable tree-shaking).
- `treeshake: true` — rollup-level tree-shaking enabled.
- `minify: false` — source is readable; consumers minify in their own build.
- All `@opensite/ui`, `@page-speed/*`, and `react*` packages are **external** — never bundled in.
- Injects `"use client";` on every output file via `esbuildOptions.banner` (required for Next.js
  App Router).

### Entry points (one dist file per entry)

```
src/index.ts                        → dist/index.{js,cjs}
src/core/index.ts                   → dist/core/index.{js,cjs}
src/core/renderer.tsx               → dist/core/renderer.{js,cjs}
src/core/BlocksProvider.tsx         → dist/core/BlocksProvider.{js,cjs}
src/core/EnhancedBlocksRenderer.tsx → dist/core/EnhancedBlocksRenderer.{js,cjs}
src/registry/index.ts               → dist/registry/index.{js,cjs}
src/types/index.ts                  → dist/types/index.{js,cjs}
src/utils/index.ts                  → dist/utils/index.{js,cjs}
src/data/index.ts                   → dist/data/index.{js,cjs}
src/renderers/index.ts              → dist/renderers/index.{js,cjs}
src/renderers/pressable-renderer.tsx → dist/renderers/pressable-renderer.{js,cjs}
src/renderers/button-renderer.tsx   → dist/renderers/button-renderer.{js,cjs}
src/renderers/link-renderer.tsx     → dist/renderers/link-renderer.{js,cjs}
```

> The individual `renderers/*-renderer` entries are built but not exposed via `package.json`
> `exports` (only `./renderers` is). Keep them in the tsup entry map for completeness/analysis,
> but import them through the barrel.

### Build commands

```bash
pnpm run build          # One-shot build (tsup)
pnpm run build:watch    # Watch mode
pnpm run clean          # Remove dist/ (rimraf dist)
pnpm run typecheck      # tsc --noEmit (no output, type errors only)
```

`pnpm run prepack` runs `build` automatically before `pnpm pack` or `pnpm publish`.
`pnpm run prepublishOnly` runs tests then build (`pnpm run test && pnpm run build`).

---

## 13. Testing

### Setup

- `vitest` with `jsdom` environment
- `@testing-library/react` for component tests
- `@testing-library/jest-dom` imported globally via `src/__tests__/setup.ts`
- `vitest.config.ts` sets `globals: true` — `describe`, `it`, `expect` etc. are available without
  importing them explicitly
- Coverage: `v8` provider, reporters `text`/`json`/`html`, excludes `node_modules/`, `dist/`,
  `**/*.test.ts(x)`, and `**/*.config.ts`

### Commands

```bash
pnpm run test           # Run all tests once (vitest run)
pnpm run test:watch     # Watch mode
pnpm run test:coverage  # Run with v8 coverage
```

### Critical test rule: always clear the registry

The registry is a module singleton. Tests that register renderers **will pollute subsequent tests**
unless the registry is cleared:

```typescript
import { clearRegistry } from "../registry/index.js";

beforeEach(() => {
  clearRegistry();
});
```

`registry.test.ts` and `data-renderer.test.tsx` already do this. Apply it to any new test file that
touches the registry.

### Test file locations

All tests live in `src/__tests__/`. Use `.test.ts` for pure logic, `.test.tsx` for anything that
renders JSX. Shared fixtures live in `src/__tests__/fixtures/`.

### What is tested

| File | Coverage |
|---|---|
| `registry.test.ts` | All registry CRUD functions, batch registration |
| `renderer.test.tsx` | `BlocksRenderer` rendering, custom renderers, CSS classes, `#styles:` prefix, empty array |
| `data-renderer.test.tsx` | `context.data` threading, `blockProps`/`props` shim, `__feed_error__` routing |
| `utils.test.ts` | `extractClassName`, `normalizeAttributes`, `getRootBlocks`, `getChildBlocks`, `parseDesignPayload` |
| `feed-client.test.ts` | URL building, filter persistence, `per_page` clamp, error envelopes, all five list endpoints |
| `mappers.test.ts` | blog / Instagram / testimonials / events wire→prop mappers, `formatFeedDate`, `truncateAtWordBoundary`, `platformLabel` |
| `resolve-blocks.test.ts` | bind-target resolution, blog/ig/reviews/events resolvers, empty-vs-error, gallery coercion, featuredPost / primaryPost / categories binds, unknown source, per-block error isolation, one-to-many expansion, wire-shape hydration |
| `resolve-blog-post.test.ts` | SPA article-layout parity with first load, per-post layout override precedence |
| `article-props.test.ts` | `mapBlogDetailToArticleProps` cross-impl parity, `slugify`, sections/chapters, read time, breadcrumbs, `cgiEscape`, `normalizedText`, Ruby/JS whitespace parity, `allowListedArticleLayout`, byline/omission rules |
| `blog-category-chips.test.ts` | `blogCategoryChips`, Ruby/JS trim parity, `blog_feed` categories bind |

---

## 14. Task Recipes

### Add a new built-in block renderer

1. Create `src/renderers/my-renderer.tsx`
2. Export a `BlockRenderer` named `myRenderer`
3. Export a `MY_BLOCK_TYPES: string[]` constant listing the `_type` strings it handles
4. Add `export * from "./my-renderer.js"` to `src/renderers/index.ts`
5. Add the `tsup` entry to `tsup.config.ts`:
   ```typescript
   "renderers/my-renderer": "src/renderers/my-renderer.tsx",
   ```
6. **Do not** add a new `package.json` `exports` sub-path for it (the project exposes only the
   `./renderers` barrel); import it via `@page-speed/blocks/renderers`
7. Register it inside `initializeDefaultRenderers()` in `src/index.ts` (mind the loop order —
   see §10)
8. Add tests in `src/__tests__/` (and `clearRegistry()` in `beforeEach`)
9. Run `pnpm run build && pnpm run test`

### Add a new utility function

1. Add the function to `src/utils/index.ts` (pure function, no React)
2. It is exported automatically via the `./utils` sub-path and barrel
3. Add unit tests in `src/__tests__/utils.test.ts`
4. No build config changes needed — `utils/index` entry already exists

### Add a new field to the `Block` type

1. Open `src/types/index.ts`
2. Add the field to the `Block` interface with a JSDoc comment
3. Make it optional (`field?: Type`) unless every block in the system provides it
4. If it needs special handling in `buildElementProps`, update `src/utils/index.ts`
5. Run `pnpm run typecheck` to catch any downstream breakage

### Add a new data source type (Dynamic Data Feeds)

1. Add the source type to the `DataSource["type"]` union in `src/types/index.ts`
2. Add any wire/prop shapes as local, string-typed interfaces in `src/types/index.ts`
   (assignable to the block's `React.ReactNode` props — do **not** add `@opensite/ui` APIs)
3. Add the `FeedClient` list method + its `build*Query` serializer in `src/data/feed-client.ts`
   (`per_page` clamp ≤ `MAX_PER_PAGE`, resend every filter, return errors, never throw/log)
4. Add the wire→prop mapper in `src/data/mappers.ts`
5. Add the resolver + bind-target map(s) in `src/data/resolve-blocks.ts`, register it in
   `BUILT_IN_SOURCES`
6. Export the public API from `src/data/index.ts` and (only if it belongs in the curated barrel
   set) `src/index.ts`
7. Keep lockstep with the dashtrack-ai `Feeds::Hydrator` reference (§19)
8. Add tests; run `pnpm run build && pnpm run test && pnpm run typecheck`

### Register a custom renderer from a consuming app

```typescript
import { registerBlockRenderer } from "@page-speed/blocks/registry";

registerBlockRenderer("MyHeroComponent", ({ block, context }) => {
  return (
    <section className={block.styles}>
      <h1>{block.content}</h1>
      {context.renderChildren(block._id)}
    </section>
  );
});
```

Call registration **before** any `BlocksRenderer` renders for the first time.

### Use a custom wrapper component

```typescript
import { BlocksRenderer } from "@page-speed/blocks/core/renderer";

function PageSection({ children }: { children: React.ReactNode }) {
  return <section className="page-section">{children}</section>;
}

<BlocksRenderer blocks={blocks} wrapper={PageSection} />
```

When `wrapper` is provided, the default `<div style={{ display: "contents" }}>` is not rendered.

### Opt out of RouterProvider (app already has one)

```typescript
import { EnhancedBlocksRenderer } from "@page-speed/blocks/core/enhanced";

<EnhancedBlocksRenderer blocks={blocks} disableRouter={true} />
```

Or use `BlocksProvider` directly:

```typescript
import { BlocksProvider } from "@page-speed/blocks/core/provider";
import { BlocksRenderer } from "@page-speed/blocks/core/renderer";

<BlocksProvider disableRouter>
  <BlocksRenderer blocks={blocks} />
</BlocksProvider>
```

### Parse a Chai design payload

```typescript
import { parseDesignPayload } from "@page-speed/blocks/utils";
// or from the barrel:
import { parseDesignPayload } from "@page-speed/blocks";

const { blocks } = parseDesignPayload(rawJsonStringOrObject);
```

Returns `{ blocks: [] }` on invalid JSON — never throws.

### Prepare a new version (Jordan publishes)

```bash
# 1. Update CHANGELOG.md
# 2. Bump version in package.json
pnpm version patch   # or minor / major
# 3. Verify the package explicitly
pnpm run prepublishOnly
```

Do not run `pnpm publish`. Hand off the verified branch, version, dependency order,
and publish order to Jordan.

---

## 15. Critical Constraints & Danger Zones

### NEVER edit files in `dist/`

`dist/` is fully regenerated on every `pnpm run build` (`clean: true`). Any manual edits will be
silently overwritten.

### NEVER import from relative paths that skip `.js` extensions

`tsconfig.json` uses `"moduleResolution": "NodeNext"`. All internal imports **must** use the
`.js` extension even for `.ts`/`.tsx` source files:

```typescript
// CORRECT
import { Block } from "../types/index.js";

// WRONG — will break at runtime
import { Block } from "../types/index";
import { Block } from "../types";
```

### NEVER add React as a direct dependency

`react` and `react-dom` are `peerDependencies` and `devDependencies` only. They are listed as
`external` in `tsup.config.ts`. Bundling React would cause version conflicts and double-React bugs
in consuming apps.

### NEVER mutate the `blocks` array inside a renderer

Renderers receive the full `blocks` array via `context.blocks`. Mutating it will corrupt the
render tree for sibling/parent renderers. Always treat it as read-only.

### NEVER use `console.log` in production code

Use `console.error` only in the error-handling paths that already use it (`renderBlock`,
`renderTree`, `parseDesignPayload`). No debug logging in renderer, utility, or data-layer code
(`FeedClient` returns errors — it must never log).

### Be careful with `ActionButton` type collision

`ActionButton` is in both `BUTTON_BLOCK_TYPES` and `PRESSABLE_BLOCK_TYPES`. The current
`initializeDefaultRenderers()` registers pressable **first**, button **second**, so
`buttonRenderer` wins for `ActionButton` (§10). If you change the loop order, you change
observable behavior.

### `blockProps` is canonical; `props` is a legacy shim only

The declared field is `blockProps`. The three built-in renderers fall back to `props` for old
payloads, but `buildElementProps` / `genericBlockRenderer` do not. New code must read `blockProps`.

### Wire-shaped blocks may lack `_type` at the data layer

`Block._type` is declared required (correct for the post-normalization render engine), but AI wire
blocks (`block_ref`/`block_name`) reach `resolveBlocks` without it. Data-layer code must derive the
component id via `blockType()` and write hydrated props via `writeContainer`/`withContainer` (§19).
Do not assume `_type` is present in `src/data/`.

### `__fallback__` and `__feed_error__` keys are reserved

Do not use `"__fallback__"` or `"__feed_error__"` as real block `_type`s. They are internal
sentinels consulted by `renderBlock`.

### Empty ≠ error (feed semantics)

`_feedMeta.status` is `ok | empty | error`. An `empty` outcome must never fabricate items or
placeholder content; an `error` outcome routes to `__feed_error__` only when registered. Do not
collapse a 404 `blog_post` into `upstream_error` (it must be `post_not_found` empty) — customer-sites
keys its not-found detection on that exact reason.

### Lockstep contracts (do not diverge unilaterally)

The data layer is a **byte-for-byte client-side mirror** of two Ruby references:

- `dashtrack-ai` `app/services/feeds/hydrator.rb` (feed hydration / block-shape handling)
- `customer-sites` `app/services/blog_detail_entry.rb` (article-layout props)

`src/__tests__/fixtures/blog-detail-parity.json` is shared with
`utility-modules/customer-sites/spec/fixtures/blog_detail_parity.json`. Changing a mapper/resolver
on one side turns the other repo's suite red. Before changing `mappers.ts`, `resolve-blocks.ts`, or
`article-props.ts`, grep the dashtrack-ai / customer-sites repos for the matching Ruby method.

### `sideEffects: false` contract

Because the package declares `"sideEffects": false`, bundlers may eliminate any module that is
imported but whose exports are unused. The auto-init code at the bottom of `src/index.ts` **only
runs if the barrel is actually imported and its exports are used**. If a consumer imports only
from sub-paths (e.g., `@page-speed/blocks/registry`), the auto-init never runs.

---

## 16. Dependency Graph & Consumers

### Direct dependencies

| Package | Range (package.json) | Actually imported by `src/`? |
|---|---|---|
| `@opensite/ui` | `3.17.3` (exact) | ❌ externalized, not imported at runtime |
| `@page-speed/img` | `0.4.10` (exact) | ❌ externalized, not imported at runtime |
| `@page-speed/pressable` | `^0.1.1` | ✅ `Pressable` (all three built-in renderers) |
| `@page-speed/router` | `^1.2.1` | ✅ `RouterProvider` (`BlocksProvider`) |
| `@page-speed/video` | `0.0.9` (exact) | ❌ externalized, not imported at runtime |

`@opensite/ui`, `@page-speed/img`, and `@page-speed/video` are declared dependencies and listed in
the tsup `external` array for ecosystem/hoisting consistency, but **this package's own runtime only
imports `@page-speed/pressable` and `@page-speed/router`**. Before adding a new `@page-speed/*` or
`@opensite/*` import, verify it is already in `dependencies` **and** the `external` array.

### Peer dependencies

```
react >=17.0.0
react-dom >=17.0.0
```

(These are the only two `peerDependencies` in `package.json` — the README's "Peer Dependencies"
install command listing `@opensite/ui` / `@page-speed/img` / `@page-speed/video` /
`@page-speed/pressable` / `@page-speed/router` is misleading; those are regular `dependencies`.)

### Reverse dependencies (consumers of `@page-speed/blocks`)

Per `/Users/jordanhudgens/code/dashtrack/docs/front-end-dependency-graph.md`, `@page-speed/blocks`
is consumed by `app` (customer-sites), `dashtrack-cms`, and `opensite-ui-showcase`.

#### `app` → `utility-modules/customer-sites` (`app/javascript/`)

- `block-registry.ts` — `initOpenSiteRenderers()` registers **every** `@opensite/ui` block into
  the blocks registry via `registerBlockRenderer`. It calls `getAllBlocks()` from
  `@opensite/ui/registry`, then deserializes `blockProps` (`__jsx` values and markup-looking
  strings) using `deserializeJsx` + `@page-speed/markdown-to-jsx`'s `compileMarkdown` (with
  `script`/`style` overrides that render `null`).
- `chai_pages.tsx` — the live-site entrypoint. Uses the **base** `BlocksRenderer` (not
  `EnhancedBlocksRenderer`) because it already wraps the tree in `@page-speed/router`'s
  `RouterProvider` directly. It also uses `parseDesignPayload` (barrel), `resolveBlocks`
  (`/data`), and its own local `normalizeBlocks` (wire → chai, run **after** `resolveBlocks`).
  `resolveBlocks` is invoked with `{ baseUrl, websiteToken, path }` from server-injected
  `window._dashtrackFeeds` / `window._dashtrackWebsite`.

#### `dashtrack-cms` → `dt-cms/Source/src/`

- `chaibuilder/useBlocksRenderer.ts` — lazily `import("@page-speed/blocks")` on the client and
  uses `EnhancedBlocksRenderer` (or `default`).
- `features/semantic-builder/previewFeedHydration.ts` — the semantic-builder preview uses
  `createFeedClient`, `resolveBindTarget`, `resolveBlocks`, and `SINGLE_BIND_TARGETS` from
  `@page-speed/blocks/data`. It also contains **pin-lag lockstep copies** of `blogCategoryChips`,
  `applyPrimaryPostBind`, and `clearEmptyFeedItems` that become idempotent no-ops once the preview
  runs against a `@page-speed/blocks` release that natively writes those binds.

#### `opensite-ui-showcase` → `tools/opensite-ui-showcase/src/`

- `app/test-blocks/page.tsx` — a fixture page using `EnhancedBlocksRenderer` with a hand-written
  `Block[]` array.
- `components/block-preview.tsx` — registers a per-component `showcase:<id>` renderer with
  `registerBlockRenderer` and renders it through `EnhancedBlocksRenderer` inside an iframe portal;
  unregisters on cleanup with `unregisterBlockRenderer`.

### Update order

Dependency-first (`docs/front-end-dependency-graph.md`): update/publish `@page-speed/pressable`
and `@page-speed/router` before `@page-speed/blocks`, and `@page-speed/blocks` before `app`,
`dashtrack-cms`, and `opensite-ui-showcase`. Applications are consumers only and are not published.

---

## 17. TypeScript Rules

- **Strict mode** is enabled (`"strict": true`). No implicit `any`.
- Target is `ES2022` — you can use optional chaining, nullish coalescing, `at()`, `Object.hasOwn`,
  etc. Do not use features newer than ES2022.
- `module` / `moduleResolution` are `NodeNext` — internal imports need `.js` extensions (§15).
- JSX transform is `react-jsx` — no `import React from "react"` needed in `.tsx`, but explicit
  imports are still required for `createElement`, `useMemo`, `Fragment`, `ReactNode`, etc.
- `types: ["node"]` is set in `tsconfig.json`.
- `@typescript-eslint/no-explicit-any` is a **warning**, not an error. Prefer proper types but
  explicit `any` is acceptable in renderer prop destructuring (the built-in renderers use it in
  their `[key: string]: any` interfaces and `...restProps`).
- `@typescript-eslint/no-unused-vars` is an error, with `argsIgnorePattern: "^_"` (prefix unused
  variables with `_`).
- `skipLibCheck: true` — declaration file errors from dependencies are ignored.
- `tsconfig.json` excludes `**/*.test.ts` / `**/*.test.tsx` from the build (`include` is
  `src/**/*`); tests are type-checked by `vitest`/esbuild, not `tsc --noEmit`.

---

## 18. Checklist Before Every Commit

Run all of these. Do not commit if any fail.

```bash
pnpm run typecheck    # Zero TypeScript errors
pnpm run lint         # Zero ESLint errors (eslint src --ext .ts,.tsx)
pnpm run test         # All tests pass (vitest run)
pnpm run build        # Build succeeds, dist/ is up to date
```

Additional checks:

- [ ] No new files added to `dist/` manually
- [ ] All new `.ts`/`.tsx` imports use the `.js` extension
- [ ] Any new `Block` fields are optional and documented with JSDoc
- [ ] Any new renderer is exported from `src/renderers/index.ts` and registered in `initializeDefaultRenderers()`
- [ ] Any new entry point is added to `tsup.config.ts` (and, if it must be publicly importable, `package.json` `exports`)
- [ ] `clearRegistry()` is called in `beforeEach` for any test touching the registry
- [ ] Any data-layer change is checked against the dashtrack-ai `Feeds::Hydrator` / customer-sites
      `BlogDetailEntry` lockstep references (§15/§19)
- [ ] `CHANGELOG.md` updated if behavior changes
- [ ] `package.json` version bumped if publishing

---

## 19. Dynamic Data Feed Layer (`src/data/`)

Implements the client-side rendering data layer of
`../../docs/dynamic-feeds/FEED_CONTRACT.md` (v1, Phases 1–6). **The synchronous render engine is
untouched** — resolution is a separate pre-render async pass. Files:

```
src/data/
├── index.ts          ← Barrel: re-exports the public API + data types from src/types
├── feed-client.ts    ← createFeedClient — the SINGLE place that builds feed URLs
├── resolve-blocks.ts ← resolveBlocks + bind-target maps + block-shape helpers
├── mappers.ts        ← wire → prop mappers + formatFeedDate + truncateAtWordBoundary
└── article-props.ts  ← blog-detail → article-layout props (mirror of BlogDetailEntry)
```

### Source types (all five implemented)

`DataSource["type"]` union:

- `blog_feed` — blog list (Phase 1)
- `blog_post` — blog detail (Phase 1)
- `testimonials_feed` — reviews (Phase 2)
- `instagram_feed` — Instagram gallery (Phase 3)
- `events_feed` — the first **EXPANDING** source (`expands: true`, D6, Phase 4)

### `resolveBlocks`

```typescript
resolveBlocks(blocks, {
  baseUrl,      // feeds API origin — never hardcoded
  websiteToken, // websites.token — the single scoping identifier
  path?,        // resolves blog_post { current: true } slugs from the last segment
  sources?,     // override/add source resolvers (merged over BUILT_IN_SOURCES)
  fetcher?,     // injectable fetch
}): Promise<Block[]>
```

- **Pure** — no registry access, no mutation of input blocks. Maps each block to zero-or-more
  output blocks (one-to-many expansion, contract D6) and `.flat()`s the result.
- Bind target resolution: `dataSource.bindTo` → `SINGLE_BIND_TARGETS[type]` →
  `DEFAULT_BIND_TARGETS[type]` → `"posts"` (`DEFAULT_BIND_TARGET`).
- Only the bind target(s) are written; every other authored prop is untouched (§2.3 rule 2).
  `dataSource` is retained on the output block (except on expanded events heroes, where it is
  dropped so re-resolves never re-expand).
- Unknown `dataSource.type` → block untouched + `_feedMeta.reason = "unknown_source:<type>"`.
- A resolver that throws/rejects degrades only its own block (`reason: "resolver_threw"`), never
  the whole `Promise.all`.

### Bind-target maps (exported from `./data`)

| Map | Key examples | Target |
|---|---|---|
| `DEFAULT_BIND_TARGETS` | `blog-related-articles` → `articles`; `blog-tech-insights` → `secondaryPosts`; `instagram-post-grid` → `items`; 17 array testimonials blocks → `testimonials`; `testimonials-list-verified` / `-images-helpful` / `-grid-add-review` → `reviews`; carousel `carousel-*` → `items` | array prop |
| `SINGLE_BIND_TARGETS` | `testimonials-company-logo` / `-large-quote` / `-split-image` → `testimonial` | single object (`items[0]`) |
| `BLOG_CATEGORY_BIND_TARGETS` | `blog-filtered-results` → `categories` | second bind: category chips |
| `BLOG_PRIMARY_POST_BIND_TARGETS` | `blog-filtered-results` → `primaryPost` | third bind: featured hero slot |
| `DEFAULT_BIND_TARGET` | — | `"posts"` (final fallback) |

`ALL_CATEGORY_CHIP` (`{ label: "All", value: "all" }`) is prepended to every non-empty hydrated
chip list; `blogCategoryChips()` trims with `rubyPosixTrim` (Ruby `[[:space:]]`), de-duplicates
case-insensitively, and never fabricates a chip on an empty taxonomy.

### `blockType` / block-shape handling

Two block shapes coexist and are never normalized before `resolveBlocks` (the host normalizes
after). `resolve-blocks.ts` exports:

- `blockType(block)` — `_type` when present, else the last `/` segment of `block_ref`/`block_name`.
- `writeContainer` / `withContainer` (internal) — write hydrated props into `data` for wire-shaped
  blocks, `blockProps` for chai-shaped blocks.

### Empty vs error

`_feedMeta.status` is `ok | empty | error` with a machine-readable `reason`. `renderBlock` routes
`error`-state blocks to `__feed_error__` only when registered; otherwise the block renders its
empty state. `empty` outcomes clear only targets the block already authored (`clearEmptyBindTarget`;
single-bind targets are deleted, array targets set to `[]`). Never fabricate items or placeholder
content.

### `FeedClient`

`createFeedClient({ baseUrl, websiteToken, fetcher? })` builds URLs under
`/public_services/websites/{token}/feeds/...`:

- `listBlogs(params)` → `/blogs`
- `getBlog(slug)` → `/blogs/{slug}`
- `listBlogCategories()` / `listBlogTags()` → `/blog_categories` / `/blog_tags` (`per_page=50`)
- `listInstagram(params)` → `/instagram`
- `listReviews(params)` → `/reviews`
- `listEvents(params)` → `/events`

Rules (do not regress):

- `per_page` is clamped ≤ `MAX_PER_PAGE` (50). `TAXONOMY_PER_PAGE = MAX_PER_PAGE`.
- Every provided filter is serialized on **every** call (filters never drop across pages — legacy
  bug #1). Scalar `category`/`tag` use `category_slug`/`tag_slug`; arrays use repeated
  `category_slug[]`/`tag_slug[]`. Reviews `platforms[]`, events `location_ids[]` are repeated Rack
  keys.
- Errors are **returned** as `{ data, meta, error }` — never thrown, never logged (legacy bugs
  #4/#5/#6). `error.status` is the HTTP status (or `0` for network failures).
- `baseUrl` / `websiteToken` / `fetcher` are injected, never hardcoded.

### Wire→prop mappers (`mappers.ts`)

- `mapBlogFeedItem` / `mapBlogFeedDetail` (blog list/detail)
- `mapInstagramFeedItem` — returns `null` to skip imageless posts (`files[0].image_url` absent)
- `mapTestimonialItem` (base) / `mapReviewItem` (returns `null` without a numeric rating; `rating`
  is REQUIRED, never fabricated) / `mapSocialTestimonialItem` (twitter-cards)
- `mapEventFeedItem` — one occurrence → `hero-event-registration` blockProps (`EventHeroProps`)
- `formatFeedDate` (`"%b %-d, %Y"`, UTC-pinned), `truncateAtWordBoundary`, `platformLabel`
  (18 `review_type` keys, `tripadvisor` → `"TripAdvisor"` — capital A, lockstep)

### Events feed (Phase 4, expanding source)

One symbolic block hydrates into **N** `hero-event-registration` instances:

- `eventLimit(source)` = `limit` default **6**, hard cap **12**; also used as `per_page`.
- Each minted block gets a deterministic `_id`
  (`"<symbolic_id>__ev_<event_id>_<occurrence_index>"`), inherits the symbolic `_parent`, and
  carries `_feedMeta { status: "ok", source: "events_feed", expandedFrom: <symbolic_id> }`.
- Minted blocks are minimal (`{ _id, _type, _parent, blockProps, _feedMeta }`) — authored
  presentation on the symbolic source is dropped; `dataSource` is dropped; `blockProps` are fresh
  mapped occurrence props (no merge).
- On empty (`no_upcoming_events`) or error (`upstream_error`) the original symbolic block stays in
  place unexpanded. Empty events do **not** run `clearEmptyBindTarget` (no bind target exists).

### Blog detail → article layouts (`article-props.ts`)

`mapBlogDetailToArticleProps` mirrors customer-sites `BlogDetailEntry#blog_to_article_props` — the
FAT union superset all six longform layouts render from. `resolveBlogPost` merges it over the
template's authored props, then applies a per-post `article_layout` override only when it is
allow-listed (`ARTICLE_LAYOUT_COMPONENT_IDS`, six ids) and only on the primary article block (no
`bindTo`). A 404 → `post_not_found` empty (never `upstream_error`).

`article-props.ts` ports several Ruby string primitives byte-for-byte (a recurring platform
lockstep trap): `rubyStrip` (ASCII `String#strip`, not JS `trim()`), `ASCII_WHITESPACE_SPLIT`,
`RUBY_POSIX_SPACE` (Unicode `[[:space:]]`, NOT JS `/\s/u`), `rubyPosixTrim`, `normalizedText`,
`cgiEscape` (Ruby `CGI.escape`), and `slugify` (mirror of `@page-speed/markdown-to-jsx` +
`BlogDetailEntry#slugify`). `HEADING_LINE` uses `[^\n]` (not `.`) so U+2028/U+2029 headings match
Ruby. `post.pubDate` is a Unix-ms integer (date-fns throws on strings).

### Key rules (do not regress)

- **Types stay in `src/types/index.ts`.** All feed interfaces (`DataSource`, `FeedMeta`,
  `FeedError`, `FeedListResponse`, `BlogFeedItem`, `InstagramFeedItem`, `ReviewFeedItem`,
  `EventFeedItem`, `ArticleDetailProps`, …) live there and are re-exported from `src/data`.
- **`FeedClient` owns URL building.** Every provided filter is serialized on every call. `per_page`
  is clamped ≤ 50. Errors are returned, never thrown/logged.
- **`resolveBlocks` is pure** and one-to-many expansion uses `.flat()`.
- **`blockProps` is canonical.** The three built-in renderers read `block.blockProps ?? block.props`
  (legacy `props` is a fallback shim only).
- **Media-URL rule (load-bearing, §3.7):** the data layer only ever consumes re-hosted MediaRecord
  CDN URLs the server ships in `files[]` / `image_url`. Never add a code path that surfaces the
  expiring `instagram_post_files.img_url`/`video_url` columns.
- **Never fabricate.** Omit absent fields/regions; engagement counts are omitted when the wire
  value is `null`; reviews with no numeric `rating` drop; events stats/actions are real-only and
  capped (`actions ≤ 2`, `stats ≤ 4`).
- **Lockstep parity.** The client (TS) and build-time (dashtrack-ai `Feeds::Hydrator`) must derive
  block type ids, choose the write container (`data` vs `blockProps`), map props, and handle
  empty/error identically. The `blog-detail-parity.json` fixture is shared with customer-sites —
  changing one side turns the other's suite red.
- **SSR:** `resolveBlocks` uses plain `fetch`; inject a `fetcher` for Node < 18 / tests.
  `initializeDefaultRenderers()` must still be called manually server-side (browser-only auto-init
  — see §6), including any custom / `__feed_error__` renderers.
- Adding the `./data` subpath required updating **both** `tsup.config.ts` (`"data/index"`) and
  `package.json` `exports` (`./data`). Keep those in sync for any future sub-path.
