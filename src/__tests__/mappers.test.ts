import { describe, it, expect } from "vitest";
import { mapBlogFeedDetail, mapBlogFeedItem, formatFeedDate } from "../data/mappers.js";
import type { BlogFeedDetailItem, BlogFeedItem } from "../types/index.js";

const baseItem: BlogFeedItem = {
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

describe("mapBlogFeedItem (§4.1)", () => {
  it("maps the wire item to the prop shape", () => {
    expect(mapBlogFeedItem(baseItem)).toMatchObject({
      id: 12,
      title: "Grand opening",
      category: "News",
      author: "Jordan H",
      date: "Jul 1, 2026",
      href: "/b/grand-opening",
      image: "https://cdn.ing/img.jpg",
      imageAlt: "Storefront",
    });
  });

  it("tolerates a null blog_category and null image fields", () => {
    const out = mapBlogFeedItem({ ...baseItem, blog_category: null, image_url: null, image_alt: null });
    expect(out.category).toBeUndefined();
    expect(out.image).toBeUndefined();
    expect(out.imageAlt).toBeUndefined();
  });
});

describe("mapBlogFeedDetail (§4.3)", () => {
  const detail: BlogFeedDetailItem = {
    ...baseItem,
    body: "## Hello",
    body_format: "markdown",
    updated_at: "2026-07-02T09:00:00Z",
    related: [{ ...baseItem, id: 2, title: "Related" }],
  };

  it("maps body, tags, and related articles", () => {
    const out = mapBlogFeedDetail(detail);
    expect(out.markdownString).toBe("## Hello");
    expect(out.tags).toEqual(["Openings"]);
    expect(out.articles).toHaveLength(1);
    expect(out.articles?.[0].title).toBe("Related");
  });

  it("is defensive when blog_tags / related are absent (partial wire payload)", () => {
    // A partial payload may omit array fields entirely; the mapper must not throw.
    const partial = { ...detail, blog_tags: undefined, related: undefined } as unknown as BlogFeedDetailItem;
    const out = mapBlogFeedDetail(partial);
    expect(out.tags).toEqual([]);
    expect(out.articles).toEqual([]);
  });
});

describe("formatFeedDate (§4.1)", () => {
  it("formats a valid ISO timestamp in UTC", () => {
    expect(formatFeedDate("2026-07-01T09:00:00Z")).toBe("Jul 1, 2026");
  });

  it("returns undefined for missing / invalid input (never a fabricated date)", () => {
    expect(formatFeedDate(null)).toBeUndefined();
    expect(formatFeedDate(undefined)).toBeUndefined();
    expect(formatFeedDate("not-a-date")).toBeUndefined();
  });
});
