/**
 * Basic Usage Example for @page-speed/blocks
 *
 * This example demonstrates how to use the BlocksRenderer component
 * to render a simple block tree.
 */

import React from "react";
import { BlocksRenderer, registerBlockRenderer } from "@page-speed/blocks";
import type { Block } from "@page-speed/blocks/types";

// Example 1: Simple block rendering
export function SimpleExample() {
  const blocks: Block[] = [
    {
      _id: "hero",
      _type: "Box",
      styles: "bg-gradient-to-r from-blue-500 to-purple-600 text-white p-12 rounded-lg shadow-xl",
      content: "Welcome to Page Speed Blocks!",
    },
  ];

  return <BlocksRenderer blocks={blocks} />;
}

// Example 2: Nested blocks
export function NestedExample() {
  const blocks: Block[] = [
    {
      _id: "container",
      _type: "Box",
      styles: "max-w-4xl mx-auto p-8",
    },
    {
      _id: "heading",
      _type: "Heading",
      _parent: "container",
      tag: "h1",
      styles: "text-4xl font-bold mb-4",
      content: "High Performance Rendering",
    },
    {
      _id: "description",
      _type: "Paragraph",
      _parent: "container",
      styles: "text-lg text-gray-600",
      content: "Built for speed with pre-compiled Tailwind CSS support.",
    },
  ];

  return <BlocksRenderer blocks={blocks} />;
}

// Example 3: Custom block renderer
registerBlockRenderer("CustomCard", ({ block, context }) => {
  return (
    <div className="border rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
      <h3 className="text-xl font-semibold mb-2">{block.content}</h3>
      <div className="text-gray-600">
        {context.renderChildren(block._id)}
      </div>
    </div>
  );
});

export function CustomRendererExample() {
  const blocks: Block[] = [
    {
      _id: "card-1",
      _type: "CustomCard",
      content: "Feature 1",
    },
    {
      _id: "card-1-desc",
      _type: "Paragraph",
      _parent: "card-1",
      content: "Description of feature 1",
    },
  ];

  return <BlocksRenderer blocks={blocks} />;
}

// Example 4: Integration with @opensite/ui
import { registerRenderers } from "@page-speed/blocks/registry";

// Register renderers for @opensite/ui components
registerRenderers({
  "ButtonPrimary": ({ block }) => (
    <button className={block.styles || "btn-primary"}>
      {block.content}
    </button>
  ),
  "HeroSplit": ({ block, context }) => (
    <section className={block.styles || "hero-split"}>
      {context.renderChildren(block._id)}
    </section>
  ),
});

export function OpenSiteUIExample() {
  const blocks: Block[] = [
    {
      _id: "hero",
      _type: "HeroSplit",
      styles: "grid grid-cols-2 gap-8 py-12",
    },
    {
      _id: "cta",
      _type: "ButtonPrimary",
      _parent: "hero",
      styles: "bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700",
      content: "Get Started",
    },
  ];

  return <BlocksRenderer blocks={blocks} />;
}
