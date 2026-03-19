# @page-speed/blocks Architecture

## Overview

`@page-speed/blocks` is a high-performance React rendering runtime designed to work with `@opensite/ui` components. It provides a flexible, tree-shakable architecture for rendering component trees from JSON design payloads with support for both pre-compiled and runtime Tailwind CSS.

## Core Principles

1. **Performance First**: Minimal bundle size, optimal runtime performance
2. **Tree-Shakable**: Granular exports allow importing only what you need
3. **Type Safe**: Full TypeScript coverage with comprehensive type definitions
4. **Extensible**: Registry-based system for custom component renderers
5. **Compatible**: Works seamlessly with Chai design payloads and @opensite/ui

## Architecture Layers

### 1. Type System (`src/types/`)

Defines the core data structures:

- **Block**: Base unit representing a component in the tree
- **DesignPayload**: Container for block trees with versioning
- **BlockRenderer**: Function signature for component renderers
- **BlockRenderContext**: Context passed to renderers with utility functions

### 2. Registry System (`src/registry/`)

Component registry that maps block types to renderer functions:

- **registerBlockRenderer**: Register a single renderer
- **registerRenderers**: Batch register multiple renderers
- **getBlockRenderer**: Retrieve a registered renderer
- **hasBlockRenderer**: Check if a renderer exists
- **clearRegistry**: Reset all renderers

**Design Pattern**: Singleton registry pattern with functional API

### 3. Core Renderer (`src/core/`)

Main rendering engine:

- **BlocksRenderer**: React component that processes block trees
- **renderBlock**: Function to render individual blocks
- **genericBlockRenderer**: Fallback renderer for unmapped block types

**Rendering Process**:
1. Parse block tree to find root blocks
2. Recursively render each block using registered renderers
3. Handle parent-child relationships via context
4. Apply styles, attributes, and props
5. Render children via callback

### 4. Utility Functions (`src/utils/`)

Helper functions for block manipulation:

- **extractClassName**: Parse Tailwind classes from styles string
- **normalizeAttributes**: Convert block attributes to React props
- **getRootBlocks**: Filter blocks with no parent
- **getChildBlocks**: Get children of a specific parent
- **buildElementProps**: Build React element props from block config
- **parseDesignPayload**: Parse JSON design payloads

## Data Flow

```
Design Payload (JSON)
        ↓
Parse & Normalize
        ↓
BlocksRenderer Component
        ↓
getRootBlocks()
        ↓
For each root block:
    ├── Lookup renderer in registry
    ├── Apply genericBlockRenderer if not found
    ├── Build element props
    ├── Render children via context callback
    └── Return React element
        ↓
Rendered Component Tree
```

## Block Tree Structure

Blocks are organized in a parent-child hierarchy:

```typescript
{
  _id: "unique-id",        // Unique identifier
  _type: "ComponentName",  // Maps to renderer
  _parent: "parent-id",    // null for root blocks
  styles: "tailwind classes",
  content: "text content",
  // ... additional props
}
```

**Key Relationships**:
- Root blocks: `_parent === null` or `_parent === undefined`
- Child blocks: `_parent === "<parent-id>"`
- Siblings: Same `_parent` value

## Styling Architecture

### Pre-compiled CSS (Recommended)

1. Extract all `styles` from blocks
2. Run Tailwind CLI to generate minimal CSS
3. Include CSS file in application
4. Blocks use pre-compiled classes

**Benefits**:
- Minimal runtime overhead
- Smaller bundle size
- Better caching
- Faster page loads

### Runtime Tailwind

1. Include Tailwind runtime in application
2. Blocks use dynamic classes
3. JIT compilation at runtime

**Trade-offs**:
- Larger bundle size
- More flexible for dynamic content
- Easier development workflow

## Tree Shaking

The package is designed for optimal tree shaking:

### Export Patterns

```typescript
// Specific imports (best for tree shaking)
import { BlocksRenderer } from "@page-speed/blocks/core/renderer";
import { registerBlockRenderer } from "@page-speed/blocks/registry";

// Namespaced imports (good)
import { BlocksRenderer } from "@page-speed/blocks/core";

// Barrel imports (less optimal but still tree-shakable)
import { BlocksRenderer, registerBlockRenderer } from "@page-speed/blocks";
```

### Bundle Size Breakdown

- **Core renderer**: ~4.5 KB
- **Registry system**: ~900 B
- **Utilities**: ~1.9 KB
- **Types**: ~70 B (declaration only)
- **Total (gzipped)**: ~2-3 KB for typical usage

## Extension Points

### 1. Custom Renderers

Register custom renderers for specific block types:

```typescript
registerBlockRenderer("MyComponent", ({ block, context }) => {
  return <MyComponent {...block} />;
});
```

### 2. Wrapper Components

Provide custom wrapper for rendered tree:

```typescript
<BlocksRenderer blocks={blocks} wrapper={CustomWrapper} />
```

### 3. Error Boundaries

Built-in error handling with fallback UI:

```typescript
// Errors are caught and rendered as red error boxes
// Children continue to render when possible
```

## Integration with @opensite/ui

The library is designed to work seamlessly with `@opensite/ui`:

```typescript
import { registerRenderers } from "@page-speed/blocks";
import { ButtonPrimary } from "@opensite/ui/blocks/button/button-primary";

registerRenderers({
  ButtonPrimary: ({ block }) => (
    <ButtonPrimary {...block.blockProps}>
      {block.content}
    </ButtonPrimary>
  ),
});
```

## Performance Optimizations

1. **Memoization**: Uses `useMemo` for expensive computations
2. **Lazy Loading**: Dynamic imports for renderers (future)
3. **Module Splitting**: Granular exports for tree shaking
4. **Zero Runtime Overhead**: Pre-compiled CSS eliminates style parsing
5. **Minimal Re-renders**: Optimized render tree traversal

## Testing Strategy

- **Unit Tests**: Individual functions and utilities
- **Component Tests**: Renderer behavior with React Testing Library
- **Integration Tests**: Full rendering pipeline
- **Type Tests**: TypeScript compilation and type checking

## Future Enhancements

1. **Lazy Renderer Loading**: Dynamic imports for large component sets
2. **Streaming SSR**: Support for React Server Components
3. **Caching Layer**: Memoization of rendered subtrees
4. **Performance Monitoring**: Built-in render time tracking
5. **Dev Tools**: Browser extension for block tree visualization

## Compatibility

- **React**: 17+ (18+ recommended)
- **TypeScript**: 5.0+
- **Build Tools**: Vite, Next.js, webpack, Rollup
- **Package Managers**: pnpm, npm, yarn
- **Node**: 18.0+

## Security Considerations

1. **Input Sanitization**: Blocks from untrusted sources should be validated
2. **XSS Prevention**: Content is escaped by React by default
3. **Type Safety**: TypeScript helps prevent runtime errors
4. **Dependency Audits**: Regular security audits of dependencies

## License

BSD-3-Clause (see LICENSE file)
