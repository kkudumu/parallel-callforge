import { describe, it, expect } from "@jest/globals";
import { expandKeywordTemplates, getKeywordTemplates, normalizeUrlMapping } from "./index.js";

describe("Agent 1 - Keywords", () => {
  describe("expandKeywordTemplates", () => {
    it("expands city placeholder in templates", () => {
      const templates = ["{city} pest control", "exterminator in {city}"];
      const cities = ["Santa Cruz", "Atlanta"];
      const result = expandKeywordTemplates(templates, cities);
      expect(result).toContain("Santa Cruz pest control");
      expect(result).toContain("exterminator in Atlanta");
      expect(result).toHaveLength(4);
    });

    it("slugifies city names for URL-safe versions", () => {
      const templates = ["{city_slug} pest control"];
      const cities = ["San Francisco"];
      const result = expandKeywordTemplates(templates, cities);
      expect(result).toContain("san-francisco pest control");
    });
  });

  describe("getKeywordTemplates", () => {
    it("reuses cached templates when present", async () => {
      const db = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ templates: ["{city} pest control"] }] }),
      };
      const llm = {
        call: jest.fn(),
      };

      const result = await getKeywordTemplates("Pest-Control", llm as any, db as any);

      expect(result).toEqual(["{city} pest control"]);
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT templates"),
        ["pest-control"]
      );
      expect(llm.call).not.toHaveBeenCalled();
    });

    it("generates and saves templates on cache miss", async () => {
      const db = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      const llm = {
        call: jest.fn().mockResolvedValue({
          templates: Array.from({ length: 10 }, (_, index) => `template-${index}`),
        }),
      };

      const result = await getKeywordTemplates("pest-control", llm as any, db as any);

      expect(result).toHaveLength(10);
      expect(llm.call).toHaveBeenCalledTimes(1);
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query).toHaveBeenLastCalledWith(
        expect.stringContaining("INSERT INTO keyword_templates"),
        ["pest-control", result]
      );
    });
  });

  describe("normalizeUrlMapping", () => {
    it("keeps flat string mappings", () => {
      expect(
        normalizeUrlMapping({
          "/watsonville/": "watsonville pest control",
        })
      ).toEqual({
        "/watsonville/": "watsonville pest control",
      });
    });

    it("flattens object values into strings", () => {
      expect(
        normalizeUrlMapping({
          "/watsonville/": { primary_keyword: "watsonville pest control" },
          "/watsonville/rodent-control/": { path: "/watsonville/rodent-control/" },
          "/watsonville/termite-control/": {},
        })
      ).toEqual({
        "/watsonville/": "watsonville pest control",
        "/watsonville/rodent-control/": "/watsonville/rodent-control/",
        "/watsonville/termite-control/": "/watsonville/termite-control/",
      });
    });
  });
});
