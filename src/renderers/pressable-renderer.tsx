import React from "react";
import { Pressable } from "@page-speed/pressable";
import type { BlockRenderer } from "../types/index.js";

interface PressableBlockProps {
  href?: string;
  onClick?: () => void;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  asButton?: boolean;
  className?: string;
  children?: React.ReactNode;
  [key: string]: any;
}

/**
 * Custom renderer for Pressable components
 * Uses @page-speed/pressable directly instead of the @opensite/ui pass-through
 */
export const pressableRenderer: BlockRenderer = ({ block, context }) => {
  const props = (block.props || {}) as PressableBlockProps;
  const {
    href,
    onClick,
    variant = "default",
    size = "default",
    asButton = false,
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
      onClick={onClick}
      variant={variant}
      size={size}
      asButton={asButton}
      className={className}
      {...restProps}
    >
      {allChildren.length > 0 ? allChildren : null}
    </Pressable>
  );
};

// Register for multiple block types that might use Pressable
export const PRESSABLE_BLOCK_TYPES = [
  "Pressable",
  "PressableButton",
  "PressableLink",
  "CTAButton",
  "ActionButton",
];