import React from "react";
import { RouterProvider } from "@page-speed/router";

/**
 * BlocksProvider wraps children with necessary providers for rendering
 * This includes RouterProvider for Pressable components to work properly
 */
export interface BlocksProviderProps {
  children: React.ReactNode;
  /** Optional: disable router provider (for apps that already have it) */
  disableRouter?: boolean;
}

export const BlocksProvider: React.FC<BlocksProviderProps> = ({
  children,
  disableRouter = false,
}) => {
  if (disableRouter) {
    return <>{children}</>;
  }

  return <RouterProvider>{children}</RouterProvider>;
};

export default BlocksProvider;