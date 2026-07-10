import { describe, it, expect } from "vitest";
import {
  resolveBlocks,
  resolveBindTarget,
  DEFAULT_BIND_TARGETS,
} from "../data/resolve-blocks.js";
import type {
  Block,
  BlogFeedItem,
  BlogFeedDetailItem,
  FeedSourceResolver,
  InstagramFeedItem,
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
