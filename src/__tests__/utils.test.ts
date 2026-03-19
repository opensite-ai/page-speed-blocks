import { describe, it, expect } from "vitest";
import {
  extractClassName,
  normalizeAttributes,
  getRootBlocks,
  getChildBlocks,
  parseDesignPayload,
} from "../utils/index.js";
import type { Block } from "../types/index.js";

describe("Utils", () => {
  describe("extractClassName", () => {
    it("extracts plain classes", () => {
      expect(extractClassName("p-4 bg-gray-100")).toBe("p-4 bg-gray-100");
    });

    it("handles #styles: prefix", () => {
      expect(extractClassName("#styles:,p-4 bg-gray-100")).toBe("p-4 bg-gray-100");
    });

    it("handles undefined styles", () => {
      expect(extractClassName(undefined)).toBe("");
    });

    it("trims whitespace", () => {
      expect(extractClassName("  p-4  ")).toBe("p-4");
    });
  });

  describe("normalizeAttributes", () => {
    it("filters out null values", () => {
      const attrs = { a: "value", b: null, c: undefined };
      const result = normalizeAttributes(attrs);
      expect(result).toEqual({ a: "value" });
    });

    it("handles empty object", () => {
      expect(normalizeAttributes({})).toEqual({});
    });

    it("handles undefined", () => {
      expect(normalizeAttributes(undefined)).toEqual({});
    });
  });

  describe("getRootBlocks", () => {
    it("returns blocks with no parent", () => {
      const blocks: Block[] = [
        { _id: "1", _type: "Box" },
        { _id: "2", _type: "Box", _parent: "1" },
        { _id: "3", _type: "Box", _parent: null },
      ];

      const roots = getRootBlocks(blocks);
      expect(roots.length).toBe(2);
      expect(roots.map((b) => b._id)).toEqual(["1", "3"]);
    });
  });

  describe("getChildBlocks", () => {
    it("returns children of a parent", () => {
      const blocks: Block[] = [
        { _id: "1", _type: "Box" },
        { _id: "2", _type: "Box", _parent: "1" },
        { _id: "3", _type: "Box", _parent: "1" },
        { _id: "4", _type: "Box", _parent: "2" },
      ];

      const children = getChildBlocks(blocks, "1");
      expect(children.length).toBe(2);
      expect(children.map((b) => b._id)).toEqual(["2", "3"]);
    });
  });

  describe("parseDesignPayload", () => {
    it("parses JSON string", () => {
      const json = JSON.stringify({ blocks: [{ _id: "1", _type: "Box" }] });
      const result = parseDesignPayload(json);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]._id).toBe("1");
    });

    it("handles object input", () => {
      const obj = { blocks: [{ _id: "1", _type: "Box" }] };
      const result = parseDesignPayload(obj);
      expect(result.blocks).toHaveLength(1);
    });

    it("handles invalid JSON", () => {
      const result = parseDesignPayload("invalid json");
      expect(result.blocks).toEqual([]);
    });
  });
});
