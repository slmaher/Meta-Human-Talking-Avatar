/**
 * BodyAnimationController: Discrete, natural conversational body animation system.
 *
 * Architecture:
 *   1. Authored Rest Pose: Preserves the exact MetaHuman bind/settled pose.
 *   2. Microscopic Respiration: Minimal thoracic expansion (< 0.0012 rad) and clavicle lift (< 0.0015 rad).
 *   3. Infrequent Posture Shifts: Discrete, slow pelvic weight adjustments (every 12–25s) with smooth cubic easing.
 *   4. Discrete Conversational Gestures:
 *      - IDLE → ATTACK (~0.6s) → HOLD (0.8–1.2s) → RELEASE (~0.7s) → COOLDOWN (6–14s).
 *      - ZERO continuous oscillations or repetitive loops.
 *      - Triggered only during speech, returning cleanly to neutral rest.
 */

import * as THREE from 'three';

interface TrackedBone {
  bone: THREE.Bone;
  restPosition: THREE.Vector3;
  restQuaternion: THREE.Quaternion;
}

type GesturePhase = 'IDLE' | 'ATTACK' | 'HOLD' | 'RELEASE';

export interface GestureDefinition {
  name: string;
  isLeftArm: boolean;
  upperArmRot: THREE.Euler; // Subtle target rotation offset
  lowerArmRot: THREE.Euler; // Subtle target rotation offset
  handRot: THREE.Euler;     // Subtle target rotation offset
}

// Discrete conversational gestures: subtle, human-scale emphasis cues
const CONVERSATIONAL_GESTURES: GestureDefinition[] = [
  // 1. Subtle right hand conversational lift
  {
    name: 'right_emphasis',
    isLeftArm: false,
    upperArmRot: new THREE.Euler(0.020, -0.015, -0.015),
    lowerArmRot: new THREE.Euler(0.035, 0.020, 0.010),
    handRot: new THREE.Euler(0.015, 0.010, 0.015),
  },
  // 2. Subtle left hand conversational open
  {
    name: 'left_open',
    isLeftArm: true,
    upperArmRot: new THREE.Euler(0.018, 0.012, 0.012),
    lowerArmRot: new THREE.Euler(0.030, -0.018, -0.010),
    handRot: new THREE.Euler(0.015, -0.010, -0.015),
  },
  // 3. Very subtle bilateral thoracic open
  {
    name: 'subtle_bilateral',
    isLeftArm: false,
    upperArmRot: new THREE.Euler(0.012, -0.010, -0.008),
    lowerArmRot: new THREE.Euler(0.022, 0.012, 0.008),
    handRot: new THREE.Euler(0.010, 0.008, 0.010),
  },
];

export interface BodyAnimationOptions {
  enableBreathing?: boolean;
}

export class BodyAnimationController {
  private bones: Map<string, TrackedBone> = new Map();
  private isBound = false;

  // Breathing accumulator
  private breathTime = 0;
  private readonly breathingFreq = (13 / 60) * Math.PI * 2; // ~13 breaths per minute

  // Posture weight shift state (discrete, infrequent: every 12–25 seconds)
  private postureTimer = 0;
  private nextPostureTime = 14.0;
  private isShiftingPosture = false;
  private shiftProgress = 0;
  private shiftDuration = 2.8; // Slow, gentle 2.8s transition
  private startPostureOffset = new THREE.Vector2(0, 0);
  private currentPostureOffset = new THREE.Vector2(0, 0);
  private targetPostureOffset = new THREE.Vector2(0, 0);

  // Discrete Gesture State Machine
  private gesturePhase: GesturePhase = 'IDLE';
  private gestureTimer = 0;
  private gestureWeight = 0; // 0.0 to 1.0
  private currentGesture: GestureDefinition = CONVERSATIONAL_GESTURES[0];
  private cooldownTimer = 0;
  private cooldownDuration = 8.0; // 6 to 14s cooldown between gestures

  // Preallocated math objects
  private tempEuler = new THREE.Euler();
  private idleQuat = new THREE.Quaternion();
  private gestureQuat = new THREE.Quaternion();

  constructor(sceneRoot?: THREE.Object3D, _options?: BodyAnimationOptions) {
    if (sceneRoot) {
      this.bindSkeleton(sceneRoot);
    }
  }

  public bindSkeleton(sceneRoot: THREE.Object3D): void {
    this.bones.clear();

    const targetBoneNames = [
      'pelvis',
      'spine_01',
      'spine_02',
      'spine_03',
      'spine_04',
      'spine_05',
      'clavicle_l',
      'clavicle_r',
      'upperarm_l',
      'upperarm_r',
      'lowerarm_l',
      'lowerarm_r',
      'hand_l',
      'hand_r',
    ];

    sceneRoot.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) {
        const bone = obj as THREE.Bone;
        const name = bone.name.toLowerCase();

        for (const target of targetBoneNames) {
          if (name === target || name.endsWith(`_${target}`) || name.endsWith(`:${target}`)) {
            if (!this.bones.has(target)) {
              this.bones.set(target, {
                bone,
                restPosition: bone.position.clone(),
                restQuaternion: bone.quaternion.clone(),
              });
            }
          }
        }
      }
    });

    this.isBound = this.bones.size > 0;
  }

  public getBoundBoneNames(): string[] {
    return Array.from(this.bones.keys());
  }

  /**
   * Updates discrete body animation layers.
   *
   * @param delta Seconds elapsed since previous frame
   * @param isSpeaking Whether conversational speech is active
   */
  public update(delta: number, isSpeaking = false): void {
    if (!this.isBound) return;

    const dt = Math.min(delta, 0.1);
    this.breathTime += dt;

    // 1. Infrequent, Discrete Posture Shift (every 12–25 seconds)
    this.updatePostureShift(dt);

    // 2. Discrete Conversational Gesture State Machine
    this.updateGestureStateMachine(dt, isSpeaking);

    // 3. Microscopic Breathing Cycle (~13 breaths/min)
    const breathCycle = Math.sin(this.breathTime * this.breathingFreq);

    // Apply layers strictly relative to cached baseline rest pose
    this.applyPelvis(breathCycle);
    this.applySpine(breathCycle);
    this.applyClavicles(breathCycle);
    this.applyArms();
  }

  /**
   * Discrete posture shift: smoothly transfers subtle weight every 12–25s,
   * holding completely stationary between shifts.
   */
  private updatePostureShift(dt: number): void {
    if (!this.isShiftingPosture) {
      this.postureTimer += dt;
      if (this.postureTimer >= this.nextPostureTime) {
        this.isShiftingPosture = true;
        this.shiftProgress = 0;
        this.shiftDuration = 2.5 + Math.random() * 0.8;
        this.startPostureOffset.copy(this.currentPostureOffset);
        // Microscopic pelvic shift: ±0.8mm sideways, ±0.6mm forward/back
        this.targetPostureOffset.set(
          (Math.random() - 0.5) * 0.0016,
          (Math.random() - 0.5) * 0.0012
        );
      }
    } else {
      this.shiftProgress += dt;
      const t = Math.min(1.0, this.shiftProgress / this.shiftDuration);
      // Smooth cubic ease-in-out
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.currentPostureOffset.lerpVectors(this.startPostureOffset, this.targetPostureOffset, ease);

      if (t >= 1.0) {
        this.isShiftingPosture = false;
        this.postureTimer = 0;
        this.nextPostureTime = 12.0 + Math.random() * 13.0; // 12 to 25s hold
      }
    }
  }

  /**
   * Discrete gesture system:
   * Triggers a subtle gesture event during speech, holds, smoothly releases,
   * then enters mandatory cooldown. Never continuously loops.
   */
  private updateGestureStateMachine(dt: number, isSpeaking: boolean): void {
    // If speech abruptly ended while a gesture was active, smoothly release
    if (!isSpeaking && this.gesturePhase !== 'IDLE' && this.gesturePhase !== 'RELEASE') {
      this.gesturePhase = 'RELEASE';
      this.gestureTimer = 0;
    }

    switch (this.gesturePhase) {
      case 'IDLE':
        this.gestureWeight = 0;
        if (isSpeaking) {
          this.cooldownTimer += dt;
          if (this.cooldownTimer >= this.cooldownDuration) {
            // Trigger a single discrete conversational gesture
            const idx = Math.floor(Math.random() * CONVERSATIONAL_GESTURES.length);
            this.currentGesture = CONVERSATIONAL_GESTURES[idx];
            this.gesturePhase = 'ATTACK';
            this.gestureTimer = 0;
          }
        } else {
          this.cooldownTimer = 0;
        }
        break;

      case 'ATTACK': {
        const attackDuration = 0.65;
        this.gestureTimer += dt;
        const t = Math.min(1.0, this.gestureTimer / attackDuration);
        // Smooth sine ease
        this.gestureWeight = Math.sin((t * Math.PI) / 2);
        if (t >= 1.0) {
          this.gesturePhase = 'HOLD';
          this.gestureTimer = 0;
        }
        break;
      }

      case 'HOLD': {
        const holdDuration = 0.9 + Math.random() * 0.4; // 0.9 to 1.3s hold
        this.gestureTimer += dt;
        this.gestureWeight = 1.0;
        if (this.gestureTimer >= holdDuration || !isSpeaking) {
          this.gesturePhase = 'RELEASE';
          this.gestureTimer = 0;
        }
        break;
      }

      case 'RELEASE': {
        const releaseDuration = 0.75;
        this.gestureTimer += dt;
        const t = Math.min(1.0, this.gestureTimer / releaseDuration);
        // Smooth ease out
        this.gestureWeight = Math.cos((t * Math.PI) / 2);
        if (t >= 1.0) {
          this.gestureWeight = 0;
          this.gesturePhase = 'IDLE';
          this.cooldownTimer = 0;
          this.cooldownDuration = 6.0 + Math.random() * 8.0; // 6 to 14s cooldown
        }
        break;
      }
    }
  }

  private applyPelvis(breathCycle: number): void {
    const tracked = this.bones.get('pelvis');
    if (!tracked) return;

    const { bone, restPosition, restQuaternion } = tracked;

    // Microscopic breathing vertical rise (< 0.5mm) + discrete posture shift
    bone.position.x = restPosition.x + this.currentPostureOffset.x;
    bone.position.y = restPosition.y + breathCycle * 0.0004;
    bone.position.z = restPosition.z + this.currentPostureOffset.y;

    // Microscopic pelvic tilt (< 0.001 rad)
    this.tempEuler.set(this.currentPostureOffset.y * 0.6, 0, -this.currentPostureOffset.x * 0.6);
    this.idleQuat.setFromEuler(this.tempEuler);
    bone.quaternion.copy(restQuaternion).multiply(this.idleQuat);
  }

  private applySpine(breathCycle: number): void {
    const spineNames = ['spine_03', 'spine_04', 'spine_05'];
    const spineAmps = [0.0004, 0.0008, 0.0012]; // Microscopic thoracic expansion only

    for (let i = 0; i < spineNames.length; i++) {
      const tracked = this.bones.get(spineNames[i]);
      if (tracked) {
        const pitch = breathCycle * spineAmps[i];
        this.tempEuler.set(pitch, 0, 0);
        this.idleQuat.setFromEuler(this.tempEuler);
        tracked.bone.quaternion.copy(tracked.restQuaternion).multiply(this.idleQuat);
      }
    }
  }

  private applyClavicles(breathCycle: number): void {
    const clavL = this.bones.get('clavicle_l');
    const clavR = this.bones.get('clavicle_r');
    const clavElevate = Math.max(0, breathCycle) * 0.0015;

    if (clavL) {
      this.tempEuler.set(0, 0, clavElevate);
      this.idleQuat.setFromEuler(this.tempEuler);
      clavL.bone.quaternion.copy(clavL.restQuaternion).multiply(this.idleQuat);
    }
    if (clavR) {
      this.tempEuler.set(0, 0, -clavElevate);
      this.idleQuat.setFromEuler(this.tempEuler);
      clavR.bone.quaternion.copy(clavR.restQuaternion).multiply(this.idleQuat);
    }
  }

  private applyArms(): void {
    // Left Arm
    const uArmL = this.bones.get('upperarm_l');
    const lArmL = this.bones.get('lowerarm_l');
    const handL = this.bones.get('hand_l');

    // Right Arm
    const uArmR = this.bones.get('upperarm_r');
    const lArmR = this.bones.get('lowerarm_r');
    const handR = this.bones.get('hand_r');

    // When no gesture is active (gestureWeight == 0), arms strictly rest at baseline
    if (this.gestureWeight <= 0.001) {
      if (uArmL) uArmL.bone.quaternion.copy(uArmL.restQuaternion);
      if (lArmL) lArmL.bone.quaternion.copy(lArmL.restQuaternion);
      if (handL) handL.bone.quaternion.copy(handL.restQuaternion);

      if (uArmR) uArmR.bone.quaternion.copy(uArmR.restQuaternion);
      if (lArmR) lArmR.bone.quaternion.copy(lArmR.restQuaternion);
      if (handR) handR.bone.quaternion.copy(handR.restQuaternion);
      return;
    }

    const g = this.currentGesture;
    const w = this.gestureWeight;

    // Apply discrete gesture to active arm
    if (g.isLeftArm) {
      if (uArmL) {
        this.tempEuler.set(g.upperArmRot.x * w, g.upperArmRot.y * w, g.upperArmRot.z * w);
        this.gestureQuat.setFromEuler(this.tempEuler);
        uArmL.bone.quaternion.copy(uArmL.restQuaternion).multiply(this.gestureQuat);
      }
      if (lArmL) {
        this.tempEuler.set(g.lowerArmRot.x * w, g.lowerArmRot.y * w, g.lowerArmRot.z * w);
        this.gestureQuat.setFromEuler(this.tempEuler);
        lArmL.bone.quaternion.copy(lArmL.restQuaternion).multiply(this.gestureQuat);
      }
      if (handL) {
        this.tempEuler.set(g.handRot.x * w, g.handRot.y * w, g.handRot.z * w);
        this.gestureQuat.setFromEuler(this.tempEuler);
        handL.bone.quaternion.copy(handL.restQuaternion).multiply(this.gestureQuat);
      }
      // Right arm rests
      if (uArmR) uArmR.bone.quaternion.copy(uArmR.restQuaternion);
      if (lArmR) lArmR.bone.quaternion.copy(lArmR.restQuaternion);
      if (handR) handR.bone.quaternion.copy(handR.restQuaternion);
    } else {
      if (uArmR) {
        this.tempEuler.set(g.upperArmRot.x * w, g.upperArmRot.y * w, g.upperArmRot.z * w);
        this.gestureQuat.setFromEuler(this.tempEuler);
        uArmR.bone.quaternion.copy(uArmR.restQuaternion).multiply(this.gestureQuat);
      }
      if (lArmR) {
        this.tempEuler.set(g.lowerArmRot.x * w, g.lowerArmRot.y * w, g.lowerArmRot.z * w);
        this.gestureQuat.setFromEuler(this.tempEuler);
        lArmR.bone.quaternion.copy(lArmR.restQuaternion).multiply(this.gestureQuat);
      }
      if (handR) {
        this.tempEuler.set(g.handRot.x * w, g.handRot.y * w, g.handRot.z * w);
        this.gestureQuat.setFromEuler(this.tempEuler);
        handR.bone.quaternion.copy(handR.restQuaternion).multiply(this.gestureQuat);
      }
      // Left arm rests
      if (uArmL) uArmL.bone.quaternion.copy(uArmL.restQuaternion);
      if (lArmL) lArmL.bone.quaternion.copy(lArmL.restQuaternion);
      if (handL) handL.bone.quaternion.copy(handL.restQuaternion);
    }
  }

  public resetToBasePose(): void {
    for (const { bone, restPosition, restQuaternion } of this.bones.values()) {
      bone.position.copy(restPosition);
      bone.quaternion.copy(restQuaternion);
    }
    this.gesturePhase = 'IDLE';
    this.gestureWeight = 0;
    this.cooldownTimer = 0;
  }
}
