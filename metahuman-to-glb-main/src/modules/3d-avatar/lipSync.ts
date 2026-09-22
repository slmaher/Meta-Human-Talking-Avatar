/**
 * LipSyncController: Evaluates ARKit facial morph targets against an AudioClock.
 *
 * Designed specifically for realistic MetaHuman character behavior:
 *   - Conversational, natural blendshape weights (avoiding exaggerated mechanical jaw dropping)
 *   - Strictly controls mouth, jaw, and tongue shapes without touching eyes, brows, or gaze
 *   - Coarticulation with plosive priority for crisp closures on P, B, M
 *   - Safe runtime morphTargetDictionary checking
 */

import * as THREE from 'three';
import { AudioClock, NullAudioClock } from './audio/AudioManager';
import {
  ARKitBlendshapeName,
  VisemeId,
  VisemeEvent,
  VisemeMorphWeights,
  MorphMeshBinding,
} from './types';

/**
 * Natural conversational phoneme-to-ARKit blendshape weights.
 * Calibrated specifically for MetaHumans in portrait conversation:
 * realistic, subtle, human-scale deformations rather than exaggerated cartoon openings.
 */
export const VISEME_TO_ARKIT_MAP: Record<VisemeId, VisemeMorphWeights> = {
  // Neutral silence
  sil: {},

  // /ɑ/, /ʌ/ (father, car) - natural open vowel
  aa: {
    jawOpen: 0.34,
    mouthLowerDownLeft: 0.12,
    mouthLowerDownRight: 0.12,
    mouthFunnel: 0.06,
  },

  // /ɛ/, /e/ (bed, ten) - medium open vowel, gentle horizontal stretch
  E: {
    jawOpen: 0.20,
    mouthStretchLeft: 0.16,
    mouthStretchRight: 0.16,
    mouthLowerDownLeft: 0.10,
    mouthLowerDownRight: 0.10,
  },

  // /i/, /ɪ/ (fleece, bit) - narrow aperture, gentle smile stretch
  ih: {
    jawOpen: 0.10,
    mouthSmileLeft: 0.14,
    mouthSmileRight: 0.14,
    mouthStretchLeft: 0.20,
    mouthStretchRight: 0.20,
    mouthLowerDownLeft: 0.04,
    mouthLowerDownRight: 0.04,
  },

  // /ɔ/, /oʊ/ (thought, boat) - rounded vowel
  oh: {
    jawOpen: 0.26,
    mouthFunnel: 0.38,
    mouthPucker: 0.14,
  },

  // /u/, /ʊ/ (goose, boot) - narrow pucker
  ou: {
    jawOpen: 0.12,
    mouthPucker: 0.42,
    mouthFunnel: 0.20,
  },

  // /p/, /b/, /m/ - bilabial closure (zero jaw open, lips gently pressed and rolled)
  PP: {
    jawOpen: 0.0,
    mouthPressLeft: 0.30,
    mouthPressRight: 0.30,
    mouthRollLower: 0.14,
    mouthRollUpper: 0.12,
  },

  // /f/, /v/ - labiodental contact (lower lip under upper teeth)
  FF: {
    jawOpen: 0.08,
    mouthRollLower: 0.26,
    mouthUpperUpLeft: 0.12,
    mouthUpperUpRight: 0.12,
    mouthFunnel: 0.06,
  },

  // /θ/, /ð/ (think, that) - interdental tongue placement
  TH: {
    jawOpen: 0.14,
    tongueOut: 0.20,
    mouthLowerDownLeft: 0.08,
    mouthLowerDownRight: 0.08,
  },

  // /t/, /d/, /l/ - alveolar contact
  DD: {
    jawOpen: 0.14,
    mouthLowerDownLeft: 0.10,
    mouthLowerDownRight: 0.10,
    mouthStretchLeft: 0.08,
    mouthStretchRight: 0.08,
  },

  // /k/, /g/, /ŋ/ - velar closure
  kk: {
    jawOpen: 0.18,
    mouthLowerDownLeft: 0.08,
    mouthLowerDownRight: 0.08,
    mouthStretchLeft: 0.06,
    mouthStretchRight: 0.06,
  },

  // /tʃ/, /dʒ/, /ʃ/ (cheese, shoe) - gentle protrusion
  CH: {
    jawOpen: 0.15,
    mouthFunnel: 0.28,
    mouthLowerDownLeft: 0.08,
    mouthLowerDownRight: 0.08,
    mouthShrugUpper: 0.08,
  },

  // /s/, /z/ (see, zoo) - subtle friction opening
  SS: {
    jawOpen: 0.08,
    mouthStretchLeft: 0.20,
    mouthStretchRight: 0.20,
    mouthLowerDownLeft: 0.04,
    mouthLowerDownRight: 0.04,
  },

  // /n/ (no, net) - nasal alveolar
  nn: {
    jawOpen: 0.12,
    mouthLowerDownLeft: 0.10,
    mouthLowerDownRight: 0.10,
  },

  // /r/ (red, run) - rhotic approximant
  RR: {
    jawOpen: 0.14,
    mouthFunnel: 0.20,
    mouthPucker: 0.16,
    mouthLowerDownLeft: 0.06,
    mouthLowerDownRight: 0.06,
  },
};

/**
 * Strictly restricted to mouth, jaw, and tongue morph targets.
 * DOES NOT include eyes, brows, cheeks, or nose so speech never corrupts facial expressions.
 */
export const SPEECH_MORPH_TARGETS: ARKitBlendshapeName[] = [
  'jawForward',
  'jawLeft',
  'jawRight',
  'jawOpen',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'tongueOut',
];

export class LipSyncController {
  private morphBindings: MorphMeshBinding[] = [];
  private currentWeights: Map<string, number> = new Map();
  private targetWeights: Map<string, number> = new Map();

  private visemeTimeline: VisemeEvent[] = [];
  private audioClock: AudioClock = new NullAudioClock();

  // Natural organic smoothing speed (responsive without mechanical snapping)
  public smoothingSpeed = 24.0;

  constructor(sceneRoot?: THREE.Object3D) {
    if (sceneRoot) {
      this.bindScene(sceneRoot);
    }
  }

  /**
   * Discovers and binds morph targets on scene meshes.
   * Dynamically inspects `mesh.morphTargetDictionary` to guarantee runtime safety.
   */
  public bindScene(sceneRoot: THREE.Object3D): void {
    this.morphBindings = [];
    sceneRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        this.morphBindings.push({
          mesh,
          dict: mesh.morphTargetDictionary,
          influences: mesh.morphTargetInfluences,
        });
      }
    });

    for (const shape of SPEECH_MORPH_TARGETS) {
      this.currentWeights.set(shape, 0);
      this.targetWeights.set(shape, 0);
    }
  }

  public setAudioClock(clock: AudioClock): void {
    this.audioClock = clock;
  }

  public play(visemes: VisemeEvent[], clock?: AudioClock): void {
    this.visemeTimeline = [...visemes].sort((a, b) => a.time - b.time);
    if (clock) {
      this.audioClock = clock;
    }
  }

  public stop(): void {
    this.visemeTimeline = [];
    this.audioClock = new NullAudioClock();
    for (const shape of SPEECH_MORPH_TARGETS) {
      this.targetWeights.set(shape, 0);
    }
  }

  public isSpeaking(): boolean {
    return this.audioClock.isPlaying() && this.visemeTimeline.length > 0;
  }

  /**
   * Evaluates current audio playback position and updates mouth morph targets.
   * Frame-rate independent.
   */
  public update(delta: number): void {
    const dt = Math.max(0.001, Math.min(delta, 0.1));

    // Reset speech target weights
    for (const shape of SPEECH_MORPH_TARGETS) {
      this.targetWeights.set(shape, 0);
    }

    const isAudioPlaying = this.audioClock.isPlaying();
    const currentAudioTime = this.audioClock.getCurrentTime();

    if (isAudioPlaying && this.visemeTimeline.length > 0) {
      const coarticulationWindow = 0.035;

      for (let i = 0; i < this.visemeTimeline.length; i++) {
        const event = this.visemeTimeline[i];
        const start = event.time;
        const end = event.time + event.duration;

        if (currentAudioTime >= start - coarticulationWindow && currentAudioTime <= end + coarticulationWindow) {
          const visemeDef = VISEME_TO_ARKIT_MAP[event.viseme] || {};
          const weight = event.weight ?? 1.0;

          const mid = (start + end) / 2;
          const halfSpan = (event.duration / 2) + coarticulationWindow;
          const dist = Math.abs(currentAudioTime - mid);
          const rawFactor = Math.max(0, 1 - (dist / halfSpan));
          // Smooth Hermite blend
          const factor = rawFactor * rawFactor * (3 - 2 * rawFactor);

          const isPlosive = event.viseme === 'PP';

          for (const [shape, targetVal] of Object.entries(visemeDef)) {
            if (targetVal !== undefined) {
              const cur = this.targetWeights.get(shape) || 0;
              const contribution = targetVal * weight * factor;
              this.targetWeights.set(shape, Math.min(1.0, Math.max(cur, contribution)));
            }
          }

          // Plosive priority rule: actively suppress jawOpen during plosive closures
          if (isPlosive && factor > 0.35) {
            const curJaw = this.targetWeights.get('jawOpen') || 0;
            this.targetWeights.set('jawOpen', curJaw * (1 - factor));
          }
        }
      }
    }

    // Exponential smoothing for natural fleshy transitions
    const smoothingAlpha = 1.0 - Math.exp(-this.smoothingSpeed * dt);

    for (const shape of SPEECH_MORPH_TARGETS) {
      const current = this.currentWeights.get(shape) || 0;
      const target = this.targetWeights.get(shape) || 0;
      const next = current + (target - current) * smoothingAlpha;
      const finalVal = Math.abs(next) < 0.0005 ? 0 : next;
      this.currentWeights.set(shape, finalVal);

      this.applyMorphWeightSafely(shape, finalVal);
    }
  }

  private applyMorphWeightSafely(shapeName: string, weight: number): void {
    for (const { dict, influences } of this.morphBindings) {
      if (dict && dict[shapeName] !== undefined) {
        const idx = dict[shapeName];
        if (influences && idx < influences.length) {
          influences[idx] = weight;
        }
      }
    }
  }

  public resetImmediately(): void {
    for (const shape of SPEECH_MORPH_TARGETS) {
      this.currentWeights.set(shape, 0);
      this.targetWeights.set(shape, 0);
      this.applyMorphWeightSafely(shape, 0);
    }
  }

  public getActiveWeights(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, val] of this.currentWeights.entries()) {
      if (val > 0.001) {
        result[key] = Math.round(val * 1000) / 1000;
      }
    }
    return result;
  }
}
