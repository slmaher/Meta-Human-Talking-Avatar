/**
 * ThreeDAvatar.tsx: Interactive Talking Avatar Orchestrator.
 * Connects:
 *   User Text / Microphone (Speech-to-Text)
 *     -> Backend LLM (/api/chat)
 *     -> AI Response
 *     -> Backend ElevenLabs TTS (/api/tts)
 *     -> Audio + Synchronized ARKit Visemes
 *     -> Existing LipSyncController & Natural Body Motion
 *     -> Bo MetaHuman
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Avatar, AvatarRef } from './Avatar';
import { ITTSProvider, ILLMProvider } from './types';
import { MockTTSProvider } from './tts/MockTTSProvider';
import { WebSpeechTTSProvider } from './tts/WebSpeechTTSProvider';
import { ElevenLabsTTSProvider } from './tts/ElevenLabsTTSProvider';
import { MockLLMProvider, BackendLLMProvider, ChatMessage } from './ai/LLMProvider';
import { SpeechToTextProvider, WebSpeechSTTProvider } from './stt/SpeechToTextProvider';

export type { ChatMessage };

export interface ThreeDAvatarProps {
  glbUrl?: string;
  defaultTtsProvider?: 'elevenlabs' | 'webspeech' | 'mock';
  defaultLlmProvider?: 'backend' | 'mock';
  backendChatEndpoint?: string;
  backendTtsEndpoint?: string;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

export const ThreeDAvatar: React.FC<ThreeDAvatarProps> = ({
  glbUrl = '/docs/5.7/characters/bo/bo.glb',
  defaultTtsProvider = 'elevenlabs',
  defaultLlmProvider = 'backend',
  backendChatEndpoint = '/api/chat',
  backendTtsEndpoint = '/api/tts',
  onSpeechStart,
  onSpeechEnd,
}) => {
  const avatarRef = useRef<AvatarRef>(null);

  // Providers
  const [ttsProviderType, setTtsProviderType] = useState(defaultTtsProvider);
  const [llmProviderType, setLlmProviderType] = useState(defaultLlmProvider);

  const ttsProviders = useRef<Record<string, ITTSProvider>>({
    elevenlabs: new ElevenLabsTTSProvider({ endpointUrl: backendTtsEndpoint }),
    webspeech: new WebSpeechTTSProvider(),
    mock: new MockTTSProvider(),
  });

  const llmProviders = useRef<Record<string, ILLMProvider>>({
    backend: new BackendLLMProvider(backendChatEndpoint),
    mock: new MockLLMProvider(),
  });

  const sttProviderRef = useRef<SpeechToTextProvider | null>(null);

  // Conversation & Interaction State
  const [inputText, setInputText] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Hello! I am Bo, your MetaHuman AI talking avatar. You can talk to me with your voice or type below.',
      timestamp: Date.now(),
    },
  ]);

  // Operational States
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [statusText, setStatusText] = useState('Idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 3D & Telemetry State
  const [activeMorphs, setActiveMorphs] = useState<Record<string, number>>({});
  const [boundBonesCount, setBoundBonesCount] = useState(0);
  const [isModelLoaded, setIsModelLoaded] = useState(false);

  // Active audio reference for interruption
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * Immediately interrupts Bo's current speech and audio:
   * - Pauses and rewinds active audio playback
   * - Stops the active TTS provider
   * - Zeroes speech morph targets and resets to resting baseline
   */
  const handleInterrupt = useCallback(() => {
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      } catch (e) {
        console.warn('[ThreeDAvatar] Audio stop error:', e);
      }
      activeAudioRef.current = null;
    }

    const currentTts = ttsProviders.current[ttsProviderType];
    if (currentTts) {
      currentTts.stop();
    }

    if (avatarRef.current) {
      avatarRef.current.stopSpeech();
    }

    setIsSpeaking(false);
    if (!isListening && !isProcessing) {
      setStatusText('Idle');
    }
  }, [ttsProviderType, isListening, isProcessing]);

  // Low-frequency telemetry interval (avoids React rerender churn on animation frames)
  useEffect(() => {
    const interval = setInterval(() => {
      if (avatarRef.current) {
        const morphs = avatarRef.current.getActiveMorphs();
        setActiveMorphs(morphs);
        const speaking = avatarRef.current.isSpeaking();
        setIsSpeaking(speaking);

        if (!speaking && statusText.startsWith('Speaking')) {
          setStatusText('Idle');
          if (onSpeechEnd) onSpeechEnd();
        }
      }
    }, 120);
    return () => clearInterval(interval);
  }, [statusText, onSpeechEnd]);

  /**
   * Speaks text through the selected TTS provider and synchronizes with LipSyncController.
   */
  const speakText = useCallback(
    async (text: string) => {
      handleInterrupt();

      const provider = ttsProviders.current[ttsProviderType] || ttsProviders.current.elevenlabs;
      setStatusText(`Speaking (${provider.name})...`);
      setIsSpeaking(true);
      if (onSpeechStart) onSpeechStart();

      try {
        const result = await provider.speak(text);

        // Attach onended handler if an HTMLAudioElement is active
        if (provider instanceof ElevenLabsTTSProvider) {
          const audio = provider.getCurrentAudio();
          if (audio) {
            activeAudioRef.current = audio;
            audio.onended = () => {
              activeAudioRef.current = null;
              avatarRef.current?.stopSpeech();
              setIsSpeaking(false);
              setStatusText('Idle');
              if (onSpeechEnd) onSpeechEnd();
            };
          }
        }

        if (avatarRef.current && result.visemes.length > 0) {
          // Hardware / playback AudioClock is the single source of truth for lip sync
          avatarRef.current.speakVisemes(result.visemes, result.audioClock);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Speech synthesis failed';
        console.error('[ThreeDAvatar] Speak failed:', message);
        setErrorMessage(message);
        setStatusText('Speech Error');
        setIsSpeaking(false);
      }
    },
    [ttsProviderType, handleInterrupt, onSpeechStart, onSpeechEnd]
  );

  /**
   * Complete conversational turn:
   * Input text -> Backend LLM -> AI response -> Backend TTS -> Bo speaks with ARKit visemes.
   */
  const handleSendMessage = useCallback(
    async (textToSend?: string) => {
      const prompt = (textToSend || inputText).trim();
      if (!prompt || isProcessing) return;

      // Interrupt any current speech before sending new turn
      handleInterrupt();

      const userMsg: ChatMessage = {
        role: 'user',
        text: prompt,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInputText('');
      setInterimTranscript('');
      setIsProcessing(true);
      setStatusText('Thinking...');
      setErrorMessage(null);

      try {
        const llm = llmProviders.current[llmProviderType] || llmProviders.current.backend;

        // Clean conversation history without UI overhead
        const cleanHistory = messages.map((m) => ({
          role: m.role,
          content: m.text || m.content || '',
          text: m.text || m.content || '',
          timestamp: m.timestamp,
        }));

        const responseText = await llm.sendMessage(prompt, cleanHistory);

        const aiMsg: ChatMessage = {
          role: 'assistant',
          text: responseText,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, aiMsg]);
        await speakText(responseText);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'AI conversation failed';
        console.error('[ThreeDAvatar] Conversation failed:', message);
        setErrorMessage(message);
        setStatusText('AI Error');
      } finally {
        setIsProcessing(false);
      }
    },
    [inputText, isProcessing, handleInterrupt, llmProviderType, messages, speakText]
  );

  /**
   * Toggles voice recognition (STT) on/off.
   */
  const toggleListening = useCallback(() => {
    // If user presses mic while Bo is speaking, interrupt Bo immediately
    if (isSpeaking) {
      handleInterrupt();
    }

    if (isListening) {
      if (sttProviderRef.current) {
        sttProviderRef.current.stop();
      }
      setIsListening(false);
      setStatusText('Idle');
      return;
    }

    if (!sttProviderRef.current) {
      sttProviderRef.current = new WebSpeechSTTProvider();
    }

    const stt = sttProviderRef.current;
    setErrorMessage(null);

    stt.onInterimTranscript = (text: string) => {
      setInterimTranscript(text);
    };

    stt.onFinalTranscript = (text: string) => {
      setInterimTranscript('');
      setIsListening(false);
      stt.stop();
      handleSendMessage(text);
    };

    stt.onError = (err: Error | string) => {
      const msg = typeof err === 'string' ? err : err.message;
      setErrorMessage(msg);
      setIsListening(false);
      setStatusText('Voice Error');
    };

    try {
      stt.start();
      setIsListening(true);
      setStatusText('Listening...');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not start microphone';
      setErrorMessage(message);
      setIsListening(false);
    }
  }, [isSpeaking, isListening, handleInterrupt, handleSendMessage]);

  const handleLoaded = useCallback(() => {
    setIsModelLoaded(true);
    if (avatarRef.current) {
      const bones = avatarRef.current.getBoundBones();
      setBoundBonesCount(bones.length);
    }
  }, []);

  const handleError = useCallback((e: Error) => {
    setErrorMessage(e.message);
    setStatusText(`Load error: ${e.message}`);
  }, []);

  // Compute status pill colors
  const getStatusColor = () => {
    if (errorMessage) return { bg: '#ef444422', text: '#f87171', border: '#ef444444' };
    if (isListening) return { bg: '#f59e0b22', text: '#fbbf24', border: '#f59e0b44' };
    if (isProcessing) return { bg: '#3b82f622', text: '#60a5fa', border: '#3b82f644' };
    if (isSpeaking) return { bg: '#10b98122', text: '#34d399', border: '#05966944' };
    return { bg: '#64748b22', text: '#94a3b8', border: '#334155' };
  };

  const statusColors = getStatusColor();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100vh',
        background: '#0a0d14',
        color: '#f0f3f8',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top Status & Settings Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          background: '#121722',
          borderBottom: '1px solid #1e2638',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Bo MetaHuman AI Talking Avatar
          </span>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: 600,
              background: statusColors.bg,
              color: statusColors.text,
              border: `1px solid ${statusColors.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '8px' }}>●</span>
            {statusText}
          </span>
          {boundBonesCount > 0 && (
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Rig: {boundBonesCount} body joints active
            </span>
          )}
        </div>

        {/* Provider Selectors */}
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#94a3b8' }}>TTS:</span>
            <select
              value={ttsProviderType}
              onChange={(e) => setTtsProviderType(e.target.value as 'elevenlabs' | 'webspeech' | 'mock')}
              style={{
                background: '#1e2638',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '4px 8px',
              }}
            >
              <option value="elevenlabs">ElevenLabs (/api/tts)</option>
              <option value="webspeech">Web Speech (Browser API)</option>
              <option value="mock">Mock Synth (Web Audio Clock)</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#94a3b8' }}>LLM:</span>
            <select
              value={llmProviderType}
              onChange={(e) => setLlmProviderType(e.target.value as 'backend' | 'mock')}
              style={{
                background: '#1e2638',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '4px 8px',
              }}
            >
              <option value="backend">Backend AI (/api/chat)</option>
              <option value="mock">Local Mock Persona</option>
            </select>
          </label>

          <a
            href="/docs/5.7/characters/bo/index.html"
            target="_blank"
            rel="noreferrer"
            style={{
              color: '#38bdf8',
              textDecoration: 'none',
              background: '#1e2638',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 500,
            }}
            title="Open Classic Docs Viewer"
          >
            Classic Viewer ↗
          </a>
        </div>
      </header>

      {/* Main Viewport */}
      <div style={{ display: 'flex', flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* 3D Canvas */}
        <div style={{ flex: 1, position: 'relative', height: '100%' }}>
          <Avatar
            ref={avatarRef}
            glbUrl={glbUrl}
            onLoaded={handleLoaded}
            onError={handleError}
          />

          {/* WebGL Context Recovery Prompt */}
          {errorMessage && errorMessage.toLowerCase().includes('webgl') && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(10, 13, 20, 0.95)',
                padding: '24px',
                textAlign: 'center',
                zIndex: 20,
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171', marginBottom: '8px' }}>
                WebGL Context Lost or Limit Reached
              </div>
              <p style={{ color: '#94a3b8', maxWidth: '420px', fontSize: '13px', lineHeight: 1.5, marginBottom: '20px' }}>
                The browser GPU process ran out of available WebGL contexts due to hot-reloads or background tabs. Refreshing the tab cleanly resets all GPU contexts.
              </p>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                🔄 Refresh Page to Reset WebGL
              </button>
            </div>
          )}

          {/* Quick Action Controls */}
          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '16px',
              display: 'flex',
              gap: '8px',
              zIndex: 10,
            }}
          >
            <button
              onClick={() => speakText('Hello, I am Bo. My conversational pipeline is fully online and ready.')}
              disabled={!isModelLoaded || isSpeaking || isProcessing}
              style={{
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 14px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(37,99,235,0.3)',
              }}
            >
              ▶ Test Voice Greeting
            </button>

            {isSpeaking && (
              <button
                onClick={handleInterrupt}
                style={{
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(220,38,38,0.3)',
                }}
              >
                ⏹ Interrupt Speech
              </button>
            )}
          </div>

          {/* Real-Time Active Morph Telemetry */}
          {Object.keys(activeMorphs).length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '16px',
                left: '16px',
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(8px)',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #334155',
                fontSize: '11px',
                fontFamily: 'monospace',
                maxWidth: '280px',
                zIndex: 10,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '6px', color: '#38bdf8' }}>
                Active ARKit Morphs:
              </div>
              {Object.entries(activeMorphs).map(([name, val]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <span style={{ color: '#cbd5e1' }}>{name}:</span>
                  <span style={{ color: '#facc15' }}>{(val as number).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat Sidebar */}
        <div
          style={{
            width: '380px',
            background: '#121722',
            borderLeft: '1px solid #1e2638',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Error Banner */}
          {errorMessage && (
            <div
              style={{
                background: '#ef444422',
                color: '#fca5a5',
                borderBottom: '1px solid #ef444444',
                padding: '10px 14px',
                fontSize: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>⚠ {errorMessage}</span>
              <button
                onClick={() => setErrorMessage(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fca5a5',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Chat Messages */}
          <div
            style={{
              flex: 1,
              padding: '16px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: m.role === 'user' ? '#2563eb' : '#1e2638',
                  color: '#fff',
                  borderRadius: '12px',
                  padding: '10px 14px',
                  fontSize: '14px',
                  lineHeight: 1.4,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                }}
              >
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '2px' }}>
                  {m.role === 'user' ? 'You' : 'Bo'}
                </div>
                {m.text}
              </div>
            ))}

            {isProcessing && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  color: '#60a5fa',
                  fontSize: '13px',
                  fontStyle: 'italic',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span style={{ animation: 'spin 1s linear infinite' }}>●</span> Bo is thinking...
              </div>
            )}

            {isListening && interimTranscript && (
              <div
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '85%',
                  background: '#f59e0b22',
                  color: '#fbbf24',
                  borderRadius: '12px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  fontStyle: 'italic',
                  border: '1px dashed #f59e0b44',
                }}
              >
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '2px' }}>Hearing...</div>
                {interimTranscript}
              </div>
            )}
          </div>

          {/* Message Input with Voice Microphone */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            style={{
              padding: '14px',
              borderTop: '1px solid #1e2638',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            {/* Microphone Button */}
            <button
              type="button"
              onClick={toggleListening}
              title={isListening ? 'Stop listening' : 'Start voice input'}
              style={{
                background: isListening ? '#ef4444' : '#1e2638',
                color: isListening ? '#fff' : '#38bdf8',
                border: `1px solid ${isListening ? '#dc2626' : '#334155'}`,
                borderRadius: '8px',
                width: '42px',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: isListening ? '0 0 12px rgba(239, 68, 68, 0.5)' : 'none',
              }}
            >
              {isListening ? '⏹' : '🎤'}
            </button>

            {/* Text Input */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isListening ? 'Listening to your voice...' : 'Ask Bo anything...'}
              disabled={isProcessing}
              style={{
                flex: 1,
                background: '#1a2233',
                color: '#fff',
                border: '1px solid #2e3b52',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '14px',
                outline: 'none',
              }}
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={isProcessing || !inputText.trim()}
              style={{
                background: isProcessing || !inputText.trim() ? '#1e293b' : '#2563eb',
                color: isProcessing || !inputText.trim() ? '#64748b' : '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '0 16px',
                height: '42px',
                fontWeight: 600,
                cursor: isProcessing || !inputText.trim() ? 'default' : 'pointer',
              }}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
