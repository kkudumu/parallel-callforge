export const BANNED_PHRASES = [
  "it is important to note",
  "in conclusion",
  "when it comes to",
  "it's worth noting",
  "in today's world",
  "at the end of the day",
  "in this article",
  "without further ado",
  "dive into",
  "navigating the",
  "leverage",
  "it goes without saying",
  "plays a crucial role",
  "in the realm of",
  "a testament to",
  // Form-language detection (enforces no_forms: true conversion strategy)
  "fill out",
  "submit your",
  "complete the form",
  "request a quote online",
  "web form",
  "online form",
  "contact form",
];

export interface ReadingLevelTarget {
  target_grade_min: number;
  target_grade_max: number;
}

export interface SectionRule {
  section: string;
  purpose: string;
  required_elements: string[];
  repeats_primary_cta: boolean;
}

export interface QualityResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
  metrics: {
    wordCount: number;
    hasCityName: boolean;
    cityMentionCount: number;
    uniqueWordRatio: number;
    repeatedSentenceRatio: number;
    bannedPhrasesFound: string[];
    placeholdersFound: string[];
    phoneMentionCount: number;
    readingGrade: number;
  };
}

const PLACEHOLDER_PATTERNS = [
  /\[[A-Z0-9_ -]+\]/g,
  /\{[a-zA-Z0-9_.-]+\}/g,
  /\bTODO\b/gi,
];

export function findPlaceholderTokens(texts: string[]): string[] {
  const matches = new Set<string>();

  for (const text of texts) {
    for (const pattern of PLACEHOLDER_PATTERNS) {
      const found = text.match(pattern) ?? [];
      for (const token of found) {
        matches.add(token);
      }
    }
  }

  return [...matches].sort();
}

export interface PageMetadata {
  title?: string;
  description?: string;
  heroImageAlt?: string;
  targetKeyword?: string;
}

export function runQualityGate(
  content: string,
  cityName: string,
  minWordCount: number,
  supplementalTexts: string[] = [],
  phoneMinMentions: number = 3,
  readingLevel?: ReadingLevelTarget,
  sectionRules?: SectionRule[],
  metadata?: PageMetadata
): QualityResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const lowerContent = content.toLowerCase();
  const normalizedWords = words.map((word) =>
    word.toLowerCase().replace(/[^a-z0-9]/g, "")
  ).filter(Boolean);
  const uniqueWordRatio = normalizedWords.length > 0
    ? new Set(normalizedWords).size / normalizedWords.length
    : 0;
  const cityPattern = new RegExp(cityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const cityMentionCount = (content.match(cityPattern) ?? []).length;
  const requiredCityMentions = minWordCount >= 1000 ? 4 : 3;
  const sentences = content
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim().toLowerCase())
    .filter((sentence) => sentence.length >= 30);
  const uniqueSentenceCount = new Set(sentences).size;
  const repeatedSentenceRatio = sentences.length > 0
    ? 1 - (uniqueSentenceCount / sentences.length)
    : 0;

  // Word count check
  if (wordCount < minWordCount) {
    failures.push("word_count");
  }

  // City name presence
  const hasCityName = lowerContent.includes(cityName.toLowerCase());
  if (!hasCityName) {
    failures.push("city_name_missing");
  } else if (cityMentionCount < requiredCityMentions) {
    failures.push("city_name_sparse");
  }

  // Banned phrases — check body content and supplemental texts (title, description, etc.)
  const bannedPhrasesFound = BANNED_PHRASES.filter((phrase) => {
    const lowerPhrase = phrase.toLowerCase();
    if (lowerContent.includes(lowerPhrase)) return true;
    return supplementalTexts.some((text) => text.toLowerCase().includes(lowerPhrase));
  });
  if (bannedPhrasesFound.length > 0) {
    failures.push("banned_phrases");
  }

  const placeholdersFound = findPlaceholderTokens([content, ...supplementalTexts]);
  if (placeholdersFound.length > 0) {
    failures.push("placeholder_tokens");
  }

  if (wordCount >= Math.max(500, minWordCount * 0.75)) {
    if (uniqueWordRatio < 0.22) {
      failures.push("low_uniqueness");
    }
    if (repeatedSentenceRatio > 0.2) {
      failures.push("repeated_sentences");
    }
  }

  // Phone mention count check
  const phoneMentionCount = countPhoneMentions(content);
  if (phoneMentionCount < phoneMinMentions) {
    failures.push("phone_count_low");
  }

  // Flesch-Kincaid reading grade — soft warning only
  const readingGrade = computeFleschKincaidGrade(content);
  if (readingLevel) {
    if (readingGrade < readingLevel.target_grade_min || readingGrade > readingLevel.target_grade_max) {
      warnings.push(`reading_grade_out_of_range: grade=${readingGrade.toFixed(1)} target=${readingLevel.target_grade_min}-${readingLevel.target_grade_max}`);
    }
  }

  // Section rules validation — soft warnings only
  if (sectionRules && sectionRules.length > 0) {
    for (const rule of sectionRules) {
      if (rule.repeats_primary_cta) {
        const hasCta = lowerContent.includes("call") || lowerContent.includes("tel:");
        if (!hasCta) {
          warnings.push(`section_missing_cta: ${rule.section}`);
        }
      }
      for (const element of rule.required_elements) {
        const elementKeyword = element.toLowerCase().split(/\s+/)[0];
        if (elementKeyword && !lowerContent.includes(elementKeyword)) {
          warnings.push(`section_missing_element: ${rule.section} requires "${element}"`);
        }
      }
    }
  }

  // Task 4.4: PAS structure soft validation (informational only)
  const PAS_PROBLEM_KEYWORDS = ["problem", "infestation", "damage", "threat", "dangerous", "risk", "signs", "found", "notice", "spotted", "worried"];
  const PAS_AGITATE_KEYWORDS = ["spread", "multiply", "quickly", "health", "costly", "worse", "delay", "urgent", "immediately", "serious", "harmful"];
  const PAS_SOLVE_KEYWORDS = ["call", "contact", "service", "treat", "eliminate", "professional", "solution", "help", "expert", "technician", "schedule"];
  const wordCountForPas = words.length;
  if (wordCountForPas >= 200) {
    const third = Math.floor(wordCountForPas / 3);
    const problemSection = words.slice(0, third).join(" ").toLowerCase();
    const agitateSection = words.slice(third, third * 2).join(" ").toLowerCase();
    const solveSection = words.slice(third * 2).join(" ").toLowerCase();
    const hasProblem = PAS_PROBLEM_KEYWORDS.some((kw) => problemSection.includes(kw));
    const hasAgitate = PAS_AGITATE_KEYWORDS.some((kw) => agitateSection.includes(kw));
    const hasSolve = PAS_SOLVE_KEYWORDS.some((kw) => solveSection.includes(kw));
    if (!hasProblem) warnings.push("pas_missing_problem_section");
    if (!hasAgitate) warnings.push("pas_missing_agitation_section");
    if (!hasSolve) warnings.push("pas_missing_solution_section");
  }

  // Task 4.1: Meta description length validation
  if (metadata?.description !== undefined) {
    const descLen = metadata.description.length;
    if (descLen > 160) {
      warnings.push(`meta_description_too_long: ${descLen} chars (max 160)`);
    } else if (descLen < 120) {
      warnings.push(`meta_description_too_short: ${descLen} chars (min 120)`);
    }
  }

  // Task 4.2: Title tag format validation
  if (metadata?.title !== undefined) {
    const title = metadata.title;
    if (title.length > 60) {
      warnings.push(`title_too_long: ${title.length} chars (max 60)`);
    }
    if (!title.toLowerCase().includes(cityName.toLowerCase())) {
      warnings.push(`title_missing_city: "${title}" does not contain "${cityName}"`);
    }
    if (metadata.targetKeyword) {
      const kwWords = metadata.targetKeyword.toLowerCase().split(/\s+/);
      const titleLower = title.toLowerCase();
      if (!kwWords.some((word) => titleLower.includes(word))) {
        warnings.push(`title_missing_keyword: "${title}" does not contain keyword words`);
      }
    }
  }

  // Task 4.3: Image alt text validation
  if (metadata?.heroImageAlt !== undefined) {
    if (!metadata.heroImageAlt.trim()) {
      warnings.push("hero_image_alt_missing");
    } else if (metadata.targetKeyword) {
      const kwWords = metadata.targetKeyword.toLowerCase().split(/\s+/);
      const altLower = metadata.heroImageAlt.toLowerCase();
      if (!kwWords.some((word) => altLower.includes(word))) {
        warnings.push(`hero_image_alt_missing_keyword: alt="${metadata.heroImageAlt}"`);
      }
    }
  } else {
    warnings.push("hero_image_alt_missing");
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    metrics: {
      wordCount,
      hasCityName,
      cityMentionCount,
      uniqueWordRatio,
      repeatedSentenceRatio,
      bannedPhrasesFound,
      placeholdersFound,
      phoneMentionCount,
      readingGrade,
    },
  };
}

function countPhoneMentions(content: string): number {
  let count = 0;
  // tel: href references
  const telRefs = (content.match(/tel:/gi) ?? []).length;
  count += telRefs;
  // Formatted phone number patterns: (XXX) XXX-XXXX, XXX-XXX-XXXX, XXX.XXX.XXXX
  const phonePatterns = content.match(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g) ?? [];
  count += phonePatterns.length;
  // "call" as a verb in CTA context (standalone word)
  const callMatches = (content.match(/\bcall\b/gi) ?? []).length;
  count += callMatches;
  return count;
}

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length <= 3) return 1;
  // Remove trailing silent e
  const normalized = cleaned.replace(/e$/, "");
  // Count vowel groups
  const vowelGroups = normalized.match(/[aeiouy]+/g) ?? [];
  return Math.max(1, vowelGroups.length);
}

function computeFleschKincaidGrade(content: string): number {
  const wordList = content.split(/\s+/).filter((w) => w.length > 0);
  if (wordList.length === 0) return 0;
  const sentenceCount = Math.max(1, (content.match(/[.!?]+/g) ?? []).length);
  const syllableCount = wordList.reduce((sum, word) => sum + countSyllables(word), 0);
  // FK Grade Level formula
  const grade = 0.39 * (wordList.length / sentenceCount) + 11.8 * (syllableCount / wordList.length) - 15.59;
  return Math.max(0, grade);
}
