import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { resolveBlocks } from "../data/resolve-blocks.js";
import type { Block, BlogFeedDetailItem } from "../types/index.js";

/**
 * R9 REGRESSION — blog-detail soft navigation used to render a bare article.
 *
 * `_templates.blog_detail` is rendered by the client on SPA navigation, hydrated by
 * `resolveBlogPost`. Before R9 that resolver wrote only 8 THIN flat props
 * (`title, markdownString, author (a string), date, image, imageAlt, tags, articles`), of which
 * the six `@opensite/ui` article layouts declare exactly TWO (`title`, `markdownString`) — React
 * drops the rest — so clicking a card from /blog produced a headline + raw prose with no
 * breadcrumb, hero image, byline or TOC, while a hard refresh of the SAME url rendered the full
 * layout (server-composed by customer-sites `BlogDetailEntry`).
 *
 * Every assertion below fails against the pre-R9 resolver.
 */

interface ParityCase {
  wire: BlogFeedDetailItem;
}

// jsdom rewrites `import.meta.url` to an http URL, so resolve from the package root instead.
const FIXTURE_PATH = resolve(process.cwd(), "src/__tests__/fixtures/blog-detail-parity.json");
const detail = (
  JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { cases: ParityCase[] }
).cases[0].wire;

const BASE = "https://api.example.com";
const TOKEN = "tok";

function detailFetcher(payload: BlogFeedDetailItem): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ data: payload }),
    }) as Response) as typeof fetch;
}

/** The template dashtrack-ai bakes into `_templates.blog_detail` (chrome omitted). */
function detailTemplate(primaryType = "article-breadcrumb-social"): Block[] {
  return [
    {
      _id: "tpl_blog_detail_article",
      _type: primaryType,
      blockProps: { enableTocTracking: false, enableBackToTop: false },
      dataSource: { type: "blog_post", current: true },
    },
    {
      _id: "tpl_blog_detail_related",
      _type: "blog-related-articles",
      blockProps: {},
      dataSource: { type: "blog_post", current: true, bindTo: "articles" },
    },
  ];
}

async function resolveTemplate(
  payload: BlogFeedDetailItem,
  primaryType?: string
): Promise<Block[]> {
  return resolveBlocks(detailTemplate(primaryType), {
    baseUrl: BASE,
    websiteToken: TOKEN,
    fetcher: detailFetcher(payload),
    path: "/b/ai-voice-agents",
  });
}

describe("resolveBlogPost — SPA navigation renders the full article layout (R9)", () => {
  it("writes the FAT prop union, not the 8 thin props", async () => {
    const [article] = await resolveTemplate(detail);
    const props = article.blockProps as Record<string, unknown>;

    // The props that were MISSING before R9 — each one is a visible region of the page.
    expect(props.breadcrumbs).toEqual([
      { label: "Blog", href: "/insights" },
      { label: "AI Automation", href: "/insights?category_slug=ai-automation" },
    ]);
    expect(props.heroImageSrc).toBe(detail.image_url);
    expect(props.heroImageAlt).toBe(detail.image_alt);
    expect(props.publishDate).toBe("Jul 1, 2026");
    expect(props.authorName).toBe("Jordan H");
    expect(props.author).toEqual({ name: "Jordan H" });
    expect(props.readTime).toBe("1 min read");
    expect(props.currentPage).toBe(detail.title);
    expect(props.description).toBe(detail.summary);
    expect(props.subtitle).toBe(detail.summary);
    expect(props.summary).toBe(detail.summary);
    expect(props.dateFormat).toBe("MMMM d, yyyy");
    expect(props.sections).toEqual([
      { id: "what-an-ai-voice-agent-isand-isnt", title: "What an AI voice agent is—and isn't" },
      { id: "metrics", title: "Metrics that matter" },
    ]);
    expect(props.chapters).toHaveLength(2);

    // article-hero-prose reads its ENTIRE header out of this nested object.
    expect(props.post).toEqual({
      title: detail.title,
      description: detail.summary,
      authorName: "Jordan H",
      image: detail.image_url,
      pubDate: Date.parse("2026-07-01T09:00:00Z"),
    });
  });

  it("keeps the props the thin path already wrote (title / markdownString / tags / articles)", async () => {
    const [article] = await resolveTemplate(detail);
    const props = article.blockProps as Record<string, unknown>;

    expect(props.title).toBe(detail.title);
    expect(props.markdownString).toBe(detail.body);
    expect(props.tags).toEqual(["voice", "AI"]);
    expect(props.articles).toHaveLength(1);
    expect((props.articles as Array<Record<string, unknown>>)[0].href).toBe("/b/related-post");
  });

  it("no longer writes the flat `author` STRING / `date` / `image` props (first load never did)", async () => {
    const [article] = await resolveTemplate(detail);
    const props = article.blockProps as Record<string, unknown>;

    expect(typeof props.author).toBe("object");
    expect(props.date).toBeUndefined();
    expect(props.image).toBeUndefined();
    expect(props.imageAlt).toBeUndefined();
  });

  it("retains authored blockProps that the hydration does not own (§2.3 rule 1)", async () => {
    const blocks = detailTemplate();
    (blocks[0].blockProps as Record<string, unknown>).badgeLabel = "Authored";
    const [article] = await resolveBlocks(blocks, {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher: detailFetcher(detail),
      path: "/b/ai-voice-agents",
    });
    expect((article.blockProps as Record<string, unknown>).badgeLabel).toBe("Authored");
    expect(article.dataSource).toEqual({ type: "blog_post", current: true });
  });

  describe("per-post layout override (§5.3 precedence)", () => {
    it("swaps the PRIMARY block's _type to the allow-listed per-post layout", async () => {
      const [article, related] = await resolveTemplate(detail);
      // The fixture post requests article-hero-prose (exactly the live workflowrush case).
      expect(article._type).toBe("article-hero-prose");
      // The related block binds `articles` and is never swapped.
      expect(related._type).toBe("blog-related-articles");
    });

    it("keeps the template's site-default _type when the post requests nothing", async () => {
      const [article] = await resolveTemplate(
        { ...detail, article_layout: null },
        "article-toc-sidebar"
      );
      expect(article._type).toBe("article-toc-sidebar");
    });

    it("keeps the template's _type for an unknown id (no unrenderable _type can ship)", async () => {
      const [article] = await resolveTemplate(
        { ...detail, article_layout: "article-bogus" },
        "article-compact-toc"
      );
      expect(article._type).toBe("article-compact-toc");
    });

    it("keeps the template's _type on a pre-R9 server that omits article_layout", async () => {
      const { article_layout: _omitted, ...withoutLayout } = detail;
      const [article] = await resolveTemplate(withoutLayout as BlogFeedDetailItem);
      expect(article._type).toBe("article-breadcrumb-social");
    });
  });

  it("writes into `data` for AI-wire-shaped blocks (block_ref) and leaves _type alone", async () => {
    const block: Block = {
      _id: "w1",
      block_ref: "article/article-breadcrumb-social",
      data: { enableTocTracking: false },
      dataSource: { type: "blog_post", current: true },
    };
    const [out] = await resolveBlocks([block], {
      baseUrl: BASE,
      websiteToken: TOKEN,
      fetcher: detailFetcher(detail),
      path: "/b/ai-voice-agents",
    });

    expect((out.data as Record<string, unknown>).breadcrumbs).toBeDefined();
    expect((out.data as Record<string, unknown>).post).toBeDefined();
    expect(out.blockProps).toBeUndefined();
    expect(out._type).toBeUndefined();
  });
});
