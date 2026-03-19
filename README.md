# @page-speed/blocks

High-performance rendering runtime for `@opensite/ui` components with pre-compiled Tailwind CSS, RouterProvider integration for Pressable components, and tree-shakable architecture.

## Features

- **Performance-First**: Optimized for minimal bundle size and maximum runtime performance
- **Tree-Shakable**: Granular exports allow importing only what you need
- **Flexible Styling**: Works with both pre-compiled CSS and runtime Tailwind
- **Registry-Based**: Extensible component registry for custom renderers
- **RouterProvider Integration**: Automatic RouterProvider wrapping for Pressable components
- **Direct Pressable Usage**: Uses `@page-speed/pressable` directly for proper Tailwind styling
- **TypeScript**: Full type safety with comprehensive type definitions
- **React 18+**: Built for modern React with hooks and concurrent features

## Installation

```bash
pnpm add @page-speed/blocks
# or
npm install @page-speed/blocks
# or
yarn add @page-speed/blocks
```

### Peer Dependencies

```bash
pnpm add react react-dom @opensite/ui @page-speed/img @page-speed/video @page-speed/pressable @page-speed/router
```

## Quick Start

### Basic Usage

```tsx
import { BlocksRenderer } from "@page-speed/blocks";
import type { Block } from "@page-speed/blocks/types";

const blocks: Block[] = [
  {
    _id: "1",
    _type: "Box",
    styles: "p-4 bg-gray-100",
    content: "Hello World",
  },
];

function App() {
  return <BlocksRenderer blocks={blocks} />;
}
```

### Enhanced Usage (Recommended)

The `EnhancedBlocksRenderer` automatically wraps your blocks with `RouterProvider` from `@page-speed/router`, ensuring Pressable components work correctly:

```tsx
import { EnhancedBlocksRenderer } from "@page-speed/blocks";
import type { Block } from "@page-speed/blocks/types";

const blocks: Block[] = [
  {
    _id: "1",
    _type: "Button",
    props: {
      variant: "default",
      size: "lg",
      onClick: () => console.log("Clicked!"),
    },
    content: "Click Me",
  },
];

function App() {
  return <EnhancedBlocksRenderer blocks={blocks} />;
}
```

### Manual Provider Control

If your app already has a RouterProvider, you can disable the automatic wrapping:

```tsx
import { EnhancedBlocksRenderer } from "@page-speed/blocks";

function App() {
  return (
    <EnhancedBlocksRenderer
      blocks={blocks}
      disableRouter={true}  // App already has RouterProvider
    />
  );
}
```

## Core Concepts

### Block Structure

Blocks are the fundamental building units, compatible with Chai design payloads:

```typescript
interface Block {
  _id: string;              // Unique identifier
  _type: string;            // Component type (maps to renderer)
  _parent?: string | null;  // Parent block ID (null for root)
  styles?: string;          // Tailwind CSS classes
  content?: string;         // Text content
  props?: Record<string, any>; // Component-specific props
  // ... additional properties
}
```

### Built-in Renderers

The library includes optimized renderers for common component types that use `@page-speed/pressable` directly:

```typescript
// Automatically registered block types:
- Pressable, PressableButton, PressableLink, CTAButton, ActionButton
- Button, SubmitButton, FormButton
- Link, NavLink, CTALink, ExternalLink
```

These renderers ensure proper Tailwind styling by using the Pressable component from `@page-speed/pressable` directly instead of pass-through components.

### Component Registry

Extend the library with custom renderers:

```tsx
import { registerBlockRenderer } from "@page-speed/blocks/registry";

registerBlockRenderer("MyComponent", ({ block, context }) => {
  return (
    <div className={block.styles}>
      {block.content}
      {context.renderChildren(block._id)}
    </div>
  );
});
```

### Tree-Shakable Imports

Import only what you need for optimal bundle size:

```typescript
// Specific imports (recommended)
import { EnhancedBlocksRenderer } from "@page-speed/blocks/core/enhanced";
import { BlocksProvider } from "@page-speed/blocks/core/provider";
import { registerBlockRenderer } from "@page-speed/blocks/registry";
import type { Block } from "@page-speed/blocks/types";

// Custom renderers
import {
  pressableRenderer,
  buttonRenderer,
  linkRenderer
} from "@page-speed/blocks/renderers";

// Main export (includes all core functionality)
import {
  EnhancedBlocksRenderer,
  BlocksRenderer,
  registerBlockRenderer,
  initializeDefaultRenderers
} from "@page-speed/blocks";
```

## API Reference

### Components

#### `<EnhancedBlocksRenderer />`

The main component for rendering blocks with automatic RouterProvider wrapping:

```tsx
interface EnhancedBlocksRendererProps {
  blocks: Block[];           // Array of blocks to render
  className?: string;        // Optional CSS class for wrapper
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
  disableRouter?: boolean;   // Disable RouterProvider if app already has one
}
```

#### `<BlocksRenderer />`

Base renderer without RouterProvider (for advanced use cases):

```tsx
interface BlocksRendererProps {
  blocks: Block[];
  className?: string;
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}
```

#### `<BlocksProvider />`

Provider component for wrapping blocks with necessary context:

```tsx
interface BlocksProviderProps {
  children: React.ReactNode;
  disableRouter?: boolean;  // Optional: disable router provider
}
```

### Registry Functions

```typescript
// Register a custom renderer for a block type
registerBlockRenderer(type: string, renderer: BlockRenderer): void

// Get renderer for a specific type
getBlockRenderer(type: string): BlockRenderer | undefined

// Check if a renderer exists
hasBlockRenderer(type: string): boolean

// Remove a renderer
unregisterBlockRenderer(type: string): void

// Clear all custom renderers
clearRegistry(): void

// Get all registered types
getRegisteredTypes(): string[]

// Register multiple renderers at once
registerRenderers(renderers: Record<string, BlockRenderer>): void

// Initialize default renderers (auto-called in browser)
initializeDefaultRenderers(): void
```

### Utility Functions

```typescript
// Parse design payload string to blocks
parseDesignPayload(payload: string | DesignPayload): Block[]

// Get root blocks (no parent)
getRootBlocks(blocks: Block[]): Block[]

// Get child blocks of a parent
getChildBlocks(blocks: Block[], parentId: string): Block[]

// Build element props from block
buildElementProps(block: Block): Record<string, any>

// Extract className from styles string
extractClassName(styles?: string): string

// Extract background styles
extractBackgroundStyle(styles?: string): React.CSSProperties | undefined
```

## Pre-compiled CSS Support

For production environments, use pre-compiled Tailwind CSS:

```tsx
// In your HTML/layout
<link rel="stylesheet" href="https://cdn.example.com/tailwind.css" />

// Then use BlocksRenderer normally
<EnhancedBlocksRenderer blocks={blocks} />
```

The library automatically works with pre-compiled styles, ensuring all button variants and component styles are properly applied.

## Pressable Component Integration

The library includes direct integration with `@page-speed/pressable` for proper button and link styling:

```tsx
// This will use the optimized Pressable renderer
const buttonBlock: Block = {
  _id: "btn-1",
  _type: "Button",
  props: {
    variant: "default",
    size: "lg",
    onClick: () => console.log("Clicked!"),
  },
  content: "Click Me",
};

// Links also use Pressable
const linkBlock: Block = {
  _id: "link-1",
  _type: "Link",
  props: {
    href: "/about",
    variant: "link",
  },
  content: "Learn More",
};
```

## Advanced Usage

### Custom Block Renderer

```tsx
import { registerBlockRenderer } from "@page-speed/blocks";
import { Pressable } from "@page-speed/pressable";

registerBlockRenderer("CustomCTA", ({ block, context }) => {
  const { href, label, icon } = block.props || {};

  return (
    <Pressable
      href={href}
      variant="default"
      size="lg"
      className="my-custom-class"
    >
      {icon && <Icon name={icon} />}
      {label || block.content}
      {context.renderChildren(block._id)}
    </Pressable>
  );
});
```

### Server-Side Rendering

```tsx
import { renderToString } from "react-dom/server";
import { EnhancedBlocksRenderer } from "@page-speed/blocks";

const html = renderToString(
  <EnhancedBlocksRenderer blocks={blocks} />
);
```

### Dynamic Block Loading

```tsx
import { BlocksRenderer, parseDesignPayload } from "@page-speed/blocks";

async function loadAndRenderBlocks() {
  const response = await fetch("/api/blocks");
  const payload = await response.json();
  const blocks = parseDesignPayload(payload);

  return <BlocksRenderer blocks={blocks} />;
}
```

## Migration from @opensite/blocks

If migrating from `@opensite/blocks`:

1. Replace imports:
```typescript
// Before
import { BlocksRenderer } from "@opensite/blocks";

// After
import { EnhancedBlocksRenderer } from "@page-speed/blocks";
```

2. Use EnhancedBlocksRenderer for automatic RouterProvider:
```tsx
// Before
<BlocksRenderer blocks={blocks} />

// After
<EnhancedBlocksRenderer blocks={blocks} />
```

3. The library automatically uses `@page-speed/pressable` for button/link components, ensuring proper Tailwind styling.

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- React 17+ required

## Contributing

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

## License

BSD-3-Clause - see [LICENSE](./LICENSE) for details.