/**
 * @page-speed/blocks
 *
 * High-performance rendering runtime for @opensite/ui components
 * with pre-compiled Tailwind CSS and tree-shakable architecture
 */

// Re-export core components
export { BlocksRenderer, genericBlockRenderer, renderBlock } from "./core/renderer.js";
export type { BlocksRendererProps } from "./core/renderer.js";

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

/**
 * Default export - BlocksRenderer component
 */
export { default } from "./core/renderer.js";
