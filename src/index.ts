/**
 * @page-speed/blocks
 *
 * High-performance rendering runtime for @opensite/ui components
 * with pre-compiled Tailwind CSS and tree-shakable architecture
 */

// Re-export core components
export {
  BlocksRenderer,
  genericBlockRenderer,
  renderBlock,
  BlocksProvider,
  EnhancedBlocksRenderer
} from "./core/index.js";

export type {
  BlocksRendererProps,
  BlocksProviderProps,
  EnhancedBlocksRendererProps
} from "./core/index.js";

// Re-export registry functions
export {
  registerBlockRenderer,
  getBlockRenderer,
  hasBlockRenderer,
  unregisterBlockRenderer,
  clearRegistry,
  getRegisteredTypes,
  registerRenderers,
} from "./registry/index.js";

// Re-export types
export type {
  Block,
  DesignPayload,
  BlockRenderContext,
  BlockRendererProps,
  BlockRenderer,
  RegistryEntry,
} from "./types/index.js";

// Re-export utilities
export {
  extractClassName,
  normalizeAttributes,
  extractBackgroundStyle,
  getRootBlocks,
  getChildBlocks,
  buildElementProps,
  parseDesignPayload,
} from "./utils/index.js";

// Re-export custom renderers
export {
  pressableRenderer,
  PRESSABLE_BLOCK_TYPES,
  buttonRenderer,
  BUTTON_BLOCK_TYPES,
  linkRenderer,
  LINK_BLOCK_TYPES,
} from "./renderers/index.js";

// Re-export UI components directly from dependencies
export { Pressable } from "@page-speed/pressable";

// Import for side effects - register default renderers
import { registerBlockRenderer } from "./registry/index.js";
import {
  pressableRenderer,
  PRESSABLE_BLOCK_TYPES,
  buttonRenderer,
  BUTTON_BLOCK_TYPES,
  linkRenderer,
  LINK_BLOCK_TYPES,
} from "./renderers/index.js";

/**
 * Initialize default renderers for common block types
 */
export function initializeDefaultRenderers(): void {
  // Register Pressable renderer for multiple types
  PRESSABLE_BLOCK_TYPES.forEach(type => {
    registerBlockRenderer(type, pressableRenderer);
  });

  // Register Button renderer
  BUTTON_BLOCK_TYPES.forEach(type => {
    registerBlockRenderer(type, buttonRenderer);
  });

  // Register Link renderer
  LINK_BLOCK_TYPES.forEach(type => {
    registerBlockRenderer(type, linkRenderer);
  });
}

// Auto-initialize if in browser environment
if (typeof window !== "undefined" && typeof document !== "undefined") {
  // Allow opt-out via global flag
  if (!(window as any).__PAGE_SPEED_BLOCKS_NO_AUTO_INIT__) {
    initializeDefaultRenderers();
  }
}

/**
 * Default export - EnhancedBlocksRenderer component
 * This version includes RouterProvider for Pressable components
 */
export { EnhancedBlocksRenderer as default } from "./core/index.js";
