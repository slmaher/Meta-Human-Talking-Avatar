/**
 * FacialAnimationController: Preserves natural, photorealistic MetaHuman facial behavior.
 *
 * Core principles:
 *   - Human-cadence natural blinking (asymmetric, fast ~75ms close, 4.5–7.0s intervals)
 *   - Steady, focused portrait gaze (no continuous unnatural darting)
 *   - Subtle, organic brow emphasis during speech
 *   - Strictly decoupled from mouth/speech morph targets
 */

import * as THREE from 'three';
import { NaturalAnimationConfig, MorphMeshBinding } from './types';

export class FacialAnimationController {
  private morphBindings: MorphMeshBinding[] = [];
  private headBone: THREE.Bone | null = null;
  private headRestRotation = new THREE.Euler();
  private headQuat = new THREE.Quaternion();
  private tempEuler = new THREE.Euler();

  private config: Required<NaturalAnimationConfig>;

  // Natural Blink State
  private blinkTimer = 0;
  private nextBlinkTime = 5.0;
  private isBlinking = false;
  private blinkElapsed = 0;
  private blinkDuration = 0.20; // ~200ms natural human blink

  // Speech Head Cadence
  private speechTime = 0;

  constructor(sceneRoot?: THREE.Object3D, config?: NaturalAnimationConfig) {
    this.config = {
      enableBlinking: config?.enableBlinking ?? true,
      enableSaccades: config?.enableSaccades ?? true,
      enableBreathing: config?.enableBreathing ?? false, // Kept off by default to preserve baseline pose
      enableExpressions: config?.enableExpressions ?? true,
      blinkIntervalMin: config?.blinkIntervalMin ?? 4.5,
      blinkIntervalMax: config?.blinkIntervalMax ?? 7.0,
      saccadeIntervalMin: config?.saccadeIntervalMin ?? 4.0,
      saccadeIntervalMax: config?.saccadeIntervalMax ?? 8.0,
    };

    if (sceneRoot) {
      this.bindScene(sceneRoot);
    }
  }

  public bindScene(sceneRoot: THREE.Object3D): void {
    this.morphBindings = [];
    this.headBone = null;

    sceneRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        this.morphBindings.push({
          mesh,
          dict: mesh.morphTargetDictionary,
          influences: mesh.morphTargetInfluences,
        });
      }

      if ((obj as THREE.Bone).isBone) {
        const bone = obj as THREE.Bone;
        if (bone.name.toLowerCase() === 'head' && !this.headBone) {
          this.headBone = bone;
          this.headRestRotation.copy(bone.rotation);
        }
      }
    });

    this.scheduleNextBlink();
  }

  private scheduleNextBlink(): void {
    const range = this.config.blinkIntervalMax - this.config.blinkIntervalMin;
    this.nextBlinkTime = this.config.blinkIntervalMin + Math.random() * range;
    this.blinkTimer = 0;
  }

  /**
   * Updates natural facial dynamics.
   *
   * @param delta Seconds elapsed since last frame
   * @param isSpeaking Whether avatar is currently speaking
   */
  public update(delta: number, isSpeaking = false): void {
    const dt = Math.min(delta, 0.1);

    // 1. Natural Asymmetric Eyelid Blinking
    if (this.config.enableBlinking) {
      this.updateBlinking(dt);
    }

    // 2. Eyebrow Dynamics (subtle conversational emphasis)
    if (this.config.enableExpressions) {
      if (isSpeaking) {
        this.speechTime += dt;
        // Gentle, soft brow lift on emphasis
        const browLift = Math.max(0, Math.sin(this.speechTime * 2.2) * 0.05);
        this.setMorphWeightSafely('browInnerUp', browLift);
      } else {
        this.speechTime = 0;
        this.setMorphWeightSafely('browInnerUp', 0);
      }
    }

    // 3. Subtle Conversational Head Nod
    if (this.headBone) {
      if (isSpeaking) {
        // Microscopic pitch cadence nod (< 0.007 rad ~ 0.4°)
        const nod = Math.sin(this.speechTime * 2.5) * 0.006;
        const tilt = Math.cos(this.speechTime * 1.3) * 0.003;
        this.tempEuler.set(
          this.headRestRotation.x + nod,
          this.headRestRotation.y + tilt,
          this.headRestRotation.z
        );
      } else {
        this.tempEuler.copy(this.headRestRotation);
      }
      this.headBone.rotation.copy(this.tempEuler);
    }
  }

  private updateBlinking(dt: number): void {
    if (!this.isBlinking) {
      this.blinkTimer += dt;
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.isBlinking = true;
        this.blinkElapsed = 0;
      }
    } else {
      this.blinkElapsed += dt;
      const progress = this.blinkElapsed / this.blinkDuration;

      if (progress >= 1.0) {
        this.isBlinking = false;
        this.setMorphWeightSafely('eyeBlinkLeft', 0);
        this.setMorphWeightSafely('eyeBlinkRight', 0);
        this.scheduleNextBlink();
      } else {
        // Asymmetrical human blink: rapid closing (~35% duration), organic opening (~65% duration)
        let blinkWeight = 0;
        if (progress < 0.35) {
          const t = progress / 0.35;
          blinkWeight = t * t;
        } else {
          const t = (progress - 0.35) / 0.65;
          blinkWeight = Math.cos(t * Math.PI * 0.5);
        }
        blinkWeight = Math.max(0, Math.min(1, blinkWeight));

        // Subtle biological asymmetry between eyes (0.98 vs 1.0)
        this.setMorphWeightSafely('eyeBlinkLeft', blinkWeight * 0.98);
        this.setMorphWeightSafely('eyeBlinkRight', blinkWeight * 1.0);
      }
    }
  }

  private setMorphWeightSafely(shapeName: string, weight: number): void {
    for (const { dict, influences } of this.morphBindings) {
      if (dict && dict[shapeName] !== undefined) {
        const idx = dict[shapeName];
        if (influences && idx < influences.length) {
          influences[idx] = weight;
        }
      }
    }
  }

  public resetToRest(): void {
    this.setMorphWeightSafely('eyeBlinkLeft', 0);
    this.setMorphWeightSafely('eyeBlinkRight', 0);
    this.setMorphWeightSafely('browInnerUp', 0);
    if (this.headBone) {
      this.headBone.rotation.copy(this.headRestRotation);
    }
  }
}
