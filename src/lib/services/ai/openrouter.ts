import type { AIProvider, GenerationRequest, GenerationResponse, StreamChunk, ModelInfo, Message } from './types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[OpenRouter]', ...args);
  }
}

export class OpenRouterProvider implements AIProvider {
  id = 'openrouter';
  name = 'OpenRouter';

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateResponse(request: GenerationRequest): Promise<GenerationResponse> {
    log('generateResponse called', {
      model: request.model,
      messagesCount: request.messages.length,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    const requestBody = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.8,
      max_tokens: request.maxTokens ?? 1024,
      stop: request.stopSequences,
      ...request.extraBody, // Spread provider-specific options (e.g., reasoning)
    };

    log('Sending request to OpenRouter...');

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://aventura.app',
        'X-Title': 'Aventura',
      },
      body: JSON.stringify(requestBody),
    });

    log('Response received', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const error = await response.text();
      log('API error', { status: response.status, error });
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    log('Response parsed', {
      model: data.model,
      contentLength: data.choices[0]?.message?.content?.length ?? 0,
      usage: data.usage,
    });

    return {
      content: data.choices[0]?.message?.content ?? '',
      model: data.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async *streamResponse(request: GenerationRequest): AsyncIterable<StreamChunk> {
    log('streamResponse called', {
      model: request.model,
      messagesCount: request.messages.length,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    log('Sending streaming request to OpenRouter...');

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://aventura.app',
        'X-Title': 'Aventura',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.8,
        max_tokens: request.maxTokens ?? 1024,
        stop: request.stopSequences,
        stream: true,
      }),
    });

    log('Stream response received', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const error = await response.text();
      log('Stream API error', { status: response.status, error });
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      log('No response body available');
      throw new Error('No response body');
    }

    log('Starting to read stream...');

    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        log('Stream reader done');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            log('Received [DONE] signal');
            yield { content: '', done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content ?? '';
            if (content) {
              chunkCount++;
              if (chunkCount <= 3) {
                log('Stream chunk received', { chunkCount, contentLength: content.length });
              }
              yield { content, done: false };
            }
          } catch (e) {
            // Ignore parsing errors for incomplete JSON
            log('JSON parse error (may be incomplete):', data.substring(0, 50));
          }
        }
      }
    }

    log('Stream finished', { totalChunks: chunkCount });
  }

  async listModels(): Promise<ModelInfo[]> {
    log('listModels called');

    // The models endpoint is public and doesn't require authentication
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      log('Request timeout triggered');
      controller.abort();
    }, 15000); // 15 second timeout

    try {
      log('Fetching models from OpenRouter API...');

      const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      log('Models response received', { status: response.status, ok: response.ok });

      if (!response.ok) {
        const errorText = await response.text();
        log('Models API error', { status: response.status, error: errorText });
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const json = await response.json();

      if (!json.data || !Array.isArray(json.data)) {
        log('Unexpected API response structure', { keys: Object.keys(json) });
        throw new Error('Invalid API response structure');
      }

      log('Models fetched successfully', { count: json.data.length });

      return json.data.map((model: any) => ({
        id: model.id,
        name: model.name ?? model.id,
        description: model.description ?? '',
        contextLength: model.context_length ?? model.top_provider?.context_length ?? 4096,
        pricing: model.pricing ? {
          prompt: parseFloat(model.pricing.prompt) || 0,
          completion: parseFloat(model.pricing.completion) || 0,
        } : undefined,
      }));
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        log('Request timed out after 15 seconds');
        throw new Error('Request timed out');
      }
      log('listModels error', error);
      throw error;
    }
  }

  async validateApiKey(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }
}
