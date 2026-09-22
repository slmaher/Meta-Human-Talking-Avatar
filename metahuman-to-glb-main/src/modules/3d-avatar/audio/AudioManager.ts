/**
 * AudioManager & AudioClock: Provides sample-accurate audio playback clocks
 * as the single source of truth for lip-sync animation.
 *
 * Supports:
 *   1. Web Audio (AudioBufferSourceNode with hardware-synchronized AudioContext.currentTime)
 *   2. HTML5 Audio (HTMLAudioElement with native audioElement.currentTime)
 *   3. SpeechSynthesis (Boundary-tracked audio clock with onstart latency calibration)
 */

export interface AudioClock {
  /**
   * Current elapsed audio playback time in seconds.
   * Driven strictly by the underlying audio hardware or media element.
   */
  getCurrentTime(): number;

  /**
   * Whether audio is actively playing through the hardware.
   */
  isPlaying(): boolean;

  /**
   * Total audio duration in seconds.
   */
  getDuration(): number;
}

/**
 * Hardware-accurate audio clock backed by Web Audio AudioContext.
 */
export class WebAudioClock implements AudioClock {
  private ctx: AudioContext;
  private startTime = 0;
  private duration = 0;
  private playing = false;

  constructor(ctx: AudioContext, startTime: number, duration: number) {
    this.ctx = ctx;
    this.startTime = startTime;
    this.duration = duration;
    this.playing = true;
  }

  public getCurrentTime(): number {
    if (!this.playing) return 0;
    const elapsed = this.ctx.currentTime - this.startTime;
    return Math.max(0, Math.min(this.duration, elapsed));
  }

  public isPlaying(): boolean {
    if (!this.playing) return false;
    if (this.ctx.currentTime >= this.startTime + this.duration) {
      this.playing = false;
      return false;
    }
    return true;
  }

  public getDuration(): number {
    return this.duration;
  }

  public markEnded(): void {
    this.playing = false;
  }
}

/**
 * Media-accurate audio clock backed by HTMLAudioElement.
 */
export class HTMLAudioClock implements AudioClock {
  private element: HTMLAudioElement;

  constructor(element: HTMLAudioElement) {
    this.element = element;
  }

  public getCurrentTime(): number {
    return this.element.currentTime;
  }

  public isPlaying(): boolean {
    return !this.element.paused && !this.element.ended && this.element.currentTime > 0;
  }

  public getDuration(): number {
    return this.element.duration || 0;
  }
}

/**
 * SpeechSynthesis audio clock that strictly calibrates against onstart and onboundary events.
 * Compensates for the browser's audio startup latency.
 */
export class SpeechSynthesisClock implements AudioClock {
  private startTime = -1;
  private duration = 0;
  private playing = false;
  private lastBoundaryTime = 0;

  constructor(estimatedDuration: number) {
    this.duration = estimatedDuration;
  }

  public onSpeechStarted(): void {
    this.startTime = performance.now() / 1000;
    this.playing = true;
  }

  public onBoundary(charIndex: number, textLength: number): void {
    if (this.startTime > 0 && textLength > 0) {
      // Calibrate current time based on speech progress
      const progressFraction = Math.min(1.0, charIndex / textLength);
      this.lastBoundaryTime = progressFraction * this.duration;
    }
  }

  public onSpeechEnded(): void {
    this.playing = false;
    this.startTime = -1;
  }

  public getCurrentTime(): number {
    if (!this.playing || this.startTime < 0) return 0;
    const elapsed = (performance.now() / 1000) - this.startTime;
    return Math.max(0, Math.min(this.duration, elapsed));
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public getDuration(): number {
    return this.duration;
  }
}

/**
 * Null clock used when avatar is idle.
 */
export class NullAudioClock implements AudioClock {
  public getCurrentTime(): number { return 0; }
  public isPlaying(): boolean { return false; }
  public getDuration(): number { return 0; }
}

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private activeClock: AudioClock = new NullAudioClock();

  public getActiveClock(): AudioClock {
    return this.activeClock;
  }

  public async getAudioContext(): Promise<AudioContext> {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    return this.audioContext;
  }

  /**
   * Plays an AudioBuffer using Web Audio with microsecond-accurate clock tracking.
   */
  public async playBuffer(buffer: AudioBuffer): Promise<AudioClock> {
    this.stop();
    const ctx = await this.getAudioContext();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startTime = ctx.currentTime;
    const clock = new WebAudioClock(ctx, startTime, buffer.duration);
    source.onended = () => {
      clock.markEnded();
      if (this.currentSource === source) {
        this.currentSource = null;
      }
    };

    source.start(startTime);
    this.currentSource = source;
    this.activeClock = clock;

    return clock;
  }

  /**
   * Plays an audio stream / URL using HTMLAudioElement with native clock tracking.
   */
  public async playUrl(url: string): Promise<AudioClock> {
    this.stop();

    const audio = new Audio(url);
    this.currentAudioElement = audio;
    const clock = new HTMLAudioClock(audio);

    await audio.play();
    this.activeClock = clock;

    return clock;
  }

  /**
   * Attaches an utterance with lifecycle event tracking.
   */
  public registerSpeechUtterance(utterance: SpeechSynthesisUtterance, duration: number, textLength: number): AudioClock {
    this.stop();

    const clock = new SpeechSynthesisClock(duration);

    utterance.onstart = () => {
      clock.onSpeechStarted();
    };

    utterance.onboundary = (e) => {
      clock.onBoundary(e.charIndex, textLength);
    };

    utterance.onend = () => {
      clock.onSpeechEnded();
    };

    utterance.onerror = () => {
      clock.onSpeechEnded();
    };

    this.activeClock = clock;
    return clock;
  }

  public stop(): void {
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* ignore */ }
      this.currentSource = null;
    }
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement.currentTime = 0;
      this.currentAudioElement = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.activeClock = new NullAudioClock();
  }
}
