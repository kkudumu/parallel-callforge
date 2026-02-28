import { describe, it, expect } from "@jest/globals";
import { expandKeywordTemplates } from "./index.js";

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
});
