import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  ARTICLE_LAYOUT_COMPONENT_IDS,
  allowListedArticleLayout,
  articleBreadcrumbs,
  articleChapters,
  articleReadTime,
  articleSections,
  cgiEscape,
  mapBlogDetailToArticleProps,
  normalizedText,
  slugify,
} from "../data/article-props.js";
import type { BlogFeedDetailItem } from "../types/index.js";

// ─── Shared cross-implementation parity fixture ────────────────────────────────────────────
//
// BYTE-IDENTICAL TWIN: utility-modules/customer-sites/spec/fixtures/blog_detail_parity.json,
// where `spec/services/blog_detail_entry_parity_spec.rb` asserts the Ruby first-load mapper
// (`BlogDetailEntry#blog_to_article_props`) reproduces the SAME `expected_props` from the same
// `wire` item. The two implementations can only drift if BOTH suites are changed together.

interface ParityCase {
  name: string;
  wire: BlogFeedDetailItem;
  expected_props: Record<string, unknown>;
}

// jsdom rewrites `import.meta.url` to an http URL, so resolve from the package root instead.
const FIXTURE_PATH = resolve(process.cwd(), "src/__tests__/fixtures/blog-detail-parity.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  cases: ParityCase[];
};

/** Drop null/undefined recursively — the Ruby side emits nulls where JS omits keys. */
function compactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      out[key] = compactDeep(val);
    }
    return out;
  }
  return value;
}

/** Related items carry real autoincrement ids on the Ruby side and fixed wire ids here. */
function normalizeRelatedIds(props: Record<string, unknown>): Record<string, unknown> {
  const articles = props.articles;
  if (Array.isArray(articles)) {
    articles.forEach((item, index) => {
      (item as Record<string, unknown>).id = `__RELATED_ID_${index}__`;
    });
  }
  return props;
}

describe("mapBlogDetailToArticleProps — cross-impl parity with customer-sites BlogDetailEntry", () => {
  for (const parityCase of fixture.cases) {
    it(`reproduces the fixture's expected article props: ${parityCase.name}`, () => {
      const actual = normalizeRelatedIds(
        compactDeep(
          JSON.parse(JSON.stringify(mapBlogDetailToArticleProps(parityCase.wire)))
        ) as Record<string, unknown>
      );

      expect(actual).toEqual(parityCase.expected_props);
    });
  }
});

// ─── Unit coverage of the individual Ruby ports ────────────────────────────────────────────

describe("slugify (mirror of @page-speed/markdown-to-jsx + BlogDetailEntry#slugify)", () => {
  it("drops non-word characters instead of turning them into separators", () => {
    // The live workflowrush heading — the id the renderer actually emits.
    expect(slugify("What an AI voice scheduling agent is—and isn't")).toBe(
      "what-an-ai-voice-scheduling-agent-isand-isnt"
    );
  });

  it("collapses repeated dashes and trims leading/trailing ones", () => {
    expect(slugify("  --Hello   World--  ")).toBe("hello-world");
  });

  it("strips accents the same way Ruby's ASCII \\w does", () => {
    expect(slugify("Café Résumé")).toBe("caf-rsum");
  });
});

describe("articleSections / articleChapters", () => {
  it("takes only H2s and skips headings inside fenced code blocks", () => {
    const body = [
      "# Title",
      "",
      "## Real one",
      "",
      "```bash",
      "## not a heading",
      "```",
      "",
      "### Too deep",
      "",
      "## Real two",
      "",
    ].join("\n");

    expect(articleSections(body)).toEqual([
      { id: "real-one", title: "Real one" },
      { id: "real-two", title: "Real two" },
    ]);
  });

  it("honours an explicit {#custom-id} and reduces the label to plain text", () => {
    const sections = articleSections("## A **bold** [link](https://x.test) {#pinned}\n");
    expect(sections).toEqual([{ id: "pinned", title: "A bold link" }]);
  });

  it("does NOT de-duplicate identical headings (the DOM has one id, twice)", () => {
    // HeadingWithId's module counter never reaches the DOM, so appending "-1" to the second
    // occurrence would produce an anchor pointing at nothing.
    expect(articleSections("## Same\n\n## Same\n").map((s) => s.id)).toEqual([
      "same",
      "same",
    ]);
  });

  it("numbers chapters 1-based off the same sections", () => {
    expect(articleChapters([{ id: "a", title: "A" }, { id: "b", title: "B" }])).toEqual([
      { id: "a", number: 1, title: "A" },
      { id: "b", number: 2, title: "B" },
    ]);
  });
});

describe("articleReadTime", () => {
  it("rounds up at ~200 wpm and ignores markdown syntax", () => {
    expect(articleReadTime(`${"word ".repeat(201)}`)).toBe("2 min read");
    expect(articleReadTime("## Heading\n\none two three")).toBe("1 min read");
  });

  it("is undefined for an empty body (never '0 min read')", () => {
    expect(articleReadTime("")).toBeUndefined();
    expect(articleReadTime("```\ncode only\n```".replace(/[\s\S]*/, ""))).toBeUndefined();
  });
});

describe("articleBreadcrumbs", () => {
  const base = {
    title: "T",
    blog_category: { name: "News", slug: "news" },
  } as unknown as BlogFeedDetailItem;

  it("uses the site's real index path from the wire", () => {
    const crumbs = articleBreadcrumbs({
      ...base,
      site_blog: { index_path: "/insights", show_byline: true },
    } as BlogFeedDetailItem);

    expect(crumbs).toEqual([
      { label: "Blog", href: "/insights" },
      { label: "News", href: "/insights?category_slug=news" },
    ]);
  });

  it("falls back to /blog when the server sends no site_blog (pre-R9 toastability)", () => {
    expect(articleBreadcrumbs(base)[0]).toEqual({ label: "Blog", href: "/blog" });
  });

  it("degrades a slugless category to the bare index (never an empty filter value)", () => {
    const crumbs = articleBreadcrumbs({
      ...base,
      blog_category: { name: "News", slug: "" },
    } as BlogFeedDetailItem);
    expect(crumbs[1]).toEqual({ label: "News", href: "/blog" });
  });

  it("omits the category crumb entirely when the post is uncategorized", () => {
    expect(
      articleBreadcrumbs({ ...base, blog_category: null } as BlogFeedDetailItem)
    ).toEqual([{ label: "Blog", href: "/blog" }]);
  });
});

describe("cgiEscape (Ruby CGI.escape parity)", () => {
  it("is the identity for friendly_id slugs", () => {
    expect(cgiEscape("ai-automation")).toBe("ai-automation");
  });

  it("encodes a space as + and escapes ~!*'() like Ruby, not encodeURIComponent", () => {
    expect(cgiEscape("a b")).toBe("a+b");
    expect(cgiEscape("~!*'()")).toBe("%7E%21%2A%27%28%29");
  });
});

describe("normalizedText", () => {
  it("collapses unicode whitespace and case for the standfirst-vs-title check", () => {
    expect(normalizedText("  AI Voice   Agents ")).toBe("ai voice agents");
  });
});

// --- Ruby<->JS string-semantics parity (R9 review fix F-P3) --------------------------------
//
// Ruby and JS disagree on two whitespace/dot questions, and each disagreement silently changed a
// heading anchor or a whole TOC entry on SPA navigation ONLY (first load, being Ruby, was always
// right). Every expectation below was produced by running the real Ruby `BlogDetailEntry`
// primitives on the same input - see R9-softnav-report.md, "Review fixes".
//
// Built with String.fromCharCode so this file stays pure ASCII: a literal U+2028 in source is a
// line terminator to older parsers and would be invisible in review.
const LINE_SEPARATOR = String.fromCharCode(0x2028); // Ruby [[:space:]] Y | JS \s Y | Ruby "." Y | JS "." N
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029); // same profile as U+2028
const ZWNBSP = String.fromCharCode(0xfeff); // BOM - Ruby [[:space:]] N | JS \s Y
const NEXT_LINE = String.fromCharCode(0x0085); // NEL - Ruby [[:space:]] Y | JS \s N

describe("Ruby/JS whitespace parity (RUBY_POSIX_SPACE, not /\\s/u)", () => {
  it("slugify leaves U+FEFF for the [^\\w-] pass to delete (Ruby: 'ab', not 'a-b')", () => {
    expect(slugify(`A${ZWNBSP}B`)).toBe("ab");
  });

  it("slugify treats U+0085 NEL as whitespace (Ruby: 'a-b', not 'ab')", () => {
    expect(slugify(`A${NEXT_LINE}B`)).toBe("a-b");
  });

  it("slugify still collapses the separators both languages agree on", () => {
    expect(slugify(`Line${LINE_SEPARATOR}Sep heading`)).toBe("line-sep-heading");
    expect(slugify(`Feff${ZWNBSP} heading`)).toBe("feff-heading");
  });

  it("normalizedText keeps U+FEFF and collapses U+0085, exactly like Ruby", () => {
    expect(normalizedText(`A${ZWNBSP}B`)).toBe(`a${ZWNBSP}b`);
    expect(normalizedText(`A${NEXT_LINE}B`)).toBe("a b");
  });

  it("a BOM inside the summary keeps it from counting as a restatement of the title", () => {
    // Ruby: normalized summary "unicode<BOM>separators" != normalized title "unicode separators",
    // so description/subtitle/summary survive. With JS /\s+/u the BOM collapsed to a space, the
    // two normalized equal, and the SPA path dropped the standfirst the server had rendered.
    const props = mapBlogDetailToArticleProps({
      id: 1,
      title: "Unicode Separators",
      summary: `Unicode${ZWNBSP}Separators`,
      body: "Body.\n",
      published_at: "2026-04-03T12:00:00Z",
    } as unknown as BlogFeedDetailItem);

    expect(props.description).toBe(`Unicode${ZWNBSP}Separators`);
    expect(props.subtitle).toBe(`Unicode${ZWNBSP}Separators`);
  });
});

describe("HEADING_LINE uses [^\\n], not '.' (U+2028 / U+2029 headings)", () => {
  it("keeps an H2 that contains U+2028 LINE SEPARATOR", () => {
    const body = `Intro.\n\n## Line${LINE_SEPARATOR}Separated Heading\n\nBody.\n`;

    expect(articleSections(body)).toEqual([
      { id: "line-separated-heading", title: `Line${LINE_SEPARATOR}Separated Heading` },
    ]);
  });

  it("keeps an H2 that contains U+2029 PARAGRAPH SEPARATOR", () => {
    const body = `## Para${PARAGRAPH_SEPARATOR}Separated Heading\n`;

    expect(articleSections(body).map((section) => section.id)).toEqual([
      "para-separated-heading",
    ]);
  });

  it("keeps an H2 that contains a BOM, slugified the Ruby way", () => {
    const body = `## Byte${ZWNBSP}Order Mark\n`;

    expect(articleSections(body)).toEqual([
      { id: "byteorder-mark", title: `Byte${ZWNBSP}Order Mark` },
    ]);
  });

  it("still refuses headings inside fenced code and 4-space indents", () => {
    const body = ["```", `## fenced${LINE_SEPARATOR}heading`, "```", "    ## indented", ""].join(
      "\n"
    );

    expect(articleSections(body)).toEqual([]);
  });
});

describe("allowListedArticleLayout", () => {
  it("accepts exactly the six @opensite/ui longform layouts", () => {
    expect([...ARTICLE_LAYOUT_COMPONENT_IDS]).toEqual([
      "article-hero-prose",
      "article-sidebar-sticky",
      "article-toc-sidebar",
      "article-breadcrumb-social",
      "article-compact-toc",
      "article-chapters-author",
    ]);
    for (const id of ARTICLE_LAYOUT_COMPONENT_IDS) {
      expect(allowListedArticleLayout(id)).toBe(id);
    }
  });

  it("rejects unknown / blank / non-string ids so no unrenderable _type can be emitted", () => {
    expect(allowListedArticleLayout("article-bogus")).toBeUndefined();
    expect(allowListedArticleLayout("")).toBeUndefined();
    expect(allowListedArticleLayout(null)).toBeUndefined();
    expect(allowListedArticleLayout(undefined)).toBeUndefined();
  });
});

describe("mapBlogDetailToArticleProps — byline + omission rules", () => {
  const wire = fixture.cases[0].wire;

  it("drops author, publishDate, readTime and post.pubDate when show_byline is false", () => {
    const props = mapBlogDetailToArticleProps({
      ...wire,
      site_blog: { index_path: "/insights", show_byline: false },
    });

    expect(props.authorName).toBeUndefined();
    expect(props.author).toBeUndefined();
    expect(props.publishDate).toBeUndefined();
    expect(props.readTime).toBeUndefined();
    expect(props.post.pubDate).toBeUndefined();
    expect(props.post.authorName).toBeUndefined();
    // …but the article itself still renders.
    expect(props.title).toBe(wire.title);
    expect(props.markdownString).toBe(wire.body);
  });

  it("keeps the byline when the server omits site_blog altogether", () => {
    const { site_blog: _omitted, ...withoutSiteBlog } = wire;
    const props = mapBlogDetailToArticleProps(withoutSiteBlog as BlogFeedDetailItem);
    expect(props.authorName).toBe("Jordan H");
    expect(props.publishDate).toBe("Jul 1, 2026");
  });

  it("emits post.pubDate as a Unix-ms INTEGER (date-fns throws on strings)", () => {
    const props = mapBlogDetailToArticleProps(wire);
    expect(typeof props.post.pubDate).toBe("number");
    expect(props.post.pubDate).toBe(Date.parse("2026-07-01T09:00:00Z"));
  });

  it("suppresses description/subtitle/summary when the summary restates the title, but keeps post.description", () => {
    const props = mapBlogDetailToArticleProps({ ...wire, summary: "  ai VOICE agents " });
    expect(props.description).toBeUndefined();
    expect(props.subtitle).toBeUndefined();
    expect(props.summary).toBeUndefined();
    expect(props.post.description).toBe("  ai VOICE agents ");
  });

  it("omits the hero props (and post.image) when the post has no image", () => {
    const props = mapBlogDetailToArticleProps({
      ...wire,
      image_url: null,
      image_alt: "orphan alt",
    });
    expect(props.heroImageSrc).toBeUndefined();
    expect(props.heroImageAlt).toBeUndefined();
    expect(props.post.image).toBeUndefined();
  });

  it("keeps every tracking flag false (HeadingWithId scroll-spy stays off)", () => {
    const props = mapBlogDetailToArticleProps(wire);
    expect(props.enableTocTracking).toBe(false);
    expect(props.enableBackToTop).toBe(false);
    expect(props.enableChapterTracking).toBe(false);
  });

  it("drops related posts with no href (mirror of the Ruby filter_map)", () => {
    const props = mapBlogDetailToArticleProps({
      ...wire,
      related: [{ ...wire.related[0], link_path: "" }],
    });
    expect(props.articles).toEqual([]);
  });

  it("tolerates a partial payload with no tags / related arrays", () => {
    const partial = { ...wire } as Partial<BlogFeedDetailItem>;
    delete partial.blog_tags;
    delete partial.related;
    const props = mapBlogDetailToArticleProps(partial as BlogFeedDetailItem);
    expect(props.tags).toEqual([]);
    expect(props.articles).toEqual([]);
  });
});
