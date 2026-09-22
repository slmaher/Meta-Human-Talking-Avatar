/**
 * Types and interfaces for the MetaHuman 3D Avatar system.
 */

import * as THREE from 'three';

/**
 * Standard ARKit 52 morph target names available on MetaHuman meshes.
 */
export type ARKitBlendshapeName =
  // Eye
  | 'eyeBlinkLeft'
  | 'eyeLookDownLeft'
  | 'eyeLookInLeft'
  | 'eyeLookOutLeft'
  | 'eyeLookUpLeft'
  | 'eyeSquintLeft'
  | 'eyeWideLeft'
  | 'eyeBlinkRight'
  | 'eyeLookDownRight'
  | 'eyeLookInRight'
  | 'eyeLookOutRight'
  | 'eyeLookUpRight'
  | 'eyeSquintRight'
  | 'eyeWideRight'
  // Jaw
  | 'jawForward'
  | 'jawLeft'
  | 'jawRight'
  | 'jawOpen'
  // Mouth
  | 'mouthClose' // Synthesized via press/jaw if missing in mesh
  | 'mouthFunnel'
  | 'mouthPucker'
  | 'mouthLeft'
  | 'mouthRight'
  | 'mouthSmileLeft'
  | 'mouthSmileRight'
  | 'mouthFrownLeft'
  | 'mouthFrownRight'
  | 'mouthDimpleLeft'
  | 'mouthDimpleRight'
  | 'mouthStretchLeft'
  | 'mouthStretchRight'
  | 'mouthRollLower'
  | 'mouthRollUpper'
  | 'mouthShrugLower'
  | 'mouthShrugUpper'
  | 'mouthPressLeft'
  | 'mouthPressRight'
  | 'mouthLowerDownLeft'
  | 'mouthLowerDownRight'
  | 'mouthUpperUpLeft'
  | 'mouthUpperUpRight'
  // Brow
  | 'browDownLeft'
  | 'browDownRight'
  | 'browInnerUp'
  | 'browOuterUpLeft'
  | 'browOuterUpRight'
  // Cheek & Nose
  | 'cheekPuff'
  | 'cheekSquintLeft'
  | 'cheekSquintRight'
  | 'noseSneerLeft'
  | 'noseSneerRight'
  // Tongue
  | 'tongueOut';

/**
 * Standard Viseme identifiers mapped to phonemes.
 */
export type VisemeId =
  | 'sil' // silence / neutral rest
  | 'aa'  // ah, father, car
  | 'E'   // eh, bed, pet
  | 'ih'  // ee, fleece, bit
  | 'oh'  // oh, thought, boat
  | 'ou'  // oo, goose, boot
  | 'PP'  // p, b, m (bilabial closure)
  | 'FF'  // f, v (labiodental)
  | 'TH'  // th (dental / tongue tip)
  | 'DD'  // t, d, n, l (alveolar)
  | 'kk'  // k, g, ng (velar)
  | 'CH'  // ch, j, sh (postalveolar)
  | 'SS'  // s, z (alveolar fricative)
  | 'nn'  // n (nasal)
  | 'RR'; // r (rhotic)

/**
 * Represents a timed viseme event along a speech timeline.
 */
export interface VisemeEvent {
  /** Offset time in seconds from speech start */
  time: number;
  /** Duration of this viseme event in seconds */
  duration: number;
  /** Viseme identifier */
  viseme: VisemeId;
  /** Intensity multiplier [0..1], defaults to 1.0 */
  weight?: number;
}

/**
 * Maps a single viseme to target ARKit blendshape weights.
 */
export type VisemeMorphWeights = Partial<Record<ARKitBlendshapeName, number>>;

/**
 * Represents a mesh containing morph targets in Three.js.
 */
export interface MorphMeshBinding {
  mesh: THREE.Mesh;
  dict: Record<string, number>;
  influences: number[];
}

import type { AudioClock } from './audio/AudioManager';

/**
 * Output of a TTS provider.
 */
export interface TTSAudioResult {
  /** Audio URL or Blob URL for playback */
  audioUrl?: string;
  /** Optional decoded AudioBuffer for WebAudio playback */
  audioBuffer?: AudioBuffer;
  /** Optional native SpeechSynthesisUtterance */
  utterance?: SpeechSynthesisUtterance;
  /** Timed visemes synchronized to the audio */
  visemes: VisemeEvent[];
  /** Total audio duration in seconds */
  duration: number;
  /** Hardware / playback AudioClock associated with this speech */
  audioClock?: AudioClock;
}

/**
 * TTS Provider interface.
 */
export interface ITTSProvider {
  /** Unique provider name */
  readonly name: string;
  /** Synthesize text into speech audio and synchronized visemes */
  speak(text: string, options?: { voice?: string; rate?: number }): Promise<TTSAudioResult>;
  /** Stop any currently ongoing speech */
  stop(): void;
}

/**
 * LLM Provider interface.
 */
export interface ILLMProvider {
  readonly name: string;
  sendMessage(prompt: string, history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): Promise<string>;
}

/**
 * Natural facial animation configuration.
 */
export interface NaturalAnimationConfig {
  enableBlinking?: boolean;
  enableSaccades?: boolean;
  enableBreathing?: boolean;
  enableExpressions?: boolean;
  blinkIntervalMin?: number; // seconds, default 3.0
  blinkIntervalMax?: number; // seconds, default 6.0
  saccadeIntervalMin?: number; // seconds, default 1.5
  saccadeIntervalMax?: number; // seconds, default 3.5
}
