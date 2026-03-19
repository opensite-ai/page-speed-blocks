import type { ReactNode } from "react";

/**
 * Block definition for component rendering
 * Compatible with Chai design payloads but optimized for @opensite/ui components
 */
export interface Block {
  /** Unique block identifier */
  _id: string;
  /** Block type - maps to component name from @opensite/ui */
  _type: string;
  /** Optional human-readable name */
  _name?: string;
  /** Parent block ID (null for root blocks) */
  _parent?: string | null;
  /** HTML tag override */
  tag?: string;
  /** Tailwind CSS classes (can be pre-compiled or runtime) */
  styles?: string;
  /** Additional HTML attributes */
  styles_attrs?: Record<string, string | number | boolean | null>;
  /** Background image configuration */
  backgroundImage?: string;
  /** Text content */
  content?: string;
  /** Link configuration */
  link?: {
    href?: string;
    target?: string;
    rel?: string;
  };
  /** Image source */
  src?: string;
  /** Image alt text */
  alt?: string;
  /** Width (for images/videos) */
  width?: number | string;
  /** Height (for images/videos) */
  height?: number | string;
  /** Media reference for CDN integration */
  mediaReference?: {
    mediaRecordId?: number;
    mediaToken?: string;
    fallbackUrl?: string;
  };
  /** Additional component props */
  blockProps?: Record<string, unknown>;
  /** Allow any additional properties */
  [key: string]: unknown;
}

/**
 * Design payload containing block tree
 */
export interface DesignPayload {
  version: string;
  blocks: Block[];
}

/**
 * Context passed to block renderers
 */
export interface BlockRenderContext {
  /** All blocks in the payload */
  blocks: Block[];
  /** Function to render child blocks */
  renderChildren: (parentId: string) => ReactNode | ReactNode[] | null;
}

/**
 * Props for block renderer functions
 */
export interface BlockRendererProps {
  block: Block;
  context: BlockRenderContext;
}

/**
 * Block renderer function signature
 */
export type BlockRenderer = (props: BlockRendererProps) => ReactNode;

/**
 * Component registry entry
 */
export interface RegistryEntry {
  /** Component name */
  name: string;
  /** Renderer function */
  renderer: BlockRenderer;
  /** Optional metadata */
  metadata?: {
    category?: string;
    description?: string;
    version?: string;
  };
}
