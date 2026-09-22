/**
 * LLM Provider interfaces and implementations for the conversational AI avatar.
 */

import { ILLMProvider } from '../types';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content?: string;
  text?: string;
  timestamp?: number;
}

export abstract class BaseLLMProvider implements ILLMProvider {
  public abstract readonly name: string;
  public abstract sendMessage(prompt: string, history?: ChatMessage[]): Promise<string>;
}

/**
 * MockLLMProvider: Context-aware conversational AI assistant representing Bo.
 * Provides instant responses for development and testing without network latency or external keys.
 */
export class MockLLMProvider extends BaseLLMProvider {
  public readonly name = 'MockLLM';

  private responses: Record<string, string> = {
    hello: "Hello! I am Bo, your MetaHuman AI talking avatar. It's great to meet you!",
    hi: "Hi there! How can I assist you today?",
    "who are you": "I am Bo, an Unreal Engine MetaHuman running directly in the browser via Three.js with full ARKit blendshapes and real-time lip sync.",
    "how are you": "I'm doing well, thank you! Ready to converse and assist you with anything you need.",
    "what can you do": "I can listen to your queries, think with an AI brain, synthesize speech through TTS, and speak to you with realistic ARKit lip sync and natural facial expressions.",
    test: "Testing one, two, three. My jaw, lips, and facial blendshapes are functioning with low latency and smooth transitions.",
  };

  public async sendMessage(prompt: string, _history?: ChatMessage[]): Promise<string> {
    // Simulate natural thinking latency (250-500ms)
    await new Promise((resolve) => setTimeout(resolve, 350));

    const clean = prompt.trim().toLowerCase();
    for (const [key, response] of Object.entries(this.responses)) {
      if (clean.includes(key)) {
        return response;
      }
    }

    return `You asked: "${prompt}". As Bo, I'm processing your request and ready to assist you further!`;
  }
}

/**
 * BackendLLMProvider: Routes chat requests to your backend server or AI endpoint (/api/chat).
 * Ensures API secrets (Gemini / OpenAI / Anthropic) are never exposed in browser client code.
 */
export class BackendLLMProvider extends BaseLLMProvider {
  public readonly name = 'BackendLLM';
  private endpointUrl: string;

  constructor(endpointUrl = '/api/chat') {
    super();
    this.endpointUrl = endpointUrl;
  }

  public async sendMessage(prompt: string, history: ChatMessage[] = []): Promise<string> {
    const formattedHistory = history.map((m) => ({
      role: m.role,
      content: m.content || m.text || '',
      text: m.text || m.content || '',
      timestamp: m.timestamp,
    }));

    const messages = [
      ...formattedHistory,
      { role: 'user' as const, content: prompt, text: prompt, timestamp: Date.now() },
    ];

    const res = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, prompt }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`[BackendLLM] HTTP error: ${res.status} ${res.statusText} ${err}`);
    }

    const data = await res.json();
    return data.text || data.reply || data.message || '';
  }
}
