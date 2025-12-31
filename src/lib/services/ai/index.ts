import { settings } from '$lib/stores/settings.svelte';
import { OpenRouterProvider } from './openrouter';
import { BUILTIN_TEMPLATES } from '$lib/services/templates';
import { ClassifierService, type ClassificationResult, type ClassificationContext } from './classifier';
import { MemoryService, type ChapterAnalysis, type ChapterSummary, type RetrievalDecision, DEFAULT_MEMORY_CONFIG } from './memory';
import { SuggestionsService, type StorySuggestion, type SuggestionsResult } from './suggestions';
import { ContextBuilder, type ContextResult, type ContextConfig, DEFAULT_CONTEXT_CONFIG } from './context';
import type { Message, GenerationResponse, StreamChunk } from './types';
import type { Story, StoryEntry, Character, Location, Item, StoryBeat, Chapter, MemoryConfig } from '$lib/types';

const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[AIService]', ...args);
  }
}

interface WorldState {
  characters: Character[];
  locations: Location[];
  items: Item[];
  storyBeats: StoryBeat[];
  currentLocation?: Location;
  chapters?: Chapter[];
  memoryConfig?: MemoryConfig;
}

class AIService {
  private getProvider() {
    const apiKey = settings.apiSettings.openrouterApiKey;
    log('Getting provider, API key configured:', !!apiKey);
    if (!apiKey) {
      throw new Error('No API key configured');
    }
    return new OpenRouterProvider(apiKey);
  }

  async generateResponse(
    entries: StoryEntry[],
    worldState: WorldState,
    story?: Story | null
  ): Promise<string> {
    log('generateResponse called', {
      entriesCount: entries.length,
      storyId: story?.id,
      templateId: story?.templateId,
    });

    const provider = this.getProvider();
    const mode = story?.mode || 'adventure';

    // Build the system prompt with world state context
    const systemPrompt = this.buildSystemPrompt(worldState, story?.templateId, undefined, mode);
    log('System prompt built, length:', systemPrompt.length, 'mode:', mode);

    // Build conversation history
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add recent entries as conversation history
    const recentEntries = entries.slice(-20); // Keep last 20 entries for context
    for (const entry of recentEntries) {
      if (entry.type === 'user_action') {
        messages.push({ role: 'user', content: entry.content });
      } else if (entry.type === 'narration') {
        messages.push({ role: 'assistant', content: entry.content });
      }
    }

    log('Messages built:', {
      totalMessages: messages.length,
      model: settings.apiSettings.defaultModel,
      temperature: settings.apiSettings.temperature,
      maxTokens: settings.apiSettings.maxTokens,
    });

    const response = await provider.generateResponse({
      messages,
      model: settings.apiSettings.defaultModel,
      temperature: settings.apiSettings.temperature,
      maxTokens: settings.apiSettings.maxTokens,
    });

    log('Response received, length:', response.content.length);
    return response.content;
  }

  async *streamResponse(
    entries: StoryEntry[],
    worldState: WorldState,
    story?: Story | null,
    useTieredContext = true
  ): AsyncIterable<StreamChunk> {
    log('streamResponse called', {
      entriesCount: entries.length,
      storyId: story?.id,
      templateId: story?.templateId,
      mode: story?.mode,
      useTieredContext,
      worldState: {
        characters: worldState.characters.length,
        locations: worldState.locations.length,
        items: worldState.items.length,
        storyBeats: worldState.storyBeats.length,
        currentLocation: worldState.currentLocation?.name,
      },
    });

    const provider = this.getProvider();
    const mode = story?.mode || 'adventure';

    // Extract user's last input for tiered context building
    const lastUserEntry = entries.findLast(e => e.type === 'user_action');
    const userInput = lastUserEntry?.content || '';

    // Build tiered context if enabled
    let tieredContextBlock: string | undefined;
    if (useTieredContext && userInput) {
      try {
        const contextResult = await this.buildTieredContext(
          worldState,
          userInput,
          entries.slice(-10), // Recent entries for name matching
          undefined // Retrieved chapter context could be passed here
        );
        tieredContextBlock = contextResult.contextBlock;
        log('Tiered context built', {
          tier1: contextResult.tier1.length,
          tier2: contextResult.tier2.length,
          tier3: contextResult.tier3.length,
          blockLength: tieredContextBlock.length,
        });
      } catch (error) {
        log('Tiered context building failed, falling back to legacy', error);
        // Fall back to legacy context building
      }
    }

    // Build the system prompt with world state context
    const systemPrompt = this.buildSystemPrompt(
      worldState,
      story?.templateId,
      undefined,
      mode,
      tieredContextBlock
    );
    log('System prompt built, length:', systemPrompt.length, 'mode:', mode);

    // Build conversation history
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add recent entries as conversation history
    const recentEntries = entries.slice(-20);
    for (const entry of recentEntries) {
      if (entry.type === 'user_action') {
        messages.push({ role: 'user', content: entry.content });
      } else if (entry.type === 'narration') {
        messages.push({ role: 'assistant', content: entry.content });
      }
    }

    log('Starting stream with', {
      totalMessages: messages.length,
      model: settings.apiSettings.defaultModel,
      temperature: settings.apiSettings.temperature,
      maxTokens: settings.apiSettings.maxTokens,
    });

    let chunkCount = 0;
    let totalContent = 0;

    for await (const chunk of provider.streamResponse({
      messages,
      model: settings.apiSettings.defaultModel,
      temperature: settings.apiSettings.temperature,
      maxTokens: settings.apiSettings.maxTokens,
    })) {
      chunkCount++;
      totalContent += chunk.content.length;
      if (chunkCount <= 3 || chunk.done) {
        log('Stream chunk', { chunkCount, contentLength: chunk.content.length, done: chunk.done });
      }
      yield chunk;
    }

    log('Stream complete', { totalChunks: chunkCount, totalContentLength: totalContent });
  }

  /**
   * Classify a narrative response to extract world state changes.
   * This is Phase 3 of the processing pipeline per design doc.
   */
  async classifyResponse(
    narrativeResponse: string,
    userAction: string,
    worldState: WorldState,
    story?: Story | null
  ): Promise<ClassificationResult> {
    log('classifyResponse called', {
      responseLength: narrativeResponse.length,
      userActionLength: userAction.length,
      genre: story?.genre,
    });

    const provider = this.getProvider();
    const classifier = new ClassifierService(provider);

    const context: ClassificationContext = {
      narrativeResponse,
      userAction,
      existingCharacters: worldState.characters,
      existingLocations: worldState.locations,
      existingItems: worldState.items,
      existingStoryBeats: worldState.storyBeats,
      genre: story?.genre ?? null,
    };

    const result = await classifier.classify(context);
    log('classifyResponse complete', {
      newCharacters: result.entryUpdates.newCharacters.length,
      newLocations: result.entryUpdates.newLocations.length,
      newItems: result.entryUpdates.newItems.length,
      newStoryBeats: result.entryUpdates.newStoryBeats.length,
    });

    return result;
  }

  /**
   * Generate story direction suggestions for creative writing mode.
   * Per design doc section 4.2: Suggestions System
   */
  async generateSuggestions(
    entries: StoryEntry[],
    activeThreads: StoryBeat[],
    genre?: string | null
  ): Promise<SuggestionsResult> {
    log('generateSuggestions called', {
      entriesCount: entries.length,
      threadsCount: activeThreads.length,
      genre,
    });

    const provider = this.getProvider();
    const suggestions = new SuggestionsService(provider);
    return await suggestions.generateSuggestions(entries, activeThreads, genre);
  }

  /**
   * Analyze if a new chapter should be created.
   * Per design doc section 3.1.2: Auto-Summarization
   */
  async analyzeForChapter(
    entries: StoryEntry[],
    lastChapterEndIndex: number,
    config: MemoryConfig
  ): Promise<ChapterAnalysis> {
    log('analyzeForChapter called', {
      entriesCount: entries.length,
      lastChapterEndIndex,
    });

    const provider = this.getProvider();
    const memory = new MemoryService(provider);
    return await memory.analyzeForChapter(entries, lastChapterEndIndex, config);
  }

  /**
   * Generate a summary and metadata for a chapter.
   */
  async summarizeChapter(entries: StoryEntry[]): Promise<ChapterSummary> {
    log('summarizeChapter called', { entriesCount: entries.length });

    const provider = this.getProvider();
    const memory = new MemoryService(provider);
    return await memory.summarizeChapter(entries);
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
    log('decideRetrieval called', {
      userInputLength: userInput.length,
      recentEntriesCount: recentEntries.length,
      chaptersCount: chapters.length,
    });

    const provider = this.getProvider();
    const memory = new MemoryService(provider);
    return await memory.decideRetrieval(userInput, recentEntries, chapters, config);
  }

  /**
   * Build context block from retrieved chapters for injection into narrator prompt.
   */
  buildRetrievedContextBlock(
    chapters: Chapter[],
    decision: RetrievalDecision
  ): string {
    const memory = new MemoryService(null as any); // Only using static method
    return memory.buildRetrievedContextBlock(chapters, decision);
  }

  /**
   * Build tiered context using the ContextBuilder.
   * Per design doc section 3.2.3: Tiered Injection
   */
  async buildTieredContext(
    worldState: WorldState,
    userInput: string,
    recentEntries: StoryEntry[],
    retrievedChapterContext?: string,
    config?: Partial<ContextConfig>
  ): Promise<ContextResult> {
    log('buildTieredContext called', {
      userInputLength: userInput.length,
      recentEntriesCount: recentEntries.length,
      hasRetrievedContext: !!retrievedChapterContext,
    });

    let provider: OpenRouterProvider | null = null;
    try {
      provider = this.getProvider();
    } catch {
      // Provider not available (no API key), will skip Tier 3
      log('No provider available, skipping Tier 3 LLM selection');
    }

    const contextBuilder = new ContextBuilder(provider, config);
    const result = await contextBuilder.buildContext(
      worldState,
      userInput,
      recentEntries,
      retrievedChapterContext
    );

    log('buildTieredContext complete', {
      tier1: result.tier1.length,
      tier2: result.tier2.length,
      tier3: result.tier3.length,
      total: result.all.length,
    });

    return result;
  }

  private buildSystemPrompt(
    worldState: WorldState,
    templateId?: string | null,
    retrievedContext?: string,
    mode: 'adventure' | 'creative-writing' = 'adventure',
    tieredContextBlock?: string
  ): string {
    // Get template-specific system prompt if available
    let basePrompt = '';

    if (templateId) {
      const template = BUILTIN_TEMPLATES.find(t => t.id === templateId);
      if (template?.systemPrompt) {
        basePrompt = template.systemPrompt;
      }
    }

    // If no template prompt, use mode-appropriate default prompt
    if (!basePrompt) {
      if (mode === 'creative-writing') {
        basePrompt = `You are a skilled fiction writer collaborating on a story. Your role is to craft engaging prose that follows the author's creative direction.

## Writing Style
- Write in third person, past tense (unless directed otherwise)
- Use vivid, literary prose with attention to craft
- Write 2-4 paragraphs per response, unless pacing calls for more or less
- Balance action, dialogue, interiority, and description
- Give characters distinct voices and believable motivations

## Collaboration Principles
- Follow the author's direction for what happens in the scene
- Add detail, texture, and craft to their vision
- If direction is vague, make interesting choices that serve the story
- Maintain consistency with established characters, tone, and world
- Craft scenes with purpose—each should advance plot or character
- Use subtext and implication; avoid over-explanation

## What to Avoid
- Breaking the narrative voice or referencing being an AI
- Contradicting established story elements
- Being overly purple or verbose
- Resolving tension too quickly—let moments breathe
- Telling instead of showing`;
      } else {
        basePrompt = `You are the narrator of an interactive story. Your role is to bring the world to life and respond to the player's actions with vivid, engaging prose.

## Writing Style
- Write in second person, present tense ("You see...", "You feel...")
- Be descriptive and evocative—use sensory details (sights, sounds, smells, textures)
- Write 2-4 paragraphs per response, unless pacing calls for more or less
- Balance action, dialogue, and atmosphere
- Make NPCs feel like real people with their own personalities and motivations

## Narrative Principles
- Respond to player actions naturally and logically within the world
- Honor player agency—describe the results of their choices, don't override them
- Leave space for the player to decide what to do next; don't railroad
- Introduce interesting characters, challenges, and opportunities organically
- Maintain strict consistency with established world details and character behaviors
- When introducing named characters or locations, give them memorable, distinct qualities

## What to Avoid
- Breaking character or referencing being an AI
- Describing what the player thinks or feels unless they said/did something that implies it
- Making decisions for the player or assuming their next action
- Repeating information the player already knows
- Being overly verbose—prefer evocative brevity over purple prose`;
      }
    }

    // Build world state context block
    let contextBlock = '';
    let hasContext = false;

    // Use tiered context block if provided (from ContextBuilder)
    if (tieredContextBlock) {
      hasContext = true;
      contextBlock = tieredContextBlock;
    } else {
      // Fallback to inline context building (legacy behavior)

      // Current location (most important for scene-setting)
      if (worldState.currentLocation) {
        hasContext = true;
        contextBlock += `\n\n[CURRENT LOCATION]\n${worldState.currentLocation.name}`;
        if (worldState.currentLocation.description) {
          contextBlock += `\n${worldState.currentLocation.description}`;
        }
      }

      // Characters currently present or known (excluding protagonist)
      const activeChars = worldState.characters.filter(c => c.status === 'active' && c.relationship !== 'self');
      if (activeChars.length > 0) {
        hasContext = true;
        contextBlock += '\n\n[KNOWN CHARACTERS]';
        for (const char of activeChars) {
          contextBlock += `\n• ${char.name}`;
          if (char.relationship) contextBlock += ` (${char.relationship})`;
          if (char.description) contextBlock += ` — ${char.description}`;
          if (char.traits && char.traits.length > 0) {
            contextBlock += ` [${char.traits.join(', ')}]`;
          }
        }
      }

      // Inventory (what the player has available)
      const inventory = worldState.items.filter(i => i.location === 'inventory');
      if (inventory.length > 0) {
        hasContext = true;
        const inventoryStr = inventory.map(item => {
          let str = item.name;
          if (item.quantity > 1) str += ` (×${item.quantity})`;
          if (item.equipped) str += ' [equipped]';
          return str;
        }).join(', ');
        contextBlock += `\n\n[INVENTORY]\n${inventoryStr}`;
      }

      // Active quests and story threads
      const activeQuests = worldState.storyBeats.filter(b => b.status === 'active' || b.status === 'pending');
      if (activeQuests.length > 0) {
        hasContext = true;
        contextBlock += '\n\n[ACTIVE THREADS]';
        for (const quest of activeQuests) {
          contextBlock += `\n• ${quest.title}`;
          if (quest.description) contextBlock += `: ${quest.description}`;
        }
      }

      // Previously visited locations (for geographic context)
      const visitedLocations = worldState.locations.filter(l => l.visited && !l.current);
      if (visitedLocations.length > 0) {
        hasContext = true;
        contextBlock += `\n\n[PLACES VISITED]\n${visitedLocations.map(l => l.name).join(', ')}`;
      }

      // Add retrieved context from memory system
      if (retrievedContext) {
        hasContext = true;
        contextBlock += retrievedContext;
      }
    }

    // Combine prompt with context
    if (hasContext) {
      basePrompt += '\n\n───────────────────────────────────────\n';
      basePrompt += 'WORLD STATE (for your reference, do not mention directly)';
      basePrompt += contextBlock;
      basePrompt += '\n───────────────────────────────────────';
    }

    // Final instruction
    basePrompt += `\n\n[INSTRUCTIONS]
Respond to the player's action with an engaging narrative continuation. Describe:
1. The immediate results of their action
2. How the environment or characters react
3. New details, opportunities, or tensions that emerge

Do not summarize what happened—show it unfolding. End in a way that invites the player's next choice.`;

    return basePrompt;
  }
}

export const aiService = new AIService();
