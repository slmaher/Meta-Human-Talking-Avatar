/**
 * MockTTSProvider: Standalone, zero-external-dependency speech testing with synthetic audio
 * and hardware-synchronized WebAudioClock.
 */

import { BaseTTSProvider, generateVisemeTimelineFromText } from './TTSProvider';
import { TTSAudioResult } from '../types';
import { WebAudioClock } from '../audio/AudioManager';

export class MockTTSProvider extends BaseTTSProvider {
  public readonly name = 'MockTTS';
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentClock: WebAudioClock | null = null;

  public async speak(text: string, options?: { rate?: number }): Promise<TTSAudioResult> {
    this.stop();

    const rate = options?.rate || 1.0;
    const charCount = text.trim().length;
    const wordCount = text.trim().split(/\s+/).length;
    const estimatedDuration = Math.max(0.8, (wordCount * 0.38 + charCount * 0.02) / rate);

    const visemes = generateVisemeTimelineFromText(text, estimatedDuration);

    let audioBuffer: AudioBuffer | undefined;
    let audioClock: WebAudioClock | undefined;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        if (!this.audioContext) {
          this.audioContext = new AudioCtx();
        }
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }

        const sampleRate = this.audioContext.sampleRate;
        const totalSamples = Math.floor(sampleRate * estimatedDuration);
        audioBuffer = this.audioContext.createBuffer(1, totalSamples, sampleRate);
        const channelData = audioBuffer.getChannelData(0);

        // Vocal formant synthesis (F0 ~ 125Hz male tone)
        const f0 = 125.0;
        for (let i = 0; i < totalSamples; i++) {
          const t = i / sampleRate;
          const env = Math.sin(Math.min(Math.PI, (t / estimatedDuration) * Math.PI));
          const formant1 = Math.sin(2 * Math.PI * f0 * t) * 0.4;
          const formant2 = Math.sin(2 * Math.PI * (f0 * 2) * t) * 0.25;
          const formant3 = Math.sin(2 * Math.PI * 750 * t) * 0.15;
          channelData[i] = (formant1 + formant2 + formant3) * env * 0.15;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        const startTime = this.audioContext.currentTime;
        audioClock = new WebAudioClock(this.audioContext, startTime, estimatedDuration);
        this.currentClock = audioClock;

        source.onended = () => {
          audioClock?.markEnded();
          if (this.currentSource === source) {
            this.currentSource = null;
          }
        };

        source.start(startTime);
        this.currentSource = source;
      }
    } catch (err) {
      console.warn('[MockTTS] WebAudio synthesis fallback:', err);
    }

    return {
      audioBuffer,
      visemes,
      duration: estimatedDuration,
      audioClock,
    };
  }

  public stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch { /* ignore */ }
      this.currentSource = null;
    }
    if (this.currentClock) {
      this.currentClock.markEnded();
      this.currentClock = null;
    }
  }
}
