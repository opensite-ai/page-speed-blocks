import React, { Fragment, createElement, useMemo } from "react";
import type { Block, BlockRenderer, BlockRendererProps } from "../types/index.js";
import { getBlockRenderer } from "../registry/index.js";
import { buildElementProps, getChildBlocks, getRootBlocks } from "../utils/index.js";

/**
 * Default HTML tag mapping for common block types
 */
const DEFAULT_TAG_BY_TYPE: Record<string, string> = {
  Box: "div",
  Heading: "h2",
  Paragraph: "p",
  Span: "span",
  Text: "span",
  Link: "a",
  Button: "button",
  List: "ul",
  ListItem: "li",
  Icon: "span",
  Divider: "hr",
  Image: "div",
  Video: "div",
};

/**
 * Append children to existing array
 */
function appendChildren(
  existing: React.ReactNode[],
  children: React.ReactNode | React.ReactNode[] | null
): React.ReactNode[] {
  if (!children) return existing;
  if (Array.isArray(children)) {
    existing.push(...children);
  } else {
    existing.push(children);
  }
  return existing;
}

/**
 * Generic block renderer - fallback for blocks without custom renderers
 */
export const genericBlockRenderer: BlockRenderer = ({ block, context }) => {
  const tag = (block.tag as string | undefined) || DEFAULT_TAG_BY_TYPE[block._type] || "div";
  const elementProps = buildElementProps(block);

  const children: React.ReactNode[] = [];
  appendChildren(children, block.content as React.ReactNode);
  appendChildren(children, context.renderChildren(block._id));

  return createElement(tag, elementProps, children.length > 0 ? children : undefined);
};

/**
 * Render a single block using registered renderer or fallback
 */
export function renderBlock({ block, context }: BlockRendererProps): React.ReactNode {
  try {
    const customRenderer = getBlockRenderer(block._type) ?? getBlockRenderer("__fallback__");
    const renderer = customRenderer ?? genericBlockRenderer;
    return renderer({ block, context });
  } catch (error) {
    console.error(`Error rendering block ${block._id} of type ${block._type}:`, error);

    // Fallback to safe error state that still renders children
    const errorBlock = {
      ...block,
      _type: "Box",
      tag: "div",
      styles: "#styles:,border border-red-300 bg-red-50 p-2 m-1 rounded",
      content: `Error rendering block (${block._type})`,
    };
    return genericBlockRenderer({ block: errorBlock, context });
  }
}

/**
 * Props for BlocksRenderer component
 */
export interface BlocksRendererProps {
  /** Array of blocks to render */
  blocks: Block[];
  /** Optional CSS class for wrapper */
  className?: string;
  /** Optional wrapper component (defaults to div with display: contents) */
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}

/**
 * Main component that renders a block tree
 * Recursively processes parent-child relationships and applies registered renderers
 */
export const BlocksRenderer: React.FC<BlocksRendererProps> = ({
  blocks,
  className,
  wrapper: Wrapper
}) => {
  const rootBlocks = useMemo(() => getRootBlocks(blocks), [blocks]);

  const renderChildBlocks = (parentId: string): React.ReactNode[] | null => {
    const children = getChildBlocks(blocks, parentId);
    if (!children.length) return null;
    return children.map((child) => (
      <Fragment key={child._id}>{renderTree(child)}</Fragment>
    ));
  };

  const renderTree = (block: Block): React.ReactNode => {
    try {
      return renderBlock({
        block,
        context: {
          blocks,
          renderChildren: renderChildBlocks,
        },
      });
    } catch (error) {
      console.error(`Error rendering block tree for ${block._id}:`, error);
      return (
        <div className="border border-red-300 bg-red-50 p-2 m-1 rounded text-red-700">
          Error rendering block: {block._type} ({block._id})
        </div>
      );
    }
  };

  if (!rootBlocks.length) return null;

  const content = (
    <>
      {rootBlocks.map((block) => (
        <Fragment key={block._id}>{renderTree(block)}</Fragment>
      ))}
    </>
  );

  if (Wrapper) {
    return <Wrapper>{content}</Wrapper>;
  }

  return (
    <div className={className} style={{ display: "contents" }}>
      {content}
    </div>
  );
};

/**
 * Default export for convenience
 */
export default BlocksRenderer;
