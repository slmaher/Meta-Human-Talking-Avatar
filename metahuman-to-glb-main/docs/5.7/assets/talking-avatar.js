// talking-avatar.js — Real-time ARKit Lip Sync & Natural MetaHuman Dynamics for Bo
// Restored to authentic MetaHuman visual and postural baseline:
//   1. AudioClock-driven conversational lip sync (subtle natural weights, zero nutcracker jaw)
//   2. Human-cadence asymmetric blinking (4.5–7.0s intervals, rapid ~75ms close)
//   3. Steady portrait gaze with zero artificial darting
//   4. Preserved authentic MetaHuman rest pose without robotic skeletal swaying

import * as THREE from 'three';

export const VISEME_TO_ARKIT_MAP = {
  sil: {},
  // Natural conversational vowels (subtle human openings, ~0.20–0.34 max)
  aa: {
    jawOpen: 0.34,
    mouthLowerDownLeft: 0.12,
    mouthLowerDownRight: 0.12,
    mouthFunnel: 0.06,
  },
  E: {
    jawOpen: 0.20,
    mouthStretchLeft: 0.16,
    mouthStretchRight: 0.16,
    mouthLowerDownLeft: 0.10,
    mouthLowerDownRight: 0.10,
  },
  ih: {
    jawOpen: 0.10,
    mouthSmileLeft: 0.14,
    mouthSmileRight: 0.14,
    mouthStretchLeft: 0.20,
    mouthStretchRight: 0.20,
    mouthLowerDownLeft: 0.04,
    mouthLowerDownRight: 0.04,
  },
  oh: {
    jawOpen: 0.26,
    mouthFunnel: 0.38,
    mouthPucker: 0.14,
  },
  ou: {
    jawOpen: 0.12,
    mouthPucker: 0.42,
    mouthFunnel: 0.20,
  },
  // Plosive bilabial closure: strictly zero jawOpen, gentle lip press & roll
  PP: {
    jawOpen: 0.0,
    mouthPressLeft: 0.30,
    mouthPressRight: 0.30,
    mouthRollLower: 0.14,
    mouthRollUpper: 0.12,
  },
  FF: {
    jawOpen: 0.08,
    mouthRollLower: 0.26,
    mouthUpperUpLeft: 0.12,
    mouthUpperUpRight: 0.12,
    mouthFunnel: 0.06,
  },
  TH: {
    jawOpen: 0.14,
    tongueOut: 0.20,
    mouthLowerDownLeft: 0.08,
    mouthLowerDownRight: 0.08,
  },
  DD: {
    jawOpen: 0.14,
    mouthLowerDownLeft: 0.10,
    mouthLowerDownRight: 0.10,
    mouthStretchLeft: 0.08,
    mouthStretchRight: 0.08,
  },
  kk: {
    jawOpen: 0.18,
    mouthLowerDownLeft: 0.08,
    mouthLowerDownRight: 0.08,
    mouthStretchLeft: 0.06,
    mouthStretchRight: 0.06,
  },
  CH: {
    jawOpen: 0.15,
    mouthFunnel: 0.28,
    mouthLowerDownLeft: 0.08,
    mouthLowerDownRight: 0.08,
    mouthShrugUpper: 0.08,
  },
  SS: {
    jawOpen: 0.08,
    mouthStretchLeft: 0.20,
    mouthStretchRight: 0.20,
    mouthLowerDownLeft: 0.04,
    mouthLowerDownRight: 0.04,
  },
  nn: {
    jawOpen: 0.12,
    mouthLowerDownLeft: 0.10,
    mouthLowerDownRight: 0.10,
  },
  RR: {
    jawOpen: 0.14,
    mouthFunnel: 0.20,
    mouthPucker: 0.16,
    mouthLowerDownLeft: 0.06,
    mouthLowerDownRight: 0.06,
  },
};

// Strictly mouth/jaw shapes; no eyes, brows, or cheeks
export const SPEECH_MORPH_TARGETS = [
  'jawForward', 'jawLeft', 'jawRight', 'jawOpen',
  'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthDimpleLeft', 'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'tongueOut',
];

const DIPHTHONGS = {
  ee: ['ih'], ea: ['ih'], oo: ['ou'], ou: ['aa', 'ou'], ow: ['aa', 'ou'],
  ai: ['E', 'ih'], ay: ['E', 'ih'], oi: ['oh', 'ih'], oy: ['oh', 'ih'],
  th: ['TH'], ch: ['CH'], sh: ['CH'], ph: ['FF'], ck: ['kk'], ng: ['kk'], wh: ['ou'],
};

const SINGLE_CHARS = {
  a: 'aa', e: 'E', i: 'ih', o: 'oh', u: 'ou',
  b: 'PP', p: 'PP', m: 'PP', f: 'FF', v: 'FF',
  t: 'DD', d: 'DD', l: 'DD', k: 'kk', g: 'kk', c: 'kk', q: 'kk', x: 'kk',
  j: 'CH', s: 'SS', z: 'SS', n: 'nn', r: 'RR', w: 'ou', y: 'ih', h: 'E',
};

export function generateVisemeTimelineFromText(text, totalDuration) {
  const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0 || totalDuration <= 0) return [];

  const parsedWords = [];
  let totalPhonemes = 0;

  for (const word of words) {
    const wordVisemes = [];
    let i = 0;
    while (i < word.length) {
      if (i + 1 < word.length) {
        const pair = word.slice(i, i + 2);
        if (DIPHTHONGS[pair]) {
          wordVisemes.push(...DIPHTHONGS[pair]);
          i += 2;
          continue;
        }
      }
      const char = word[i];
      if (SINGLE_CHARS[char]) {
        wordVisemes.push(SINGLE_CHARS[char]);
      }
      i++;
    }
    if (wordVisemes.length > 0) {
      parsedWords.push(wordVisemes);
      totalPhonemes += wordVisemes.length;
    }
  }

  if (totalPhonemes === 0) return [];

  const events = [];
  const availableTime = Math.max(0.1, totalDuration - 0.15);
  const pauseBetweenWords = 0.04;
  const wordCount = parsedWords.length;
  const totalPauses = Math.max(0, wordCount - 1) * pauseBetweenWords;
  const netSpeechTime = Math.max(0.05, availableTime - totalPauses);
  const basePhonemeDuration = netSpeechTime / totalPhonemes;

  let currentTime = 0.05;

  for (let w = 0; w < parsedWords.length; w++) {
    const wordVisemes = parsedWords[w];
    for (let p = 0; p < wordVisemes.length; p++) {
      const viseme = wordVisemes[p];
      const isVowel = ['aa', 'E', 'ih', 'oh', 'ou'].includes(viseme);
      const duration = isVowel ? basePhonemeDuration * 1.25 : basePhonemeDuration * 0.85;

      events.push({
        time: currentTime,
        duration: Math.max(0.04, duration),
        viseme,
        weight: isVowel ? 1.0 : 0.85,
      });
      currentTime += duration;
    }
    currentTime += pauseBetweenWords;
  }

  return events;
}

/**
 * Discrete Event-Driven Body Animation Controller
 */
const GESTURES = [
  { isLeftArm: false, upperArmRot: new THREE.Euler(0.020, -0.015, -0.015), lowerArmRot: new THREE.Euler(0.035, 0.020, 0.010), handRot: new THREE.Euler(0.015, 0.010, 0.015) },
  { isLeftArm: true,  upperArmRot: new THREE.Euler(0.018, 0.012, 0.012),  lowerArmRot: new THREE.Euler(0.030, -0.018, -0.010), handRot: new THREE.Euler(0.015, -0.010, -0.015) },
];

export class BodyAnimationController {
  constructor(sceneRoot) {
    this.bones = new Map();
    this.breathTime = 0;
    this.breathingFreq = (13 / 60) * Math.PI * 2;

    this.postureTimer = 0;
    this.nextPostureTime = 14.0;
    this.isShiftingPosture = false;
    this.shiftProgress = 0;
    this.shiftDuration = 2.8;
    this.startPostureOffset = new THREE.Vector2(0, 0);
    this.currentPostureOffset = new THREE.Vector2(0, 0);
    this.targetPostureOffset = new THREE.Vector2(0, 0);

    this.gesturePhase = 'IDLE';
    this.gestureTimer = 0;
    this.gestureWeight = 0;
    this.currentGesture = GESTURES[0];
    this.cooldownTimer = 0;
    this.cooldownDuration = 8.0;

    this.tempEuler = new THREE.Euler();
    this.idleQuat = new THREE.Quaternion();
    this.gestureQuat = new THREE.Quaternion();

    if (sceneRoot) this.bindSkeleton(sceneRoot);
  }

  bindSkeleton(sceneRoot) {
    this.bones.clear();
    const targetNames = ['pelvis', 'spine_03', 'spine_04', 'spine_05', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'];
    sceneRoot.traverse((obj) => {
      if (obj.isBone) {
        const name = obj.name.toLowerCase();
        for (const target of targetNames) {
          if (name === target || name.endsWith(`_${target}`) || name.endsWith(`:${target}`)) {
            if (!this.bones.has(target)) {
              this.bones.set(target, { bone: obj, restPos: obj.position.clone(), restQuat: obj.quaternion.clone() });
            }
          }
        }
      }
    });
  }

  update(delta, isSpeaking = false) {
    if (this.bones.size === 0) return;
    const dt = Math.min(delta, 0.1);
    this.breathTime += dt;

    // Posture shift
    if (!this.isShiftingPosture) {
      this.postureTimer += dt;
      if (this.postureTimer >= this.nextPostureTime) {
        this.isShiftingPosture = true;
        this.shiftProgress = 0;
        this.shiftDuration = 2.5 + Math.random() * 0.8;
        this.startPostureOffset.copy(this.currentPostureOffset);
        this.targetPostureOffset.set((Math.random() - 0.5) * 0.0016, (Math.random() - 0.5) * 0.0012);
      }
    } else {
      this.shiftProgress += dt;
      const t = Math.min(1.0, this.shiftProgress / this.shiftDuration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.currentPostureOffset.lerpVectors(this.startPostureOffset, this.targetPostureOffset, ease);
      if (t >= 1.0) {
        this.isShiftingPosture = false;
        this.postureTimer = 0;
        this.nextPostureTime = 12.0 + Math.random() * 13.0;
      }
    }

    // Discrete gesture state machine
    if (!isSpeaking && this.gesturePhase !== 'IDLE' && this.gesturePhase !== 'RELEASE') {
      this.gesturePhase = 'RELEASE';
      this.gestureTimer = 0;
    }
    if (this.gesturePhase === 'IDLE') {
      this.gestureWeight = 0;
      if (isSpeaking) {
        this.cooldownTimer += dt;
        if (this.cooldownTimer >= this.cooldownDuration) {
          this.currentGesture = GESTURES[Math.floor(Math.random() * GESTURES.length)];
          this.gesturePhase = 'ATTACK';
          this.gestureTimer = 0;
        }
      } else {
        this.cooldownTimer = 0;
      }
    } else if (this.gesturePhase === 'ATTACK') {
      this.gestureTimer += dt;
      const t = Math.min(1.0, this.gestureTimer / 0.65);
      this.gestureWeight = Math.sin((t * Math.PI) / 2);
      if (t >= 1.0) { this.gesturePhase = 'HOLD'; this.gestureTimer = 0; }
    } else if (this.gesturePhase === 'HOLD') {
      this.gestureTimer += dt;
      this.gestureWeight = 1.0;
      if (this.gestureTimer >= 1.1 || !isSpeaking) { this.gesturePhase = 'RELEASE'; this.gestureTimer = 0; }
    } else if (this.gesturePhase === 'RELEASE') {
      this.gestureTimer += dt;
      const t = Math.min(1.0, this.gestureTimer / 0.75);
      this.gestureWeight = Math.cos((t * Math.PI) / 2);
      if (t >= 1.0) {
        this.gestureWeight = 0;
        this.gesturePhase = 'IDLE';
        this.cooldownTimer = 0;
        this.cooldownDuration = 6.0 + Math.random() * 8.0;
      }
    }

    const breathCycle = Math.sin(this.breathTime * this.breathingFreq);

    // Apply Pelvis
    const pelvis = this.bones.get('pelvis');
    if (pelvis) {
      pelvis.bone.position.x = pelvis.restPos.x + this.currentPostureOffset.x;
      pelvis.bone.position.y = pelvis.restPos.y + breathCycle * 0.0004;
      pelvis.bone.position.z = pelvis.restPos.z + this.currentPostureOffset.y;
      this.tempEuler.set(this.currentPostureOffset.y * 0.6, 0, -this.currentPostureOffset.x * 0.6);
      this.idleQuat.setFromEuler(this.tempEuler);
      pelvis.bone.quaternion.copy(pelvis.restQuat).multiply(this.idleQuat);
    }

    // Apply Spine
    const spineNames = ['spine_03', 'spine_04', 'spine_05'];
    const spineAmps = [0.0004, 0.0008, 0.0012];
    for (let i = 0; i < spineNames.length; i++) {
      const s = this.bones.get(spineNames[i]);
      if (s) {
        this.tempEuler.set(breathCycle * spineAmps[i], 0, 0);
        this.idleQuat.setFromEuler(this.tempEuler);
        s.bone.quaternion.copy(s.restQuat).multiply(this.idleQuat);
      }
    }

    // Apply Clavicles
    const clavL = this.bones.get('clavicle_l');
    const clavR = this.bones.get('clavicle_r');
    const clavElevate = Math.max(0, breathCycle) * 0.0015;
    if (clavL) {
      this.tempEuler.set(0, 0, clavElevate);
      this.idleQuat.setFromEuler(this.tempEuler);
      clavL.bone.quaternion.copy(clavL.restQuat).multiply(this.idleQuat);
    }
    if (clavR) {
      this.tempEuler.set(0, 0, -clavElevate);
      this.idleQuat.setFromEuler(this.tempEuler);
      clavR.bone.quaternion.copy(clavR.restQuat).multiply(this.idleQuat);
    }

    // Apply Arms
    const uArmL = this.bones.get('upperarm_l');
    const lArmL = this.bones.get('lowerarm_l');
    const handL = this.bones.get('hand_l');
    const uArmR = this.bones.get('upperarm_r');
    const lArmR = this.bones.get('lowerarm_r');
    const handR = this.bones.get('hand_r');

    if (this.gestureWeight <= 0.001) {
      if (uArmL) uArmL.bone.quaternion.copy(uArmL.restQuat);
      if (lArmL) lArmL.bone.quaternion.copy(lArmL.restQuat);
      if (handL) handL.bone.quaternion.copy(handL.restQuat);
      if (uArmR) uArmR.bone.quaternion.copy(uArmR.restQuat);
      if (lArmR) lArmR.bone.quaternion.copy(lArmR.restQuat);
      if (handR) handR.bone.quaternion.copy(handR.restQuat);
      return;
    }

    const g = this.currentGesture;
    const w = this.gestureWeight;
    if (g.isLeftArm) {
      if (uArmL) {
        this.tempEuler.set(g.upperArmRot.x * w, g.upperArmRot.y * w, g.upperArmRot.z * w);
        uArmL.bone.quaternion.copy(uArmL.restQuat).multiply(this.gestureQuat.setFromEuler(this.tempEuler));
      }
      if (lArmL) {
        this.tempEuler.set(g.lowerArmRot.x * w, g.lowerArmRot.y * w, g.lowerArmRot.z * w);
        lArmL.bone.quaternion.copy(lArmL.restQuat).multiply(this.gestureQuat.setFromEuler(this.tempEuler));
      }
      if (handL) {
        this.tempEuler.set(g.handRot.x * w, g.handRot.y * w, g.handRot.z * w);
        handL.bone.quaternion.copy(handL.restQuat).multiply(this.gestureQuat.setFromEuler(this.tempEuler));
      }
      if (uArmR) uArmR.bone.quaternion.copy(uArmR.restQuat);
      if (lArmR) lArmR.bone.quaternion.copy(lArmR.restQuat);
      if (handR) handR.bone.quaternion.copy(handR.restQuat);
    } else {
      if (uArmR) {
        this.tempEuler.set(g.upperArmRot.x * w, g.upperArmRot.y * w, g.upperArmRot.z * w);
        uArmR.bone.quaternion.copy(uArmR.restQuat).multiply(this.gestureQuat.setFromEuler(this.tempEuler));
      }
      if (lArmR) {
        this.tempEuler.set(g.lowerArmRot.x * w, g.lowerArmRot.y * w, g.lowerArmRot.z * w);
        lArmR.bone.quaternion.copy(lArmR.restQuat).multiply(this.gestureQuat.setFromEuler(this.tempEuler));
      }
      if (handR) {
        this.tempEuler.set(g.handRot.x * w, g.handRot.y * w, g.handRot.z * w);
        handR.bone.quaternion.copy(handR.restQuat).multiply(this.gestureQuat.setFromEuler(this.tempEuler));
      }
      if (uArmL) uArmL.bone.quaternion.copy(uArmL.restQuat);
      if (lArmL) lArmL.bone.quaternion.copy(lArmL.restQuat);
      if (handL) handL.bone.quaternion.copy(handL.restQuat);
    }
  }
}

/**
 * Natural MetaHuman Facial Controller (Blinking, subtle speech cadence)
 */
export class NaturalFacialController {
  constructor(sceneRoot) {
    this.morphBindings = [];
    this.headBone = null;
    this.headRestRot = new THREE.Euler();
    this.tempEuler = new THREE.Euler();

    this.blinkTimer = 0;
    this.nextBlinkTime = 5.0;
    this.isBlinking = false;
    this.blinkElapsed = 0;
    this.blinkDuration = 0.20; // ~200ms human blink
    this.speechTime = 0;

    if (sceneRoot) this.bindScene(sceneRoot);
  }

  bindScene(sceneRoot) {
    this.morphBindings = [];
    this.headBone = null;

    sceneRoot.traverse((obj) => {
      if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
        this.morphBindings.push({
          mesh: obj,
          dict: obj.morphTargetDictionary,
          influences: obj.morphTargetInfluences,
        });
      }
      if (obj.isBone && obj.name.toLowerCase() === 'head' && !this.headBone) {
        this.headBone = obj;
        this.headRestRot.copy(obj.rotation);
      }
    });

    this.scheduleNextBlink();
  }

  scheduleNextBlink() {
    this.nextBlinkTime = 4.5 + Math.random() * 2.5; // 4.5 to 7.0s intervals
    this.blinkTimer = 0;
  }

  update(delta, isSpeaking = false) {
    const dt = Math.min(delta, 0.1);

    // 1. Natural Asymmetric Eyelid Blink
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
        let w = progress < 0.35
          ? Math.pow(progress / 0.35, 2)
          : Math.cos(((progress - 0.35) / 0.65) * Math.PI * 0.5);
        w = Math.max(0, Math.min(1, w));
        // Subtle natural asymmetry
        this.setMorphWeightSafely('eyeBlinkLeft', w * 0.98);
        this.setMorphWeightSafely('eyeBlinkRight', w * 1.0);
      }
    }

    // 2. Eyebrows on Speech
    if (isSpeaking) {
      this.speechTime += dt;
      const brow = Math.max(0, Math.sin(this.speechTime * 2.2) * 0.05);
      this.setMorphWeightSafely('browInnerUp', brow);

      if (this.headBone) {
        const nod = Math.sin(this.speechTime * 2.5) * 0.005;
        this.tempEuler.set(this.headRestRot.x + nod, this.headRestRot.y, this.headRestRot.z);
        this.headBone.rotation.copy(this.tempEuler);
      }
    } else {
      this.speechTime = 0;
      this.setMorphWeightSafely('browInnerUp', 0);
      if (this.headBone) {
        this.headBone.rotation.copy(this.headRestRot);
      }
    }
  }

  setMorphWeightSafely(shapeName, weight) {
    for (const { dict, influences } of this.morphBindings) {
      if (dict && dict[shapeName] !== undefined) {
        const idx = dict[shapeName];
        if (influences && idx < influences.length) {
          influences[idx] = weight;
        }
      }
    }
  }
}

/**
 * AudioClock-driven LipSyncController
 */
export class LipSyncController {
  constructor(sceneRoot) {
    this.morphBindings = [];
    this.currentWeights = new Map();
    this.targetWeights = new Map();
    this.visemeTimeline = [];
    this.audioClock = null;
    this.smoothingSpeed = 24.0;

    if (sceneRoot) this.bindScene(sceneRoot);
  }

  bindScene(sceneRoot) {
    this.morphBindings = [];
    sceneRoot.traverse((obj) => {
      if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
        this.morphBindings.push({
          mesh: obj,
          dict: obj.morphTargetDictionary,
          influences: obj.morphTargetInfluences,
        });
      }
    });

    for (const shape of SPEECH_MORPH_TARGETS) {
      this.currentWeights.set(shape, 0);
      this.targetWeights.set(shape, 0);
    }
  }

  play(visemes, clock) {
    this.visemeTimeline = [...visemes].sort((a, b) => a.time - b.time);
    this.audioClock = clock;
  }

  stop() {
    this.visemeTimeline = [];
    this.audioClock = null;
    for (const shape of SPEECH_MORPH_TARGETS) {
      this.targetWeights.set(shape, 0);
    }
  }

  isSpeaking() {
    return !!(this.audioClock && this.audioClock.isPlaying() && this.visemeTimeline.length > 0);
  }

  update(delta) {
    const dt = Math.max(0.001, Math.min(delta, 0.1));

    for (const shape of SPEECH_MORPH_TARGETS) {
      this.targetWeights.set(shape, 0);
    }

    if (this.isSpeaking()) {
      const currentAudioTime = this.audioClock.getCurrentTime();
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
          const factor = rawFactor * rawFactor * (3 - 2 * rawFactor);

          const isPlosive = event.viseme === 'PP';

          for (const [shape, targetVal] of Object.entries(visemeDef)) {
            if (targetVal !== undefined) {
              const cur = this.targetWeights.get(shape) || 0;
              this.targetWeights.set(shape, Math.min(1.0, Math.max(cur, targetVal * weight * factor)));
            }
          }

          if (isPlosive && factor > 0.35) {
            const curJaw = this.targetWeights.get('jawOpen') || 0;
            this.targetWeights.set('jawOpen', curJaw * (1 - factor));
          }
        }
      }
    }

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

  applyMorphWeightSafely(shapeName, weight) {
    for (const { dict, influences } of this.morphBindings) {
      if (dict && dict[shapeName] !== undefined) {
        const idx = dict[shapeName];
        if (influences && idx < influences.length) {
          influences[idx] = weight;
        }
      }
    }
  }

  getActiveWeights() {
    const result = {};
    for (const [key, val] of this.currentWeights.entries()) {
      if (val > 0.001) result[key] = Math.round(val * 1000) / 1000;
    }
    return result;
  }
}

/**
 * Initializes and mounts the AI talking avatar overlay onto an existing Three.js viewer.
 */
export function setupTalkingAvatar(viewerContext) {
  const { gltf } = viewerContext;
  const root = gltf.scene;

  const facialAnim = new NaturalFacialController(root);
  const lipSync = new LipSyncController(root);
  const bodyAnim = new BodyAnimationController(root);

  // Hook into animation loop without disturbing base scene
  const clock = new THREE.Clock();
  const updateTick = () => {
    const delta = clock.getDelta();
    const isSpeaking = lipSync.isSpeaking();

    // 1. Discrete conversational body animation (micro-breathing, infrequent posture shift, discrete speech gestures)
    bodyAnim.update(delta, isSpeaking);

    // 2. Natural Facial Dynamics (asymmetric blinks, speech cadence)
    facialAnim.update(delta, isSpeaking);

    // 3. Conversational Lip Sync (AudioClock-driven mouth articulation)
    lipSync.update(delta);

    requestAnimationFrame(updateTick);
  };
  requestAnimationFrame(updateTick);

  // Speech function with SpeechSynthesisClock calibration
  async function speak(text) {
    const wordCount = text.trim().split(/\s+/).length;
    const duration = Math.max(1.0, wordCount * 0.38 + text.length * 0.02);
    const visemes = generateVisemeTimelineFromText(text, duration);

    const speechClock = {
      startTime: -1,
      duration,
      playing: false,
      getCurrentTime() {
        if (!this.playing || this.startTime < 0) return 0;
        return Math.max(0, Math.min(this.duration, (performance.now() / 1000) - this.startTime));
      },
      isPlaying() { return this.playing; },
      getDuration() { return this.duration; },
    };

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 0.95;
      u.rate = 1.0;

      u.onstart = () => {
        speechClock.startTime = performance.now() / 1000;
        speechClock.playing = true;
      };
      u.onend = () => { speechClock.playing = false; };
      u.onerror = () => { speechClock.playing = false; };

      lipSync.play(visemes, speechClock);
      window.speechSynthesis.speak(u);
    } else {
      speechClock.startTime = performance.now() / 1000;
      speechClock.playing = true;
      lipSync.play(visemes, speechClock);
    }
  }

  const API_BASE = (typeof window !== 'undefined' && window.location.port === '5173')
    ? ''
    : 'http://localhost:5173';

  let activeAudio = null;

  async function speak(text) {
    if (!text || !text.trim()) return;

    // Interrupt any existing speech
    if (activeAudio) {
      try { activeAudio.pause(); } catch (_) {}
      activeAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    // Try backend TTS (/api/tts) first for ElevenLabs audio and high-precision visemes
    try {
      const res = await fetch(`${API_BASE}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.audio && data.visemes && data.visemes.length > 0) {
          const audio = new Audio(data.audio);
          activeAudio = audio;

          const clock = {
            startTime: -1,
            duration: data.duration || 1.0,
            playing: false,
            getCurrentTime() {
              if (!this.playing || !activeAudio) return 0;
              return activeAudio.currentTime;
            },
            isPlaying() { return this.playing; },
            getDuration() { return this.duration; },
          };

          audio.onplay = () => {
            clock.playing = true;
            clock.startTime = performance.now() / 1000;
          };
          audio.onended = () => {
            clock.playing = false;
            activeAudio = null;
          };
          audio.onerror = () => {
            clock.playing = false;
            activeAudio = null;
          };

          lipSync.play(data.visemes, clock);
          await audio.play();
          return;
        }
      }
    } catch (e) {
      console.warn('[talking-avatar] Backend TTS error, falling back to Web Speech:', e);
    }

    // Fallback: rule-based visemes with Web Speech synthesis
    const visemes = textToVisemes(text);
    const duration = Math.max(0.6, visemes[visemes.length - 1]?.time || 1.0);

    const speechClock = {
      startTime: -1,
      duration,
      playing: false,
      getCurrentTime() {
        if (!this.playing || this.startTime < 0) return 0;
        return Math.max(0, Math.min(this.duration, (performance.now() / 1000) - this.startTime));
      },
      isPlaying() { return this.playing; },
      getDuration() { return this.duration; },
    };

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 0.95;
      u.rate = 1.0;

      u.onstart = () => {
        speechClock.startTime = performance.now() / 1000;
        speechClock.playing = true;
      };
      u.onend = () => { speechClock.playing = false; };
      u.onerror = () => { speechClock.playing = false; };

      lipSync.play(visemes, speechClock);
      window.speechSynthesis.speak(u);
    } else {
      speechClock.startTime = performance.now() / 1000;
      speechClock.playing = true;
      lipSync.play(visemes, speechClock);
    }
  }

  const conversationHistory = [];

  async function askBo(query, onStatusChange) {
    const prompt = (query || '').trim();
    if (!prompt) return '';

    if (onStatusChange) onStatusChange('Thinking...');

    conversationHistory.push({ role: 'user', text: prompt });

    let reply = '';
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversationHistory }),
      });

      if (res.ok) {
        const data = await res.json();
        reply = data.text || '';
      }
    } catch (e) {
      console.warn('[talking-avatar] Backend chat failed, falling back:', e);
    }

    if (!reply) {
      // Local fallback persona if backend is unreachable
      const q = prompt.toLowerCase();
      if (q.includes('hello') || q.includes('hi')) {
        reply = "Hello! I am Bo, your MetaHuman AI avatar. How can I help you today?";
      } else if (q.includes('who are you')) {
        reply = "I am Bo, an Unreal Engine MetaHuman running in Three.js with full ARKit blendshapes and real-time lip sync.";
      } else {
        reply = `You asked: "${prompt}". I am Bo, your MetaHuman talking avatar.`;
      }
    }

    conversationHistory.push({ role: 'assistant', text: reply });
    if (onStatusChange) onStatusChange('Speaking...');
    await speak(reply);
    if (onStatusChange) onStatusChange('Idle');
    return reply;
  }

  window.testSpeech = (text = 'Hello, I am Bo. How can I help you today?') => speak(text);
  window.speak = speak;
  window.askBo = askBo;
  window.__lipSync = lipSync;
  window.__facialAnim = facialAnim;

  buildTalkingAvatarUI(speak, askBo, lipSync);
}

function buildTalkingAvatarUI(speakFn, askFn, lipSync) {
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 360px;
    background: rgba(14, 19, 30, 0.94);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 14px;
    padding: 16px;
    color: #fff;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    z-index: 10000;
    box-shadow: 0 12px 36px rgba(0,0,0,0.6);
  `;

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-weight:700; font-size:14px; color:#38bdf8;">Bo AI Talking Avatar</span>
        <span id="speech-status-badge" style="font-size:11px; background:#1e293b; border:1px solid #334155; padding:2px 8px; border-radius:10px; color:#94a3b8;">Idle</span>
      </div>
      <a href="http://localhost:5173/" target="_blank" style="font-size:11px; color:#38bdf8; text-decoration:none; background:#1e293b; padding:3px 8px; border-radius:6px; border:1px solid #334155;" title="Open React Studio Interface">Studio ↗</a>
    </div>

    <div id="ai-response-display" style="background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:10px; margin-bottom:12px; font-size:12px; color:#e2e8f0; line-height:1.4; max-height:120px; overflow-y:auto; min-height:38px;">
      Hello! I am Bo. Ask me anything or click the microphone to talk.
    </div>

    <div style="display:flex; gap:6px; margin-bottom:10px;">
      <button id="btn-test-speech" style="flex:1; background:#2563eb; color:#fff; border:none; border-radius:6px; padding:8px; font-weight:600; cursor:pointer; font-size:12px;">
        ▶ Test Voice Greeting
      </button>
    </div>

    <form id="ai-chat-form" style="display:flex; gap:6px; align-items:center;">
      <button type="button" id="btn-mic" style="width:36px; height:36px; background:#1e293b; color:#38bdf8; border:1px solid #334155; border-radius:6px; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center;" title="Voice input">🎤</button>
      <input id="ai-chat-input" type="text" placeholder="Ask Bo anything (AI connected)..." style="flex:1; background:#1e293b; color:#fff; border:1px solid #334155; border-radius:6px; padding:8px 10px; font-size:12px; outline:none;" />
      <button type="submit" id="btn-submit" style="background:#059669; color:#fff; border:none; border-radius:6px; padding:8px 14px; font-weight:600; cursor:pointer; font-size:12px;">Send</button>
    </form>
    <div id="active-morphs-box" style="margin-top:10px; font-size:11px; color:#38bdf8; font-family:monospace; min-height:16px;"></div>
  `;

  document.body.appendChild(panel);

  const statusBadge = panel.querySelector('#speech-status-badge');
  const morphsBox = panel.querySelector('#active-morphs-box');
  const testBtn = panel.querySelector('#btn-test-speech');
  const chatForm = panel.querySelector('#ai-chat-form');
  const chatInput = panel.querySelector('#ai-chat-input');
  const micBtn = panel.querySelector('#btn-mic');
  const responseDisplay = panel.querySelector('#ai-response-display');
  const submitBtn = panel.querySelector('#btn-submit');

  testBtn.addEventListener('click', () => {
    responseDisplay.textContent = 'Hello, I am Bo. My conversational pipeline is fully online and ready.';
    speakFn('Hello, I am Bo. My conversational pipeline is fully online and ready.');
  });

  const updateStatus = (status) => {
    statusBadge.textContent = status;
    if (status === 'Speaking...') {
      statusBadge.style.background = '#05966933';
      statusBadge.style.color = '#34d399';
      statusBadge.style.borderColor = '#059669';
    } else if (status === 'Thinking...') {
      statusBadge.style.background = '#2563eb33';
      statusBadge.style.color = '#60a5fa';
      statusBadge.style.borderColor = '#2563eb';
    } else if (status === 'Listening...') {
      statusBadge.style.background = '#dc262633';
      statusBadge.style.color = '#f87171';
      statusBadge.style.borderColor = '#dc2626';
    } else {
      statusBadge.style.background = '#1e293b';
      statusBadge.style.color = '#94a3b8';
      statusBadge.style.borderColor = '#334155';
    }
  };

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = chatInput.value.trim();
    if (!query) return;
    chatInput.value = '';
    submitBtn.disabled = true;
    chatInput.disabled = true;

    try {
      responseDisplay.textContent = `You: "${query}"\nBo is thinking...`;
      const reply = await askFn(query, updateStatus);
      responseDisplay.textContent = `Bo: ${reply}`;
    } catch (err) {
      responseDisplay.textContent = `Error: ${err.message || err}`;
    } finally {
      submitBtn.disabled = false;
      chatInput.disabled = false;
      chatInput.focus();
    }
  });

  // Microphone Voice Input
  let recognition = null;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      micBtn.style.background = '#dc2626';
      micBtn.style.color = '#fff';
      updateStatus('Listening...');
    };

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      chatInput.value = text;
      updateStatus('Idle');
      chatForm.dispatchEvent(new Event('submit'));
    };

    recognition.onerror = () => {
      micBtn.style.background = '#1e293b';
      micBtn.style.color = '#38bdf8';
      updateStatus('Idle');
    };

    recognition.onend = () => {
      micBtn.style.background = '#1e293b';
      micBtn.style.color = '#38bdf8';
      if (statusBadge.textContent === 'Listening...') updateStatus('Idle');
    };

    micBtn.addEventListener('click', () => {
      try {
        recognition.start();
      } catch (_) {
        recognition.stop();
      }
    });
  } else {
    micBtn.style.opacity = '0.5';
    micBtn.title = 'Speech recognition not supported in this browser';
  }

  setInterval(() => {
    const isSpeaking = lipSync.isSpeaking();
    if (!isSpeaking && statusBadge.textContent.startsWith('Speaking')) {
      updateStatus('Idle');
    }

    const active = lipSync.getActiveWeights();
    const keys = Object.keys(active);
    if (keys.length > 0) {
      morphsBox.textContent = 'ARKit: ' + keys.slice(0, 3).map(k => `${k}: ${(active[k] || 0).toFixed(2)}`).join(' | ');
    } else {
      morphsBox.textContent = '';
    }
  }, 100);
}
