import { describe, it, expect } from "vitest";
import { createFeedClient, MAX_PER_PAGE } from "../data/feed-client.js";
import type { BlogFeedParams } from "../types/index.js";

/** Record every requested URL and return a canned JSON body. */
function recordingFetcher(body: unknown, init?: { ok?: boolean; status?: number }) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      statusText: "OK",
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return { calls, fetcher };
}

const BASE = "https://api.example.com";
const TOKEN = "site-token-123";

describe("createFeedClient — URL building", () => {
  it("scopes every route under /public_services/websites/{token}/feeds", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });

    await client.listBlogs();
    await client.listBlogCategories();
    await client.listBlogTags();

    expect(calls[0]).toBe(
      "https://api.example.com/public_services/websites/site-token-123/feeds/blogs"
    );
    expect(calls[1]).toBe(
      "https://api.example.com/public_services/websites/site-token-123/feeds/blog_categories"
    );
    expect(calls[2]).toBe(
      "https://api.example.com/public_services/websites/site-token-123/feeds/blog_tags"
    );
  });

  it("strips a trailing slash from baseUrl", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({
      baseUrl: "https://api.example.com/",
      websiteToken: TOKEN,
      fetcher,
    });
    await client.listBlogs();
    expect(calls[0]).toBe(
      "https://api.example.com/public_services/websites/site-token-123/feeds/blogs"
    );
  });

  it("URL-encodes the website token and the detail slug", async () => {
    const { calls, fetcher } = recordingFetcher({ data: null });
    const client = createFeedClient({
      baseUrl: BASE,
      websiteToken: "a b/c",
      fetcher,
    });
    await client.getBlog("grand opening/2026");
    expect(calls[0]).toBe(
      "https://api.example.com/public_services/websites/a%20b%2Fc/feeds/blogs/grand%20opening%2F2026"
    );
  });
});

describe("createFeedClient — filter + page persistence (legacy bug #1)", () => {
  const filters: BlogFeedParams = {
    perPage: 12,
    categorySlug: "news",
    tagSlug: "openings",
    query: "grand opening",
    sortBy: "title",
    sortDir: "asc",
  };

  it("serializes every provided filter on every page request", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });

    await client.listBlogs({ ...filters, page: 1 });
    await client.listBlogs({ ...filters, page: 2 });

    for (const url of calls) {
      const query = new URL(url).searchParams;
      expect(query.get("per_page")).toBe("12");
      expect(query.get("category_slug")).toBe("news");
      expect(query.get("tag_slug")).toBe("openings");
      expect(query.get("query")).toBe("grand opening");
      expect(query.get("sort_by")).toBe("title");
      expect(query.get("sort_dir")).toBe("asc");
    }
    expect(new URL(calls[0]).searchParams.get("page")).toBe("1");
    expect(new URL(calls[1]).searchParams.get("page")).toBe("2");
  });

  it("percent-encodes filter values", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listBlogs({ query: "a & b" });
    // URLSearchParams encodes spaces as "+" and ampersands as %26.
    expect(calls[0]).toContain("query=a+%26+b");
  });
});

describe("createFeedClient — per_page clamp (legacy bug #6 / #10)", () => {
  it("clamps per_page to MAX_PER_PAGE", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listBlogs({ perPage: 500 });
    expect(new URL(calls[0]).searchParams.get("per_page")).toBe(String(MAX_PER_PAGE));
  });

  it("floors per_page to at least 1", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listBlogs({ perPage: 0 });
    expect(new URL(calls[0]).searchParams.get("per_page")).toBe("1");
  });
});

describe("createFeedClient — error handling (legacy bug #4)", () => {
  it("returns an error envelope on non-2xx (never throws)", async () => {
    const { fetcher } = recordingFetcher({}, { ok: false, status: 404 });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const result = await client.listBlogs();
    expect(result.data).toEqual([]);
    expect(result.meta).toBeNull();
    expect(result.error).toEqual({ status: 404, message: "OK" });
  });

  it("returns a status-0 error on network failure", async () => {
    const fetcher = (async () => {
      throw new Error("boom");
    }) as typeof fetch;
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const result = await client.listBlogs();
    expect(result.error).toEqual({ status: 0, message: "boom" });
  });

  it("getBlog returns data:null with an error on failure", async () => {
    const { fetcher } = recordingFetcher({}, { ok: false, status: 500 });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const result = await client.getBlog("missing");
    expect(result.data).toBeNull();
    expect(result.error?.status).toBe(500);
  });
});

describe("createFeedClient — success envelopes", () => {
  it("surfaces data + meta from the list envelope", async () => {
    const meta = { page: 1, per_page: 12, total_pages: 4, total_records: 41 };
    const { fetcher } = recordingFetcher({ data: [{ id: 1 }], meta });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const result = await client.listBlogs();
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual(meta);
    expect(result.error).toBeUndefined();
  });
});
