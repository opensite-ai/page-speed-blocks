import type {
  BlogFeedItem,
  BlogFeedDetailItem,
  BlogFeedParams,
  BlogFeedTaxonomy,
  CreateFeedClientOptions,
  EventFeedItem,
  EventFeedParams,
  FeedClient,
  FeedError,
  FeedItemResponse,
  FeedListResponse,
  FeedResponseMeta,
  InstagramFeedItem,
  InstagramFeedParams,
  ReviewFeedItem,
  ReviewFeedParams,
} from "../types/index.js";

/** Upper bound for `per_page` (FEED_CONTRACT §3.2 — clamped client-side too). */
export const MAX_PER_PAGE = 50;

/**
 * Serialize normalized list params into wire query params (§3.2).
 * Every provided filter is serialized on every call — this is the class's guarantee
 * against legacy bug #1 (pagination dropping filters). Values are URL-encoded by
 * `URLSearchParams`. `per_page` is clamped to ≤ 50.
 */
function buildBlogQuery(params: BlogFeedParams): string {
  const query = new URLSearchParams();

  if (typeof params.page === "number") {
    query.set("page", String(params.page));
  }
  if (typeof params.perPage === "number") {
    const clamped = Math.min(Math.max(1, Math.trunc(params.perPage)), MAX_PER_PAGE);
    query.set("per_page", String(clamped));
  }
  if (params.categorySlug) query.set("category_slug", params.categorySlug);
  if (params.tagSlug) query.set("tag_slug", params.tagSlug);
  if (params.query) query.set("query", params.query);
  if (params.sortBy) query.set("sort_by", params.sortBy);
  if (params.sortDir) query.set("sort_dir", params.sortDir);

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

/**
 * Serialize normalized Instagram list params into wire query params (§3.7).
 * Mirrors `buildBlogQuery`: every provided filter is serialized on every call (legacy bug #1),
 * values are URL-encoded by `URLSearchParams`, and `per_page` is clamped to ≤ 50.
 */
function buildInstagramQuery(params: InstagramFeedParams): string {
  const query = new URLSearchParams();

  if (typeof params.page === "number") {
    query.set("page", String(params.page));
  }
  if (typeof params.perPage === "number") {
    const clamped = Math.min(Math.max(1, Math.trunc(params.perPage)), MAX_PER_PAGE);
    query.set("per_page", String(clamped));
  }
  if (params.hashtag) query.set("hashtag", params.hashtag);

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

/**
 * Serialize normalized reviews list params into wire query params (§3.8).
 * Mirrors `buildBlogQuery`: every provided filter is serialized on every call (legacy bug #1),
 * values are URL-encoded by `URLSearchParams`, and `per_page` is clamped to ≤ 50. `platforms`
 * is emitted as REPEATED `platforms[]` params to match the Rails endpoint's array binding.
 */
function buildReviewQuery(params: ReviewFeedParams): string {
  const query = new URLSearchParams();

  if (typeof params.page === "number") {
    query.set("page", String(params.page));
  }
  if (typeof params.perPage === "number") {
    const clamped = Math.min(Math.max(1, Math.trunc(params.perPage)), MAX_PER_PAGE);
    query.set("per_page", String(clamped));
  }
  if (typeof params.minRating === "number") {
    query.set("min_rating", String(params.minRating));
  }
  if (params.platforms) {
    // Repeated `platforms[]=…` params (Rack array binding). An unknown key is left to the
    // server to reject (§2.3 rule 3: unknown platform → empty result, never unfiltered).
    for (const platform of params.platforms) {
      if (platform) query.append("platforms[]", platform);
    }
  }
  if (
    params.locationId !== undefined &&
    params.locationId !== null &&
    params.locationId !== ""
  ) {
    query.set("location_id", String(params.locationId));
  }
  if (params.sortBy) query.set("sort_by", params.sortBy);
  if (params.sortDir) query.set("sort_dir", params.sortDir);

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

/**
 * Serialize normalized events list params into wire query params (§3.9).
 * Mirrors `buildReviewQuery`: every provided filter is serialized on every call (legacy bug #1),
 * values are URL-encoded by `URLSearchParams`, and `per_page` is clamped to ≤ 50. `location_ids`
 * is emitted as REPEATED `location_ids[]` params to match the Rails endpoint's array binding.
 * NOTE: `upcomingOnly` has no wire param on the §3.9 endpoint (the server's default window starts
 * at "now"), so it is deliberately not serialized here.
 */
function buildEventQuery(params: EventFeedParams): string {
  const query = new URLSearchParams();

  if (typeof params.page === "number") {
    query.set("page", String(params.page));
  }
  if (typeof params.perPage === "number") {
    const clamped = Math.min(Math.max(1, Math.trunc(params.perPage)), MAX_PER_PAGE);
    query.set("per_page", String(clamped));
  }
  if (params.startDate) query.set("start_date", params.startDate);
  if (params.endDate) query.set("end_date", params.endDate);
  if (params.locationIds) {
    // Repeated `location_ids[]=…` params (Rack array binding). Empty/blank ids are dropped; the
    // server validates membership against the website's assigned locations (§3.9 / §2.3 rule 3:
    // an unknown/foreign id → empty result, never an unfiltered one).
    for (const id of params.locationIds) {
      if (id !== undefined && id !== null && id !== "") {
        query.append("location_ids[]", String(id));
      }
    }
  }

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

function toFeedError(status: number, message: string): FeedError {
  return { status, message };
}

/**
 * Create a typed feed client (FEED_CONTRACT §7.2). The single place that builds feed URLs:
 * `/public_services/websites/{token}/feeds/...`. Never throws for expected failures —
 * HTTP / network errors are returned as `{ data: [], meta: null, error }` and never swallowed
 * (no `console.*`).
 */
export function createFeedClient(options: CreateFeedClientOptions): FeedClient {
  const { websiteToken, fetcher } = options;
  // Strip trailing slashes so path joins stay clean.
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const feedsRoot = `${baseUrl}/public_services/websites/${encodeURIComponent(
    websiteToken
  )}/feeds`;

  // Resolve the fetch implementation lazily; do not throw at construction time.
  const doFetch: typeof fetch = (input, init) => {
    const impl = fetcher ?? (typeof fetch !== "undefined" ? fetch : undefined);
    if (!impl) {
      return Promise.reject(new Error("No fetch implementation available"));
    }
    return impl(input, init);
  };

  async function requestList<T>(url: string): Promise<FeedListResponse<T>> {
    try {
      const response = await doFetch(url);
      if (!response.ok) {
        return {
          data: [],
          meta: null,
          error: toFeedError(response.status, response.statusText || `Request failed (${response.status})`),
        };
      }
      const body = (await response.json()) as {
        data?: T[];
        meta?: FeedResponseMeta;
      };
      return { data: body.data ?? [], meta: body.meta ?? null };
    } catch (error) {
      return {
        data: [],
        meta: null,
        error: toFeedError(0, error instanceof Error ? error.message : "Network error"),
      };
    }
  }

  async function requestItem<T>(url: string): Promise<FeedItemResponse<T>> {
    try {
      const response = await doFetch(url);
      if (!response.ok) {
        return {
          data: null,
          error: toFeedError(response.status, response.statusText || `Request failed (${response.status})`),
        };
      }
      const body = (await response.json()) as { data?: T | null };
      return { data: body.data ?? null };
    } catch (error) {
      return {
        data: null,
        error: toFeedError(0, error instanceof Error ? error.message : "Network error"),
      };
    }
  }

  return {
    listBlogs(params: BlogFeedParams = {}) {
      return requestList<BlogFeedItem>(`${feedsRoot}/blogs${buildBlogQuery(params)}`);
    },
    getBlog(slug: string) {
      return requestItem<BlogFeedDetailItem>(
        `${feedsRoot}/blogs/${encodeURIComponent(slug)}`
      );
    },
    listBlogCategories() {
      return requestList<BlogFeedTaxonomy>(`${feedsRoot}/blog_categories`);
    },
    listBlogTags() {
      return requestList<BlogFeedTaxonomy>(`${feedsRoot}/blog_tags`);
    },
    listInstagram(params: InstagramFeedParams = {}) {
      return requestList<InstagramFeedItem>(
        `${feedsRoot}/instagram${buildInstagramQuery(params)}`
      );
    },
    listReviews(params: ReviewFeedParams = {}) {
      return requestList<ReviewFeedItem>(
        `${feedsRoot}/reviews${buildReviewQuery(params)}`
      );
    },
    listEvents(params: EventFeedParams = {}) {
      return requestList<EventFeedItem>(
        `${feedsRoot}/events${buildEventQuery(params)}`
      );
    },
  };
}
