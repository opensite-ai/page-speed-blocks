import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlocksRenderer } from "../core/renderer.js";
import { registerBlockRenderer } from "../registry/index.js";
import type { Block } from "../types/index.js";

describe("BlocksRenderer", () => {
  it("renders a simple block tree", () => {
    const blocks: Block[] = [
      {
        _id: "1",
        _type: "Box",
        styles: "test-class",
        content: "Hello World",
      },
    ];

    const { container } = render(<BlocksRenderer blocks={blocks} />);
    expect(container.textContent).toContain("Hello World");
  });

  it("renders nested blocks", () => {
    const blocks: Block[] = [
      {
        _id: "parent",
        _type: "Box",
        styles: "parent-class",
        content: "Parent",
      },
      {
        _id: "child",
        _type: "Box",
        _parent: "parent",
        styles: "child-class",
        content: "Child",
      },
    ];

    const { container } = render(<BlocksRenderer blocks={blocks} />);
    expect(container.textContent).toContain("Parent");
    expect(container.textContent).toContain("Child");
  });

  it("handles custom block renderer", () => {
    registerBlockRenderer("CustomBlock", ({ block }) => {
      return <div data-testid="custom">{block.content}</div>;
    });

    const blocks: Block[] = [
      {
        _id: "1",
        _type: "CustomBlock",
        content: "Custom Content",
      },
    ];

    render(<BlocksRenderer blocks={blocks} />);
    expect(screen.getByTestId("custom")).toHaveTextContent("Custom Content");
  });

  it("handles empty blocks array", () => {
    const { container } = render(<BlocksRenderer blocks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("applies CSS classes from styles", () => {
    const blocks: Block[] = [
      {
        _id: "1",
        _type: "Box",
        styles: "p-4 bg-gray-100",
        content: "Styled",
      },
    ];

    const { container } = render(<BlocksRenderer blocks={blocks} />);
    const element = container.querySelector(".p-4.bg-gray-100");
    expect(element).toBeTruthy();
  });

  it("handles #styles: prefix", () => {
    const blocks: Block[] = [
      {
        _id: "1",
        _type: "Box",
        styles: "#styles:,p-4 bg-gray-100",
        content: "Styled",
      },
    ];

    const { container } = render(<BlocksRenderer blocks={blocks} />);
    const element = container.querySelector(".p-4.bg-gray-100");
    expect(element).toBeTruthy();
  });
});
