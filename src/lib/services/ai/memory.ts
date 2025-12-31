import type { OpenRouterProvider } from './openrouter';
import type { Chapter, StoryEntry, MemoryConfig } from '$lib/types';

const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[Memory]', ...args);
  }
}

// Default memory configuration
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  chapterThreshold: 50,
  chapterBuffer: 10,
  autoSummarize: true,
  enableRetrieval: true,
  maxChaptersPerRetrieval: 3,
};

export interface ChapterAnalysis {
  shouldCreateChapter: boolean;
  optimalEndIndex: number;  // Index in entries array where chapter should end
  suggestedTitle: string | null;
}

export interface ChapterSummary {
  summary: string;
  title: string;
  keywords: string[];
  characters: string[];
  locations: string[];
  plotThreads: string[];
  emotionalTone: string;
}

export interface RetrievalDecision {
  relevantChapterIds: string[];
  queries: { chapterId: string; question: string }[];
}

export interface RetrievedContext {
  chapterId: string;
  chapterNumber: number;
  summary: string;
  relevantExcerpt: string | null;
}

export class MemoryService {
  private provider: OpenRouterProvider;
  private model: string;
  private temperature: number;

  constructor(provider: OpenRouterProvider, model?: string, temperature?: number) {
    this.provider = provider;
    // Use Grok 4.1 Fast for memory operations - fast and capable
    this.model = model || 'x-ai/grok-4.1-fast';
    this.temperature = temperature ?? 0.3;
  }

  /**
   * Analyze if a new chapter should be created based on message count and story content.
   * Per design doc section 3.1.2: Auto-Summarization
   */
  async analyzeForChapter(
    entries: StoryEntry[],
    lastChapterEndIndex: number,
    config: MemoryConfig
  ): Promise<ChapterAnalysis> {
    const messagesSinceLastChapter = entries.length - lastChapterEndIndex;
    const threshold = config.chapterThreshold + config.chapterBuffer;

    log('analyzeForChapter', {
      totalEntries: entries.length,
      lastChapterEndIndex,
      messagesSinceLastChapter,
      threshold,
    });

    // Not enough messages yet
    if (messagesSinceLastChapter < threshold) {
      return {
        shouldCreateChapter: false,
        optimalEndIndex: -1,
        suggestedTitle: null,
      };
    }

    // Get entries since last chapter, excluding the buffer
    const startIndex = lastChapterEndIndex;
    const endIndex = entries.length - config.chapterBuffer;
    const chapterEntries = entries.slice(startIndex, endIndex);

    if (chapterEntries.length < config.chapterThreshold) {
      return {
        shouldCreateChapter: false,
        optimalEndIndex: -1,
        suggestedTitle: null,
      };
    }

    // Ask AI to find optimal chapter break point
    const prompt = this.buildChapterAnalysisPrompt(chapterEntries);

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          { role: 'system', content: this.getChapterAnalysisSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        temperature: this.temperature,
        maxTokens: 500,
      });

      const result = this.parseChapterAnalysis(response.content, startIndex, chapterEntries.length);
      log('Chapter analysis result:', result);
      return result;
    } catch (error) {
      log('Chapter analysis failed:', error);
      // Fallback: use threshold as break point
      return {
        shouldCreateChapter: true,
        optimalEndIndex: startIndex + config.chapterThreshold,
        suggestedTitle: null,
      };
    }
  }

  /**
   * Generate a summary and metadata for a chapter.
   */
  async summarizeChapter(entries: StoryEntry[]): Promise<ChapterSummary> {
    log('summarizeChapter called', { entryCount: entries.length });

    const content = entries.map((e, i) => {
      const prefix = e.type === 'user_action' ? '[ACTION]' : '[NARRATION]';
      return `${i + 1}. ${prefix} ${e.content}`;
    }).join('\n\n');

    const prompt = `Summarize this story chapter and extract metadata.

CHAPTER CONTENT:
"""
${content}
"""

Respond with JSON:
{
  "summary": "A concise 2-3 sentence summary of what happened in this chapter",
  "title": "A short evocative chapter title (3-6 words)",
  "keywords": ["key", "words", "for", "search"],
  "characters": ["Character names mentioned"],
  "locations": ["Location names mentioned"],
  "plotThreads": ["Active plot threads or quests"],
  "emotionalTone": "The overall emotional tone (e.g., tense, hopeful, mysterious)"
}`;

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a story analyst. Extract key information from story chapters. Respond with valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.temperature,
        maxTokens: 1000,
      });

      return this.parseChapterSummary(response.content);
    } catch (error) {
      log('Chapter summarization failed:', error);
      // Fallback summary
      return {
        summary: 'Chapter summary unavailable.',
        title: 'Untitled Chapter',
        keywords: [],
        characters: [],
        locations: [],
        plotThreads: [],
        emotionalTone: 'neutral',
      };
    }
  }

  /**
   * Decide which chapters are relevant for the current context.
   * Per design doc section 3.1.3: Retrieval Flow
   */
  async decideRetrieval(
    userInput: string,
    recentEntries: StoryEntry[],
    chapters: Chapter[],
    config: MemoryConfig
  ): Promise<RetrievalDecision> {
    if (!config.enableRetrieval || chapters.length === 0) {
      return { relevantChapterIds: [], queries: [] };
    }

    log('decideRetrieval', {
      userInput: userInput.substring(0, 100),
      recentEntriesCount: recentEntries.length,
      chaptersCount: chapters.length,
    });

    const chapterSummaries = chapters.map(ch => ({
      id: ch.id,
      number: ch.number,
      title: ch.title,
      summary: ch.summary,
      characters: ch.characters,
      locations: ch.locations,
    }));

    const recentContext = recentEntries.slice(-5).map(e => e.content).join('\n');

    const prompt = `Based on the user's input and current scene, decide which past chapters are relevant.

USER INPUT:
"${userInput}"

CURRENT SCENE (last few messages):
"""
${recentContext}
"""

CHAPTER SUMMARIES:
${JSON.stringify(chapterSummaries, null, 2)}

Respond with JSON:
{
  "relevantChapterIds": ["id1", "id2"],
  "queries": [
    {"chapterId": "id1", "question": "What was X?"}
  ]
}

Guidelines:
- Only include chapters that are ACTUALLY relevant to the current context
- Often, no chapters need to be queried - return empty arrays if nothing is relevant
- Maximum ${config.maxChaptersPerRetrieval} chapters per query
- Consider: characters mentioned, locations being revisited, plot threads referenced`;

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You decide which story chapters are relevant for the current context. Respond with valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.temperature,
        maxTokens: 500,
      });

      return this.parseRetrievalDecision(response.content, config.maxChaptersPerRetrieval);
    } catch (error) {
      log('Retrieval decision failed:', error);
      return { relevantChapterIds: [], queries: [] };
    }
  }

  /**
   * Build context block from retrieved chapters for injection into narrator prompt.
   */
  buildRetrievedContextBlock(
    chapters: Chapter[],
    decision: RetrievalDecision
  ): string {
    if (decision.relevantChapterIds.length === 0) {
      return '';
    }

    const relevantChapters = chapters.filter(ch =>
      decision.relevantChapterIds.includes(ch.id)
    );

    if (relevantChapters.length === 0) {
      return '';
    }

    let contextBlock = '\n\n[FROM EARLIER IN THE STORY]';

    for (const chapter of relevantChapters) {
      contextBlock += `\n\n• Chapter ${chapter.number}`;
      if (chapter.title) {
        contextBlock += ` - "${chapter.title}"`;
      }
      contextBlock += `:\n${chapter.summary}`;
    }

    return contextBlock;
  }

  private getChapterAnalysisSystemPrompt(): string {
    return `You analyze story content to find optimal chapter break points.

A good chapter break:
- Falls at a natural pause in the story (scene change, time skip, revelation)
- Doesn't split the middle of an important scene or dialogue
- Creates a satisfying sense of closure for what came before

Respond with valid JSON only.`;
  }

  private buildChapterAnalysisPrompt(entries: StoryEntry[]): string {
    const content = entries.map((e, i) => {
      const prefix = e.type === 'user_action' ? '[ACTION]' : '[NARRATION]';
      return `${i + 1}. ${prefix} ${e.content.substring(0, 200)}${e.content.length > 200 ? '...' : ''}`;
    }).join('\n\n');

    return `Analyze this story content and find the optimal chapter break point.

STORY CONTENT (${entries.length} messages):
"""
${content}
"""

Find the best message number (1-${entries.length}) to end this chapter.
Look for natural story beats: scene changes, resolutions, revelations.

Respond with JSON:
{
  "optimalEndIndex": <number 1-${entries.length}>,
  "suggestedTitle": "Short evocative title for this chapter",
  "reasoning": "Brief explanation of why this is a good break point"
}`;
  }

  private parseChapterAnalysis(
    content: string,
    startIndex: number,
    entryCount: number
  ): ChapterAnalysis {
    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();

      const parsed = JSON.parse(jsonStr);
      const relativeIndex = Math.min(Math.max(1, parsed.optimalEndIndex || entryCount), entryCount);

      return {
        shouldCreateChapter: true,
        optimalEndIndex: startIndex + relativeIndex,
        suggestedTitle: parsed.suggestedTitle || null,
      };
    } catch (e) {
      log('Failed to parse chapter analysis:', e);
      return {
        shouldCreateChapter: true,
        optimalEndIndex: startIndex + entryCount,
        suggestedTitle: null,
      };
    }
  }

  private parseChapterSummary(content: string): ChapterSummary {
    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();

      const parsed = JSON.parse(jsonStr);
      return {
        summary: parsed.summary || 'Summary unavailable.',
        title: parsed.title || 'Untitled Chapter',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        locations: Array.isArray(parsed.locations) ? parsed.locations : [],
        plotThreads: Array.isArray(parsed.plotThreads) ? parsed.plotThreads : [],
        emotionalTone: parsed.emotionalTone || 'neutral',
      };
    } catch (e) {
      log('Failed to parse chapter summary:', e);
      return {
        summary: 'Summary unavailable.',
        title: 'Untitled Chapter',
        keywords: [],
        characters: [],
        locations: [],
        plotThreads: [],
        emotionalTone: 'neutral',
      };
    }
  }

  private parseRetrievalDecision(content: string, maxChapters: number): RetrievalDecision {
    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();

      const parsed = JSON.parse(jsonStr);
      const ids = Array.isArray(parsed.relevantChapterIds)
        ? parsed.relevantChapterIds.slice(0, maxChapters)
        : [];
      const queries = Array.isArray(parsed.queries)
        ? parsed.queries.slice(0, maxChapters)
        : [];

      return { relevantChapterIds: ids, queries };
    } catch (e) {
      log('Failed to parse retrieval decision:', e);
      return { relevantChapterIds: [], queries: [] };
    }
  }
}
