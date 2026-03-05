import { describe, it, expect } from "@jest/globals";
import { runQualityGate, BANNED_PHRASES, findPlaceholderTokens } from "./quality-gate.js";

const FILLER_WORDS = Array.from({ length: 1300 }, (_, index) => `word${index}`).join(" ");

// Enough phone references to satisfy the 3-mention minimum
const PHONE_REFS = "Call (555) 123-4567 today. Call our team now. Call for a free quote.";

// 4 city mentions (minWordCount >= 1000 requires 4) + phone refs — used as tail for all "should pass" tests
const PASS_TAIL = `${PHONE_REFS} Santa Cruz pest control services here. Santa Cruz homeowners call us. Santa Cruz specialists stand by. Santa Cruz service available.`;

describe("Quality Gate", () => {
  // ─────────────────────────────────────────────────────────────────
  // Existing baseline tests (preserved + updated for phone_count_low)
  // ─────────────────────────────────────────────────────────────────

  it("passes content that meets all criteria", () => {
    const content = `${FILLER_WORDS} Santa Cruz pest control services available here. Call (831) 555-1234 for inspections. Santa Cruz homeowners call our team anytime. Santa Cruz neighborhoods need seasonal treatments. Call now for Santa Cruz service.`;
    const result = runQualityGate(content, "Santa Cruz", 1200);
    expect(result.passed).toBe(true);
  });

  it("fails content with sparse city mentions", () => {
    const content = FILLER_WORDS + " Santa Cruz pest control services available here.";
    const result = runQualityGate(content, "Santa Cruz", 1200);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("city_name_sparse");
  });

  it("fails content with banned AI phrases", () => {
    const content = "It is important to note that pest control in Santa Cruz requires attention. " + FILLER_WORDS;
    const result = runQualityGate(content, "Santa Cruz", 1200);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("banned_phrases");
  });

  it("fails content below minimum word count", () => {
    const content = "Short content about Santa Cruz pest control.";
    const result = runQualityGate(content, "Santa Cruz", 800);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("word_count");
  });

  it("fails content missing city name", () => {
    const content = FILLER_WORDS + " pest control services are available.";
    const result = runQualityGate(content, "Santa Cruz", 800);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("city_name_missing");
  });

  it("fails repetitive content with weak uniqueness", () => {
    const sentence = "Santa Cruz pest control helps homeowners stop ants and rodents fast";
    const content = Array(180).fill(sentence).join(". ") + ".";
    const result = runQualityGate(content, "Santa Cruz", 800);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("low_uniqueness");
    expect(result.failures).toContain("repeated_sentences");
  });

  it("fails content that still contains placeholder tokens", () => {
    const content = `${FILLER_WORDS} Santa Cruz pest control starts here. Call [PHONE] today for Santa Cruz service. Santa Cruz experts are ready.`;
    const result = runQualityGate(content, "Santa Cruz", 800, ["{domain}", "TODO"]);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("placeholder_tokens");
    expect(result.metrics.placeholdersFound).toEqual(expect.arrayContaining(["[PHONE]", "{domain}", "TODO"]));
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 1.3: Phone number count validation
  // ─────────────────────────────────────────────────────────────────

  describe("Task 1.3 — Phone mention count", () => {
    it("passes when phone mentions equal minimum (exactly 3 call words)", () => {
      const content = `${FILLER_WORDS} Santa Cruz pest control. Call for service. Santa Cruz homeowners call us. Call Santa Cruz team today.`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.failures).not.toContain("phone_count_low");
      expect(result.metrics.phoneMentionCount).toBeGreaterThanOrEqual(3);
    });

    it("passes with tel: href references counting toward total", () => {
      const content = `${FILLER_WORDS} Santa Cruz pest control <a href="tel:5551234567">call</a>. <a href="tel:5551234567">call us</a>. Santa Cruz call today. Santa Cruz team ready.`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.metrics.phoneMentionCount).toBeGreaterThanOrEqual(3);
    });

    it("passes with formatted phone number patterns", () => {
      const content = `${FILLER_WORDS} Santa Cruz pest control. Call (555) 123-4567 now. (555) 123-4567 available. Santa Cruz team at 555.123.4567. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.metrics.phoneMentionCount).toBeGreaterThanOrEqual(3);
      expect(result.failures).not.toContain("phone_count_low");
    });

    it("fails when phone mentions are below minimum", () => {
      const content = `${FILLER_WORDS} Santa Cruz pest control services available here. Santa Cruz homeowners need help. Santa Cruz team is local.`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.passed).toBe(false);
      expect(result.failures).toContain("phone_count_low");
      expect(result.metrics.phoneMentionCount).toBeLessThan(3);
    });

    it("fails content with zero phone mentions", () => {
      const content = `${FILLER_WORDS} Santa Cruz pest control. Santa Cruz homeowners reach out. Santa Cruz service is available now.`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.failures).toContain("phone_count_low");
      expect(result.metrics.phoneMentionCount).toBe(0);
    });

    it("respects custom phoneMinMentions parameter", () => {
      // Content with exactly 1 phone mention — should pass with minimum=1 but fail with minimum=3
      const content = `${FILLER_WORDS} Santa Cruz pest control. Call us now. Santa Cruz homeowners need help. Santa Cruz team is local.`;
      const resultStrict = runQualityGate(content, "Santa Cruz", 1200, [], 3);
      expect(resultStrict.failures).toContain("phone_count_low");

      const resultLenient = runQualityGate(content, "Santa Cruz", 1200, [], 1);
      expect(resultLenient.failures).not.toContain("phone_count_low");
    });

    it("passes with phoneMinMentions=0 regardless of content", () => {
      const content = `${FILLER_WORDS} Santa Cruz pest control. Santa Cruz homeowners. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 0);
      expect(result.failures).not.toContain("phone_count_low");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 1.5: Supplemental texts banned phrase scanning
  // ─────────────────────────────────────────────────────────────────

  describe("Task 1.5 — Supplemental texts banned phrase check", () => {
    it("catches banned phrase in supplemental title field", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Santa Cruz homeowners. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200, ["It is important to note: Santa Cruz pest control"]);
      expect(result.passed).toBe(false);
      expect(result.failures).toContain("banned_phrases");
      expect(result.metrics.bannedPhrasesFound).toContain("it is important to note");
    });

    it("catches banned phrase in supplemental description field", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Santa Cruz homeowners. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200, ["In conclusion, our pest control services are best"]);
      expect(result.failures).toContain("banned_phrases");
      expect(result.metrics.bannedPhrasesFound).toContain("in conclusion");
    });

    it("catches banned phrase in supplemental h1 field", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Santa Cruz homeowners. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200, ["Santa Cruz", "When it comes to pest control in Santa Cruz"]);
      expect(result.failures).toContain("banned_phrases");
    });

    it("passes when supplemental texts are clean", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Santa Cruz homeowners. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200, ["Best Pest Control in Santa Cruz, CA", "Professional service available"]);
      expect(result.failures).not.toContain("banned_phrases");
    });

    it("catches placeholder tokens in supplemental texts", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Santa Cruz homeowners. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200, ["{domain}", "TODO"]);
      expect(result.failures).toContain("placeholder_tokens");
      expect(result.metrics.placeholdersFound).toContain("{domain}");
      expect(result.metrics.placeholdersFound).toContain("TODO");
    });

    it("reports banned phrase field name via bannedPhrasesFound array", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Santa Cruz homeowners. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200, ["dive into Santa Cruz pest control services"]);
      expect(result.metrics.bannedPhrasesFound).toContain("dive into");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 2.7: Flesch-Kincaid reading grade validation (warnings only)
  // ─────────────────────────────────────────────────────────────────

  describe("Task 2.7 — Reading grade validation (warnings)", () => {
    it("emits no reading grade warning when grade is within target range", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      // First compute actual grade, then set a wide range around it so no warning fires
      const probe = runQualityGate(content, "Santa Cruz", 1200);
      const actualGrade = probe.metrics.readingGrade;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, {
        target_grade_min: Math.floor(actualGrade) - 5,
        target_grade_max: Math.ceil(actualGrade) + 5,
      });
      const gradeWarnings = result.warnings.filter((w) => w.startsWith("reading_grade_out_of_range"));
      expect(gradeWarnings).toHaveLength(0);
    });

    it("emits reading_grade_out_of_range warning when grade is outside range", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      // Set a very narrow impossible range to force the warning
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, { target_grade_min: 99, target_grade_max: 100 });
      const gradeWarnings = result.warnings.filter((w) => w.startsWith("reading_grade_out_of_range"));
      expect(gradeWarnings).toHaveLength(1);
      expect(gradeWarnings[0]).toMatch(/grade=\d+\.\d/);
      expect(gradeWarnings[0]).toMatch(/target=99-100/);
    });

    it("does not fail (only warns) when reading grade is out of range", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, { target_grade_min: 99, target_grade_max: 100 });
      expect(result.passed).toBe(true);
      expect(result.failures).not.toContain("reading_grade_out_of_range");
    });

    it("includes computed reading grade in metrics", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(typeof result.metrics.readingGrade).toBe("number");
      expect(result.metrics.readingGrade).toBeGreaterThanOrEqual(0);
    });

    it("does not emit reading grade warning when readingLevel is not provided", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      const gradeWarnings = result.warnings.filter((w) => w.startsWith("reading_grade_out_of_range"));
      expect(gradeWarnings).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 2.8: Section rules validation (warnings only)
  // ─────────────────────────────────────────────────────────────────

  describe("Task 2.8 — Section rules validation (warnings)", () => {
    it("warns when section with repeats_primary_cta=true has no CTA", () => {
      const noCta = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control services. Santa Cruz homeowners need help. Santa Cruz service.`;
      // Replace "call" with "contact" so no CTA keyword matches
      const noCtaContent = noCta.replace(/call/gi, "contact");
      // Force no tel: or call in content
      const contentWithoutCta = `${FILLER_WORDS} Santa Cruz pest control services. Santa Cruz homeowners need help. Santa Cruz service area. (555) 123-4567. (555) 234-5678. (555) 345-6789.`;

      const result = runQualityGate(contentWithoutCta, "Santa Cruz", 1200, [], 3, undefined, [
        { section: "mid-page", purpose: "conversion", required_elements: [], repeats_primary_cta: true },
      ]);
      const ctaWarnings = result.warnings.filter((w) => w.startsWith("section_missing_cta"));
      expect(ctaWarnings).toHaveLength(1);
      expect(ctaWarnings[0]).toContain("mid-page");
    });

    it("does not warn about CTA when section has a call keyword", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, [
        { section: "hero", purpose: "conversion", required_elements: [], repeats_primary_cta: true },
      ]);
      const ctaWarnings = result.warnings.filter((w) => w.startsWith("section_missing_cta"));
      expect(ctaWarnings).toHaveLength(0);
    });

    it("warns when required element is missing from content", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, [
        { section: "trust-band", purpose: "credibility", required_elements: ["guarantee badge", "license number"], repeats_primary_cta: false },
      ]);
      const elementWarnings = result.warnings.filter((w) => w.startsWith("section_missing_element"));
      expect(elementWarnings.length).toBeGreaterThan(0);
      expect(elementWarnings[0]).toContain("trust-band");
    });

    it("does not warn when required element is present", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Santa Cruz homeowners call us. Our guarantee badge is visible. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, [
        { section: "trust-band", purpose: "credibility", required_elements: ["guarantee"], repeats_primary_cta: false },
      ]);
      const elementWarnings = result.warnings.filter((w) => w.startsWith("section_missing_element") && w.includes('"guarantee"'));
      expect(elementWarnings).toHaveLength(0);
    });

    it("is warning-only — does not cause hard failures", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, [
        { section: "any-section", purpose: "test", required_elements: ["nonexistent-element-xyz"], repeats_primary_cta: false },
      ]);
      expect(result.passed).toBe(true);
      expect(result.failures).not.toContain("section_missing_element");
    });

    it("handles empty sectionRules array without warnings", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, []);
      const sectionWarnings = result.warnings.filter((w) => w.startsWith("section_"));
      expect(sectionWarnings).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 4.4: PAS structure validation (warnings only)
  // ─────────────────────────────────────────────────────────────────

  describe("Task 4.4 — PAS structure validation (warnings)", () => {
    it("warns when problem-section keywords are absent from first third", () => {
      // Fill first third with neutral words, agitate in middle, solve at end
      const first = Array(100).fill("service available today quality").join(" ");
      const middle = Array(100).fill("spread multiply quickly").join(" ");
      const last = Array(100).fill("call solution professional").join(" ");
      const content = `Santa Cruz ${first} ${middle} ${last}`;
      const result = runQualityGate(content, "Santa Cruz", 100, [], 3);
      // Warn if no problem keywords in first section
      const pasWarnings = result.warnings.filter((w) => w.startsWith("pas_missing"));
      expect(pasWarnings.some((w) => w.includes("problem"))).toBe(true);
    });

    it("does not warn on PAS when all three sections have appropriate keywords", () => {
      // Problem → Agitate → Solve spread through the content
      const first = Array(100).fill("infestation damage risk problem").join(" ");
      const middle = Array(100).fill("spread quickly health urgent").join(" ");
      const last = Array(100).fill("call solution professional service").join(" ");
      const content = `Santa Cruz ${first} ${middle} ${last}`;
      const result = runQualityGate(content, "Santa Cruz", 100, [], 3);
      const pasProblemWarning = result.warnings.filter((w) => w === "pas_missing_problem_section");
      const pasAgitateWarning = result.warnings.filter((w) => w === "pas_missing_agitation_section");
      const pasSolveWarning = result.warnings.filter((w) => w === "pas_missing_solution_section");
      expect(pasProblemWarning).toHaveLength(0);
      expect(pasAgitateWarning).toHaveLength(0);
      expect(pasSolveWarning).toHaveLength(0);
    });

    it("is warning-only — PAS never causes hard failures", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.failures.filter((f) => f.startsWith("pas_"))).toHaveLength(0);
    });

    it("skips PAS check for very short content (under 200 words)", () => {
      const shortContent = "Santa Cruz pest control is available. Call us now. Santa Cruz experts ready.";
      const result = runQualityGate(shortContent, "Santa Cruz", 10, [], 0);
      const pasWarnings = result.warnings.filter((w) => w.startsWith("pas_missing"));
      expect(pasWarnings).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 4.1: Meta description length validation (warnings only)
  // ─────────────────────────────────────────────────────────────────

  describe("Task 4.1 — Meta description length validation", () => {
    it("emits no meta description warning when length is within 120-160 chars", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const desc = "A".repeat(140); // 140 chars — within range
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, { description: desc });
      const descWarnings = result.warnings.filter((w) => w.startsWith("meta_description"));
      expect(descWarnings).toHaveLength(0);
    });

    it("warns when meta description is too long (over 160 chars)", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const desc = "A".repeat(165);
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, { description: desc });
      expect(result.warnings.some((w) => w.startsWith("meta_description_too_long"))).toBe(true);
    });

    it("warns when meta description is too short (under 120 chars)", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const desc = "Short description.";
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, { description: desc });
      expect(result.warnings.some((w) => w.startsWith("meta_description_too_short"))).toBe(true);
    });

    it("is warning-only — meta description length never fails the gate", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, { description: "Short." });
      expect(result.passed).toBe(true);
    });

    it("skips meta description check when metadata is absent", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      const descWarnings = result.warnings.filter((w) => w.startsWith("meta_description"));
      expect(descWarnings).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 4.2: Title tag format validation (warnings only)
  // ─────────────────────────────────────────────────────────────────

  describe("Task 4.2 — Title tag format validation", () => {
    it("emits no title warnings for a well-formed title", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, {
        title: "Santa Cruz Pest Control | Same-Day Service",
        targetKeyword: "pest control",
      });
      const titleWarnings = result.warnings.filter((w) => w.startsWith("title_"));
      expect(titleWarnings).toHaveLength(0);
    });

    it("warns when title exceeds 60 characters", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const longTitle = "Santa Cruz Professional Pest Control Services | Call Now For Same-Day Service";
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, { title: longTitle });
      expect(result.warnings.some((w) => w.startsWith("title_too_long"))).toBe(true);
    });

    it("warns when title does not contain city name", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, { title: "Pest Control Services | Call Today" });
      expect(result.warnings.some((w) => w.startsWith("title_missing_city"))).toBe(true);
    });

    it("warns when title does not contain target keyword words", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, {
        title: "Santa Cruz Home Services",
        targetKeyword: "termite inspection",
      });
      expect(result.warnings.some((w) => w.startsWith("title_missing_keyword"))).toBe(true);
    });

    it("is warning-only — title issues never fail the gate", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, {
        title: "This title has no city and is way too long for search engines to display properly in results",
      });
      expect(result.passed).toBe(true);
    });

    it("skips keyword check when targetKeyword is not provided", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, {
        title: "Santa Cruz Pest Control",
      });
      const kwWarnings = result.warnings.filter((w) => w.startsWith("title_missing_keyword"));
      expect(kwWarnings).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 4.3: Image alt text validation (warnings only)
  // ─────────────────────────────────────────────────────────────────

  describe("Task 4.3 — Hero image alt text validation", () => {
    it("warns when heroImageAlt is absent from metadata", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, {});
      expect(result.warnings.some((w) => w === "hero_image_alt_missing")).toBe(true);
    });

    it("warns when heroImageAlt is empty string", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, { heroImageAlt: "" });
      expect(result.warnings.some((w) => w === "hero_image_alt_missing")).toBe(true);
    });

    it("warns when heroImageAlt does not contain target keyword words", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, {
        heroImageAlt: "Professional worker",
        targetKeyword: "termite inspection",
      });
      expect(result.warnings.some((w) => w.startsWith("hero_image_alt_missing_keyword"))).toBe(true);
    });

    it("emits no alt text warning when alt contains target keyword", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, {
        heroImageAlt: "Santa Cruz termite inspection technician checking for damage",
        targetKeyword: "termite inspection",
      });
      const altWarnings = result.warnings.filter((w) => w.startsWith("hero_image_alt"));
      expect(altWarnings).toHaveLength(0);
    });

    it("is warning-only — missing alt never fails the gate", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, [], 3, undefined, undefined, { heroImageAlt: "" });
      expect(result.passed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 4.10: Form-language detection (banned phrases)
  // ─────────────────────────────────────────────────────────────────

  describe("Task 4.10 — Form-language detection", () => {
    it("BANNED_PHRASES list includes form-language entries", () => {
      expect(BANNED_PHRASES).toContain("fill out");
      expect(BANNED_PHRASES).toContain("submit your");
      expect(BANNED_PHRASES).toContain("complete the form");
      expect(BANNED_PHRASES).toContain("request a quote online");
      expect(BANNED_PHRASES).toContain("web form");
      expect(BANNED_PHRASES).toContain("online form");
      expect(BANNED_PHRASES).toContain("contact form");
    });

    it("fails when content contains 'fill out'", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Fill out the form below. Santa Cruz homeowners call us. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.failures).toContain("banned_phrases");
      expect(result.metrics.bannedPhrasesFound).toContain("fill out");
    });

    it("fails when content contains 'submit your'", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Submit your request today. Santa Cruz homeowners call us. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.failures).toContain("banned_phrases");
      expect(result.metrics.bannedPhrasesFound).toContain("submit your");
    });

    it("fails when content contains 'request a quote online'", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. Request a quote online for fast service. Santa Cruz homeowners call us. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.failures).toContain("banned_phrases");
      expect(result.metrics.bannedPhrasesFound).toContain("request a quote online");
    });

    it("fails when form language is in supplemental title", () => {
      const content = `${FILLER_WORDS} ${PASS_TAIL}`;
      const result = runQualityGate(content, "Santa Cruz", 1200, ["Fill out the contact form for service"]);
      expect(result.failures).toContain("banned_phrases");
    });

    it("form-language detection is case-insensitive", () => {
      const content = `${FILLER_WORDS} ${PHONE_REFS} Santa Cruz pest control. FILL OUT the form below. Santa Cruz homeowners call us. Santa Cruz service.`;
      const result = runQualityGate(content, "Santa Cruz", 1200);
      expect(result.failures).toContain("banned_phrases");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // findPlaceholderTokens: unit-level test
  // ─────────────────────────────────────────────────────────────────

  describe("findPlaceholderTokens utility", () => {
    it("detects [BRACKET] style tokens", () => {
      const tokens = findPlaceholderTokens(["Contact [COMPANY_NAME] in [CITY]"]);
      expect(tokens).toContain("[COMPANY_NAME]");
      expect(tokens).toContain("[CITY]");
    });

    it("detects {brace} style tokens", () => {
      const tokens = findPlaceholderTokens(["{domain} is live at {url.path}"]);
      expect(tokens).toContain("{domain}");
    });

    it("detects TODO tokens (case-insensitive)", () => {
      const tokens = findPlaceholderTokens(["TODO: finish this section"]);
      expect(tokens).toContain("TODO");
    });

    it("returns empty array for clean content", () => {
      const tokens = findPlaceholderTokens(["Clean professional content about pest control"]);
      expect(tokens).toHaveLength(0);
    });

    it("deduplicates repeated tokens", () => {
      const tokens = findPlaceholderTokens(["[PHONE] ... [PHONE] ... [PHONE]"]);
      expect(tokens).toEqual(["[PHONE]"]);
    });

    it("scans multiple texts", () => {
      const tokens = findPlaceholderTokens(["body content [PHONE]", "{domain} header", "TODO footer"]);
      expect(tokens).toEqual(expect.arrayContaining(["[PHONE]", "{domain}", "TODO"]));
    });
  });
});
