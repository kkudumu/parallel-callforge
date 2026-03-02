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
];

export interface QualityResult {
  passed: boolean;
  failures: string[];
  metrics: {
    wordCount: number;
    hasCityName: boolean;
    cityMentionCount: number;
    uniqueWordRatio: number;
    repeatedSentenceRatio: number;
    bannedPhrasesFound: string[];
    placeholdersFound: string[];
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

export function runQualityGate(
  content: string,
  cityName: string,
  minWordCount: number,
  supplementalTexts: string[] = []
): QualityResult {
  const failures: string[] = [];
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

  // Banned phrases
  const bannedPhrasesFound = BANNED_PHRASES.filter((phrase) =>
    lowerContent.includes(phrase.toLowerCase())
  );
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

  return {
    passed: failures.length === 0,
    failures,
    metrics: {
      wordCount,
      hasCityName,
      cityMentionCount,
      uniqueWordRatio,
      repeatedSentenceRatio,
      bannedPhrasesFound,
      placeholdersFound,
    },
  };
}
