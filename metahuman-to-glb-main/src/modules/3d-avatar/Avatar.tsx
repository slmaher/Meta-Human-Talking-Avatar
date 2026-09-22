/**
 * Avatar.tsx: Renders the photorealistic Bo MetaHuman using the authentic
 * repository shader pipeline, preserving original materials, hair, eye refraction,
 * and authored rest pose, with AudioClock-synchronized conversational lip sync.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

// @ts-expect-error - Import authentic repository viewer engine
import { mount } from '../../../docs/5.7/assets/viewer.js';

import { LipSyncController } from './lipSync';
import { FacialAnimationController } from './facialAnimation';
import { BodyAnimationController } from './bodyAnimation';
import { VisemeEvent } from './types';
import { AudioClock } from './audio/AudioManager';

export interface AvatarRef {
  speakVisemes: (visemes: VisemeEvent[], clock?: AudioClock) => void;
  stopSpeech: () => void;
  isSpeaking: () => boolean;
  getActiveMorphs: () => Record<string, number>;
  getBoundBones: () => string[];
  getScene: () => THREE.Scene | null;
}

export interface AvatarProps {
  glbUrl?: string;
  mappingUrl?: string;
  onLoaded?: () => void;
  onError?: (err: Error) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Avatar = React.forwardRef<AvatarRef, AvatarProps>(
  (
    {
      glbUrl = '/docs/5.7/characters/bo/bo.glb',
      mappingUrl = '/docs/5.7/characters/bo/mh_materials.json',
      onLoaded,
      onError,
      className,
      style,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const lipSyncRef = useRef<LipSyncController | null>(null);
    const facialAnimRef = useRef<FacialAnimationController | null>(null);
    const bodyAnimRef = useRef<BodyAnimationController | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);

    React.useImperativeHandle(ref, () => ({
      speakVisemes: (visemes: VisemeEvent[], clock?: AudioClock) => {
        lipSyncRef.current?.play(visemes, clock);
      },
      stopSpeech: () => {
        lipSyncRef.current?.stop();
        lipSyncRef.current?.resetImmediately();
        facialAnimRef.current?.resetToRest();
      },
      isSpeaking: () => {
        return lipSyncRef.current?.isSpeaking() ?? false;
      },
      getActiveMorphs: () => {
        return lipSyncRef.current?.getActiveWeights() ?? {};
      },
      getBoundBones: () => {
        return bodyAnimRef.current?.getBoundBoneNames() ?? [];
      },
      getScene: () => sceneRef.current,
    }));

    const onLoadedRef = useRef(onLoaded);
    onLoadedRef.current = onLoaded;

    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const isMountedRef = useRef(false);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // Prevent concurrent double initialization
      if (isMountedRef.current) return;
      isMountedRef.current = true;

      let isDisposed = false;
      let viewerContext: {
        renderer: THREE.WebGLRenderer;
        scene: THREE.Scene;
        camera: THREE.PerspectiveCamera;
        controls: { update: () => void };
        gltf: { scene: THREE.Object3D };
        dispose?: () => void;
      } | null = null;

      // Clean any existing canvas/children before mounting
      container.innerHTML = '';

      // Mount using authentic MetaHuman viewer pipeline
      mount(container, {
        characterId: 'bo',
        glbUrl,
        mappingUrl,
        autoRotate: false,
        interactive: true,
        background: 0x0a0d14,
      })
        .then((v: any) => {
          if (isDisposed) {
            try {
              if (typeof v.dispose === 'function') {
                v.dispose();
              } else {
                v.renderer.setAnimationLoop(null);
                v.renderer.forceContextLoss();
                v.renderer.dispose();
              }
            } catch (_) {}
            container.innerHTML = '';
            return;
          }

          viewerContext = v;
          sceneRef.current = v.scene;

          // 1. Initialize Controllers
          const lipSync = new LipSyncController(v.gltf.scene);
          lipSyncRef.current = lipSync;

          const facialAnim = new FacialAnimationController(v.gltf.scene);
          facialAnimRef.current = facialAnim;

          const bodyAnim = new BodyAnimationController(v.gltf.scene, { enableBreathing: true });
          bodyAnimRef.current = bodyAnim;

          // 2. Set render animation loop integrating controllers
          const clock = new THREE.Clock();
          v.renderer.setAnimationLoop(() => {
            if (isDisposed) return;
            const delta = clock.getDelta();

            v.controls.update();

            const isSpeaking = lipSync.isSpeaking();

            // Layer 1: Body (Microscopic thoracic breathing, strictly preserving rest posture)
            bodyAnim.update(delta, isSpeaking);

            // Layer 2: Face (Natural asymmetric blinks, steady gaze, speech cadence)
            facialAnim.update(delta, isSpeaking);

            // Layer 3: Lip Sync (AudioClock-driven conversational articulation, mouth only)
            lipSync.update(delta);

            v.renderer.render(v.scene, v.camera);
          });

          if (onLoadedRef.current) onLoadedRef.current();
        })
        .catch((err: Error) => {
          console.error('[Avatar] Mount error:', err);
          if (onErrorRef.current) onErrorRef.current(err);
        });

      return () => {
        isDisposed = true;
        isMountedRef.current = false;
        if (viewerContext) {
          try {
            if (typeof viewerContext.dispose === 'function') {
              viewerContext.dispose();
            } else {
              viewerContext.renderer.setAnimationLoop(null);
              viewerContext.renderer.forceContextLoss();
              viewerContext.renderer.dispose();
            }
          } catch (_) {}
        }
        container.innerHTML = '';
      };
    }, [glbUrl, mappingUrl]);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          ...style,
        }}
      />
    );
  }
);

Avatar.displayName = 'Avatar';
