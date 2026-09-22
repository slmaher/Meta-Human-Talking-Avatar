/**
 * SpeechToTextProvider abstraction and Web Speech API implementation.
 * Designed to be modular and replaceable with Cloud STT (Whisper, Deepgram, etc.).
 */

export interface SpeechToTextProvider {
  /** Starts speech recognition listening */
  start(): void;
  /** Stops speech recognition listening */
  stop(): void;
  /** Callback fired for interim recognition results */
  onInterimTranscript?: (text: string) => void;
  /** Callback fired when a final sentence / transcript is recognized */
  onFinalTranscript?: (text: string) => void;
  /** Callback fired on recognition error */
  onError?: (error: Error | string) => void;
  /** Whether the provider is currently actively listening */
  isListening?: () => boolean;
}

// Type declaration for browser SpeechRecognition
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: {
        transcript: string;
        confidence: number;
      };
    };
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

/**
 * WebSpeechSTTProvider: Uses the browser's built-in Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 */
export class WebSpeechSTTProvider implements SpeechToTextProvider {
  private recognition: SpeechRecognitionInstance | null = null;
  private listening = false;
  private language: string;

  public onInterimTranscript?: (text: string) => void;
  public onFinalTranscript?: (text: string) => void;
  public onError?: (error: Error | string) => void;

  constructor(language = 'en-US') {
    this.language = language;
  }

  public isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );
  }

  public isListening(): boolean {
    return this.listening;
  }

  public start(): void {
    if (this.listening) return;

    if (!this.isSupported()) {
      const err = new Error('Speech recognition is not supported in this browser. Please use Chrome, Edge, or text input.');
      if (this.onError) {
        this.onError(err);
      } else {
        console.warn('[WebSpeechSTTProvider]', err.message);
      }
      return;
    }

    try {
      const SpeechRecognitionConstructor = (
        (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition
      );

      if (!SpeechRecognitionConstructor) return;

      const recognition = new SpeechRecognitionConstructor();
      this.recognition = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this.language;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        this.listening = true;
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            finalText += text;
          } else {
            interimText += text;
          }
        }

        if (interimText.trim() && this.onInterimTranscript) {
          this.onInterimTranscript(interimText);
        }

        if (finalText.trim() && this.onFinalTranscript) {
          this.onFinalTranscript(finalText.trim());
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        // Ignore benign aborts or short pauses
        if (event.error === 'no-speech' || event.error === 'aborted') {
          return;
        }
        console.warn('[WebSpeechSTTProvider] Speech recognition error:', event.error);
        if (this.onError) {
          this.onError(new Error(`Speech recognition error: ${event.error}`));
        }
      };

      recognition.onend = () => {
        this.listening = false;
        this.recognition = null;
      };

      recognition.start();
      this.listening = true;
    } catch (err) {
      this.listening = false;
      this.recognition = null;
      if (this.onError) {
        this.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  public stop(): void {
    if (!this.recognition) {
      this.listening = false;
      return;
    }

    try {
      this.recognition.stop();
    } catch (e) {
      console.warn('[WebSpeechSTTProvider] Stop error:', e);
    } finally {
      this.listening = false;
      this.recognition = null;
    }
  }
}
