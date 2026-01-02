import type { OpenRouterProvider } from './openrouter';
import type {
  Tool,
  ToolCall,
  AgenticMessage,
} from './types';
import type {
  Chapter,
  StoryEntry,
  Entry,
} from '$lib/types';
import { settings } from '$lib/stores/settings.svelte';

const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[AgenticRetrieval]', ...args);
  }
}

// Tool definitions for Agentic Retrieval (per design doc section 3.1.4)
const RETRIEVAL_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'list_chapters',
      description: 'List all available chapters with their summaries, characters, and locations',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_chapter',
      description: 'Ask a specific question about a single chapter to get relevant information',
      parameters: {
        type: 'object',
        properties: {
          chapter_number: {
            type: 'number',
            description: 'The chapter number to query',
          },
          question: {
            type: 'string',
            description: 'The specific question to answer about this chapter',
          },
        },
        required: ['chapter_number', 'question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_chapters',
      description: 'Ask a question across a range of chapters (max 3 per query) for broader information',
      parameters: {
        type: 'object',
        properties: {
          start_chapter: {
            type: 'number',
            description: 'First chapter in the range',
          },
          end_chapter: {
            type: 'number',
            description: 'Last chapter in the range',
          },
          question: {
            type: 'string',
            description: 'The question to answer',
          },
        },
        required: ['start_chapter', 'end_chapter', 'question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_entries',
      description: 'List lorebook entries for cross-referencing with story context',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Optional filter by entry type',
            enum: ['character', 'location', 'item', 'faction', 'concept', 'event'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_retrieval',
      description: 'Signal that retrieval is complete and provide synthesized context',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Synthesized context from retrieved information that is relevant to the current situation',
          },
        },
        required: ['summary'],
      },
    },
  },
];

// Default system prompt for Agentic Retrieval
export const DEFAULT_AGENTIC_RETRIEVAL_PROMPT = `You are a context retrieval agent for an interactive story. Your job is to gather relevant past context that will help the narrator respond to the current situation.

Guidelines:
1. Start by reviewing the chapter list to understand the story structure
2. Query specific chapters that seem relevant to the current user input
3. Focus on gathering context about:
   - Characters mentioned or involved
   - Locations being revisited
   - Plot threads being referenced
   - Items or information from the past
   - Relationship history
4. Be selective - only gather truly relevant information
5. When you have enough context, call finish_retrieval with a synthesized summary

The context you provide will be injected into the narrator's prompt to help maintain story consistency.`;

export interface AgenticRetrievalContext {
  userInput: string;
  recentEntries: StoryEntry[];
  chapters: Chapter[];
  entries: Entry[];
}

export interface AgenticRetrievalResult {
  context: string;
  queriedChapters: number[];
  iterations: number;
  sessionId: string;
}

export class AgenticRetrievalService {
  private provider: OpenRouterProvider;
  private settingsOverride?: Partial<AgenticRetrievalSettings>;

  constructor(provider: OpenRouterProvider, settingsOverride?: Partial<AgenticRetrievalSettings>) {
    this.provider = provider;
    this.settingsOverride = settingsOverride;
  }

  private get model(): string {
    return this.settingsOverride?.model ?? settings.systemServicesSettings.agenticRetrieval?.model ?? 'minimax/minimax-m2.1';
  }

  private get temperature(): number {
    return this.settingsOverride?.temperature ?? settings.systemServicesSettings.agenticRetrieval?.temperature ?? 0.3;
  }

  private get maxIterations(): number {
    return this.settingsOverride?.maxIterations ?? settings.systemServicesSettings.agenticRetrieval?.maxIterations ?? 10;
  }

  private get systemPrompt(): string {
    return this.settingsOverride?.systemPrompt ?? settings.systemServicesSettings.agenticRetrieval?.systemPrompt ?? DEFAULT_AGENTIC_RETRIEVAL_PROMPT;
  }

  /**
   * Run agentic retrieval to gather context for the current situation.
   * Per design doc section 3.1.4: Agentic Retrieval (Optional)
   */
  async runRetrieval(
    context: AgenticRetrievalContext,
    onQueryChapter?: (chapterNumber: number, question: string) => Promise<string>,
    onQueryChapters?: (startChapter: number, endChapter: number, question: string) => Promise<string>
  ): Promise<AgenticRetrievalResult> {
    const sessionId = crypto.randomUUID();
    const queriedChapters: number[] = [];

    log('Starting agentic retrieval', {
      sessionId,
      userInputLength: context.userInput.length,
      chaptersCount: context.chapters.length,
      entriesCount: context.entries.length,
    });

    // Build initial prompt
    const initialPrompt = this.buildInitialPrompt(context);

    // Initialize conversation
    const messages: AgenticMessage[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: initialPrompt },
    ];

    let complete = false;
    let iterations = 0;
    let retrievedContext = '';
    let consecutiveNoToolCalls = 0;
    const MAX_NO_TOOL_CALL_RETRIES = 2;

    while (!complete && iterations < this.maxIterations) {
      iterations++;
      log(`Retrieval iteration ${iterations}/${this.maxIterations}`);

      try {
        const response = await this.provider.generateWithTools({
          messages,
          model: this.model,
          temperature: this.temperature,
          maxTokens: 1500,
          tools: RETRIEVAL_TOOLS,
          tool_choice: 'auto',
          extraBody: {
            reasoning: { effort: 'high' },
            provider: { only: ['Minimax'] },
          },
        });

        log('Retrieval agent response', {
          hasContent: !!response.content,
          hasToolCalls: !!response.tool_calls,
          toolCallCount: response.tool_calls?.length ?? 0,
          finishReason: response.finish_reason,
          hasReasoning: !!response.reasoning,
          hasReasoningDetails: !!response.reasoning_details,
        });

        if (response.reasoning) {
          log('Agent reasoning:', response.reasoning.substring(0, 500));
        }

        // If no tool calls, prompt the agent to use tools or finish
        if (!response.tool_calls || response.tool_calls.length === 0) {
          consecutiveNoToolCalls++;
          log(`No tool calls (${consecutiveNoToolCalls}/${MAX_NO_TOOL_CALL_RETRIES})`);

          if (response.content) {
            messages.push({
              role: 'assistant',
              content: response.content,
              reasoning: response.reasoning ?? null,
              reasoning_details: response.reasoning_details,
            });
          }

          if (consecutiveNoToolCalls >= MAX_NO_TOOL_CALL_RETRIES) {
            log('Max no-tool-call retries reached, ending retrieval');
            break;
          }

          messages.push({
            role: 'user',
            content: 'Please use the available tools to gather relevant context, or call finish_retrieval when you are done.',
          });
          continue;
        }

        consecutiveNoToolCalls = 0;

        // Add assistant response to messages
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.tool_calls,
          reasoning: response.reasoning ?? null,
          reasoning_details: response.reasoning_details,
        });

        // Execute each tool call
        for (const toolCall of response.tool_calls) {
          const result = await this.executeTool(
            toolCall,
            context,
            queriedChapters,
            onQueryChapter,
            onQueryChapters
          );

          if (toolCall.function.name === 'finish_retrieval') {
            complete = true;
            const args = JSON.parse(toolCall.function.arguments);
            retrievedContext = args.summary;
          }

          // Add tool result to messages
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      } catch (error) {
        log('Error in retrieval iteration:', error);
        break;
      }
    }

    if (iterations >= this.maxIterations) {
      log('Max iterations reached');
    }

    log('Agentic retrieval complete', {
      sessionId,
      iterations,
      queriedChaptersCount: queriedChapters.length,
      contextLength: retrievedContext.length,
    });

    return {
      context: retrievedContext,
      queriedChapters,
      iterations,
      sessionId,
    };
  }

  private buildInitialPrompt(context: AgenticRetrievalContext): string {
    // Format recent context (last 5 entries)
    const recentContext = context.recentEntries.slice(-5).map(e => {
      const prefix = e.type === 'user_action' ? '[ACTION]' : '[NARRATION]';
      return `${prefix} ${e.content.substring(0, 300)}...`;
    }).join('\n\n');

    return `# Current Situation

USER INPUT:
"${context.userInput}"

RECENT SCENE:
${recentContext}

# Available Chapters: ${context.chapters.length}
${context.chapters.map(c => `- Chapter ${c.number}: ${c.title || 'Untitled'} (${c.characters.join(', ')})`).join('\n')}

# Lorebook Entries: ${context.entries.length}
${context.entries.slice(0, 20).map(e => `- ${e.name} (${e.type})`).join('\n')}
${context.entries.length > 20 ? `...and ${context.entries.length - 20} more` : ''}

Please gather relevant context from past chapters that will help respond to this situation. Focus on information that is actually needed - often, no retrieval is necessary for simple actions.`;
  }

  private async executeTool(
    toolCall: ToolCall,
    context: AgenticRetrievalContext,
    queriedChapters: number[],
    onQueryChapter?: (chapterNumber: number, question: string) => Promise<string>,
    onQueryChapters?: (startChapter: number, endChapter: number, question: string) => Promise<string>
  ): Promise<string> {
    const args = JSON.parse(toolCall.function.arguments);
    log('Executing retrieval tool:', toolCall.function.name, args);

    switch (toolCall.function.name) {
      case 'list_chapters': {
        return JSON.stringify(context.chapters.map(c => ({
          number: c.number,
          title: c.title,
          summary: c.summary,
          characters: c.characters,
          locations: c.locations,
          plotThreads: c.plotThreads,
        })));
      }

      case 'query_chapter': {
        const chapterNum = args.chapter_number;
        const question = args.question;

        // Track queried chapters
        if (!queriedChapters.includes(chapterNum)) {
          queriedChapters.push(chapterNum);
        }

        const chapter = context.chapters.find(c => c.number === chapterNum);
        if (!chapter) {
          return JSON.stringify({ error: `Chapter ${chapterNum} not found` });
        }

        // If we have a query callback, use it for AI-powered answers
        if (onQueryChapter) {
          try {
            const answer = await onQueryChapter(chapterNum, question);
            return JSON.stringify({
              chapter: chapterNum,
              question,
              answer,
            });
          } catch (error) {
            log('Query chapter failed, falling back to summary:', error);
          }
        }

        // Fallback: return summary
        return JSON.stringify({
          chapter: chapterNum,
          question,
          answer: `Based on chapter summary: ${chapter.summary}`,
          characters: chapter.characters,
          locations: chapter.locations,
        });
      }

      case 'query_chapters': {
        const startChapter = args.start_chapter;
        const endChapter = Math.min(args.end_chapter, startChapter + 2);
        const question = args.question;

        const chapters = context.chapters.filter(
          c => c.number >= startChapter && c.number <= endChapter
        );

        // Track queried chapters
        for (const c of chapters) {
          if (!queriedChapters.includes(c.number)) {
            queriedChapters.push(c.number);
          }
        }

        if (chapters.length === 0) {
          return JSON.stringify({ error: 'No chapters in specified range' });
        }

        if (onQueryChapters) {
          try {
            const answer = await onQueryChapters(startChapter, endChapter, question);
            return JSON.stringify({
              range: { start: startChapter, end: endChapter },
              question,
              answer,
            });
          } catch (error) {
            log('Query chapters failed, falling back to summaries:', error);
          }
        }

        const combinedSummaries = chapters.map(c =>
          `Chapter ${c.number}: ${c.summary}`
        ).join('\n\n');

        return JSON.stringify({
          range: { start: startChapter, end: endChapter },
          question,
          answer: `Based on chapters ${startChapter}-${endChapter}:\n${combinedSummaries}`,
        });
      }

      case 'list_entries': {
        const typeFilter = args.type;
        const filtered = typeFilter
          ? context.entries.filter(e => e.type === typeFilter)
          : context.entries;

        return JSON.stringify(filtered.map(e => ({
          id: e.id,
          name: e.name,
          type: e.type,
          description: e.description.substring(0, 150),
          aliases: e.aliases,
        })));
      }

      case 'finish_retrieval': {
        return JSON.stringify({
          success: true,
          message: 'Retrieval complete',
          summary_length: args.summary.length,
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
    }
  }

  /**
   * Build a context block from retrieval results for injection into narrator prompt.
   */
  static formatForPromptInjection(result: AgenticRetrievalResult): string {
    if (!result.context || result.context.length === 0) {
      return '';
    }

    return `
<retrieved_context>
## From Earlier in the Story
${result.context}
</retrieved_context>`;
  }
}

// Settings interface
export interface AgenticRetrievalSettings {
  enabled: boolean;
  model: string;
  temperature: number;
  maxIterations: number;
  systemPrompt: string;
  // Threshold for when to use agentic retrieval instead of static
  agenticThreshold: number; // Use agentic if chapters > N (default: 30)
}

export function getDefaultAgenticRetrievalSettings(): AgenticRetrievalSettings {
  return {
    enabled: false, // Disabled by default, static retrieval is usually sufficient
    model: 'minimax/minimax-m2.1',
    temperature: 0.3,
    maxIterations: 10,
    systemPrompt: DEFAULT_AGENTIC_RETRIEVAL_PROMPT,
    agenticThreshold: 30,
  };
}
