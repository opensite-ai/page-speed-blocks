import { describe, it, expect } from "vitest";
import {
  mapBlogFeedDetail,
  mapBlogFeedItem,
  mapInstagramFeedItem,
  formatFeedDate,
} from "../data/mappers.js";
import type {
  BlogFeedDetailItem,
  BlogFeedItem,
  InstagramFeedItem,
} from "../types/index.js";

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

describe("mapInstagramFeedItem (§4.1b)", () => {
  const imagePost: InstagramFeedItem = {
    id: "17900000000000001",
    permalink: "https://www.instagram.com/p/ABC123/",
    caption: "Grand opening today!",
    post_type: "image",
    posted_at: "2026-07-01T09:00:00Z",
    like_count: 12,
    comment_count: 3,
    view_count: null,
    play_count: null,
    location_name: "Encapsa HQ",
    files: [{ media_type: "image", image_url: "https://cdn.ing/ig/1.jpg", video_url: null }],
  };

  it("maps an image post to the prop shape (id string-coerced, counts included)", () => {
    expect(mapInstagramFeedItem(imagePost)).toEqual({
      id: "17900000000000001",
      href: "https://www.instagram.com/p/ABC123/",
      image: "https://cdn.ing/ig/1.jpg",
      imageAlt: "Grand opening today!",
      caption: "Grand opening today!",
      date: "Jul 1, 2026",
      likeCount: 12,
      commentCount: 3,
    });
  });

  it("maps a video post (isVideo + videoUrl from files[0], view_count included)", () => {
    const videoPost: InstagramFeedItem = {
      ...imagePost,
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
    const out = mapInstagramFeedItem(videoPost);
    expect(out).toMatchObject({
      image: "https://cdn.ing/ig/thumb.jpg",
      isVideo: true,
      videoUrl: "https://cdn.ing/ig/clip.mp4",
      viewCount: 480,
    });
  });

  it("skips an imageless post (files[0].image_url null) — returns null (§4.1b)", () => {
    const noImage: InstagramFeedItem = {
      ...imagePost,
      files: [{ media_type: "video", image_url: null, video_url: "https://cdn.ing/ig/clip.mp4" }],
    };
    expect(mapInstagramFeedItem(noImage)).toBeNull();
  });

  it("skips a post with no files at all — returns null", () => {
    expect(mapInstagramFeedItem({ ...imagePost, files: [] })).toBeNull();
  });

  it("omits absent counts (null) rather than fabricating zeros", () => {
    const out = mapInstagramFeedItem(imagePost);
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty("viewCount");
    expect(out).toHaveProperty("likeCount", 12);
  });

  it("keeps a real zero count (0 is a number)", () => {
    const out = mapInstagramFeedItem({ ...imagePost, like_count: 0 });
    expect(out?.likeCount).toBe(0);
  });

  it("falls back imageAlt to 'Instagram post' for a blank/absent caption", () => {
    const out = mapInstagramFeedItem({ ...imagePost, caption: null });
    expect(out?.imageAlt).toBe("Instagram post");
    expect(out).not.toHaveProperty("caption");
  });

  it("collapses whitespace and truncates a long caption for imageAlt (full caption kept)", () => {
    const long = "line one\n\nline two " + "x".repeat(200);
    const out = mapInstagramFeedItem({ ...imagePost, caption: long });
    expect(out?.caption).toBe(long); // caption prop keeps the full text
    expect(out?.imageAlt?.length).toBeLessThanOrEqual(101); // 100 chars + ellipsis
    expect(out?.imageAlt?.endsWith("…")).toBe(true);
    expect(out?.imageAlt).not.toContain("\n");
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
