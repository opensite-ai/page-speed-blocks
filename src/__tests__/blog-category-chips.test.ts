import { describe, it, expect } from "vitest";
import {
  resolveBlocks,
  blogCategoryChips,
  ALL_CATEGORY_CHIP,
  BLOG_CATEGORY_BIND_TARGETS,
} from "../data/resolve-blocks.js";
import type { Block, BlogFeedItem } from "../types/index.js";

/**
 * R9 — dynamic category chips (FEED_CONTRACT §2.4).
 *
 * The `blog-filtered-results` chip bar used to be a purely AUTHORED prop: the LLM themed the
 * demo seed at generation time and froze it into `pages.design_payload`, so every live site
 * shipped fabricated chips (Healthcare / Hospitality / Dental) that matched none of its real
 * posts. Hydration now OVERRIDES that array with the site's published-category taxonomy, in
 * lockstep with the dashtrack-ai `Feeds::Hydrator` (server-side, first load).
 */

const BASE = "https://api.example.com";
const TOKEN = "tok";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

const post: BlogFeedItem = {
  id: 12,
  token: "abc123",
  slug: "ai-sales-automation-for-smbs",
  title: "AI sales automation for SMBs",
  summary: "Start with frequent, data-rich handoffs.",
  link_path: "/b/ai-sales-automation-for-smbs",
  published_at: "2026-08-01T09:00:00Z",
  author: "Jordan H",
  image_url: "https://cdn.ing/img.jpg",
  image_alt: "Desk",
  seo_title: null,
  seo_description: null,
  blog_category: { name: "AI sales automation", slug: "ai-sales-automation" },
  blog_tags: [],
};

/** Production-shaped taxonomy for workflowrush.com (website 1124), ordered by name. */
const TAXONOMY = [
  { name: "AI Automation Strategy", slug: "ai-automation-strategy" },
  { name: "AI sales automation", slug: "ai-sales-automation" },
  { name: "Business book reviews", slug: "business-book-reviews" },
];

/** The exact fabricated chips frozen into website 1124's live design_payload. */
const AUTHORED_FAKE_CHIPS = [
  { label: "All", value: "all" },
  { label: "Healthcare", value: "healthcare" },
  { label: "Hospitality", value: "hospitality" },
  { label: "Dental", value: "dental" },
  { label: "Lead Generation", value: "lead-generation" },
];

type FetcherOptions = {
  posts?: BlogFeedItem[];
  taxonomy?: Array<{ name: string; slug: string }>;
  taxonomyStatus?: number;
};

function feedFetcher(options: FetcherOptions = {}) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/feeds/blog_categories")) {
      if (options.taxonomyStatus && options.taxonomyStatus >= 400) {
        return jsonResponse({}, false, options.taxonomyStatus);
      }
      return jsonResponse({ data: options.taxonomy ?? TAXONOMY, meta: null });
    }
    if (url.includes("/feeds/blogs")) {
      return jsonResponse({
        data: options.posts ?? [post],
        meta: { page: 1, per_page: 12, total_pages: 1, total_records: 1 },
      });
    }
    return jsonResponse({ data: [], meta: null }, false, 404);
  }) as typeof fetch;
  return { calls, fetcher };
}

function filteredResultsBlock(): Block {
  return {
    _id: "blk_blog",
    _type: "blog-filtered-results",
    blockProps: {
      heading: "AI Automation Insights for Business Owners",
      categories: AUTHORED_FAKE_CHIPS,
    },
    dataSource: { type: "blog_feed" },
  };
}

describe("blogCategoryChips", () => {
  it("emits an All entry plus {label: name, value: name.toLowerCase()} in taxonomy order", () => {
    expect(blogCategoryChips(TAXONOMY)).toEqual([
      { label: "All", value: "all" },
      { label: "AI Automation Strategy", value: "ai automation strategy", slug: "ai-automation-strategy" },
      { label: "AI sales automation", value: "ai sales automation", slug: "ai-sales-automation" },
      { label: "Business book reviews", value: "business book reviews", slug: "business-book-reviews" },
    ]);
  });

  it("values match what the block compares against (post.category.toLowerCase())", () => {
    const chips = blogCategoryChips(TAXONOMY);
    const postCategory = "AI sales automation".toLowerCase();
    expect(chips.some((chip) => chip.value === postCategory)).toBe(true);
  });

  it("de-duplicates case-only collisions (they would collide on the React key)", () => {
    const chips = blogCategoryChips([
      { name: "AI Sales Automation", slug: "a" },
      { name: "ai sales automation", slug: "b" },
    ]);
    expect(chips).toEqual([
      ALL_CATEGORY_CHIP,
      { label: "AI Sales Automation", value: "ai sales automation", slug: "a" },
    ]);
  });

  it("skips blank names and returns [] (no lone All chip) when nothing survives", () => {
    expect(blogCategoryChips([{ name: "   ", slug: "x" }])).toEqual([]);
    expect(blogCategoryChips([])).toEqual([]);
  });

  /**
   * R9 review fix: the trim is Ruby `[[:space:]]` (`rubyPosixTrim`), NOT `String.trim()`.
   *
   * The server side (`Feeds::Hydrator#published_category_names`) trims with `[[:space:]]`, and the
   * two sets differ on exactly two codepoints, so `.trim()` produced a DIFFERENT chip label (and
   * therefore value, and React key) than the server for a BOM-wrapped category name.
   */
  describe("Ruby/JS trim parity (rubyPosixTrim, not String.trim)", () => {
    // Same constants (and same convention) as the article-props parity suite.
    const ZWNBSP = String.fromCharCode(0xfeff); // BOM  - Ruby [[:space:]] N | JS \s Y
    const NEXT_LINE = String.fromCharCode(0x0085); // NEL - Ruby [[:space:]] Y | JS \s N
    const NBSP = String.fromCharCode(0x00a0); // both Y
    const IDEOGRAPHIC = String.fromCharCode(0x3000); // both Y

    it("KEEPS a U+FEFF BOM wrapper, exactly as Ruby [[:space:]] does", () => {
      // Ruby  : "<BOM>Dental<BOM>".gsub(/\A[[:space:]]+|[[:space:]]+\z/, "") => "<BOM>Dental<BOM>"
      // JS    : "<BOM>Dental<BOM>".trim()                                     => "Dental"
      const name = `${ZWNBSP}Dental${ZWNBSP}`;
      expect(blogCategoryChips([{ name, slug: "dental" }])).toEqual([
        ALL_CATEGORY_CHIP,
        { label: name, value: name.toLowerCase(), slug: "dental" },
      ]);
    });

    it("STRIPS a U+0085 NEL wrapper, exactly as Ruby [[:space:]] does", () => {
      // The mirror-image case: JS `\s` (and therefore `.trim()`) does NOT contain U+0085.
      expect(
        blogCategoryChips([{ name: `${NEXT_LINE}Dental${NEXT_LINE}`, slug: "dental" }])
      ).toEqual([ALL_CATEGORY_CHIP, { label: "Dental", value: "dental", slug: "dental" }]);
    });

    it("still trims the members both languages agree on, and drops all-space names", () => {
      expect(
        blogCategoryChips([{ name: `${NBSP}Dental${IDEOGRAPHIC}`, slug: "dental" }])
      ).toEqual([ALL_CATEGORY_CHIP, { label: "Dental", value: "dental", slug: "dental" }]);
      expect(
        blogCategoryChips([{ name: `${NEXT_LINE}${NBSP}${IDEOGRAPHIC}`, slug: "x" }])
      ).toEqual([]);
    });
  });
});

describe("resolveBlocks — blog_feed categories bind (§2.4)", () => {
  it("declares the chip bind target for blog-filtered-results", () => {
    expect(BLOG_CATEGORY_BIND_TARGETS["blog-filtered-results"]).toBe("categories");
  });

  it("OVERRIDES the authored fake chips with the site's real categories", async () => {
    const { fetcher } = feedFetcher();
    const [resolved] = await resolveBlocks([filteredResultsBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });

    expect(resolved.blockProps?.categories).toEqual([
      { label: "All", value: "all" },
      { label: "AI Automation Strategy", value: "ai automation strategy", slug: "ai-automation-strategy" },
      { label: "AI sales automation", value: "ai sales automation", slug: "ai-sales-automation" },
      { label: "Business book reviews", value: "business book reviews", slug: "business-book-reviews" },
    ]);
    // Every other authored prop survives (§2.3 rule 2).
    expect(resolved.blockProps?.heading).toBe(
      "AI Automation Insights for Business Owners"
    );
    expect(resolved._feedMeta?.status).toBe("ok");
  });

  it("writes the chips into `data` for a wire-shaped (block_ref) block", async () => {
    const { fetcher } = feedFetcher();
    const wireBlock: Block = {
      _id: "blk_wire",
      block_ref: "blog/blog-filtered-results",
      data: { heading: "All Articles", categories: AUTHORED_FAKE_CHIPS },
      dataSource: { type: "blog_feed" },
    };

    const [resolved] = await resolveBlocks([wireBlock], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });

    expect(resolved.data?.categories).toEqual(blogCategoryChips(TAXONOMY));
    expect(resolved.blockProps).toBeUndefined();
  });

  it("fetches the taxonomy ONCE for a page carrying several chip blocks", async () => {
    const { calls, fetcher } = feedFetcher();
    const second = { ...filteredResultsBlock(), _id: "blk_blog_2" };

    const resolved = await resolveBlocks([filteredResultsBlock(), second], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });

    expect(
      calls.filter((url) => url.includes("blog_categories")).length
    ).toBe(1);
    for (const block of resolved) {
      expect(block.blockProps?.categories).toEqual(blogCategoryChips(TAXONOMY));
    }
  });

  it("never touches the chips of a block that has no filter bar", async () => {
    const { calls, fetcher } = feedFetcher();
    const gridBlock: Block = {
      _id: "blk_grid",
      _type: "blog-grid-author-cards",
      blockProps: { heading: "Latest" },
      dataSource: { type: "blog_feed" },
    };

    const [resolved] = await resolveBlocks([gridBlock], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });

    expect(resolved.blockProps?.categories).toBeUndefined();
    // No chip-bearing block on the page → no taxonomy request at all.
    expect(calls.some((url) => url.includes("blog_categories"))).toBe(false);
  });

  it("replaces the fake chips with [] rather than keeping them when the taxonomy is empty", async () => {
    const { fetcher } = feedFetcher({ taxonomy: [] });
    const [resolved] = await resolveBlocks([filteredResultsBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });

    expect(resolved.blockProps?.categories).toEqual([]);
    expect(resolved._feedMeta?.status).toBe("ok");
  });

  it("degrades to [] (never fabricated chips) when the taxonomy request fails, keeping posts ok", async () => {
    const { fetcher } = feedFetcher({ taxonomyStatus: 503 });
    const [resolved] = await resolveBlocks([filteredResultsBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });

    expect(resolved.blockProps?.categories).toEqual([]);
    // Single-item feed: the newest post now rides the primaryPost hero bind.
    expect(
      (resolved.blockProps?.primaryPost as Record<string, unknown>).title
    ).toBe("AI sales automation for SMBs");
    expect(resolved._feedMeta?.status).toBe("ok");
  });

  it("clears the fake chips on an EMPTY feed too (no posts must not mean fake filters)", async () => {
    const { fetcher } = feedFetcher({ posts: [] });
    const [resolved] = await resolveBlocks([filteredResultsBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });

    expect(resolved._feedMeta?.status).toBe("empty");
    expect(resolved._feedMeta?.reason).toBe("no_published_posts");
    expect(resolved.blockProps?.categories).toEqual(blogCategoryChips(TAXONOMY));
    // The empty branch must not invent a posts array.
    expect(resolved.blockProps?.posts).toBeUndefined();
  });

  it("leaves the authored chips untouched when the POST query itself errors", async () => {
    const fetcher = (async () => jsonResponse({}, false, 500)) as typeof fetch;
    const [resolved] = await resolveBlocks([filteredResultsBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });

    expect(resolved._feedMeta?.status).toBe("error");
    expect(resolved.blockProps?.categories).toEqual(AUTHORED_FAKE_CHIPS);
  });
});
