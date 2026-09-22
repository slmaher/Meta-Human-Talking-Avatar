/**
 * ElevenLabsTTSProvider: High-fidelity speech synthesis adapter.
 * Securely calls the backend endpoint (/api/tts) so API keys are never exposed in browser code.
 * Returns an HTMLAudioClock backed by the active HTMLAudioElement for sample-accurate ARKit lip sync.
 */

import { BaseTTSProvider, generateVisemeTimelineFromText } from './TTSProvider';
import { TTSAudioResult, VisemeEvent } from '../types';
import { HTMLAudioClock, NullAudioClock } from '../audio/AudioManager';

export interface ElevenLabsConfig {
  endpointUrl?: string;
  voiceId?: string;
}

export class ElevenLabsTTSProvider extends BaseTTSProvider {
  public readonly name = 'ElevenLabsTTS';
  private endpointUrl: string;
  private voiceId?: string;
  private currentAudio: HTMLAudioElement | null = null;
  private currentClock: HTMLAudioClock | null = null;

  constructor(config: ElevenLabsConfig = {}) {
    super();
    this.endpointUrl = config.endpointUrl || '/api/tts';
    this.voiceId = config.voiceId;
  }

  public async speak(text: string): Promise<TTSAudioResult> {
    this.stop();

    const response = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId: this.voiceId }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`[ElevenLabsTTS] Backend error ${response.status}: ${response.statusText} ${err}`);
    }

    const data = await response.json();
    const audioSrc = data.audio || data.audioUrl;
    const duration = data.duration || Math.max(1.0, text.length * 0.065);
    const visemes: VisemeEvent[] = data.visemes?.length > 0
      ? data.visemes
      : generateVisemeTimelineFromText(text, duration);

    if (!audioSrc) {
      console.warn('[ElevenLabsTTS] No audio payload returned from backend');
      return {
        visemes,
        duration,
        audioClock: new NullAudioClock(),
      };
    }

    const clock = this.playAudio(audioSrc);

    return {
      audioUrl: audioSrc,
      visemes,
      duration,
      audioClock: clock,
    };
  }

  private playAudio(url: string): HTMLAudioClock {
    const audio = new Audio(url);
    this.currentAudio = audio;
    const clock = new HTMLAudioClock(audio);
    this.currentClock = clock;

    audio.play().catch((e) => {
      console.warn('[ElevenLabsTTS] Play prevented (audio autoplay policy):', e);
    });

    return clock;
  }

  public getCurrentAudio(): HTMLAudioElement | null {
    return this.currentAudio;
  }

  public stop(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch (e) {
        console.warn('[ElevenLabsTTS] Error stopping audio:', e);
      }
      this.currentAudio = null;
    }
    this.currentClock = null;
  }
}
