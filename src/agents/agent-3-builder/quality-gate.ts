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
    bannedPhrasesFound: string[];
  };
}

export function runQualityGate(
  content: string,
  cityName: string,
  minWordCount: number
): QualityResult {
  const failures: string[] = [];
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const lowerContent = content.toLowerCase();

  // Word count check
  if (wordCount < minWordCount) {
    failures.push("word_count");
  }

  // City name presence
  const hasCityName = lowerContent.includes(cityName.toLowerCase());
  if (!hasCityName) {
    failures.push("city_name_missing");
  }

  // Banned phrases
  const bannedPhrasesFound = BANNED_PHRASES.filter((phrase) =>
    lowerContent.includes(phrase.toLowerCase())
  );
  if (bannedPhrasesFound.length > 0) {
    failures.push("banned_phrases");
  }

  return {
    passed: failures.length === 0,
    failures,
    metrics: { wordCount, hasCityName, bannedPhrasesFound },
  };
}
