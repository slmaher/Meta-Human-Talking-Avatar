/**
 * Bo MetaHuman material settings, bone fixups, and camera framing utilities.
 * Preserves realistic skin, hair shaders, eye refraction, and clothing.
 */

import * as THREE from 'three';

/**
 * Hand-tuned settled rotations for cloth and accessory bones in rest pose.
 * In three.js quaternion order: [x, y, z, w].
 */
export const BONE_FIXUPS: Record<string, [number, number, number, number]> = {
  dyn_string_l_joint01: [0, 0.4828, 0, 0.8757],
  dyn_string_r_joint01: [0, 0.4742, 0, 0.8804],
};

/**
 * Hair overrides tuned specifically for Bo to achieve natural melanin and gloss.
 */
export const BO_HAIR_CONFIG = {
  global: {
    hair_roughness_floor: 0.56,
    root_darkening: 0.0,
    seed_variation: 0.36,
    hair_roughness_seed_amp: 0.08,
    anisotropy: 0.09,
    anisotropy_rotation: 0.798,
  },
  materials: {
    brows: { mode: 'blend', color: '#090603', hair_density: 4.0 },
    hair: { mode: 'both', color: '#090603', hair_density: 4.0, blend_opacity: 0.1 },
  },
};

/**
 * Applies necessary settled rotations to simulated garment and accessory bones.
 */
export function applyBoneFixups(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) {
      const bone = obj as THREE.Bone;
      const q = BONE_FIXUPS[bone.name];
      if (q) {
        bone.quaternion.set(q[0], q[1], q[2], q[3]);
        count++;
      }
    }
  });
  return count;
}

/**
 * Automatically positions the camera to frame Bo's head and chest portrait-style.
 */
export function autoFrameBo(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void },
  root: THREE.Object3D
): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  // Focus near the eye line (~88-90% of body height)
  const headY = box.min.y + size.y * 0.88;
  const headExtent = size.y * 0.22;

  const vFov = (camera.fov * Math.PI) / 180;
  const dist = headExtent / (2 * Math.tan(vFov / 2));

  camera.position.set(0, headY, dist * 1.6);
  controls.target.set(0, headY, 0);
  controls.update();
}

/**
 * Ensures all materials on Bo render double-sided (required for hair cards, eyelashes, clothing).
 */
export function enforceDoubleSidedMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m) {
          m.side = THREE.DoubleSide;
        }
      }
    }
  });
}
