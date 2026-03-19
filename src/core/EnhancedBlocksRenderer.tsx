import React from "react";
import { BlocksRenderer, type BlocksRendererProps } from "./renderer.js";
import { BlocksProvider } from "./BlocksProvider.js";

/**
 * EnhancedBlocksRenderer automatically wraps the renderer with necessary providers
 * This ensures Pressable components from @page-speed/pressable work properly
 */
export interface EnhancedBlocksRendererProps extends BlocksRendererProps {
  /** Optional: disable router provider if app already has one */
  disableRouter?: boolean;
}

export const EnhancedBlocksRenderer: React.FC<EnhancedBlocksRendererProps> = ({
  blocks,
  className,
  wrapper,
  disableRouter = false,
}) => {
  return (
    <BlocksProvider disableRouter={disableRouter}>
      <BlocksRenderer blocks={blocks} className={className} wrapper={wrapper} />
    </BlocksProvider>
  );
};

export default EnhancedBlocksRenderer;