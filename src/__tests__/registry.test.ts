import { describe, it, expect, beforeEach } from "vitest";
import {
  registerBlockRenderer,
  getBlockRenderer,
  hasBlockRenderer,
  unregisterBlockRenderer,
  clearRegistry,
  getRegisteredTypes,
  registerRenderers,
} from "../registry/index.js";

describe("Registry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("registers and retrieves a renderer", () => {
    const renderer = () => null;
    registerBlockRenderer("TestBlock", renderer);
    expect(getBlockRenderer("TestBlock")).toBe(renderer);
  });

  it("checks if renderer exists", () => {
    const renderer = () => null;
    registerBlockRenderer("TestBlock", renderer);
    expect(hasBlockRenderer("TestBlock")).toBe(true);
    expect(hasBlockRenderer("NonExistent")).toBe(false);
  });

  it("unregisters a renderer", () => {
    const renderer = () => null;
    registerBlockRenderer("TestBlock", renderer);
    expect(unregisterBlockRenderer("TestBlock")).toBe(true);
    expect(hasBlockRenderer("TestBlock")).toBe(false);
  });

  it("clears all renderers", () => {
    registerBlockRenderer("Block1", () => null);
    registerBlockRenderer("Block2", () => null);
    clearRegistry();
    expect(getRegisteredTypes()).toEqual([]);
  });

  it("gets all registered types", () => {
    registerBlockRenderer("Block1", () => null);
    registerBlockRenderer("Block2", () => null);
    const types = getRegisteredTypes();
    expect(types.sort()).toEqual(["Block1", "Block2"]);
  });

  it("batch registers renderers", () => {
    const renderers = {
      Block1: () => null,
      Block2: () => null,
      Block3: () => null,
    };

    registerRenderers(renderers);
    expect(getRegisteredTypes().length).toBe(3);
    expect(hasBlockRenderer("Block1")).toBe(true);
    expect(hasBlockRenderer("Block2")).toBe(true);
    expect(hasBlockRenderer("Block3")).toBe(true);
  });
});
