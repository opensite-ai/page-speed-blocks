import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlocksRenderer } from "../core/renderer.js";
import {
  clearRegistry,
  registerBlockRenderer,
  FEED_ERROR_RENDERER_KEY,
} from "../registry/index.js";
import { buttonRenderer } from "../renderers/button-renderer.js";
import type { Block } from "../types/index.js";

beforeEach(() => {
  clearRegistry();
});

describe("BlockRenderContext.data threading (§7.3)", () => {
  it("passes the BlocksRenderer `data` prop into context.data", () => {
    registerBlockRenderer("DataReader", ({ context }) => (
      <div data-testid="reader">{String(context.data?.greeting ?? "none")}</div>
    ));
    const blocks: Block[] = [{ _id: "1", _type: "DataReader" }];
    render(<BlocksRenderer blocks={blocks} data={{ greeting: "hello" }} />);
    expect(screen.getByTestId("reader")).toHaveTextContent("hello");
  });

  it("leaves context.data undefined when no data prop is provided", () => {
    registerBlockRenderer("DataReader", ({ context }) => (
      <div data-testid="reader">{context.data === undefined ? "undef" : "set"}</div>
    ));
    render(<BlocksRenderer blocks={[{ _id: "1", _type: "DataReader" }]} />);
    expect(screen.getByTestId("reader")).toHaveTextContent("undef");
  });
});

describe("blockProps shim in built-in renderers", () => {
  it("buttonRenderer reads canonical blockProps", () => {
    registerBlockRenderer("Button", buttonRenderer);
    const blocks: Block[] = [
      { _id: "1", _type: "Button", content: "Go", blockProps: { "data-testid": "via-blockprops" } },
    ];
    render(<BlocksRenderer blocks={blocks} />);
    expect(screen.getByTestId("via-blockprops")).toBeTruthy();
  });

  it("buttonRenderer falls back to the legacy props key", () => {
    registerBlockRenderer("Button", buttonRenderer);
    const blocks: Block[] = [
      { _id: "1", _type: "Button", content: "Go", props: { "data-testid": "via-legacy-props" } },
    ];
    render(<BlocksRenderer blocks={blocks} />);
    expect(screen.getByTestId("via-legacy-props")).toBeTruthy();
  });
});

describe("__feed_error__ renderer affordance (§7.3)", () => {
  it("routes error-state blocks to the feed error renderer when registered", () => {
    registerBlockRenderer("blog-grid", () => <div data-testid="normal">normal</div>);
    registerBlockRenderer(FEED_ERROR_RENDERER_KEY, () => (
      <div data-testid="feed-error">error</div>
    ));
    const blocks: Block[] = [
      { _id: "1", _type: "blog-grid", _feedMeta: { status: "error", source: "blog_feed" } },
    ];
    render(<BlocksRenderer blocks={blocks} />);
    expect(screen.getByTestId("feed-error")).toBeTruthy();
    expect(screen.queryByTestId("normal")).toBeNull();
  });

  it("renders the block normally when no feed error renderer is registered", () => {
    registerBlockRenderer("blog-grid", () => <div data-testid="normal">normal</div>);
    const blocks: Block[] = [
      { _id: "1", _type: "blog-grid", _feedMeta: { status: "error", source: "blog_feed" } },
    ];
    render(<BlocksRenderer blocks={blocks} />);
    expect(screen.getByTestId("normal")).toBeTruthy();
  });

  it("does not divert non-error feed states to the error renderer", () => {
    registerBlockRenderer("blog-grid", () => <div data-testid="normal">normal</div>);
    registerBlockRenderer(FEED_ERROR_RENDERER_KEY, () => (
      <div data-testid="feed-error">error</div>
    ));
    const blocks: Block[] = [
      { _id: "1", _type: "blog-grid", _feedMeta: { status: "empty", source: "blog_feed" } },
    ];
    render(<BlocksRenderer blocks={blocks} />);
    expect(screen.getByTestId("normal")).toBeTruthy();
    expect(screen.queryByTestId("feed-error")).toBeNull();
  });
});
