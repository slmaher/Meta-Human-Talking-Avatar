import React from 'react';
import { ThreeDAvatar } from './modules/3d-avatar/ThreeDAvatar';

export const App: React.FC = () => {
  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
      <ThreeDAvatar
        glbUrl="/docs/5.7/characters/bo/bo.glb"
        defaultTtsProvider="elevenlabs"
        defaultLlmProvider="backend"
      />
    </div>
  );
};
