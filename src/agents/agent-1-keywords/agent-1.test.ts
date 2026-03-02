import { describe, it, expect } from "@jest/globals";
import {
  expandKeywordTemplates,
  getKeywordTemplates,
  loadCandidateCitiesFromDeploymentCandidates,
  normalizeUrlMapping,
} from "./index.js";

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

  describe("loadCandidateCitiesFromDeploymentCandidates", () => {
    it("loads ranked cities from deployment_candidates while prioritizing ideal markets", async () => {
      const db = {
        query: jest.fn().mockResolvedValue({
          rows: [
            {
              city: "Santa Cruz",
              state: "CA",
              population: 76000,
              market_type: "standalone_city",
              metro_parent: null,
            },
            {
              city: "Shawnee",
              state: "KS",
              population: 68000,
              market_type: "suburb",
              metro_parent: {
                city: "Kansas City",
                state: "MO",
                population: 510000,
                distance_miles: 12.4,
              },
            },
          ],
        }),
      };

      const result = await loadCandidateCitiesFromDeploymentCandidates("offer-123", db as any, 2);

      expect(result).toEqual([
        {
          city: "Santa Cruz",
          state: "CA",
          population: 76000,
          market_type: "standalone_city",
          cluster: null,
          metro_parent: null,
        },
        {
          city: "Shawnee",
          state: "KS",
          population: 68000,
          market_type: "suburb",
          cluster: null,
          metro_parent: {
            city: "Kansas City",
            state: "MO",
            population: 510000,
            distance_miles: 12.4,
          },
        },
      ]);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("FROM deployment_candidates"),
        ["offer-123", 2]
      );
    });
  });
});
