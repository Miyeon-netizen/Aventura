import type {
  AIProvider,
  GenerationRequest,
  GenerationResponse,
  StreamChunk,
  ModelInfo,
  Message,
  AgenticRequest,
  AgenticResponse,
  Tool,
  ToolCall,
} from './types';

const NANOGPT_API_URL = 'https://nano-gpt.com/api/v1/chat/completions';
const NANOGPT_MODELS_URL = 'https://nano-gpt.com/api/v1/models';
const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[NanoGPT]', ...args);
  }
}

export class NanoGPTProvider implements AIProvider {
  id = 'nanogpt';
  name = 'NanoGPT';

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateResponse(request: GenerationRequest): Promise<GenerationResponse> {
    log('generateResponse called', {
      model: request.model,
      messagesCount: request.messages.length,
      temperature: request.temperature,
      topP: request.topP,
      maxTokens: request.maxTokens,
    });

    const requestBody: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.8,
      max_tokens: request.maxTokens ?? 8192,
      stop: request.stopSequences,
      ...request.extraBody,
    };

    if (request.topP !== undefined) {
      requestBody.top_p = request.topP;
    }

    log('Sending request to NanoGPT...');

    const response = await fetch(NANOGPT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    log('Response received', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const error = await response.text();
      log('API error', { status: response.status, error });
      throw new Error(`NanoGPT API error: ${response.status} - ${error}`);
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

  /**
   * Generate a response with tool calling support.
   */
  async generateWithTools(request: AgenticRequest): Promise<AgenticResponse> {
    log('generateWithTools called', {
      model: request.model,
      messagesCount: request.messages.length,
      toolsCount: request.tools.length,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    const requestBody: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 8192,
      tools: request.tools,
      tool_choice: request.tool_choice ?? 'auto',
      ...request.extraBody,
    };

    log('Sending tool-enabled request to NanoGPT...');

    const response = await fetch(NANOGPT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    log('Tool response received', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const error = await response.text();
      log('Tool API error', { status: response.status, error });
      throw new Error(`NanoGPT API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice?.message;

    log('Tool response parsed', {
      model: data.model,
      finishReason: choice?.finish_reason,
      hasToolCalls: !!message?.tool_calls,
      toolCallCount: message?.tool_calls?.length ?? 0,
      contentLength: message?.content?.length ?? 0,
    });

    // Parse tool calls if present
    const toolCalls: ToolCall[] | undefined = message?.tool_calls?.map((tc: any) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

    return {
      content: message?.content ?? null,
      model: data.model,
      tool_calls: toolCalls,
      finish_reason: choice?.finish_reason ?? 'stop',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
        reasoningTokens: data.usage.reasoning_tokens,
      } : undefined,
    };
  }

  async *streamResponse(request: GenerationRequest): AsyncIterable<StreamChunk> {
    log('streamResponse called', {
      model: request.model,
      messagesCount: request.messages.length,
      temperature: request.temperature,
      topP: request.topP,
      maxTokens: request.maxTokens,
    });

    log('Sending streaming request to NanoGPT...');

    const requestBody: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.8,
      max_tokens: request.maxTokens ?? 8192,
      stop: request.stopSequences,
      stream: true,
      ...request.extraBody,
    };

    if (request.topP !== undefined) {
      requestBody.top_p = request.topP;
    }

    const response = await fetch(NANOGPT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    log('Stream response received', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const error = await response.text();
      log('Stream API error', { status: response.status, error });
      throw new Error(`NanoGPT API error: ${response.status} - ${error}`);
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
            log('JSON parse error (may be incomplete):', data.substring(0, 50));
          }
        }
      }
    }

    log('Stream finished', { totalChunks: chunkCount });
  }

  async listModels(): Promise<ModelInfo[]> {
    log('listModels called');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      log('Request timeout triggered');
      controller.abort();
    }, 15000);

    try {
      log('Fetching models from NanoGPT API...');

      const response = await fetch(NANOGPT_MODELS_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
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
        name: model.id, // NanoGPT models usually have readable IDs
        description: '',
        contextLength: 4096, // Default fallback
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
