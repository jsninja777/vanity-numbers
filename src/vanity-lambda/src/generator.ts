import fs from "fs";
import path from "path";

const WORDLIST_PATH = path.join(process.env.LAMBDA_TASK_ROOT || __dirname, "wordlist.txt");
console.log("WORDLIST_PATH", WORDLIST_PATH, "exists:", fs.existsSync(WORDLIST_PATH));

// T9 keypad mapping
const T9: Record<string, string> = {
  "2": "ABC", "3": "DEF", "4": "GHI",
  "5": "JKL", "6": "MNO", "7": "PQRS",
  "8": "TUV", "9": "WXYZ"
};

let WORDLIST: string[];

  // Prefer embedded array module if present
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const embedded = require("./wordlist.data") as { WORDLIST?: string[] };
  if (embedded && Array.isArray(embedded.WORDLIST) && embedded.WORDLIST.length > 0) {
    WORDLIST = embedded.WORDLIST.map(w => String(w).trim().toUpperCase()).filter(w => /^[A-Z]+$/.test(w));
    console.log("Using embedded WORDLIST (", WORDLIST.length, ")");
  } else {
    throw new Error("Embedded WORDLIST missing or empty");
  }


// Word → digits
export const wordToDigits = (word: string): string =>
  [...word.toUpperCase()]
    .map(ch => Object.entries(T9).find(([, letters]) => letters.includes(ch))?.[0] ?? "")
    .join("");

// Precompute mappings
const WORD_TO_DIGITS: Record<string, string> = Object.fromEntries(
  WORDLIST.map(w => [w, wordToDigits(w)])
);

const DIGITS_TO_WORDS: Record<string, string[]> = {};
for (const [word, digits] of Object.entries(WORD_TO_DIGITS)) {
  DIGITS_TO_WORDS[digits] ??= [];
  DIGITS_TO_WORDS[digits].push(word);
}

// Normalize phone number
export const normalizeNumber = (num: string): string =>
  (num ?? "").replace(/\D/g, "");

// Format 10-digit numbers
export const formatDigits = (digits: string): string =>
  digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : digits;

/**
 * Generate vanity candidates (recursive backtracking)
 */
export const generateAllCandidates = (digits: string): string[] => {
  const results = new Set<string>();
  const n = digits.length;

  const backtrack = (pos: number, path: string[]): void => {
    if (pos >= n) {
      results.add(path.join(""));
      return;
    }

    for (let len = 3; len <= Math.min(12, n - pos); len++) {
      const sub = digits.slice(pos, pos + len);
      DIGITS_TO_WORDS[sub]?.forEach(word =>
        backtrack(pos + len, [...path, word])
      );
    }

    backtrack(pos + 1, [...path, digits[pos]]);
  };

  backtrack(0, []);
  return [...results];
};

/**
 * Scoring function
 */
const scoreCandidate = (text: string): number => {
  let score = 0;

  if (/^[A-Z]+$/.test(text) && WORD_TO_DIGITS[text]) {
    score += 500;
  }

  score += 10 * (text.match(/[A-Z]/g)?.length ?? 0);
  score += 5 * (text.match(/[AEIOU]/g)?.length ?? 0);
  score -= (text.match(/[^0-9A-Z]/g)?.length ?? 0);

  // Prefer XXX-WORD-XXXX pattern: first letters starting after area code
  const firstLetterIndex = text.search(/[A-Z]/);
  if (firstLetterIndex === 3) {
    score += 80; // ideal: letters start at index 3 (after NPA)
  } else if (firstLetterIndex >= 0 && firstLetterIndex < 3) {
    score += 30; // also good if letters start early
  } else if (firstLetterIndex > 3) {
    score += 10; // some letters later are still helpful
  }

  // Slight bonus if we end with 4 digits (memorable last-4)
  if (/[0-9]{4}$/.test(text)) {
    score += 20;
  }
  return score;
};

/**
 * Pick top N vanity numbers
 */
export const pickTopN = (candidates: string[], n = 5): string[] => {
  const scored = candidates
    .map(text => ({ text, score: scoreCandidate(text) }))
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));

  const unique: string[] = [];
  const seen = new Set<string>();

  for (const { text } of scored) {
    if (!seen.has(text)) {
      seen.add(text);
      unique.push(text);
    }
    if (unique.length >= n) break;
  }

  return unique;
};

/**
 * Main API
 */
export const getVanityNumbers = (phone: string, n = 5): string[] => {
  console.log("Getting vanity numbers for", phone);
  let digits = normalizeNumber(phone);
  console.log("Normalized digits:", digits);
  
  // If it's an 11-digit number (like +1XXXXXXXXXX), use the last 10 digits
  if (digits.length === 11 && digits.startsWith('1')) {
    console.log("11-digit number, using last 10 digits");
    digits = digits.slice(1);
  }
  
  // If it's still not 10 digits, return the original number as fallback
  if (digits.length !== 10) {
    console.log("Not 10 digits, returning formatted original");
    return [formatDigits(digits)];
  }
  
  // Primary generation from object matches
  const candidates = generateAllCandidates(digits);
  let results = pickTopN(candidates, n);

  // Ensure candidates are exactly: 3 digits + WORD(>=3, in object) + 4 digits
  const getWordRun = (text: string): { start: number; end: number; word: string } | null => {
    const matches = [...text.matchAll(/[A-Z]{3,}/g)];
    if (matches.length !== 1) return null;
    const m = matches[0];
    const start = m.index ?? -1;
    if (start < 0) return null;
    const word = m[0];
    if (!WORD_TO_DIGITS[word]) return null; 
    const end = start + word.length;
    
    // prefix must be digits, suffix must be digits, and total length 10
    const prefix = text.slice(0, start);
    const suffix = text.slice(end);
    if (!/^\d*$/.test(prefix) || !/^\d*$/.test(suffix)) return null;
    if (text.length !== 10) return null;
    return { start, end, word };
  };
  const isWordOnlyCandidate = (text: string): boolean => !!getWordRun(text);
  results = results.filter(isWordOnlyCandidate);

  // If we don't have enough, synthesize additional "wordy" candidates
  if (results.length < n) {
    const extrasSet = new Set<string>();

    type WordMatch = { start: number; len: number; word: string };
    const matches: WordMatch[] = [];

    // Collect possible word matches across the number (lengths 3..7), excluding segments with 0/1
    for (let start = 0; start < digits.length; start++) {
      for (let len = 7; len >= 3; len--) {
        if (start + len > digits.length) continue;
        const sub = digits.slice(start, start + len);
        if (!/^[2-9]+$/.test(sub)) continue;
        const words = DIGITS_TO_WORDS[sub];
        if (!words) continue;
        for (let wi = 0; wi < words.length; wi++) {
          matches.push({ start, len, word: words[wi] });
          if (results.length + extrasSet.size + matches.length >= n * 5) break;
        }
        if (results.length + extrasSet.size + matches.length >= n * 5) break;
      }
    }

    // Prefer starts at index 3 (after area code), then nearer to 3, then longer words
    matches.sort((a, b) => {
      const aPref = a.start === 3 ? 0 : Math.abs(a.start - 3) + 1;
      const bPref = b.start === 3 ? 0 : Math.abs(b.start - 3) + 1;
      return aPref - bPref || b.len - a.len || a.word.localeCompare(b.word);
    });

    // Single-word overlays
    for (const m of matches) {
      const cand = digits.slice(0, m.start) + m.word + digits.slice(m.start + m.len);
      if (isWordOnlyCandidate(cand)) extrasSet.add(cand);
      if (results.length + extrasSet.size >= n) break;
    }

    // If still short, try two-word overlays
    if (results.length + extrasSet.size < n) {
      for (let i = 0; i < matches.length; i++) {
        const m1 = matches[i];
        for (let j = i + 1; j < matches.length; j++) {
          const m2 = matches[j];
          if (m2.start < m1.start + m1.len) continue; // avoid overlap
          const prefix = digits.slice(0, m1.start);
          const mid = digits.slice(m1.start + m1.len, m2.start);
          const suffix = digits.slice(m2.start + m2.len);
          const cand = prefix + m1.word + mid + m2.word + suffix;
          if (isWordOnlyCandidate(cand)) extrasSet.add(cand);
          if (results.length + extrasSet.size >= n) break;
        }
        if (results.length + extrasSet.size >= n) break;
      }
    }

    if (extrasSet.size > 0) {
      const extras = Array.from(extrasSet);
      const merged = pickTopN([...results, ...extras], n * 5);
      results = merged.filter(isWordOnlyCandidate).slice(0, n);
    }

    // Anchored related-word expansion: to keep the word at the same position as the strongest result
    if (results.length < n && results.length > 0) {
      // Use the strongest current result as the anchor
      const anchor = results[0];
      const firstLetterIndex = anchor.search(/[A-Z]/);
      if (firstLetterIndex >= 0) {
        let end = firstLetterIndex;
        while (end < anchor.length && /[A-Z]/.test(anchor[end])) end++;
        const anchorWord = anchor.slice(firstLetterIndex, end);
        const segLen = end - firstLetterIndex;

        // Map anchor segment back to original digits 
        const segDigits = digits.slice(firstLetterIndex, firstLetterIndex + segLen);
        const segmentobject = DIGITS_TO_WORDS[segDigits] || [];

        // Build seeds from the anchor word
        const seeds = new Set<string>();
        if (anchorWord.length > 0) seeds.add(anchorWord);
        for (let i = 0; i + 1 < anchorWord.length; i++) seeds.add(anchorWord.slice(i, i + 2));
        for (let i = 0; i + 2 < anchorWord.length; i++) seeds.add(anchorWord.slice(i, i + 3));

        // Related words: must fit the same digit segment and share any seed
        const related = segmentobject.filter(w => {
          for (const s of seeds) {
            if (s && w.includes(s)) return true;
          }
          return false;
        });

        // Overlay related words at the same position, collect until it hit n
        const anchored: string[] = [];
        for (const w of related) {
          const cand = digits.slice(0, firstLetterIndex) + w + digits.slice(firstLetterIndex + segLen);
          if (isWordOnlyCandidate(cand)) anchored.push(cand);
          if (results.length + anchored.length >= n) break;
        }

        if (anchored.length > 0) {
          const merged = pickTopN([...results, ...anchored], n * 3);
          results = merged.filter(isWordOnlyCandidate).slice(0, n);
        }
      }
    }

  }

  // If word is still short and not up to 5, it should expand with related words sharing 2+ letters with the strongest word,
  // overlaid at the same position, replacing as many digits as the theme word's length (not strict T9).
  if (results.length < n && results.length > 0) {
    const anchor = results[0];
    const firstLetterIndex = anchor.search(/[A-Z]/);
    if (firstLetterIndex >= 0) {
      let end = firstLetterIndex;
      while (end < anchor.length && /[A-Z]/.test(anchor[end])) end++;
      const anchorWord = anchor.slice(firstLetterIndex, end);

      const seedSet = new Set<string>();
      for (let i = 0; i + 1 < anchorWord.length; i++) seedSet.add(anchorWord.slice(i, i + 2));
      for (let i = 0; i + 2 < anchorWord.length; i++) seedSet.add(anchorWord.slice(i, i + 3));

      const themed: string[] = [];
      for (const w of WORDLIST) {
        if (w.length < 3) continue;
        let ok = false;
        for (const s of seedSet) {
          if (s && w.includes(s)) { ok = true; break; }
        }
        if (!ok) continue;
        if (firstLetterIndex + w.length > digits.length) continue; // must fit within 10 chars
        const cand = digits.slice(0, firstLetterIndex) + w + digits.slice(firstLetterIndex + w.length);
        if (isWordOnlyCandidate(cand)) themed.push(cand);
        if (results.length + themed.length >= n) break;
      }

      if (themed.length > 0) {
        // Strict-first ordering: sort strict and themed separately, strict first
        const sortByScore = (arr: string[]) =>
          arr
            .map(text => ({ text, score: scoreCandidate(text) }))
            .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
            .map(x => x.text);

        const strictSorted = sortByScore(results).filter(isWordOnlyCandidate);
        const themedSorted = sortByScore(themed).filter(isWordOnlyCandidate);

        const combined: string[] = [];
        for (const s of strictSorted) {
          if (!combined.includes(s)) combined.push(s);
          if (combined.length >= n) break;
        }
        if (combined.length < n) {
          for (const t of themedSorted) {
            if (!combined.includes(t)) combined.push(t);
            if (combined.length >= n) break;
          }
        }

        results = combined;
      }
    }
  }
  
  // If no good candidates found, return formatted original
  if (results.length === 0 || results.every(r => r === digits)) {
    console.log("No good candidates found, returning formatted original");
    return [formatDigits(digits)];
  }

  // Present as digits-prefix - WORD - digits-suffix (do not split the word)
  const dashed = results.map(r => {
    const run = getWordRun(r);
    if (!run) return r;
    const prefix = r.slice(0, run.start);
    const word = run.word;
    const suffix = r.slice(run.end);
    const parts: string[] = [];
    if (prefix) parts.push(prefix);
    parts.push(word);
    if (suffix) parts.push(suffix);
    return parts.join("-");
  });

  return dashed;
};
