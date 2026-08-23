import { describe, it, expect } from "vitest";
import {
  resolveBlocks,
  resolveBindTarget,
  DEFAULT_BIND_TARGETS,
  SINGLE_BIND_TARGETS,
} from "../data/resolve-blocks.js";
import type {
  Block,
  BlogFeedItem,
  BlogFeedDetailItem,
  DataSource,
  EventFeedItem,
  FeedSourceResolver,
  InstagramFeedItem,
  ReviewFeedItem,
} from "../types/index.js";

const BASE = "https://api.example.com";
const TOKEN = "tok";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: "OK",
    json: async () => body,
  } as Response;
}

/** Build a fetcher that dispatches on URL substring. */
function routeFetcher(routes: Array<[string, unknown]>, failing = false): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (failing) throw new Error("network down");
    const url = String(input);
    for (const [needle, body] of routes) {
      if (url.includes(needle)) return jsonResponse(body);
    }
    return jsonResponse({ data: [], meta: null }, false, 404);
  }) as typeof fetch;
}

const sampleItem: BlogFeedItem = {
  id: 12,
  token: "abc123",
  slug: "grand-opening",
  title: "Grand opening",
  summary: "We opened!",
  link_path: "/b/grand-opening",
  published_at: "2026-07-01T09:00:00Z",
  author: "Jordan H",
  image_url: "https://cdn.ing/img.jpg",
  image_alt: "Storefront",
  seo_title: "Grand opening",
  seo_description: "desc",
  blog_category: { name: "News", slug: "news" },
  blog_tags: [{ name: "Openings", slug: "openings" }],
};

describe("resolveBindTarget", () => {
  it("prefers explicit bindTo", () => {
    const block: Block = { _id: "1", _type: "blog-grid-author-cards", dataSource: { type: "blog_feed", bindTo: "custom" } };
    expect(resolveBindTarget(block)).toBe("custom");
  });

  it("uses the per-block default map (blog-related-articles -> articles)", () => {
    expect(DEFAULT_BIND_TARGETS["blog-related-articles"]).toBe("articles");
    const block: Block = { _id: "1", _type: "blog-related-articles", dataSource: { type: "blog_feed" } };
    expect(resolveBindTarget(block)).toBe("articles");
  });

  it("falls back to posts", () => {
    const block: Block = { _id: "1", _type: "blog-grid-author-cards", dataSource: { type: "blog_feed" } };
    expect(resolveBindTarget(block)).toBe("posts");
  });
});

describe("resolveBlocks — blog_feed resolved", () => {
  it("inlines mapped items into the bind target, retains dataSource, leaves authored props untouched", async () => {
    const fetcher = routeFetcher([
      ["/feeds/blogs", { data: [sampleItem], meta: { page: 1, per_page: 9, total_pages: 1, total_records: 1 } }],
    ]);
    const block: Block = {
      _id: "blk_a1",
      _type: "blog-grid-author-cards",
      blockProps: { heading: "Latest news" },
      dataSource: { type: "blog_feed", limit: 9, category: "news", bindTo: "posts" },
    };

    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    // authored prop untouched
    expect(out.blockProps?.heading).toBe("Latest news");
    // bind target inlined + mapped per §4.1
    const posts = out.blockProps?.posts as Array<Record<string, unknown>>;
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      id: 12,
      title: "Grand opening",
      category: "News",
      author: "Jordan H",
      date: "Jul 1, 2026",
      href: "/b/grand-opening",
      image: "https://cdn.ing/img.jpg",
      imageAlt: "Storefront",
    });
    // dataSource retained
    expect(out.dataSource).toEqual(block.dataSource);
    // ok meta with pagination
    expect(out._feedMeta).toMatchObject({
      status: "ok",
      source: "blog_feed",
      page: 1,
      perPage: 9,
      totalPages: 1,
      totalRecords: 1,
    });
    expect(out._feedMeta?.resolvedAt).toBeTruthy();
  });

  it("serializes the limit as per_page (clamped) in the request", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ data: [sampleItem], meta: null });
    }) as typeof fetch;
    const block: Block = { _id: "1", _type: "blog-grid-author-cards", dataSource: { type: "blog_feed", limit: 9 } };
    await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(new URL(calls[0]).searchParams.get("per_page")).toBe("9");
  });

  it("propagates multi-value filters from dataSource across derived pages", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ data: [sampleItem], meta: null });
    }) as typeof fetch;
    const filters = {
      type: "blog_feed" as const,
      limit: 2,
      offset: 0,
      category: ["news", "events"],
      tag: ["openings", "summer"],
    };
    const blocks: Block[] = [
      { _id: "page-1", _type: "blog-grid-author-cards", dataSource: filters },
      {
        _id: "page-2",
        _type: "blog-grid-author-cards",
        dataSource: { ...filters, offset: 2 },
      },
    ];

    await resolveBlocks(blocks, { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(calls).toHaveLength(2);
    calls.forEach((url, index) => {
      const query = new URL(url).searchParams;
      expect(query.get("page")).toBe(String(index + 1));
      expect(query.get("per_page")).toBe("2");
      expect(query.getAll("category_slug[]")).toEqual(["news", "events"]);
      expect(query.getAll("tag_slug[]")).toEqual(["openings", "summer"]);
    });
  });
});

describe("resolveBlocks — empty vs error are distinct (§2.3 rule 5)", () => {
  it("empty feed -> status empty, no items inlined", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [], meta: null }]]);
    const block: Block = { _id: "1", _type: "blog-grid-author-cards", dataSource: { type: "blog_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("empty");
    expect(out._feedMeta?.reason).toBe("no_published_posts");
    expect(out.blockProps?.posts).toBeUndefined();
  });

  it("fetch failure -> status error", async () => {
    const fetcher = routeFetcher([], true);
    const block: Block = { _id: "1", _type: "blog-grid-author-cards", dataSource: { type: "blog_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("error");
    expect(out.blockProps?.posts).toBeUndefined();
  });
});

/**
 * R9 review fix: EMPTY clears the AUTHORED bind target (FEED_CONTRACT 2.3 rule 5).
 *
 * An `empty` outcome used to return the block untouched, assuming a feed-bound block carries no
 * authored items. Legacy payloads carry the themed demo seed, so an empty feed rendered
 * FABRICATED posts as the client's real content. LOCKSTEP with dashtrack-ai
 * `Feeds::Hydrator#clear_empty_bind_target` and the dt-cms preview's `clearEmptyFeedItems`.
 */
describe("resolveBlocks: EMPTY empties the authored bind target (R9)", () => {
  /** The fabricated seed a legacy design_payload still carries next to a live dataSource. */
  const FABRICATED_POSTS = [
    { id: 1, title: "Fabricated demo post", href: "/b/demo" },
    { id: 2, title: "Second demo post", href: "/b/demo-2" },
  ];

  it("blog_feed empty: an authored posts array is emptied, other authored props survive", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [], meta: null }]]);
    const block: Block = {
      _id: "1",
      _type: "blog-grid-author-cards",
      blockProps: { heading: "Latest", posts: FABRICATED_POSTS },
      dataSource: { type: "blog_feed" },
    };

    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out._feedMeta?.status).toBe("empty");
    expect(out.blockProps?.posts).toEqual([]);
    expect(out.blockProps?.heading).toBe("Latest"); // rule 2
    expect(out.dataSource).toEqual({ type: "blog_feed" }); // rule 1
  });

  it("blog_feed empty on a wire-shaped block: clears `data`, never materializes blockProps", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [], meta: null }]]);
    const block: Block = {
      _id: "1",
      block_ref: "blog/blog-grid-author-cards",
      data: { heading: "Latest", posts: FABRICATED_POSTS },
      dataSource: { type: "blog_feed" },
    };

    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out.data?.posts).toEqual([]);
    expect(out.data?.heading).toBe("Latest");
    expect(out.blockProps).toBeUndefined();
  });

  it("testimonials_feed empty: an authored testimonials array is emptied", async () => {
    const fetcher = routeFetcher([["/feeds/reviews", { data: [], meta: null }]]);
    const block: Block = {
      _id: "1",
      _type: "testimonials-marquee",
      blockProps: { testimonials: [{ quote: "Fabricated", author: "Nobody" }] },
      dataSource: { type: "testimonials_feed" },
    };

    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out._feedMeta?.reason).toBe("no_reviews");
    expect(out.blockProps?.testimonials).toEqual([]);
  });

  it("single-bind empty: the OBJECT prop is DELETED (an object has no empty array form)", async () => {
    const fetcher = routeFetcher([["/feeds/reviews", { data: [], meta: null }]]);
    const block: Block = {
      _id: "1",
      _type: "testimonials-large-quote",
      blockProps: { testimonial: { quote: "Fabricated", author: "Nobody" }, heading: "Praise" },
      dataSource: { type: "testimonials_feed" },
    };

    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out.blockProps && "testimonial" in out.blockProps).toBe(false);
    expect(out.blockProps?.heading).toBe("Praise");
  });

  it("instagram_feed empty: an authored items array is emptied", async () => {
    const fetcher = routeFetcher([["/feeds/instagram", { data: [], meta: null }]]);
    const block: Block = {
      _id: "1",
      _type: "instagram-post-grid",
      blockProps: { items: [{ id: "1", image: "https://cdn.ing/fake.jpg" }] },
      dataSource: { type: "instagram_feed" },
    };

    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out._feedMeta?.reason).toBe("no_instagram_posts");
    expect(out.blockProps?.items).toEqual([]);
  });

  it("blog_post 404: the authored bind target of the related-articles block is emptied", async () => {
    const fetcher = routeFetcher([]); // every request 404s
    const block: Block = {
      _id: "1",
      _type: "blog-related-articles",
      blockProps: { articles: FABRICATED_POSTS },
      dataSource: { type: "blog_post", slug: "gone", bindTo: "articles" },
    };

    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out._feedMeta?.reason).toBe("post_not_found");
    expect(out.blockProps?.articles).toEqual([]);
  });

  it("never invents a bind target the block did not author", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [], meta: null }]]);
    const block: Block = {
      _id: "1",
      _type: "blog-grid-author-cards",
      blockProps: { heading: "Latest" },
      dataSource: { type: "blog_feed" },
    };

    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out.blockProps && "posts" in out.blockProps).toBe(false);
  });

  it("ERROR is NOT empty: the authored array survives an upstream failure untouched", async () => {
    const fetcher = routeFetcher([], true);
    const block: Block = {
      _id: "1",
      _type: "blog-grid-author-cards",
      blockProps: { posts: FABRICATED_POSTS },
      dataSource: { type: "blog_feed" },
    };

    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out._feedMeta?.status).toBe("error");
    expect(out.blockProps?.posts).toEqual(FABRICATED_POSTS);
  });

  it("a block with NO dataSource is authored content and is never cleared", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [], meta: null }]]);
    const authored: Block = {
      _id: "authored",
      _type: "blog-grid-author-cards",
      blockProps: { posts: FABRICATED_POSTS },
    };
    const bound: Block = {
      _id: "bound",
      _type: "blog-grid-author-cards",
      blockProps: { posts: FABRICATED_POSTS },
      dataSource: { type: "blog_feed" },
    };

    const out = await resolveBlocks([authored, bound], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });

    expect(out[0].blockProps?.posts).toEqual(FABRICATED_POSTS);
    expect(out[0]._feedMeta).toBeUndefined();
    expect(out[1].blockProps?.posts).toEqual([]);
  });

  it("EXPANDING events_feed empty: the symbolic block stays UNEXPANDED and is NOT cleared", async () => {
    const fetcher = routeFetcher([["/feeds/events", { data: [], meta: null }]]);
    const block: Block = {
      _id: "blk_ev",
      _type: "hero-event-registration",
      blockProps: { heading: "Authored", posts: FABRICATED_POSTS },
      dataSource: { type: "events_feed" },
    };

    const out = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out).toHaveLength(1);
    expect(out[0]._id).toBe("blk_ev");
    expect(out[0]._feedMeta?.reason).toBe("no_upcoming_events");
    // No bind target exists for an expanding source; the generic "posts" fallback must not be
    // mistaken for one (see resolveEventsFeed's R9 exception note).
    expect(out[0].blockProps?.posts).toEqual(FABRICATED_POSTS);
    expect(out[0].blockProps?.heading).toBe("Authored");
  });
});

describe("resolveBlocks — gallery coercion (§2.4)", () => {
  it("skips items missing an image and coerces id to string", async () => {
    const noImage: BlogFeedItem = { ...sampleItem, id: 99, image_url: null };
    const fetcher = routeFetcher([
      ["/feeds/blogs", { data: [sampleItem, noImage], meta: null }],
    ]);
    const block: Block = { _id: "1", _type: "carousel-badge-cards", dataSource: { type: "blog_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const items = out.blockProps?.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("12");
    expect(typeof items[0].id).toBe("string");
  });
});

describe("resolveBlocks — blog-tech-insights featuredPost (§2.4)", () => {
  it("sets featuredPost to the first item when unset", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [sampleItem], meta: null }]]);
    const block: Block = { _id: "1", _type: "blog-tech-insights", dataSource: { type: "blog_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out.blockProps?.secondaryPosts).toHaveLength(1);
    expect((out.blockProps?.featuredPost as Record<string, unknown>).title).toBe("Grand opening");
  });

  it("does not overwrite an authored featuredPost", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [sampleItem], meta: null }]]);
    const block: Block = {
      _id: "1",
      _type: "blog-tech-insights",
      blockProps: { featuredPost: { title: "Authored" } },
      dataSource: { type: "blog_feed" },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect((out.blockProps?.featuredPost as Record<string, unknown>).title).toBe("Authored");
  });
});

// TASK-6 §2: the featured hero slot on blog-filtered-results. LOCKSTEP with
// dashtrack-ai Feeds::Hydrator#set_filtered_results_primary — unlike
// tech-insights' respect-if-set featuredPost, this bind always OVERRIDES the
// authored value (an authored primaryPost on a feed-bound block is fabricated
// demo content, same rationale as the category chips).
describe("resolveBlocks — blog-filtered-results primaryPost (TASK-6 §2)", () => {
  const secondItem: BlogFeedItem = {
    ...sampleItem,
    id: 13,
    slug: "second-post",
    title: "Second post",
    link_path: "/b/second-post",
    published_at: "2026-06-01T09:00:00Z",
  };

  function filteredResultsBlock(props: Record<string, unknown> = {}, ds: DataSource = { type: "blog_feed" }): Block {
    return {
      _id: "blk_fr",
      _type: "blog-filtered-results",
      blockProps: { heading: "Insights", ...props },
      dataSource: ds,
    };
  }

  it("binds the newest post to primaryPost and the REST to posts (>= 2 items, page 1)", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [sampleItem, secondItem], meta: null }]]);
    const [out] = await resolveBlocks([filteredResultsBlock()], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect((out.blockProps?.primaryPost as Record<string, unknown>).title).toBe("Grand opening");
    expect((out.blockProps?.posts as Array<Record<string, unknown>>).map((p) => p.title)).toEqual(["Second post"]);
  });

  it("OVERRIDES an authored primaryPost (fabrication, like the chips)", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [sampleItem, secondItem], meta: null }]]);
    const block = filteredResultsBlock({ primaryPost: { title: "Fabricated demo post" } });
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect((out.blockProps?.primaryPost as Record<string, unknown>).title).toBe("Grand opening");
  });

  it("binds a SINGLE post to primaryPost and leaves the grid empty (owner directive 2026-08-22)", async () => {
    // "As long as there is at least one blog post, it should always have the
    // latest blog post here" — landinglab.ai/blog (1 post, empty hero).
    const fetcher = routeFetcher([["/feeds/blogs", { data: [sampleItem], meta: null }]]);
    const block = filteredResultsBlock({ primaryPost: { title: "Fabricated demo post" } });
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect((out.blockProps?.primaryPost as Record<string, unknown>).title).toBe("Grand opening");
    expect(out.blockProps?.posts).toEqual([]);
  });

  it("never binds primaryPost beyond page 1 (a later page must not rotate the hero)", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [sampleItem, secondItem], meta: null }]]);
    const block = filteredResultsBlock({}, { type: "blog_feed", limit: 12, offset: 12 });
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out.blockProps).not.toHaveProperty("primaryPost");
    expect(out.blockProps?.posts).toHaveLength(2);
  });

  it("clears an authored primaryPost on an EMPTY feed (§2.3 rule 5)", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [], meta: null }]]);
    const block = filteredResultsBlock({ primaryPost: { title: "Fabricated demo post" } });
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out.blockProps).not.toHaveProperty("primaryPost");
    expect(out._feedMeta?.status).toBe("empty");
  });

  it("does not write primaryPost when bindTo overrides the default target", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [sampleItem, secondItem], meta: null }]]);
    const block = filteredResultsBlock({}, { type: "blog_feed", bindTo: "customList" });
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out.blockProps).not.toHaveProperty("primaryPost");
    expect(out.blockProps?.customList).toHaveLength(2);
  });

  it("never writes primaryPost on other blog blocks", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [sampleItem, secondItem], meta: null }]]);
    const block: Block = { _id: "1", _type: "blog-grid-author-cards", dataSource: { type: "blog_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out.blockProps).not.toHaveProperty("primaryPost");
  });
});

describe("resolveBlocks — blog_post detail (§4.3)", () => {
  const detail: BlogFeedDetailItem = {
    ...sampleItem,
    body: "## Hello",
    body_format: "markdown",
    updated_at: "2026-07-02T09:00:00Z",
    related: [{ ...sampleItem, id: 2, title: "Related" }],
  };

  it("resolves current:true slug from the last path segment and inlines §4.3 props", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ data: detail });
    }) as typeof fetch;
    const block: Block = { _id: "1", _type: "article-hero-prose", dataSource: { type: "blog_post", current: true } };
    const [out] = await resolveBlocks([block], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
      path: "/b/grand-opening",
    });
    expect(calls[0]).toContain("/feeds/blogs/grand-opening");
    expect(out.blockProps?.markdownString).toBe("## Hello");
    expect(out.blockProps?.title).toBe("Grand opening");
    expect(out.blockProps?.tags).toEqual(["Openings"]);
    expect((out.blockProps?.articles as unknown[])).toHaveLength(1);
    expect(out._feedMeta?.status).toBe("ok");
  });

  it("errors when current:true but no slug resolvable", async () => {
    const fetcher = routeFetcher([]);
    const block: Block = { _id: "1", _type: "article-hero-prose", dataSource: { type: "blog_post", current: true } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("error");
    expect(out._feedMeta?.reason).toBe("unresolved_slug");
  });

  it("maps a 404 to empty/post_not_found (SPA not-found detection, §2.3 rule 5)", async () => {
    // getBlog returns { data: null, error: { status: 404 } } → must be an empty state so
    // customer-sites' matched-but-missing detection (reason === "post_not_found") fires.
    const fetcher = (async () => jsonResponse({ data: null }, false, 404)) as typeof fetch;
    const block: Block = { _id: "1", _type: "article-hero-prose", dataSource: { type: "blog_post", slug: "gone" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("empty");
    expect(out._feedMeta?.reason).toBe("post_not_found");
    expect(out._feedMeta?.source).toBe("blog_post");
  });

  it("maps a non-404 error to error/upstream_error", async () => {
    const fetcher = (async () => jsonResponse({ data: null }, false, 500)) as typeof fetch;
    const block: Block = { _id: "1", _type: "article-hero-prose", dataSource: { type: "blog_post", slug: "boom" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("error");
    expect(out._feedMeta?.reason).toBe("upstream_error");
  });
});

describe("resolveBindTarget — instagram-post-grid (§4.1b)", () => {
  it("defaults instagram-post-grid to items", () => {
    expect(DEFAULT_BIND_TARGETS["instagram-post-grid"]).toBe("items");
    const block: Block = { _id: "1", _type: "instagram-post-grid", dataSource: { type: "instagram_feed" } };
    expect(resolveBindTarget(block)).toBe("items");
  });
});

describe("resolveBlocks — instagram_feed (§3.7 / §4.1b)", () => {
  const igImage: InstagramFeedItem = {
    id: "17900000000000001",
    permalink: "https://www.instagram.com/p/ABC123/",
    caption: "Grand opening!",
    post_type: "image",
    posted_at: "2026-07-01T09:00:00Z",
    like_count: 12,
    comment_count: 3,
    view_count: null,
    play_count: null,
    location_name: null,
    files: [{ media_type: "image", image_url: "https://cdn.ing/ig/1.jpg", video_url: null }],
  };
  const igVideo: InstagramFeedItem = {
    ...igImage,
    id: "17900000000000002",
    post_type: "video",
    view_count: 480,
    play_count: 502,
    files: [
      {
        media_type: "video",
        image_url: "https://cdn.ing/ig/thumb.jpg",
        video_url: "https://cdn.ing/ig/clip.mp4",
      },
    ],
  };

  it("inlines mapped items into items, retains dataSource, attaches ok meta", async () => {
    const fetcher = routeFetcher([
      [
        "/feeds/instagram",
        { data: [igImage, igVideo], meta: { page: 1, per_page: 12, total_pages: 1, total_records: 2 } },
      ],
    ]);
    const block: Block = {
      _id: "ig1",
      _type: "instagram-post-grid",
      blockProps: { heading: "Follow us" },
      dataSource: { type: "instagram_feed", limit: 12 },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out.blockProps?.heading).toBe("Follow us"); // authored prop untouched
    const items = out.blockProps?.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "17900000000000001",
      href: "https://www.instagram.com/p/ABC123/",
      image: "https://cdn.ing/ig/1.jpg",
      likeCount: 12,
    });
    expect(items[1]).toMatchObject({ isVideo: true, videoUrl: "https://cdn.ing/ig/clip.mp4" });
    expect(out.dataSource).toEqual(block.dataSource);
    expect(out._feedMeta).toMatchObject({
      status: "ok",
      source: "instagram_feed",
      page: 1,
      perPage: 12,
      totalRecords: 2,
    });
  });

  it("serializes limit as per_page and passes hashtag through", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ data: [igImage], meta: null });
    }) as typeof fetch;
    const block: Block = {
      _id: "1",
      _type: "instagram-post-grid",
      dataSource: { type: "instagram_feed", limit: 8, hashtag: "openings" },
    };
    await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const query = new URL(calls[0]).searchParams;
    expect(query.get("per_page")).toBe("8");
    expect(query.get("hashtag")).toBe("openings");
  });

  it("skips imageless posts; all-imageless -> empty/no_instagram_posts", async () => {
    const imageless: InstagramFeedItem = {
      ...igImage,
      files: [{ media_type: "video", image_url: null, video_url: "https://cdn.ing/ig/clip.mp4" }],
    };
    const fetcher = routeFetcher([["/feeds/instagram", { data: [imageless], meta: null }]]);
    const block: Block = { _id: "1", _type: "instagram-post-grid", dataSource: { type: "instagram_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("empty");
    expect(out._feedMeta?.reason).toBe("no_instagram_posts");
    expect(out.blockProps?.items).toBeUndefined();
  });

  it("empty feed -> status empty, no items inlined", async () => {
    const fetcher = routeFetcher([["/feeds/instagram", { data: [], meta: null }]]);
    const block: Block = { _id: "1", _type: "instagram-post-grid", dataSource: { type: "instagram_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("empty");
    expect(out._feedMeta?.reason).toBe("no_instagram_posts");
  });

  it("fetch failure -> status error/upstream_error", async () => {
    const fetcher = routeFetcher([], true);
    const block: Block = { _id: "1", _type: "instagram-post-grid", dataSource: { type: "instagram_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("error");
    expect(out._feedMeta?.reason).toBe("upstream_error");
    expect(out.blockProps?.items).toBeUndefined();
  });
});

describe("resolveBindTarget — testimonials (§4.1c)", () => {
  it("defaults array testimonials blocks to `testimonials`", () => {
    expect(DEFAULT_BIND_TARGETS["testimonials-marquee"]).toBe("testimonials");
    const block: Block = {
      _id: "1",
      _type: "testimonials-marquee",
      dataSource: { type: "testimonials_feed" },
    };
    expect(resolveBindTarget(block)).toBe("testimonials");
  });

  it("defaults the `reviews`-prop blocks to `reviews`", () => {
    for (const t of [
      "testimonials-list-verified",
      "testimonials-images-helpful",
      "testimonials-grid-add-review",
    ]) {
      expect(DEFAULT_BIND_TARGETS[t]).toBe("reviews");
      expect(
        resolveBindTarget({ _id: "1", _type: t, dataSource: { type: "testimonials_feed" } })
      ).toBe("reviews");
    }
  });

  it("defaults the single-bind trio to `testimonial` via SINGLE_BIND_TARGETS", () => {
    for (const t of [
      "testimonials-company-logo",
      "testimonials-large-quote",
      "testimonials-split-image",
    ]) {
      expect(SINGLE_BIND_TARGETS[t]).toBe("testimonial");
      expect(
        resolveBindTarget({ _id: "1", _type: t, dataSource: { type: "testimonials_feed" } })
      ).toBe("testimonial");
    }
  });

  it("still honors an explicit bindTo override on a single-bind block", () => {
    expect(
      resolveBindTarget({
        _id: "1",
        _type: "testimonials-large-quote",
        dataSource: { type: "testimonials_feed", bindTo: "custom" },
      })
    ).toBe("custom");
  });
});

describe("resolveBlocks — testimonials_feed (§3.8 / §4.1c)", () => {
  const reviewGoogle: ReviewFeedItem = {
    id: "9c3b7a10-0000-4000-8000-000000000001",
    reviewer_name: "Dana P.",
    rating: 5,
    content: "Absolutely wonderful — the tasting menu was a highlight of our trip.",
    platform: "google",
    time_created: "2026-07-01T09:00:00Z",
    profile_url: "https://www.google.com/maps/contrib/123",
    avatar_url: "https://lh3.googleusercontent.com/rot.jpg",
  };
  const reviewYelp: ReviewFeedItem = {
    ...reviewGoogle,
    id: "9c3b7a10-0000-4000-8000-000000000002",
    reviewer_name: "Sam T.",
    rating: 4,
    content: "Solid brunch.",
    platform: "yelp",
    profile_url: null,
  };

  it("maps base TestimonialItem[] into the default `testimonials` target, retains dataSource, ok meta", async () => {
    const fetcher = routeFetcher([
      [
        "/feeds/reviews",
        {
          data: [reviewGoogle, reviewYelp],
          meta: { page: 1, per_page: 12, total_pages: 1, total_records: 2 },
        },
      ],
    ]);
    const block: Block = {
      _id: "t1",
      _type: "testimonials-marquee",
      blockProps: { heading: "What guests say" },
      dataSource: { type: "testimonials_feed", limit: 12 },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out.blockProps?.heading).toBe("What guests say"); // authored prop untouched
    const items = out.blockProps?.testimonials as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      quote: "Absolutely wonderful — the tasting menu was a highlight of our trip.",
      author: "Dana P.",
      rating: 5,
      linkConfig: { label: "Read on Google", href: "https://www.google.com/maps/contrib/123" },
    });
    // No avatar ever reaches the block (§3.8 media caveat).
    expect(JSON.stringify(items)).not.toContain("googleusercontent");
    // Yelp review with no profile_url → no linkConfig.
    expect(items[1]).not.toHaveProperty("linkConfig");
    expect(out.dataSource).toEqual(block.dataSource);
    expect(out._feedMeta).toMatchObject({
      status: "ok",
      source: "testimonials_feed",
      page: 1,
      perPage: 12,
      totalRecords: 2,
    });
  });

  it("serializes limit/minRating/platforms[]/locationId into the request", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ data: [reviewGoogle], meta: null });
    }) as typeof fetch;
    const block: Block = {
      _id: "1",
      _type: "testimonials-marquee",
      dataSource: {
        type: "testimonials_feed",
        limit: 8,
        minRating: 4,
        platforms: ["google", "yelp"],
        locationId: 1093,
      },
    };
    await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const query = new URL(calls[0]).searchParams;
    expect(query.get("per_page")).toBe("8");
    expect(query.get("min_rating")).toBe("4");
    expect(query.getAll("platforms[]")).toEqual(["google", "yelp"]);
    expect(query.get("location_id")).toBe("1093");
  });

  it("coerces to ReviewItem[] for testimonials-list-verified (content/title/date/verified)", async () => {
    const fetcher = routeFetcher([["/feeds/reviews", { data: [reviewGoogle], meta: null }]]);
    const block: Block = {
      _id: "1",
      _type: "testimonials-list-verified",
      dataSource: { type: "testimonials_feed" },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const reviews = out.blockProps?.reviews as Array<Record<string, unknown>>;
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      content: "Absolutely wonderful — the tasting menu was a highlight of our trip.",
      rating: 5,
      author: "Dana P.",
      date: "Jul 1, 2026",
      verified: true,
    });
    expect(reviews[0].title).toBeTruthy();
    expect(reviews[0]).not.toHaveProperty("quote");
  });

  it("coerces to SocialTestimonialItem[] for testimonials-twitter-cards (content, no handle)", async () => {
    const fetcher = routeFetcher([["/feeds/reviews", { data: [reviewGoogle], meta: null }]]);
    const block: Block = {
      _id: "1",
      _type: "testimonials-twitter-cards",
      dataSource: { type: "testimonials_feed" },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const items = out.blockProps?.testimonials as Array<Record<string, unknown>>;
    expect(items[0]).toHaveProperty("content");
    expect(items[0]).not.toHaveProperty("quote");
    expect(items[0]).not.toHaveProperty("handle");
  });

  it("grid-add-review uses the base TestimonialItem shape under the `reviews` prop", async () => {
    const fetcher = routeFetcher([["/feeds/reviews", { data: [reviewGoogle], meta: null }]]);
    const block: Block = {
      _id: "1",
      _type: "testimonials-grid-add-review",
      dataSource: { type: "testimonials_feed" },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const reviews = out.blockProps?.reviews as Array<Record<string, unknown>>;
    expect(reviews[0]).toHaveProperty("quote"); // base shape, not ReviewItem
    expect(reviews[0]).not.toHaveProperty("title");
    expect(reviews[0]).not.toHaveProperty("verified");
  });

  it("binds items[0] as a single OBJECT (not an array) for single-bind blocks", async () => {
    const fetcher = routeFetcher([
      ["/feeds/reviews", { data: [reviewGoogle, reviewYelp], meta: null }],
    ]);
    const block: Block = {
      _id: "1",
      _type: "testimonials-large-quote",
      dataSource: { type: "testimonials_feed" },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const bound = out.blockProps?.testimonial;
    expect(Array.isArray(bound)).toBe(false);
    expect(bound).toMatchObject({ quote: reviewGoogle.content, author: "Dana P.", rating: 5 });
    // Nothing bound under a plural target.
    expect(out.blockProps?.testimonials).toBeUndefined();
  });

  it("empty feed -> status empty/no_reviews, nothing inlined", async () => {
    const fetcher = routeFetcher([["/feeds/reviews", { data: [], meta: null }]]);
    const block: Block = { _id: "1", _type: "testimonials-marquee", dataSource: { type: "testimonials_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("empty");
    expect(out._feedMeta?.reason).toBe("no_reviews");
    expect(out.blockProps?.testimonials).toBeUndefined();
  });

  it("fetch failure -> status error/upstream_error", async () => {
    const fetcher = routeFetcher([], true);
    const block: Block = { _id: "1", _type: "testimonials-marquee", dataSource: { type: "testimonials_feed" } };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out._feedMeta?.status).toBe("error");
    expect(out._feedMeta?.reason).toBe("upstream_error");
    expect(out.blockProps?.testimonials).toBeUndefined();
  });

  // Drop-unrated lockstep with the dashtrack-ai REFERENCE
  // `Feeds::Hydrator#review_item_shape` (returns nil when rating is not Numeric) +
  // `#coerce_testimonials` (filter_map) + `#hydrate_testimonials_feed` (items.empty? guard).
  // Unreachable today (the server filters rating >= min_rating, NULLs excluded) but §3.8's
  // wire type is `rating int|null`, so the ReviewItem coercion enforces it regardless.
  const reviewUnrated: ReviewFeedItem = {
    ...reviewGoogle,
    id: "9c3b7a10-0000-4000-8000-000000000003",
    reviewer_name: "Alex R.",
    rating: null,
    profile_url: null,
  };

  for (const type of ["testimonials-list-verified", "testimonials-images-helpful"]) {
    it(`drops items without a numeric rating for ${type} (rating is REQUIRED on ReviewItem)`, async () => {
      const fetcher = routeFetcher([
        ["/feeds/reviews", { data: [reviewGoogle, reviewUnrated, reviewYelp], meta: null }],
      ]);
      const block: Block = { _id: "1", _type: type, dataSource: { type: "testimonials_feed" } };
      const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
      const reviews = out.blockProps?.reviews as Array<Record<string, unknown>>;
      // The unrated item is dropped; the two rated items survive.
      expect(reviews).toHaveLength(2);
      expect(reviews.every((r) => typeof r.rating === "number")).toBe(true);
      expect(out._feedMeta?.status).toBe("ok");
    });

    it(`yields empty/no_reviews when ALL items are unrated for ${type}`, async () => {
      const fetcher = routeFetcher([
        ["/feeds/reviews", { data: [reviewUnrated, { ...reviewUnrated, id: "x" }], meta: null }],
      ]);
      const block: Block = { _id: "1", _type: type, dataSource: { type: "testimonials_feed" } };
      const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
      expect(out._feedMeta?.status).toBe("empty");
      expect(out._feedMeta?.reason).toBe("no_reviews");
      // Nothing inlined on an empty state.
      expect(out.blockProps?.reviews).toBeUndefined();
    });
  }

  it("KEEPS unrated items (base shape, rating omitted) for testimonials-grid-add-review", async () => {
    const fetcher = routeFetcher([
      ["/feeds/reviews", { data: [reviewGoogle, reviewUnrated], meta: null }],
    ]);
    const block: Block = {
      _id: "1",
      _type: "testimonials-grid-add-review",
      dataSource: { type: "testimonials_feed" },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const reviews = out.blockProps?.reviews as Array<Record<string, unknown>>;
    // grid-add-review uses the base TestimonialItem shape — no drop; the unrated item stays
    // (rating simply omitted). Only list-verified/images-helpful drop.
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toHaveProperty("rating", 5);
    expect(reviews[1]).not.toHaveProperty("rating");
    expect(out._feedMeta?.status).toBe("ok");
  });
});

describe("resolveBlocks — unknown source", () => {
  it("leaves the block untouched with an unknown_source error meta", async () => {
    const fetcher = routeFetcher([]);
    const block: Block = {
      _id: "1",
      _type: "mystery",
      blockProps: { heading: "keep me" },
      dataSource: { type: "made_up" as never },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out.blockProps?.heading).toBe("keep me");
    expect(out._feedMeta).toMatchObject({ status: "error", reason: "unknown_source:made_up" });
  });
});

describe("resolveBlocks — blocks without a dataSource pass through", () => {
  it("returns the block unchanged", async () => {
    const fetcher = routeFetcher([]);
    const block: Block = { _id: "1", _type: "Box", content: "static" };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    expect(out).toEqual(block);
    expect(out._feedMeta).toBeUndefined();
  });
});

describe("resolveBlocks — per-block error isolation (§2.3 rule 5)", () => {
  it("a resolver that throws degrades only its own block; siblings resolve normally", async () => {
    const throwingSource: FeedSourceResolver = async () => {
      throw new Error("resolver blew up");
    };
    const fetcher = routeFetcher([
      ["/feeds/blogs", { data: [sampleItem], meta: { page: 1, per_page: 9, total_pages: 1, total_records: 1 } }],
    ]);
    const input: Block[] = [
      { _id: "boom", _type: "hero-event-registration", dataSource: { type: "events_feed" } },
      { _id: "ok", _type: "blog-grid-author-cards", dataSource: { type: "blog_feed", limit: 9 } },
    ];

    // The whole pass must resolve (never reject) despite the throwing block.
    const out = await resolveBlocks(input, {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
      sources: { events_feed: throwingSource },
    });

    expect(out).toHaveLength(2);
    const [failed, healthy] = out;
    // failed block carries the isolation meta
    expect(failed._id).toBe("boom");
    expect(failed._feedMeta).toMatchObject({
      status: "error",
      reason: "resolver_threw",
      source: "events_feed",
    });
    expect(failed._feedMeta?.resolvedAt).toBeTruthy();
    // sibling resolved normally
    expect(healthy._id).toBe("ok");
    expect(healthy._feedMeta?.status).toBe("ok");
    expect((healthy.blockProps?.posts as unknown[])).toHaveLength(1);
  });
});

describe("resolveBlocks — one-to-many expansion (D6)", () => {
  it("a fake expanding source yields more blocks than it received", async () => {
    const expandingSource: FeedSourceResolver = async ({ block }) => {
      return [1, 2, 3].map((n) => ({
        ...block,
        _id: `${block._id}-${n}`,
        _feedMeta: { status: "ok" as const, source: "events_feed", resolvedAt: new Date().toISOString() },
      }));
    };
    const fetcher = routeFetcher([]);
    const input: Block[] = [
      { _id: "keep", _type: "Box", content: "static" },
      { _id: "evt", _type: "hero-event-registration", dataSource: { type: "events_feed" } },
    ];
    const out = await resolveBlocks(input, {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
      sources: { events_feed: expandingSource },
    });
    // 1 static + 3 expanded = 4
    expect(out).toHaveLength(4);
    expect(out.map((b) => b._id)).toEqual(["keep", "evt-1", "evt-2", "evt-3"]);
  });
});

describe("resolveBlocks — events_feed expansion (§3.9 / §4.1d, D6, built-in resolver)", () => {
  const baseEvent: EventFeedItem = {
    id: "123",
    occurrence_id: "123:0",
    title: "Summer Kickoff Party",
    description: "Join us for food, drinks, and live music.",
    starts_at: "2026-07-18T19:00:00-07:00",
    ends_at: "2026-07-18T22:00:00-07:00",
    timezone: "America/Phoenix",
    location_name: "The Rooftop",
    custom_address: null,
    image_url: "https://cdn.ing/events/1.jpg",
    registration_url: "https://tickets.example.com/123",
    booking_behavior: "external",
    price_from: "25.00",
    recurring_summary: null,
  };

  // Two occurrences of event 123 + one of event 456 → three distinct heroes.
  const occurrences: EventFeedItem[] = [
    { ...baseEvent, id: "123", occurrence_id: "123:0" },
    { ...baseEvent, id: "123", occurrence_id: "123:1", starts_at: "2026-07-25T19:00:00-07:00" },
    { ...baseEvent, id: "456", occurrence_id: "456:0", title: "Autumn Gala" },
  ];

  const eventsFetcher = (data: EventFeedItem[], meta: unknown = null) =>
    routeFetcher([["/feeds/events", { data, meta }]]);

  const symbolicBlock = (overrides: Partial<Block> = {}): Block => ({
    _id: "slot_events",
    _type: "hero-event-registration",
    _parent: "section_1",
    blockProps: { heading: "Upcoming Events" }, // authored placeholder — must NOT survive
    dataSource: { type: "events_feed", limit: 6 },
    ...overrides,
  });

  it("expands ONE symbolic block into N hero-event-registration instances", async () => {
    const out = await resolveBlocks([symbolicBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher: eventsFetcher(occurrences),
    });
    expect(out).toHaveLength(3);
    for (const b of out) expect(b._type).toBe("hero-event-registration");
  });

  it("mints unique, deterministic _ids (<source>__ev_<event>_<occurrence>) and inherits _parent", async () => {
    const out = await resolveBlocks([symbolicBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher: eventsFetcher(occurrences),
    });
    expect(out.map((b) => b._id)).toEqual([
      "slot_events__ev_123_0",
      "slot_events__ev_123_1",
      "slot_events__ev_456_0",
    ]);
    // Uniqueness (duplicate _id = React key collision + wrong child lookups).
    expect(new Set(out.map((b) => b._id)).size).toBe(out.length);
    // _parent inherited from the symbolic block so heroes render as siblings in its slot.
    for (const b of out) expect(b._parent).toBe("section_1");
  });

  it("carries ok _feedMeta with expandedFrom on every expanded block", async () => {
    const out = await resolveBlocks([symbolicBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher: eventsFetcher(occurrences),
    });
    for (const b of out) {
      expect(b._feedMeta).toMatchObject({
        status: "ok",
        source: "events_feed",
        expandedFrom: "slot_events",
      });
      expect(b._feedMeta?.resolvedAt).toBeTruthy();
    }
  });

  it("uses the mapped occurrence props (NOT the authored placeholder) and DROPS dataSource", async () => {
    const out = await resolveBlocks([symbolicBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher: eventsFetcher(occurrences),
    });
    // Authored heading "Upcoming Events" is replaced by the event title.
    expect(out[0].blockProps?.heading).toBe("Summer Kickoff Party");
    expect(out[2].blockProps?.heading).toBe("Autumn Gala");
    expect(out[0].blockProps).toMatchObject({
      badgeText: "JUL 18",
      locationLabel: "Jul 18, 2026 · 7:00 PM",
      locationSublabel: "The Rooftop",
      image: { src: "https://cdn.ing/events/1.jpg", alt: "Summer Kickoff Party" },
      stats: [{ value: "$25.00", label: "From" }],
      actions: [{ label: "Register", href: "https://tickets.example.com/123" }],
    });
    // dataSource dropped so a re-resolve never re-expands the hero.
    for (const b of out) expect(b.dataSource).toBeUndefined();
  });

  it("mints a MINIMAL block (§4.1d): EXACT key set, no inherited authored block-level fields", async () => {
    // Symbolic source carrying block-level presentation that must NOT survive expansion.
    const out = await resolveBlocks(
      [
        symbolicBlock({
          _name: "Events Hero",
          tag: "section",
          styles: "bg-slate-900 py-24",
          styles_attrs: { role: "region" },
          backgroundImage: "https://cdn.ing/bg.jpg",
          content: "authored copy",
          src: "https://cdn.ing/authored.jpg",
          alt: "authored alt",
          link: { href: "/authored" },
        }),
      ],
      { baseUrl: BASE, websiteToken: TOKEN, fetcher: eventsFetcher(occurrences) }
    );
    // EXACTLY the contract-enumerated fields — byte-for-byte lockstep with the Ruby hydrator.
    for (const b of out) {
      expect(Object.keys(b).sort()).toEqual([
        "_feedMeta",
        "_id",
        "_parent",
        "_type",
        "blockProps",
      ]);
    }
    // No authored block-level field (nor dataSource) leaked onto the concrete heroes.
    const first = out[0] as Record<string, unknown>;
    expect(first.dataSource).toBeUndefined();
    expect(first._name).toBeUndefined();
    expect(first.tag).toBeUndefined();
    expect(first.styles).toBeUndefined();
    expect(first.styles_attrs).toBeUndefined();
    expect(first.backgroundImage).toBeUndefined();
    expect(first.content).toBeUndefined();
    expect(first.src).toBeUndefined();
    expect(first.alt).toBeUndefined();
    expect(first.link).toBeUndefined();
    // _parent still carries the inherited value (present, not dropped).
    expect(first._parent).toBe("section_1");
  });

  it("places expanded heroes contiguously in the source's slot, siblings preserved", async () => {
    const input: Block[] = [
      { _id: "hdr", _type: "Box", content: "header" },
      symbolicBlock(),
      { _id: "ftr", _type: "Box", content: "footer" },
    ];
    const out = await resolveBlocks(input, {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher: eventsFetcher(occurrences),
    });
    expect(out.map((b) => b._id)).toEqual([
      "hdr",
      "slot_events__ev_123_0",
      "slot_events__ev_123_1",
      "slot_events__ev_456_0",
      "ftr",
    ]);
  });

  it("EMPTY (no occurrences) → the ORIGINAL symbolic block stays UNEXPANDED with empty meta", async () => {
    const block = symbolicBlock();
    const out = await resolveBlocks([block], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher: eventsFetcher([]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]._id).toBe("slot_events"); // not expanded
    expect(out[0]._feedMeta).toMatchObject({
      status: "empty",
      reason: "no_upcoming_events",
      source: "events_feed",
    });
    // dataSource retained on the unexpanded block (so the empty renderer / re-query works).
    expect(out[0].dataSource).toEqual(block.dataSource);
    // Authored props untouched on the empty path.
    expect(out[0].blockProps?.heading).toBe("Upcoming Events");
  });

  it("ERROR (fetch failure) → the ORIGINAL block stays UNEXPANDED with error meta", async () => {
    const out = await resolveBlocks([symbolicBlock()], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher: routeFetcher([], true),
    });
    expect(out).toHaveLength(1);
    expect(out[0]._id).toBe("slot_events");
    expect(out[0]._feedMeta).toMatchObject({
      status: "error",
      reason: "upstream_error",
      source: "events_feed",
    });
  });

  it("caps the render count at the limit default (6) even if the server returns more", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...baseEvent,
      id: String(i),
      occurrence_id: `${i}:0`,
    }));
    const out = await resolveBlocks(
      [symbolicBlock({ dataSource: { type: "events_feed" } })], // no explicit limit
      { baseUrl: BASE, websiteToken: TOKEN, fetcher: eventsFetcher(many) }
    );
    expect(out).toHaveLength(6);
  });

  it("hard-caps the render count at 12 even when limit is larger", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...baseEvent,
      id: String(i),
      occurrence_id: `${i}:0`,
    }));
    const out = await resolveBlocks(
      [symbolicBlock({ dataSource: { type: "events_feed", limit: 20 } })],
      { baseUrl: BASE, websiteToken: TOKEN, fetcher: eventsFetcher(many) }
    );
    expect(out).toHaveLength(12);
  });

  it("sends per_page (render limit) + start_date/end_date/location_ids[] from the dataSource", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ data: [baseEvent], meta: null });
    }) as typeof fetch;
    const block = symbolicBlock({
      dataSource: {
        type: "events_feed",
        limit: 4,
        startDate: "2026-07-18",
        endDate: "2026-08-18",
        locationIds: [1093, 1094],
      },
    });
    await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const query = new URL(calls[0]).searchParams;
    expect(query.get("per_page")).toBe("4"); // per_page = render limit
    expect(query.get("start_date")).toBe("2026-07-18");
    expect(query.get("end_date")).toBe("2026-08-18");
    expect(query.getAll("location_ids[]")).toEqual(["1093", "1094"]);
  });

  it("defaults per_page to the limit default (6) when the dataSource sets no limit", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ data: [baseEvent], meta: null });
    }) as typeof fetch;
    await resolveBlocks([symbolicBlock({ dataSource: { type: "events_feed" } })], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher,
    });
    expect(new URL(calls[0]).searchParams.get("per_page")).toBe("6");
  });
});

// ---------------------------------------------------------------------------
// AI wire (block_ref / data) shape — Phase 5 shape-fix (FEED_CONTRACT §2 / §4).
// AI-generated pages arrive as { block_ref, data } (octane-emitted, persisted verbatim). They are
// normalized to chai { _type, blockProps } LAZILY by customer-sites `normalizeBlocks` AFTER
// resolveBlocks runs, and that normalizer rebuilds blockProps from `data` ONLY. So the resolver must
// (a) derive the block TYPE from block_ref (`split("/").pop()`) and (b) write hydrated props into
// `data`, not `blockProps`, or they are silently discarded. dt-cms chai { _type, blockProps } blocks
// MUST keep working unchanged. Lockstep with dashtrack-ai `Feeds::Hydrator`
// (app/services/feeds/hydrator.rb — #block_type/#ref_component_id + #props_hash/#write_target).
// ---------------------------------------------------------------------------
describe("resolveBlocks — AI wire (block_ref / data) shape (Phase 5 shape-fix, §2/§4)", () => {
  /**
   * Build an AI-wire-shaped block (block_ref + data, NO _type). Cast because `_type` is declared
   * required on `Block` for the post-normalization render engine, yet is genuinely absent on wire
   * blocks at the data layer — which is exactly the shape this fix handles.
   */
  const wireBlock = (
    block_ref: string,
    dataSource: DataSource,
    data: Record<string, unknown> = {}
  ): Block => ({ _id: `wire_${block_ref}`, block_ref, data, dataSource }) as Block;

  const igImage: InstagramFeedItem = {
    id: "17900000000000001",
    permalink: "https://www.instagram.com/p/ABC123/",
    caption: "Grand opening!",
    post_type: "image",
    posted_at: "2026-07-01T09:00:00Z",
    like_count: 12,
    comment_count: 3,
    view_count: null,
    play_count: null,
    location_name: null,
    files: [{ media_type: "image", image_url: "https://cdn.ing/ig/1.jpg", video_url: null }],
  };
  const reviewGoogle: ReviewFeedItem = {
    id: "9c3b7a10-0000-4000-8000-000000000001",
    reviewer_name: "Dana P.",
    rating: 5,
    content: "Absolutely wonderful — the tasting menu was a highlight of our trip.",
    platform: "google",
    time_created: "2026-07-01T09:00:00Z",
    profile_url: "https://www.google.com/maps/contrib/123",
    avatar_url: "https://lh3.googleusercontent.com/rot.jpg",
  };
  const baseEvent: EventFeedItem = {
    id: "123",
    occurrence_id: "123:0",
    title: "Summer Kickoff Party",
    description: "Join us for food, drinks, and live music.",
    starts_at: "2026-07-18T19:00:00-07:00",
    ends_at: "2026-07-18T22:00:00-07:00",
    timezone: "America/Phoenix",
    location_name: "The Rooftop",
    custom_address: null,
    image_url: "https://cdn.ing/events/1.jpg",
    registration_url: "https://tickets.example.com/123",
    booking_behavior: "external",
    price_from: "25.00",
    recurring_summary: null,
  };

  it("resolveBindTarget derives the type key from block_ref (split('/').pop()), no-op on no-slash", () => {
    // gallery/instagram-post-grid → instagram-post-grid → items
    expect(
      resolveBindTarget(wireBlock("gallery/instagram-post-grid", { type: "instagram_feed" }))
    ).toBe("items");
    // testimonials array default via block_ref
    expect(
      resolveBindTarget(wireBlock("testimonials/testimonials-marquee", { type: "testimonials_feed" }))
    ).toBe("testimonials");
    // single-bind default via block_ref (SINGLE_BIND_TARGETS)
    expect(
      resolveBindTarget(wireBlock("testimonials/testimonials-large-quote", { type: "testimonials_feed" }))
    ).toBe("testimonial");
    // block_name fallback + no "/" segment no-ops safely (parity with normalizeBlocks:261)
    expect(
      resolveBindTarget({
        _id: "n1",
        block_name: "blog-related-articles",
        dataSource: { type: "blog_feed" },
      } as Block)
    ).toBe("articles");
    // unknown wire type → posts fallback (§2.3 rule 6)
    expect(
      resolveBindTarget(wireBlock("mystery/unknown-block", { type: "blog_feed" }))
    ).toBe("posts");
  });

  it("instagram: hydrated items land in `data.items` (NOT blockProps); type derived from block_ref", async () => {
    const fetcher = routeFetcher([["/feeds/instagram", { data: [igImage], meta: null }]]);
    const block = wireBlock(
      "gallery/instagram-post-grid",
      { type: "instagram_feed" },
      { heading: "Follow us" }
    );
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    const items = out.data?.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "17900000000000001", image: "https://cdn.ing/ig/1.jpg" });
    // authored `data` prop untouched (§2.3 rule 2)
    expect(out.data?.heading).toBe("Follow us");
    // NOTHING written to blockProps — normalizeBlocks rebuilds blockProps from `data` and would
    // discard any blockProps write for a wire block.
    expect(out.blockProps).toBeUndefined();
    expect(out.dataSource).toEqual(block.dataSource);
    expect(out._feedMeta?.status).toBe("ok");
  });

  it("testimonials: base TestimonialItem[] lands in `data.testimonials` (NOT blockProps)", async () => {
    const fetcher = routeFetcher([["/feeds/reviews", { data: [reviewGoogle], meta: null }]]);
    const block = wireBlock("testimonials/testimonials-marquee", { type: "testimonials_feed" });
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    const items = out.data?.testimonials as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quote: reviewGoogle.content, author: "Dana P.", rating: 5 });
    expect(out.blockProps).toBeUndefined();
    expect(out._feedMeta?.status).toBe("ok");
  });

  it("testimonials: ReviewItem[] coercion for a block_ref list-verified block lands in `data.reviews`", async () => {
    const fetcher = routeFetcher([["/feeds/reviews", { data: [reviewGoogle], meta: null }]]);
    const block = wireBlock("testimonials/testimonials-list-verified", { type: "testimonials_feed" });
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    const reviews = out.data?.reviews as Array<Record<string, unknown>>;
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ content: reviewGoogle.content, rating: 5, verified: true });
    expect(reviews[0]).not.toHaveProperty("quote"); // ReviewItem shape, derived via block_ref type
    expect(out.blockProps).toBeUndefined();
  });

  it("blog: mapped posts land in `data` under the block_ref-derived bind target (NOT blockProps)", async () => {
    const fetcher = routeFetcher([["/feeds/blogs", { data: [sampleItem], meta: null }]]);
    // blog/blog-related-articles → blog-related-articles → bind target `articles`
    const block = wireBlock("blog/blog-related-articles", { type: "blog_feed" });
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    const articles = out.data?.articles as Array<Record<string, unknown>>;
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({ id: 12, title: "Grand opening" });
    expect(out.blockProps).toBeUndefined();
    expect(out._feedMeta?.status).toBe("ok");
  });

  it("REGRESSION: a chai `_type`/`blockProps` block still writes blockProps, never `data`", async () => {
    const fetcher = routeFetcher([["/feeds/instagram", { data: [igImage], meta: null }]]);
    const block: Block = {
      _id: "chai_ig",
      _type: "instagram-post-grid",
      blockProps: { heading: "Follow us" },
      dataSource: { type: "instagram_feed" },
    };
    const [out] = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    const items = out.blockProps?.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(out.blockProps?.heading).toBe("Follow us"); // authored prop untouched
    // No `data` key ever created for a chai-shaped block (write stays on the blockProps path).
    expect(out.data).toBeUndefined();
    expect(out._feedMeta?.status).toBe("ok");
  });

  it("events: a block_ref symbolic source still expands into CHAI `_type` heroes with blockProps", async () => {
    const occurrences: EventFeedItem[] = [
      { ...baseEvent, id: "123", occurrence_id: "123:0" },
      { ...baseEvent, id: "456", occurrence_id: "456:0", title: "Autumn Gala" },
    ];
    const fetcher = routeFetcher([["/feeds/events", { data: occurrences, meta: null }]]);
    const block = wireBlock(
      "heroes/hero-event-registration",
      { type: "events_feed", limit: 6 },
      { heading: "Upcoming Events" } // authored placeholder — must NOT survive the mint
    );
    const out = await resolveBlocks([block], { baseUrl: BASE, websiteToken: TOKEN, fetcher });

    expect(out).toHaveLength(2);
    for (const b of out) {
      // Mint stays chai-shaped (renders via normalizeBlocks passthrough) — NOT block_ref/data.
      expect(b._type).toBe("hero-event-registration");
      expect(b.block_ref).toBeUndefined();
      expect(b.data).toBeUndefined();
      // Exact minimal key set (byte-for-byte lockstep with the Ruby hydrator mint).
      expect(Object.keys(b).sort()).toEqual(["_feedMeta", "_id", "_parent", "_type", "blockProps"]);
    }
    // Occurrence props on blockProps (not the authored placeholder), heroes rendered from real data.
    expect(out[0].blockProps?.heading).toBe("Summer Kickoff Party");
    expect(out[1].blockProps?.heading).toBe("Autumn Gala");
  });
});
