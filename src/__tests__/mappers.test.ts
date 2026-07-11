import { describe, it, expect } from "vitest";
import {
  mapBlogFeedDetail,
  mapBlogFeedItem,
  mapEventFeedItem,
  mapInstagramFeedItem,
  mapReviewItem,
  mapSocialTestimonialItem,
  mapTestimonialItem,
  platformLabel,
  formatFeedDate,
  truncateAtWordBoundary,
} from "../data/mappers.js";
import type {
  BlogFeedDetailItem,
  BlogFeedItem,
  EventFeedItem,
  InstagramFeedItem,
  ReviewFeedItem,
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

  // Shared lockstep test vectors — the identical cases exist in dashtrack-ai
  // spec/services/feeds/instagram_feed_resolver_spec.rb. The alt rule counts
  // CODEPOINTS, not UTF-16 code units, so emoji are never split.
  const altFor = (caption: string): string | undefined =>
    mapInstagramFeedItem({ ...imagePost, caption })?.imageAlt;

  // (a) 150 ascii chars -> first 100 + ellipsis.
  it("hard-cuts a long ascii caption at 100 codepoints with an ellipsis", () => {
    const alt = altFor("a".repeat(150));
    expect(alt).toBe(`${"a".repeat(100)}…`);
    expect(alt?.length).toBe(101);
  });

  // (b) NBSP (U+00A0) + ideographic space (U+3000) runs collapse and trim.
  it("collapses and trims Unicode whitespace (NBSP U+00A0) runs", () => {
    expect(altFor("\u00A0\u00A0hello\u00A0\u3000\u00A0world\u3000")).toBe(
      "hello world"
    );
  });

  // (c) 120 emoji (each a surrogate pair) -> first 100 codepoints, never split.
  it("cuts at 100 codepoints without splitting surrogate-pair emoji", () => {
    const alt = altFor("\u{1F600}".repeat(120));
    expect(alt).toBe(`${"\u{1F600}".repeat(100)}…`);
    // Codepoint count is 101 (100 emoji + ellipsis); UTF-16 .length is larger.
    expect(alt ? Array.from(alt).length : 0).toBe(101);
    // No lone surrogate was produced by the cut.
    expect(alt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  // (d) a cut that lands on whitespace has that trailing whitespace stripped.
  it("strips trailing whitespace exposed by the 100-codepoint cut", () => {
    const alt = altFor(`${"a".repeat(99)} ${"b".repeat(50)}`);
    expect(alt).toBe(`${"a".repeat(99)}…`);
    expect(alt?.length).toBe(100);
  });
});

describe("testimonial mappers (§4.1c)", () => {
  const review: ReviewFeedItem = {
    id: "9c3b7a10-0000-4000-8000-000000000001",
    reviewer_name: "Dana P.",
    rating: 5,
    content: "Absolutely wonderful service and the food was incredible.",
    platform: "google",
    time_created: "2026-07-01T09:00:00Z",
    profile_url: "https://www.google.com/maps/contrib/123",
    // Hotlinked avatar is present on the wire but must never be mapped (§3.8 caveat).
    avatar_url: "https://lh3.googleusercontent.com/rot-prone.jpg",
  };

  describe("mapTestimonialItem (base shape)", () => {
    it("maps content→quote, reviewer_name→author, numeric rating, and linkConfig", () => {
      expect(mapTestimonialItem(review)).toEqual({
        quote: "Absolutely wonderful service and the food was incredible.",
        author: "Dana P.",
        rating: 5,
        linkConfig: {
          label: "Read on Google",
          href: "https://www.google.com/maps/contrib/123",
        },
      });
    });

    it("NEVER maps avatar_url (Phase 2 media caveat, §3.8)", () => {
      const out = mapTestimonialItem(review) as Record<string, unknown>;
      expect(out).not.toHaveProperty("avatarSrc");
      expect(out).not.toHaveProperty("avatar_url");
      expect(out).not.toHaveProperty("avatar");
      expect(JSON.stringify(out)).not.toContain("googleusercontent");
    });

    it("omits rating when null (never fabricated)", () => {
      const out = mapTestimonialItem({ ...review, rating: null });
      expect(out).not.toHaveProperty("rating");
    });

    it("omits linkConfig when profile_url is absent (no synthesized link)", () => {
      const out = mapTestimonialItem({ ...review, profile_url: null });
      expect(out).not.toHaveProperty("linkConfig");
    });

    it("keeps a real zero-ish rating (1 is a number)", () => {
      expect(mapTestimonialItem({ ...review, rating: 1 }).rating).toBe(1);
    });
  });

  describe("mapReviewItem (ReviewItem coercion for list-verified / images-helpful)", () => {
    it("renames quote→content, adds date and verified:true, passes numeric rating", () => {
      const out = mapReviewItem(review);
      expect(out).toMatchObject({
        content: "Absolutely wonderful service and the food was incredible.",
        rating: 5,
        author: "Dana P.",
        date: "Jul 1, 2026",
        verified: true,
      });
      expect(out).not.toHaveProperty("quote");
    });

    it("derives a word-boundary title (~40 chars) with an ellipsis when truncated", () => {
      const out = mapReviewItem(review);
      // Cut window is 40 chars: "Absolutely wonderful service and the fo" → last space before "fo".
      expect(out?.title).toBe("Absolutely wonderful service and the…");
      expect(out?.title.endsWith("…")).toBe(true);
      // Word boundary: never cuts mid-word.
      expect(out?.title).not.toContain("fo…");
    });

    it("uses the whole content as title when it is short (no ellipsis)", () => {
      const out = mapReviewItem({ ...review, content: "Great spot!" });
      expect(out?.title).toBe("Great spot!");
      expect(out?.title.endsWith("…")).toBe(false);
    });

    it("collapses whitespace in the title", () => {
      const out = mapReviewItem({ ...review, content: "Great\n\n  spot!" });
      expect(out?.title).toBe("Great spot!");
    });

    it("DROPS the item (returns null) when rating is absent — never rendered rating-less (lockstep hydrator.rb review_item_shape / §2.3 rule 5)", () => {
      expect(mapReviewItem({ ...review, rating: null, time_created: "" })).toBeNull();
    });

    it("keeps a numeric zero-ish rating (1 is a number → not dropped)", () => {
      expect(mapReviewItem({ ...review, rating: 1 })?.rating).toBe(1);
    });
  });

  describe("mapSocialTestimonialItem (twitter-cards coercion)", () => {
    it("maps content (not quote) + author + linkConfig; never sets handle", () => {
      const out = mapSocialTestimonialItem(review) as Record<string, unknown>;
      expect(out.content).toBe(
        "Absolutely wonderful service and the food was incredible."
      );
      expect(out.author).toBe("Dana P.");
      expect(out.linkConfig).toEqual({
        label: "Read on Google",
        href: "https://www.google.com/maps/contrib/123",
      });
      expect(out).not.toHaveProperty("quote");
      expect(out).not.toHaveProperty("handle");
    });
  });

  describe("platformLabel", () => {
    // Byte-for-byte parity with the dashtrack-ai LOCKSTEP REFERENCE
    // `Feeds::TestimonialsFeedResolver::PLATFORM_LABELS`
    // (app/services/feeds/testimonials_feed_resolver.rb). These 18 pairs are ALSO the exact
    // `LocationReview::REVIEW_TYPE_VALUES` enum key set — so the map covers every valid
    // `review_type` and the capitalize/`titleize` fallback is UNREACHABLE for any enum key.
    // Hardcoded on purpose: any future drift on either side must fail this test loudly.
    const RUBY_PLATFORM_LABELS: ReadonlyArray<readonly [string, string]> = [
      ["yelp", "Yelp"],
      ["google", "Google"],
      ["applemaps", "Apple Maps"],
      ["doordash", "DoorDash"],
      ["facebook", "Facebook"],
      ["foursquare", "Foursquare"],
      ["grubhub", "Grubhub"],
      ["opentable", "OpenTable"],
      ["tripadvisor", "TripAdvisor"],
      ["ubereats", "Uber Eats"],
      ["bbb", "BBB"],
      ["bing", "Bing"],
      ["booking", "Booking.com"],
      ["citysearch", "Citysearch"],
      ["expedia", "Expedia"],
      ["justeat", "Just Eat"],
      ["orbitz", "Orbitz"],
      ["travelocity", "Travelocity"],
    ];

    it("maps all 18 review_type enum keys byte-for-byte to the Ruby reference labels", () => {
      expect(RUBY_PLATFORM_LABELS).toHaveLength(18);
      for (const [key, label] of RUBY_PLATFORM_LABELS) {
        expect(platformLabel(key)).toBe(label);
      }
    });

    it("labels known enum keys", () => {
      expect(platformLabel("google")).toBe("Google");
      expect(platformLabel("yelp")).toBe("Yelp");
      expect(platformLabel("applemaps")).toBe("Apple Maps");
      expect(platformLabel("ubereats")).toBe("Uber Eats");
      expect(platformLabel("bbb")).toBe("BBB");
      expect(platformLabel("tripadvisor")).toBe("TripAdvisor");
    });

    it("capitalizes an unknown key rather than throwing", () => {
      expect(platformLabel("someplace")).toBe("Someplace");
    });

    it("falls back generically for a blank platform (never 'Read on ')", () => {
      expect(platformLabel("")).toBe("the review site");
      expect(platformLabel(null)).toBe("the review site");
    });
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

// ---------------------------------------------------------------------------
// Events feed mapper (§3.9 / §4.1d)
// ---------------------------------------------------------------------------

describe("truncateAtWordBoundary (§4.1c / §4.1d shared rule)", () => {
  // Ten 5-char words joined by single spaces → 59 codepoints. Cutting to 50 lands inside the
  // 9th word ("II"); the word-boundary cut backs up to the last ASCII space → first 8 words.
  const WORDS = [
    "AAAAA", "BBBBB", "CCCCC", "DDDDD", "EEEEE",
    "FFFFF", "GGGGG", "HHHHH", "IIIII", "JJJJJ",
  ];
  const EXPECTED = `${WORDS.slice(0, 8).join(" ")}…`; // "AAAAA … HHHHH…"

  it("returns the collapsed string unchanged when within the cap", () => {
    expect(truncateAtWordBoundary("Summer Kickoff Party", 50)).toBe("Summer Kickoff Party");
  });

  it("cuts a long string at the last word boundary and appends an ellipsis", () => {
    expect(truncateAtWordBoundary(WORDS.join(" "), 50)).toBe(EXPECTED);
    expect(Array.from(EXPECTED).length).toBe(48); // 47 kept + ellipsis
  });

  // Unicode-whitespace lockstep (twice review-flagged): NBSP U+00A0 and ideographic space U+3000
  // MUST collapse to a single ASCII space BEFORE counting, so all three produce byte-identical
  // output. Exact expected strings pinned below.
  it("collapses NBSP (U+00A0) separators identically to ASCII spaces", () => {
    expect(truncateAtWordBoundary(WORDS.join("\u00a0"), 50)).toBe(EXPECTED);
  });

  it("collapses ideographic-space (U+3000) separators identically to ASCII spaces", () => {
    expect(truncateAtWordBoundary(WORDS.join("\u3000"), 50)).toBe(EXPECTED);
  });

  it("collapses mixed Unicode-whitespace runs and trims both ends", () => {
    // Leading/trailing Unicode whitespace + mixed NBSP/U+3000 interior runs.
    const input = `\u00a0\u3000${WORDS.join("\u00a0\u3000")}\u3000\u00a0`;
    expect(truncateAtWordBoundary(input, 50)).toBe(EXPECTED);
  });

  it("cuts at 50 codepoints without splitting surrogate-pair emoji", () => {
    const out = truncateAtWordBoundary("\u{1F600}".repeat(60), 50);
    expect(out).toBe(`${"\u{1F600}".repeat(50)}…`);
    expect(Array.from(out).length).toBe(51); // 50 emoji + ellipsis, never a lone surrogate
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("returns an empty string for whitespace-only input (caller omits the field)", () => {
    expect(truncateAtWordBoundary("\u00a0\u3000  \n\t", 130)).toBe("");
  });
});

describe("mapEventFeedItem (§4.1d)", () => {
  const baseEvent: EventFeedItem = {
    id: "123",
    occurrence_id: "123:2",
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
    recurring_summary: "Weekly on Fridays",
  };

  it("maps a fully-populated occurrence to hero props (badge/label in the event tz)", () => {
    expect(mapEventFeedItem(baseEvent)).toEqual({
      heading: "Summer Kickoff Party",
      description: "Join us for food, drinks, and live music.",
      badgeText: "JUL 18",
      locationLabel: "Jul 18, 2026 · 7:00 PM",
      locationSublabel: "The Rooftop",
      image: { src: "https://cdn.ing/events/1.jpg", alt: "Summer Kickoff Party" },
      stats: [
        { value: "$25.00", label: "From" },
        { value: "Weekly on Fridays", label: "Schedule" },
      ],
      actions: [{ label: "Register", href: "https://tickets.example.com/123" }],
    });
  });

  it("truncates the heading ≤ 50 codepoints at a word boundary (§4.1d)", () => {
    const title = "AAAAA BBBBB CCCCC DDDDD EEEEE FFFFF GGGGG HHHHH IIIII JJJJJ";
    expect(mapEventFeedItem({ ...baseEvent, title }).heading).toBe(
      "AAAAA BBBBB CCCCC DDDDD EEEEE FFFFF GGGGG HHHHH…"
    );
  });

  it("uses the raw (untruncated) title as the image alt", () => {
    const title = "AAAAA BBBBB CCCCC DDDDD EEEEE FFFFF GGGGG HHHHH IIIII JJJJJ";
    expect(mapEventFeedItem({ ...baseEvent, title }).image?.alt).toBe(title);
  });

  it("OMITS description when blank/whitespace-only (never fabricated)", () => {
    const out = mapEventFeedItem({ ...baseEvent, description: "\u00a0\u3000  " });
    expect(out).not.toHaveProperty("description");
  });

  it("truncates a long description ≤ 130 codepoints at a word boundary", () => {
    const long = `${"word ".repeat(40)}tail`; // 205 chars, well over 130
    const out = mapEventFeedItem({ ...baseEvent, description: long });
    expect(Array.from(out.description ?? "").length).toBeLessThanOrEqual(131);
    expect(out.description?.endsWith("…")).toBe(true);
    expect(out.description).not.toContain("  "); // whitespace collapsed
  });

  it("prefers location_name, falls back to custom_address, omits when neither", () => {
    expect(
      mapEventFeedItem({ ...baseEvent, location_name: null, custom_address: "123 Main St" })
        .locationSublabel
    ).toBe("123 Main St");
    const neither = mapEventFeedItem({
      ...baseEvent,
      location_name: null,
      custom_address: "   ",
    });
    expect(neither).not.toHaveProperty("locationSublabel");
  });

  it("OMITS the image when image_url is absent (text-column collapse allowed)", () => {
    const out = mapEventFeedItem({ ...baseEvent, image_url: null });
    expect(out).not.toHaveProperty("image");
  });

  describe("stats — REAL data only, OMITTED when none (§4.1d)", () => {
    it("emits both stats when price and recurring_summary are present", () => {
      expect(mapEventFeedItem(baseEvent).stats).toEqual([
        { value: "$25.00", label: "From" },
        { value: "Weekly on Fridays", label: "Schedule" },
      ]);
    });

    it("emits only the price stat when there is no recurring summary", () => {
      const out = mapEventFeedItem({ ...baseEvent, recurring_summary: null });
      expect(out.stats).toEqual([{ value: "$25.00", label: "From" }]);
    });

    it("emits only the schedule stat when there is no price", () => {
      const out = mapEventFeedItem({ ...baseEvent, price_from: null });
      expect(out.stats).toEqual([{ value: "Weekly on Fridays", label: "Schedule" }]);
    });

    it("OMITS stats entirely when neither price nor recurring summary is real", () => {
      const out = mapEventFeedItem({
        ...baseEvent,
        price_from: null,
        recurring_summary: null,
      });
      expect(out).not.toHaveProperty("stats");
    });
  });

  describe("actions — Register only when registration_url present (§4.1d)", () => {
    it("emits a single Register action when registration_url is present", () => {
      expect(mapEventFeedItem(baseEvent).actions).toEqual([
        { label: "Register", href: "https://tickets.example.com/123" },
      ]);
    });

    it("OMITS actions when registration_url is absent", () => {
      const out = mapEventFeedItem({ ...baseEvent, registration_url: null });
      expect(out).not.toHaveProperty("actions");
    });
  });

  describe("constraint caps (§4.1d): actions ≤ 2, stats ≤ 4", () => {
    it("never emits more than 2 actions or 4 stats", () => {
      const out = mapEventFeedItem(baseEvent);
      expect((out.actions ?? []).length).toBeLessThanOrEqual(2);
      expect((out.stats ?? []).length).toBeLessThanOrEqual(4);
    });
  });

  describe("date/time formatting (event timezone, DST-free Phoenix)", () => {
    it("builds the badge as uppercased short date in the event tz", () => {
      // 19:00 -07:00 in America/Phoenix (UTC-7 year-round) → Jul 18.
      expect(mapEventFeedItem(baseEvent).badgeText).toBe("JUL 18");
    });

    it("builds the location label with a middot separator and ASCII space before AM/PM", () => {
      const label = mapEventFeedItem(baseEvent).locationLabel ?? "";
      expect(label).toBe("Jul 18, 2026 · 7:00 PM");
      // No narrow/regular no-break space slipped in from ICU (lockstep with Ruby strftime).
      expect(label).not.toMatch(/[\u202f\u00a0]/);
    });

    it("degrades to UTC (never throws) for an unknown timezone", () => {
      const out = mapEventFeedItem({ ...baseEvent, timezone: "Not/AZone" });
      // 2026-07-19T02:00:00Z in UTC → Jul 19, 2:00 AM.
      expect(out.badgeText).toBe("JUL 19");
      expect(out.locationLabel).toBe("Jul 19, 2026 · 2:00 AM");
    });

    it("omits badge/label for an unparseable starts_at (never fabricated)", () => {
      const out = mapEventFeedItem({ ...baseEvent, starts_at: "not-a-date" });
      expect(out).not.toHaveProperty("badgeText");
      expect(out).not.toHaveProperty("locationLabel");
    });
  });
});
