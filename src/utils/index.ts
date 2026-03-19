import type { Block } from "../types/index.js";

/**
 * Extract className from styles string
 * Handles both raw classes and #styles: prefixed format
 */
export function extractClassName(styles?: string): string {
  if (!styles) return "";

  // Handle #styles: prefix from Chai builder (format: #styles:,classes)
  if (styles.startsWith("#styles:")) {
    const withoutPrefix = styles.substring("#styles:".length);
    // Remove leading comma if present
    return withoutPrefix.startsWith(",") ? withoutPrefix.substring(1).trim() : withoutPrefix.trim();
  }

  return styles.trim();
}

/**
 * Normalize attributes object for React
 */
export function normalizeAttributes(
  attrs?: Record<string, string | number | boolean | null>
): Record<string, unknown> {
  if (!attrs) return {};

  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    normalized[key] = value;
  }

  return normalized;
}

/**
 * Extract background style from backgroundImage string
 */
export function extractBackgroundStyle(
  backgroundImage?: string
): Record<string, string> | null {
  if (!backgroundImage) return null;

  return {
    backgroundImage: `url(${backgroundImage})`,
  };
}

/**
 * Get root blocks (blocks with no parent)
 */
export function getRootBlocks(blocks: Block[]): Block[] {
  return blocks.filter((block) => !block._parent || block._parent === null);
}

/**
 * Get child blocks of a specific parent
 */
export function getChildBlocks(blocks: Block[], parentId: string): Block[] {
  return blocks.filter((block) => block._parent === parentId);
}

/**
 * Build element props from block configuration
 */
export function buildElementProps(block: Block): Record<string, unknown> {
  const className = extractClassName(block.styles);
  const attrs = normalizeAttributes(block.styles_attrs);
  const backgroundStyle = extractBackgroundStyle(block.backgroundImage);

  const elementProps: Record<string, unknown> = {
    className,
    ...attrs,
  };

  if (backgroundStyle) {
    elementProps.style = {
      ...(attrs?.style as Record<string, string | number> | undefined),
      ...backgroundStyle,
    };
  }

  if (block.blockProps && typeof block.blockProps === "object") {
    Object.assign(elementProps, block.blockProps);
  }

  return elementProps;
}

/**
 * Parse design payload (handles both string and object formats)
 */
export function parseDesignPayload(payload: string | object): { blocks: Block[] } {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch (error) {
      console.error("Failed to parse design payload:", error);
      return { blocks: [] };
    }
  }
  return payload as { blocks: Block[] };
}
