import React from "react";
import { Pressable } from "@page-speed/pressable";
import type { BlockRenderer } from "../types/index.js";

interface ButtonBlockProps {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
  [key: string]: any;
}

/**
 * Custom renderer for Button components
 * Renders as Pressable with asButton=true
 */
export const buttonRenderer: BlockRenderer = ({ block, context }) => {
  const props = (block.props || {}) as ButtonBlockProps;
  const {
    variant = "default",
    size = "default",
    onClick,
    disabled,
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
      asButton={true}
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      className={className}
      {...restProps}
    >
      {allChildren.length > 0 ? allChildren : null}
    </Pressable>
  );
};

export const BUTTON_BLOCK_TYPES = [
  "Button",
  "SubmitButton",
  "ActionButton",
  "FormButton",
];