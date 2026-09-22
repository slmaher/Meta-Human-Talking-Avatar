/**
 * TTS Provider interface, text-to-viseme alignment generator, and factory.
 */

import { ITTSProvider, TTSAudioResult, VisemeEvent, VisemeId } from '../types';

/**
 * Common English grapheme-to-viseme mapping rules for realistic lip sync timing.
 */
const DIPHTHONG_RULES: Record<string, VisemeId[]> = {
  ee: ['ih'],
  ea: ['ih'],
  oo: ['ou'],
  ou: ['aa', 'ou'],
  ow: ['aa', 'ou'],
  ai: ['E', 'ih'],
  ay: ['E', 'ih'],
  oi: ['oh', 'ih'],
  oy: ['oh', 'ih'],
  th: ['TH'],
  ch: ['CH'],
  sh: ['CH'],
  ph: ['FF'],
  ck: ['kk'],
  ng: ['kk'],
  wh: ['ou'],
};

const SINGLE_CHAR_RULES: Record<string, VisemeId> = {
  a: 'aa',
  e: 'E',
  i: 'ih',
  o: 'oh',
  u: 'ou',
  b: 'PP',
  p: 'PP',
  m: 'PP',
  f: 'FF',
  v: 'FF',
  t: 'DD',
  d: 'DD',
  l: 'DD',
  k: 'kk',
  g: 'kk',
  c: 'kk',
  q: 'kk',
  x: 'kk',
  j: 'CH',
  s: 'SS',
  z: 'SS',
  n: 'nn',
  r: 'RR',
  w: 'ou',
  y: 'ih',
  h: 'E',
};

/**
 * Converts a text string into an aligned VisemeEvent sequence given a total speech duration.
 */
export function generateVisemeTimelineFromText(text: string, totalDuration: number): VisemeEvent[] {
  const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = clean.split(/\s+/).filter((w) => w.length > 0);

  if (words.length === 0 || totalDuration <= 0) {
    return [];
  }

  // Parse word phoneme sequences
  const parsedWords: VisemeId[][] = [];
  let totalPhonemes = 0;

  for (const word of words) {
    const wordVisemes: VisemeId[] = [];
    let i = 0;
    while (i < word.length) {
      if (i + 1 < word.length) {
        const pair = word.slice(i, i + 2);
        if (DIPHTHONG_RULES[pair]) {
          wordVisemes.push(...DIPHTHONG_RULES[pair]);
          i += 2;
          continue;
        }
      }
      const char = word[i];
      if (SINGLE_CHAR_RULES[char]) {
        wordVisemes.push(SINGLE_CHAR_RULES[char]);
      }
      i++;
    }

    if (wordVisemes.length > 0) {
      parsedWords.push(wordVisemes);
      totalPhonemes += wordVisemes.length;
    }
  }

  if (totalPhonemes === 0) return [];

  const events: VisemeEvent[] = [];
  // Leave a small initial pause (50ms) and ending pause (100ms)
  const availableTime = Math.max(0.1, totalDuration - 0.15);
  const pauseBetweenWords = 0.04;
  const wordCount = parsedWords.length;
  const totalPauses = Math.max(0, wordCount - 1) * pauseBetweenWords;
  const netSpeechTime = Math.max(0.05, availableTime - totalPauses);
  const basePhonemeDuration = netSpeechTime / totalPhonemes;

  let currentTime = 0.05;

  for (let w = 0; w < parsedWords.length; w++) {
    const wordVisemes = parsedWords[w];
    for (let p = 0; p < wordVisemes.length; p++) {
      const viseme = wordVisemes[p];
      // Vowels naturally last slightly longer than consonants
      const isVowel = ['aa', 'E', 'ih', 'oh', 'ou'].includes(viseme);
      const duration = isVowel ? basePhonemeDuration * 1.25 : basePhonemeDuration * 0.85;

      events.push({
        time: currentTime,
        duration: Math.max(0.04, duration),
        viseme,
        weight: isVowel ? 1.0 : 0.85,
      });

      currentTime += duration;
    }

    currentTime += pauseBetweenWords;
  }

  return events;
}

export abstract class BaseTTSProvider implements ITTSProvider {
  public abstract readonly name: string;
  public abstract speak(text: string, options?: { voice?: string; rate?: number }): Promise<TTSAudioResult>;
  public abstract stop(): void;
}
