import React from "react";
import { Pressable } from "@page-speed/pressable";
import type { BlockRenderer } from "../types/index.js";

interface LinkBlockProps {
  href?: string;
  target?: string;
  rel?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  children?: React.ReactNode;
  [key: string]: any;
}

/**
 * Custom renderer for Link components
 * Renders as Pressable with href
 */
export const linkRenderer: BlockRenderer = ({ block, context }) => {
  const props = (block.props || {}) as LinkBlockProps;
  const {
    href,
    target,
    rel,
    variant = "link",
    size,
    className,
    children: blockChildren,
    ...restProps
  } = props;

  // Render children from block tree
  const treeChildren = context.renderChildren(block._id);

  // Combine block content, explicit children, and tree children
  const allChildren = [
    block.content,
    blockChildren,
    treeChildren
  ].filter(Boolean);

  return (
    <Pressable
      href={href}
      target={target}
      rel={rel}
      variant={variant}
      size={size}
      className={className}
      {...restProps}
    >
      {allChildren.length > 0 ? allChildren : null}
    </Pressable>
  );
};

export const LINK_BLOCK_TYPES = [
  "Link",
  "NavLink",
  "CTALink",
  "ExternalLink",
];