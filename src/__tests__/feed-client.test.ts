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

  it("serializes array filters with Rack keys and keeps them on every page request", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const multiValueFilters: BlogFeedParams = {
      categorySlug: ["news & events", "café"],
      tagSlug: ["grand/opening", "summer"],
      sortBy: "published_at",
    };

    await client.listBlogs({ ...multiValueFilters, page: 1 });
    await client.listBlogs({ ...multiValueFilters, page: 2 });

    for (const url of calls) {
      const query = new URL(url).searchParams;
      expect(query.getAll("category_slug[]")).toEqual(["news & events", "café"]);
      expect(query.getAll("tag_slug[]")).toEqual(["grand/opening", "summer"]);
      expect(query.has("category_slug")).toBe(false);
      expect(query.has("tag_slug")).toBe(false);
      expect(query.get("sort_by")).toBe("published_at");
    }
    expect(new URL(calls[0]).searchParams.get("page")).toBe("1");
    expect(new URL(calls[1]).searchParams.get("page")).toBe("2");
    expect(calls[0]).toContain("category_slug%5B%5D=news+%26+events");
    expect(calls[0]).toContain("tag_slug%5B%5D=grand%2Fopening");
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

describe("createFeedClient — listInstagram URL building (§3.7)", () => {
  it("scopes to /feeds/instagram with no query when params are empty", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listInstagram();
    expect(calls[0]).toBe(
      "https://api.example.com/public_services/websites/site-token-123/feeds/instagram"
    );
  });

  it("serializes page, per_page, and hashtag", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listInstagram({ page: 2, perPage: 24, hashtag: "openings" });
    const query = new URL(calls[0]).searchParams;
    expect(query.get("page")).toBe("2");
    expect(query.get("per_page")).toBe("24");
    expect(query.get("hashtag")).toBe("openings");
  });

  it("clamps per_page to MAX_PER_PAGE", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listInstagram({ perPage: 500 });
    expect(new URL(calls[0]).searchParams.get("per_page")).toBe(String(MAX_PER_PAGE));
  });

  it("percent-encodes a hashtag containing punctuation (e.g. leading #)", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listInstagram({ hashtag: "#grand opening" });
    // URLSearchParams encodes "#" as %23 and the space as "+".
    expect(calls[0]).toContain("hashtag=%23grand+opening");
    expect(new URL(calls[0]).searchParams.get("hashtag")).toBe("#grand opening");
  });

  it("returns an error envelope on non-2xx (never throws)", async () => {
    const { fetcher } = recordingFetcher({}, { ok: false, status: 500 });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const result = await client.listInstagram();
    expect(result.data).toEqual([]);
    expect(result.meta).toBeNull();
    expect(result.error?.status).toBe(500);
  });
});

describe("createFeedClient — listReviews URL building (§3.8)", () => {
  it("scopes to /feeds/reviews with no query when params are empty", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listReviews();
    expect(calls[0]).toBe(
      "https://api.example.com/public_services/websites/site-token-123/feeds/reviews"
    );
  });

  it("serializes page, per_page, min_rating, location_id, sort_by, and sort_dir", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listReviews({
      page: 2,
      perPage: 24,
      minRating: 4,
      locationId: 1093,
      sortBy: "rating",
      sortDir: "asc",
    });
    const query = new URL(calls[0]).searchParams;
    expect(query.get("page")).toBe("2");
    expect(query.get("per_page")).toBe("24");
    expect(query.get("min_rating")).toBe("4");
    expect(query.get("location_id")).toBe("1093");
    expect(query.get("sort_by")).toBe("rating");
    expect(query.get("sort_dir")).toBe("asc");
  });

  it("clamps per_page to MAX_PER_PAGE", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listReviews({ perPage: 500 });
    expect(new URL(calls[0]).searchParams.get("per_page")).toBe(String(MAX_PER_PAGE));
  });

  it("serializes platforms as REPEATED platforms[] params (Rack array binding)", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listReviews({ platforms: ["google", "yelp", "facebook"] });
    // The raw URL carries the bracket key percent-encoded, repeated once per platform.
    expect(calls[0]).toContain("platforms%5B%5D=google");
    expect(calls[0]).toContain("platforms%5B%5D=yelp");
    expect(calls[0]).toContain("platforms%5B%5D=facebook");
    // Round-trips back to the array under the literal bracket key.
    const query = new URL(calls[0]).searchParams;
    expect(query.getAll("platforms[]")).toEqual(["google", "yelp", "facebook"]);
  });

  it("drops empty platform entries but keeps a single valid one", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listReviews({ platforms: ["", "google"] });
    expect(new URL(calls[0]).searchParams.getAll("platforms[]")).toEqual(["google"]);
  });

  it("percent-encodes a platform value with punctuation", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listReviews({ platforms: ["a b&c"] });
    expect(new URL(calls[0]).searchParams.getAll("platforms[]")).toEqual(["a b&c"]);
  });

  it("re-sends every filter on every page request (legacy bug #1)", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const filters = { minRating: 4, platforms: ["google"], locationId: 7, sortBy: "rating" as const };
    await client.listReviews({ ...filters, page: 1 });
    await client.listReviews({ ...filters, page: 2 });
    for (const url of calls) {
      const query = new URL(url).searchParams;
      expect(query.get("min_rating")).toBe("4");
      expect(query.getAll("platforms[]")).toEqual(["google"]);
      expect(query.get("location_id")).toBe("7");
      expect(query.get("sort_by")).toBe("rating");
    }
    expect(new URL(calls[0]).searchParams.get("page")).toBe("1");
    expect(new URL(calls[1]).searchParams.get("page")).toBe("2");
  });

  it("returns an error envelope on non-2xx (never throws)", async () => {
    const { fetcher } = recordingFetcher({}, { ok: false, status: 500 });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const result = await client.listReviews();
    expect(result.data).toEqual([]);
    expect(result.meta).toBeNull();
    expect(result.error?.status).toBe(500);
  });
});

describe("createFeedClient — listEvents URL building (§3.9)", () => {
  it("scopes to /feeds/events with no query when params are empty", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listEvents();
    expect(calls[0]).toBe(
      "https://api.example.com/public_services/websites/site-token-123/feeds/events"
    );
  });

  it("serializes page, per_page, start_date, and end_date", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listEvents({
      page: 2,
      perPage: 24,
      startDate: "2026-07-18",
      endDate: "2026-08-18",
    });
    const query = new URL(calls[0]).searchParams;
    expect(query.get("page")).toBe("2");
    expect(query.get("per_page")).toBe("24");
    expect(query.get("start_date")).toBe("2026-07-18");
    expect(query.get("end_date")).toBe("2026-08-18");
  });

  it("serializes location_ids as REPEATED location_ids[] params (Rack array binding)", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listEvents({ locationIds: [1093, "1094", 1095] });
    // The bracket key is percent-encoded, repeated once per id.
    expect(calls[0]).toContain("location_ids%5B%5D=1093");
    expect(calls[0]).toContain("location_ids%5B%5D=1094");
    expect(calls[0]).toContain("location_ids%5B%5D=1095");
    const query = new URL(calls[0]).searchParams;
    expect(query.getAll("location_ids[]")).toEqual(["1093", "1094", "1095"]);
  });

  it("drops empty/blank location id entries but keeps valid ones (incl. 0)", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listEvents({ locationIds: ["", 0, "1094"] });
    expect(new URL(calls[0]).searchParams.getAll("location_ids[]")).toEqual(["0", "1094"]);
  });

  it("clamps per_page to MAX_PER_PAGE", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    await client.listEvents({ perPage: 500 });
    expect(new URL(calls[0]).searchParams.get("per_page")).toBe(String(MAX_PER_PAGE));
  });

  it("re-sends every filter on every page request (legacy bug #1)", async () => {
    const { calls, fetcher } = recordingFetcher({ data: [], meta: null });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const filters = {
      startDate: "2026-07-18",
      endDate: "2026-08-18",
      locationIds: [1093, 1094],
    };
    await client.listEvents({ ...filters, page: 1 });
    await client.listEvents({ ...filters, page: 2 });
    for (const url of calls) {
      const query = new URL(url).searchParams;
      expect(query.get("start_date")).toBe("2026-07-18");
      expect(query.get("end_date")).toBe("2026-08-18");
      expect(query.getAll("location_ids[]")).toEqual(["1093", "1094"]);
    }
    expect(new URL(calls[0]).searchParams.get("page")).toBe("1");
    expect(new URL(calls[1]).searchParams.get("page")).toBe("2");
  });

  it("returns an error envelope on non-2xx (never throws)", async () => {
    const { fetcher } = recordingFetcher({}, { ok: false, status: 500 });
    const client = createFeedClient({ baseUrl: BASE, websiteToken: TOKEN, fetcher });
    const result = await client.listEvents();
    expect(result.data).toEqual([]);
    expect(result.meta).toBeNull();
    expect(result.error?.status).toBe(500);
  });
});
