# @page-speed/blocks

High-performance rendering runtime for `@opensite/ui` components with pre-compiled Tailwind CSS and tree-shakable architecture.

## Features

- **Performance-First**: Optimized for minimal bundle size and maximum runtime performance
- **Tree-Shakable**: Granular exports allow importing only what you need
- **Flexible Styling**: Works with both pre-compiled CSS and runtime Tailwind
- **Registry-Based**: Extensible component registry for custom renderers
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
pnpm add react react-dom @opensite/ui @page-speed/img @opensite/video @page-speed/pressable
```

## Quick Start

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
  // ... additional properties
}
```

### Component Registry

The library uses a registry system to map block types to renderer functions:

```tsx
import { registerBlockRenderer } from "@page-speed/blocks/registry";

registerBlockRenderer("MyComponent", ({ block, context }) => {
  return <div className={block.styles}>{block.content}</div>;
});
```

### Tree-Shakable Imports

Import only what you need for optimal bundle size:

```typescript
// Specific imports (recommended)
import { BlocksRenderer } from "@page-speed/blocks/core/renderer";
import { registerBlockRenderer } from "@page-speed/blocks/registry";
import type { Block } from "@page-speed/blocks/types";

// Namespaced imports
import { BlocksRenderer } from "@page-speed/blocks/core";
import { registerBlockRenderer } from "@page-speed/blocks/registry";

// Main export (includes all core functionality)
import { BlocksRenderer, registerBlockRenderer } from "@page-speed/blocks";
```

## API Reference

### Components

#### `BlocksRenderer`

Main rendering component that processes block trees.

```tsx
interface BlocksRendererProps {
  blocks: Block[];
  className?: string;
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}
```

**Example:**

```tsx
<BlocksRenderer
  blocks={blocks}
  className="custom-wrapper"
  wrapper={CustomWrapperComponent}
/>
```

### Registry Functions

#### `registerBlockRenderer(type, renderer)`

Register a custom renderer for a block type.

```tsx
registerBlockRenderer("CustomBlock", ({ block, context }) => {
  return <div>{block.content}</div>;
});
```

#### `getBlockRenderer(type)`

Get a registered renderer by type.

```tsx
const renderer = getBlockRenderer("CustomBlock");
```

#### `hasBlockRenderer(type)`

Check if a renderer is registered.

```tsx
if (hasBlockRenderer("CustomBlock")) {
  // Renderer exists
}
```

#### `registerRenderers(renderers)`

Batch register multiple renderers.

```tsx
registerRenderers({
  Header: ({ block }) => <header>{block.content}</header>,
  Footer: ({ block }) => <footer>{block.content}</footer>,
});
```

### Utility Functions

#### `getRootBlocks(blocks)`

Get all root-level blocks (blocks with no parent).

#### `getChildBlocks(blocks, parentId)`

Get all child blocks of a specific parent.

#### `buildElementProps(block)`

Build React props from block configuration (handles styles, attrs, etc.).

#### `parseDesignPayload(payload)`

Parse a design payload from string or object format.

## Integration with @opensite/ui

This library is designed to work seamlessly with `@opensite/ui` components:

```tsx
import { registerBlockRenderer } from "@page-speed/blocks";
import { Button } from "@opensite/ui/blocks/button/button-primary";

registerBlockRenderer("ButtonPrimary", ({ block, context }) => {
  return (
    <Button
      href={block.link?.href}
      className={block.styles}
    >
      {block.content}
      {context.renderChildren(block._id)}
    </Button>
  );
});
```

## Advanced Usage

### Custom Wrapper Component

```tsx
function CustomWrapper({ children }: { children: React.ReactNode }) {
  return <div className="page-container">{children}</div>;
}

<BlocksRenderer blocks={blocks} wrapper={CustomWrapper} />
```

### Error Handling

The renderer includes built-in error boundaries that catch rendering errors and display fallback UI:

```tsx
// Errors are logged to console and display a red error box
// Children are still rendered when possible
```

### Generic Renderer

For blocks without custom renderers, the library uses a generic renderer that maps block types to HTML elements:

```tsx
import { genericBlockRenderer } from "@page-speed/blocks/core/renderer";

// Automatically handles: Box -> div, Heading -> h2, Paragraph -> p, etc.
```

## Performance Optimization

### Pre-compiled CSS

For maximum performance, pre-compile your Tailwind CSS:

1. Extract all `styles` from your blocks
2. Run Tailwind CLI to generate minimal CSS
3. Serve the compiled CSS file
4. Blocks will use the pre-compiled classes

### Tree Shaking

Import from specific paths to enable tree shaking:

```typescript
// Good - only imports what you need
import { BlocksRenderer } from "@page-speed/blocks/core/renderer";

// Less optimal - imports entire package
import { BlocksRenderer } from "@page-speed/blocks";
```

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  Block,
  BlockRenderer,
  BlockRenderContext,
  DesignPayload
} from "@page-speed/blocks/types";
```

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- React 17+ (React 18+ recommended)
- ES2022+ features

## License

BSD-3-Clause

## Contributing

See [CONTRIBUTING.md](https://github.com/opensite-ai/page-speed-blocks/blob/main/CONTRIBUTING.md)

## Support

- GitHub Issues: [github.com/opensite-ai/page-speed-blocks/issues](https://github.com/opensite-ai/page-speed-blocks/issues)
- Documentation: [opensite.ai/docs/page-speed-blocks](https://opensite.ai/docs/page-speed-blocks)
