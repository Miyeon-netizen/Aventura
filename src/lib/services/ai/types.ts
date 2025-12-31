export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationRequest {
  messages: Message[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  extraBody?: Record<string, unknown>; // For provider-specific options like reasoning
}

export interface GenerationResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextLength: number;
  pricing?: {
    prompt: number;
    completion: number;
  };
}

export interface AIProvider {
  id: string;
  name: string;

  generateResponse(request: GenerationRequest): Promise<GenerationResponse>;
  streamResponse(request: GenerationRequest): AsyncIterable<StreamChunk>;
  listModels(): Promise<ModelInfo[]>;
  validateApiKey(): Promise<boolean>;
}
