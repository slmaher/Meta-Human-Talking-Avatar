# AI Talking Avatar — Bo MetaHuman

## Overview

This project is based on the following open-source repository:

**Reference Repository:**
https://github.com/smorchj/metahuman-to-glb

The repository is used as the reference/base for the MetaHuman avatar and facial setup.

The goal of our implementation is to build an **AI Talking Avatar** on top of that existing setup, allowing the avatar to receive text or voice input, generate an AI response, speak it using TTS, and synchronize the facial/lip movement with the generated speech.

---

## Reference Repository

### MetaHuman → GLB

The original repository provides the main avatar/facial foundation, including:

* MetaHuman web-ready avatar setup
* Three.js viewer
* ARKit facial blendshapes
* Facial deformation
* Facial animation support
* Hair and facial-hair rendering
* Web-based avatar rendering

Repository:

https://github.com/smorchj/metahuman-to-glb

We use this repository as the reference for the existing avatar and facial/ARKit setup rather than rebuilding that part from scratch.

---

# What We Added

On top of the existing avatar setup, we added the **AI Talking Avatar layer**.

## 1. AI / LLM Integration

Added an LLM provider architecture that allows the avatar to receive a user message and generate an AI response.

Flow:

```text
User Message
     ↓
LLM
     ↓
AI Response
```

The implementation supports a backend-based LLM provider so API keys remain server-side.

---

## 2. Text-to-Speech

Added a TTS provider architecture for converting the AI response into speech.

Current provider structure includes:

```text
TTSProvider
├── MockTTSProvider
├── WebSpeechTTSProvider
└── ElevenLabsTTSProvider
```

The production flow is intended to use ElevenLabs:

```text
AI Response
     ↓
ElevenLabs
     ↓
Generated Audio
```

Configuration is handled through server-side environment variables.

---

## 3. Lip Sync / Viseme Layer

Added a lip-sync layer that maps speech visemes to the avatar's existing ARKit facial blendshapes.

The intended flow is:

```text
Generated Speech
      ↓
Viseme Timing
      ↓
Lip Sync Controller
      ↓
ARKit Facial Blendshapes
      ↓
Avatar Mouth Movement
```

The goal is to synchronize the avatar's mouth movement with the actual generated speech instead of using simple audio-volume based animation.

---

## 4. Facial Animation

Added supporting facial animation for a more natural talking-avatar experience, including:

* Blinking
* Eye movement / saccades
* Gaze changes
* Subtle idle movement
* Speech-related facial movement

The original avatar behavior and facial setup should remain the base, with these animations layered carefully on top.

---

## 5. Talking Avatar UI

Added a React-based talking-avatar layer containing:

* Avatar viewer
* Chat interface
* Text input
* Conversation messages
* Speaking state
* Thinking state
* Listening state
* Error state
* Speech controls

---

# Target End-to-End Flow

The final system is intended to work like this:

```text
                 ┌──────────────┐
                 │     User     │
                 └──────┬───────┘
                        │
              Text or Voice Input
                        │
                        ▼
                 ┌──────────────┐
                 │     LLM      │
                 └──────┬───────┘
                        │
                  AI Response
                        │
                        ▼
                 ┌──────────────┐
                 │     TTS      │
                 │  ElevenLabs  │
                 └──────┬───────┘
                        │
               Audio + Viseme Timing
                        │
                        ▼
                 ┌──────────────┐
                 │   Lip Sync   │
                 └──────┬───────┘
                        │
                 ARKit Blendshapes
                        │
                        ▼
                 ┌──────────────┐
                 │   Bo Avatar  │
                 └──────────────┘
```

---

# Text Interaction

The text interaction flow is:

```text
User types message
        ↓
Backend /api/chat
        ↓
LLM
        ↓
AI response text
        ↓
/api/tts
        ↓
ElevenLabs
        ↓
Audio + timing
        ↓
Lip Sync
        ↓
Bo speaks
```

---

# Voice Interaction

The voice interaction flow is:

```text
User microphone
        ↓
Speech-to-Text
        ↓
User transcript
        ↓
LLM
        ↓
AI response
        ↓
ElevenLabs TTS
        ↓
Audio + visemes
        ↓
Lip Sync
        ↓
Bo speaks
```

---

# Environment Variables

The AI services use server-side environment variables.

Example:

```env
# LLM
LLM_API_KEY=
LLM_MODEL=gemini-1.5-flash

# ElevenLabs
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5

# Server
PORT=5173
```

### Important

API keys must remain server-side and must never be exposed in browser/client code.

A `.env.example` file should contain only the variable names/placeholders.

Actual credentials should be stored in the local `.env` file.

---

# Main Added Components

The AI talking-avatar implementation includes the following main areas:

```text
src/modules/3d-avatar/

├── Avatar.tsx
├── ThreeDAvatar.tsx
├── types.ts
│
├── lipSync.ts
├── facialAnimation.ts
│
├── ai/
│   └── LLMProvider.ts
│
├── tts/
│   ├── TTSProvider.ts
│   ├── MockTTSProvider.ts
│   ├── WebSpeechTTSProvider.ts
│   └── ElevenLabsTTSProvider.ts
│
└── materials/
    └── boMaterials.ts
```

Additional talking-avatar integration:

```text
docs/5.7/assets/
└── talking-avatar.js
```

---

# Original vs Added

## Existing / Reference

From the original repository:

* MetaHuman avatar setup
* Three.js rendering
* ARKit facial blendshapes
* Facial deformation
* Hair rendering
* Facial-hair rendering
* Original avatar viewer
* Existing facial/animation infrastructure

Reference:

https://github.com/smorchj/metahuman-to-glb

## Added

Our implementation adds:

* LLM integration layer
* TTS provider architecture
* ElevenLabs integration
* AI conversation flow
* Chat UI
* Talking-avatar orchestration
* Viseme/lip-sync layer
* Facial animation layer
* Text → AI → Speech pipeline
* Voice interaction architecture
* Backend API integration structure

---

# Current Status

### Completed / Implemented

* Existing MetaHuman avatar integrated as the base
* AI provider architecture
* TTS provider architecture
* ElevenLabs provider
* Chat/talking-avatar UI
* Lip-sync architecture
* ARKit-based facial control
* Facial animation support
* Text-to-AI conversation flow structure

### Still Requires / Needs Validation

* Real LLM API credentials
* Real ElevenLabs API credentials
* Final voice selection
* End-to-end `/api/chat` testing
* End-to-end `/api/tts` testing
* Voice input / Speech-to-Text validation
* Final viseme timing validation
* Final facial-animation tuning
* Production security/configuration

---

# Important Design Principle

The original MetaHuman/Three.js facial setup should remain the foundation.

We are **not replacing the original avatar system**.

Instead:

```text
Original MetaHuman Facial System
              +
       AI Conversation
              +
            TTS
              +
       Viseme Lip Sync
              =
       AI Talking Avatar
```

This allows us to preserve the existing avatar quality while adding the AI interaction layer.

---

## Reference

Original repository:

https://github.com/smorchj/metahuman-to-glb
