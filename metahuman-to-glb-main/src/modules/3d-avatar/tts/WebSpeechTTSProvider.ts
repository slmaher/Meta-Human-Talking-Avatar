/**
 * WebSpeechTTSProvider: Uses native window.speechSynthesis with a SpeechSynthesisClock
 * that calibrates lip sync strictly against onstart latency and onboundary events.
 */

import { BaseTTSProvider, generateVisemeTimelineFromText } from './TTSProvider';
import { TTSAudioResult } from '../types';
import { SpeechSynthesisClock } from '../audio/AudioManager';

export class WebSpeechTTSProvider extends BaseTTSProvider {
  public readonly name = 'WebSpeechTTS';
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentClock: SpeechSynthesisClock | null = null;

  public async speak(text: string, options?: { voice?: string; rate?: number }): Promise<TTSAudioResult> {
    this.stop();

    const rate = options?.rate || 1.0;
    const charCount = text.trim().length;
    const wordCount = text.trim().split(/\s+/).length;
    const estimatedDuration = Math.max(0.8, (wordCount * 0.38 + charCount * 0.02) / rate);

    const visemes = generateVisemeTimelineFromText(text, estimatedDuration);
    const clock = new SpeechSynthesisClock(estimatedDuration);
    this.currentClock = clock;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = 0.95;

      if (options?.voice) {
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find(
          (v) => v.name.toLowerCase().includes(options.voice!.toLowerCase()) || v.lang.includes(options.voice!)
        );
        if (match) utterance.voice = match;
      }

      utterance.onstart = () => {
        clock.onSpeechStarted();
      };

      utterance.onboundary = (e) => {
        clock.onBoundary(e.charIndex, text.length);
      };

      utterance.onend = () => {
        clock.onSpeechEnded();
      };

      utterance.onerror = () => {
        clock.onSpeechEnded();
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    }

    return {
      visemes,
      duration: estimatedDuration,
      audioClock: clock,
    };
  }

  public stop(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (this.currentClock) {
      this.currentClock.onSpeechEnded();
      this.currentClock = null;
    }
    this.currentUtterance = null;
  }
}
