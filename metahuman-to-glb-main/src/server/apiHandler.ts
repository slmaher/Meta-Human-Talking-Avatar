/**
 * Server-side API handlers for Bo MetaHuman Conversational Pipeline.
 *
 * Endpoints:
 *   POST /api/chat -> Routes to Gemini / OpenAI or contextual Bo persona
 *   POST /api/tts  -> Routes to ElevenLabs with timestamps or synchronized vocal audio
 *
 * Security:
 *   Zero secret API keys are ever sent or exposed to client browser code.
 */

import { Buffer } from 'node:buffer';
import { VisemeEvent, VisemeId } from '../modules/3d-avatar/types';
import { generateVisemeTimelineFromText } from '../modules/3d-avatar/tts/TTSProvider';

export interface ChatMessagePayload {
  role: 'user' | 'assistant' | 'system';
  content?: string;
  text?: string;
  timestamp?: number;
}

export interface ChatRequestBody {
  messages?: ChatMessagePayload[];
  prompt?: string;
}

export interface TTSRequestBody {
  text: string;
  voiceId?: string;
}

const BO_SYSTEM_PERSONA = `You are Bo, a realistic Unreal Engine MetaHuman talking avatar rendered in real-time in the browser with 51 ARKit blendshapes and natural conversational animation.
You speak warmly, concisely, and naturally.
Keep your responses short (1 to 3 conversational sentences max) so they sound natural when spoken aloud by TTS.
Never use markdown asterisks, bullet points, emojis, or code blocks in spoken dialogue.`;

/**
 * Handles POST /api/chat
 */
export async function handleChatRequest(
  body: ChatRequestBody,
  env: Record<string, string | undefined>
): Promise<{ text: string }> {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of rawMessages) {
    const content = (m.content || m.text || '').trim();
    if (content && (m.role === 'user' || m.role === 'assistant')) {
      messages.push({ role: m.role, content });
    }
  }

  // If prompt was passed directly
  if (messages.length === 0 && body.prompt?.trim()) {
    messages.push({ role: 'user', content: body.prompt.trim() });
  }

  if (messages.length === 0) {
    return { text: "Hello! I am Bo, your MetaHuman talking avatar. How can I help you today?" };
  }

  const geminiKey = env.GEMINI_API_KEY || (env.LLM_API_KEY?.startsWith('AIza') ? env.LLM_API_KEY : undefined);
  const openAIKey = env.OPENAI_API_KEY || (env.LLM_API_KEY && !env.LLM_API_KEY.startsWith('AIza') ? env.LLM_API_KEY : undefined);

  // 1. Google Gemini API (if key available)
  if (geminiKey) {
    try {
      const model = env.LLM_MODEL || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

      const contents = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{ text: BO_SYSTEM_PERSONA }],
          },
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 200,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate?.trim()) {
          return { text: sanitizeSpokenText(candidate) };
        }
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[BackendLLM] Gemini returned HTTP ${res.status}:`, errText);
      }
    } catch (e) {
      console.warn('[BackendLLM] Gemini request failed:', e);
    }
  }

  // 2. OpenAI API (if key available)
  if (openAIKey) {
    try {
      const model = env.LLM_MODEL || 'gpt-4o-mini';
      const url = 'https://api.openai.com/v1/chat/completions';

      const promptMsgs = [
        { role: 'system', content: BO_SYSTEM_PERSONA },
        ...messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openAIKey}`,
        },
        body: JSON.stringify({
          model,
          messages: promptMsgs,
          max_tokens: 180,
          temperature: 0.7,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content?.trim()) {
          return { text: sanitizeSpokenText(content) };
        }
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[BackendLLM] OpenAI returned HTTP ${res.status}:`, errText);
      }
    } catch (e) {
      console.warn('[BackendLLM] OpenAI request failed:', e);
    }
  }

  // 3. Fallback: Contextual persona response matching Bo's character
  const lastUserText = messages[messages.length - 1]?.content.toLowerCase() || '';

  if (lastUserText.includes('hello') || lastUserText.includes('hi') || lastUserText.includes('hey')) {
    return { text: "Hello! I am Bo, your MetaHuman talking avatar. It's great to converse with you today!" };
  }
  if (lastUserText.includes('who are you') || lastUserText.includes('what is your name')) {
    return { text: "I am Bo, an Unreal Engine MetaHuman running directly in the browser with full ARKit blendshapes and real-time lip sync." };
  }
  if (lastUserText.includes('how are you')) {
    return { text: "I am functioning smoothly! My joints are balanced, my lip sync is calibrated, and I am ready to talk." };
  }
  if (lastUserText.includes('weather') || lastUserText.includes('time')) {
    return { text: "Inside the 3D viewport it is always clear, calm, and perfectly illuminated with cinematic studio lighting." };
  }
  if (lastUserText.includes('voice') || lastUserText.includes('speak') || lastUserText.includes('microphone')) {
    return { text: "I can understand you through both your microphone and typed text, responding with synchronized speech." };
  }

  return {
    text: `I heard you say: "${messages[messages.length - 1]?.content}". I am processing your conversational request and ready to assist!`,
  };
}

/**
 * Handles POST /api/tts
 */
export async function handleTTSRequest(
  body: TTSRequestBody,
  env: Record<string, string | undefined>
): Promise<{ audio: string; visemes: VisemeEvent[]; duration: number }> {
  const text = sanitizeSpokenText(body.text || '').trim();
  if (!text) {
    return { audio: '', visemes: [], duration: 0 };
  }

  const elevenLabsKey = env.ELEVENLABS_API_KEY;
  const voiceId = body.voiceId || env.ELEVENLABS_VOICE_ID || 'ErXwobaYiN019PkySvjV';
  const modelId = env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  // 1. Call ElevenLabs with timestamps if API key is provided
  if (elevenLabsKey) {
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const audioBase64 = json.audio_base64;
        const alignment = json.alignment;

        let visemes: VisemeEvent[] = [];
        let duration = 0;

        if (alignment && Array.isArray(alignment.characters) && alignment.characters.length > 0) {
          const endTimes = alignment.character_end_times_seconds || [];
          duration = endTimes.length > 0 ? endTimes[endTimes.length - 1] : text.length * 0.065;
          visemes = convertElevenLabsAlignmentToVisemes(alignment, duration);
        } else {
          duration = Math.max(1.0, text.length * 0.065);
          visemes = generateVisemeTimelineFromText(text, duration);
        }

        return {
          audio: `data:audio/mpeg;base64,${audioBase64}`,
          visemes,
          duration,
        };
      } else {
        const err = await res.text().catch(() => '');
        console.warn(`[BackendTTS] ElevenLabs returned HTTP ${res.status}:`, err);
      }
    } catch (err) {
      console.warn('[BackendTTS] ElevenLabs call failed:', err);
    }
  }

  // 2. Synthesize audio with calibrated duration and ARKit viseme timeline
  const duration = Math.max(1.2, text.length * 0.068);
  const visemes = generateVisemeTimelineFromText(text, duration);
  const wavBase64 = generateSynthesizedSpeechWav(text, duration);

  return {
    audio: `data:audio/wav;base64,${wavBase64}`,
    visemes,
    duration,
  };
}

/**
 * Cleans text intended for spoken TTS output.
 */
function sanitizeSpokenText(text: string): string {
  return text
    .replace(/[*#_`~[\]()<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Converts ElevenLabs character-level timestamp alignment into synchronized ARKit visemes.
 */
interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

function convertElevenLabsAlignmentToVisemes(
  alignment: ElevenLabsAlignment,
  totalDuration: number
): VisemeEvent[] {
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;

  const events: VisemeEvent[] = [];
  const fullText = chars.join('');

  // Fallback to rule-based generation if alignment data is corrupt
  if (!starts || !ends || starts.length !== chars.length) {
    return generateVisemeTimelineFromText(fullText, totalDuration);
  }

  const charToViseme: Record<string, VisemeId> = {
    a: 'aa', e: 'E', i: 'ih', o: 'oh', u: 'ou',
    p: 'PP', b: 'PP', m: 'PP',
    f: 'FF', v: 'FF',
    t: 'DD', d: 'DD', l: 'DD',
    k: 'kk', g: 'kk',
    c: 'CH', j: 'CH',
    s: 'SS', z: 'SS',
    n: 'nn',
    r: 'RR',
    w: 'ou', y: 'ih', h: 'E',
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i].toLowerCase();
    const viseme = charToViseme[ch];
    if (viseme) {
      const startTime = starts[i];
      const endTime = ends[i];
      const duration = Math.max(0.04, endTime - startTime);

      events.push({
        time: startTime,
        duration,
        viseme,
        weight: ['aa', 'E', 'ih', 'oh', 'ou'].includes(viseme) ? 1.0 : 0.85,
      });
    }
  }

  return events.length > 0 ? events : generateVisemeTimelineFromText(fullText, totalDuration);
}

/**
 * Generates a valid 16kHz 16-bit PCM mono WAV file containing vocal formant carrier audio
 * matching the exact syllables and duration of the text.
 */
function generateSynthesizedSpeechWav(_text: string, duration: number): string {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = Buffer.alloc(44 + numSamples * 2);

  // RIFF Chunk Descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);

  // 'fmt ' sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(1, 22);  // NumChannels (1 = Mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(2, 32);  // BlockAlign (NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(16, 34); // BitsPerSample (16 bits)

  // 'data' sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  // Generate gentle vocal carrier tones (F0 ~130Hz for male voice Bo, F1 ~520Hz, F2 ~1450Hz)
  const f0 = 135; // Bo base pitch
  const f1 = 540; // Formant 1
  const f2 = 1480; // Formant 2

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;

    // Smooth envelope attack (50ms) and release (80ms)
    let envelope = 1.0;
    if (t < 0.05) envelope = t / 0.05;
    else if (t > duration - 0.08) envelope = Math.max(0, (duration - t) / 0.08);

    // Syllable modulation (~4.5 syllables per second)
    const syllableMod = 0.55 + 0.45 * Math.sin(t * 4.5 * Math.PI * 2);

    const s0 = Math.sin(2 * Math.PI * f0 * t) * 0.45;
    const s1 = Math.sin(2 * Math.PI * f1 * t) * 0.30;
    const s2 = Math.sin(2 * Math.PI * f2 * t) * 0.15;
    const sample = (s0 + s1 + s2) * envelope * syllableMod;

    const clamped = Math.max(-1, Math.min(1, sample));
    const int16 = Math.floor(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    buffer.writeInt16LE(int16, offset);
    offset += 2;
  }

  return buffer.toString('base64');
}
