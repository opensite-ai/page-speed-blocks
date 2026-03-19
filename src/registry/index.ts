import type { BlockRenderer } from "../types/index.js";

/**
 * Global block renderer registry
 * Maps block type names to renderer functions
 */
const rendererRegistry = new Map<string, BlockRenderer>();

/**
 * Register a block renderer
 */
export function registerBlockRenderer(type: string, renderer: BlockRenderer): void {
  rendererRegistry.set(type, renderer);
}

/**
 * Get a block renderer by type
 */
export function getBlockRenderer(type: string): BlockRenderer | undefined {
  return rendererRegistry.get(type);
}

/**
 * Check if a renderer is registered for a type
 */
export function hasBlockRenderer(type: string): boolean {
  return rendererRegistry.has(type);
}

/**
 * Unregister a block renderer
 */
export function unregisterBlockRenderer(type: string): boolean {
  return rendererRegistry.delete(type);
}

/**
 * Clear all registered renderers
 */
export function clearRegistry(): void {
  rendererRegistry.clear();
}

/**
 * Get all registered renderer types
 */
export function getRegisteredTypes(): string[] {
  return Array.from(rendererRegistry.keys());
}

/**
 * Batch register multiple renderers
 */
export function registerRenderers(renderers: Record<string, BlockRenderer>): void {
  for (const [type, renderer] of Object.entries(renderers)) {
    registerBlockRenderer(type, renderer);
  }
}
