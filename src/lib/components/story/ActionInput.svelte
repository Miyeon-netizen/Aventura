<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte';
  import { story } from '$lib/stores/story.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { aiService } from '$lib/services/ai';
  import { Send, Wand2, MessageSquare, Brain, Sparkles, Feather } from 'lucide-svelte';
  import type { Chapter } from '$lib/types';
  import type { StorySuggestion } from '$lib/services/ai/suggestions';
  import Suggestions from './Suggestions.svelte';
  import {
    emitUserInput,
    emitNarrativeResponse,
    emitSuggestionsReady,
    eventBus,
    type ResponseStreamingEvent,
    type ClassificationCompleteEvent,
  } from '$lib/services/events';

  function log(...args: any[]) {
    console.log('[ActionInput]', ...args);
  }

  let inputValue = $state('');
  let actionType = $state<'do' | 'say' | 'think' | 'story'>('do');
  let suggestions = $state<StorySuggestion[]>([]);
  let suggestionsLoading = $state(false);

  // In creative writing mode, show different input style
  const isCreativeMode = $derived(story.storyMode === 'creative-writing');

  /**
   * Generate story direction suggestions for creative writing mode.
   */
  async function refreshSuggestions() {
    if (!isCreativeMode || story.entries.length === 0) {
      suggestions = [];
      return;
    }

    suggestionsLoading = true;
    try {
      const result = await aiService.generateSuggestions(
        story.entries,
        story.pendingQuests,
        story.currentStory?.genre
      );
      suggestions = result.suggestions;
      log('Suggestions refreshed:', suggestions.length);

      // Emit SuggestionsReady event
      emitSuggestionsReady(suggestions.map(s => ({ text: s.text, type: s.type })));
    } catch (error) {
      log('Failed to generate suggestions:', error);
      suggestions = [];
    } finally {
      suggestionsLoading = false;
    }
  }

  /**
   * Handle selecting a suggestion - populate the input with the suggestion text.
   */
  function handleSuggestionSelect(text: string) {
    inputValue = text;
    // Focus the input
    const input = document.querySelector('textarea');
    input?.focus();
  }

  /**
   * Check if auto-summarization should create a new chapter.
   * Runs in background after each response, per design doc section 3.1.2.
   */
  async function checkAutoSummarize() {
    if (!story.currentStory) return;

    const config = story.memoryConfig;
    log('checkAutoSummarize', {
      messagesSinceLastChapter: story.messagesSinceLastChapter,
      threshold: config.chapterThreshold + config.chapterBuffer,
    });

    // Analyze if we should create a chapter
    const analysis = await aiService.analyzeForChapter(
      story.entries,
      story.lastChapterEndIndex,
      config
    );

    if (!analysis.shouldCreateChapter) {
      log('No chapter needed yet');
      return;
    }

    log('Creating new chapter', { optimalEndIndex: analysis.optimalEndIndex });

    // Get entries for this chapter
    const startIndex = story.lastChapterEndIndex;
    const chapterEntries = story.entries.slice(startIndex, analysis.optimalEndIndex);

    if (chapterEntries.length === 0) {
      log('No entries for chapter');
      return;
    }

    // Generate chapter summary
    const summary = await aiService.summarizeChapter(chapterEntries);

    // Create the chapter
    const chapterNumber = story.chapters.length + 1;
    const chapter: Chapter = {
      id: crypto.randomUUID(),
      storyId: story.currentStory.id,
      number: chapterNumber,
      title: analysis.suggestedTitle || summary.title,
      startEntryId: chapterEntries[0].id,
      endEntryId: chapterEntries[chapterEntries.length - 1].id,
      entryCount: chapterEntries.length,
      summary: summary.summary,
      keywords: summary.keywords,
      characters: summary.characters,
      locations: summary.locations,
      plotThreads: summary.plotThreads,
      emotionalTone: summary.emotionalTone,
      arcId: null,
      createdAt: Date.now(),
    };

    await story.addChapter(chapter);
    log('Chapter created', { number: chapterNumber, title: chapter.title });
  }

  const actionPrefixes = {
    do: 'You ',
    say: 'You say "',
    think: 'You think to yourself, "',
    story: '',
  };

  const actionSuffixes = {
    do: '',
    say: '"',
    think: '"',
    story: '',
  };

  async function handleSubmit() {
    log('handleSubmit called', { inputValue: inputValue.trim(), actionType, isCreativeMode, isGenerating: ui.isGenerating });

    if (!inputValue.trim() || ui.isGenerating) {
      log('Submit blocked', { emptyInput: !inputValue.trim(), isGenerating: ui.isGenerating });
      return;
    }

    // In creative writing mode, use raw input as direction
    // In adventure mode, apply action prefixes/suffixes
    const content = isCreativeMode
      ? inputValue.trim()
      : actionPrefixes[actionType] + inputValue.trim() + actionSuffixes[actionType];
    log('Action content built', { content, mode: isCreativeMode ? 'creative' : 'adventure' });

    // Add user action to story
    await story.addEntry('user_action', content);
    log('User action added to story');

    // Emit UserInput event
    emitUserInput(content, isCreativeMode ? 'direction' : actionType);

    // Clear input
    inputValue = '';

    // Generate AI response with streaming
    if (settings.hasApiKey) {
      log('Starting AI generation...');
      ui.setGenerating(true);
      ui.startStreaming();

      try {
        // Build world state for AI context
        const worldState = {
          characters: story.characters,
          locations: story.locations,
          items: story.items,
          storyBeats: story.storyBeats,
          currentLocation: story.currentLocation,
        };

        log('World state built', {
          characters: worldState.characters.length,
          locations: worldState.locations.length,
          items: worldState.items.length,
          storyBeats: worldState.storyBeats.length,
        });

        let fullResponse = '';
        let chunkCount = 0;

        // Use streaming response
        log('Starting stream iteration...');
        for await (const chunk of aiService.streamResponse(story.entries, worldState, story.currentStory)) {
          chunkCount++;
          if (chunk.content) {
            fullResponse += chunk.content;
            ui.appendStreamContent(chunk.content);

            // Emit streaming event
            eventBus.emit<ResponseStreamingEvent>({
              type: 'ResponseStreaming',
              chunk: chunk.content,
              accumulated: fullResponse,
            });
          }

          if (chunk.done) {
            log('Stream done signal received');
            break;
          }
        }

        log('Stream complete', { chunkCount, responseLength: fullResponse.length });

        // Save the complete response as a story entry
        if (fullResponse.trim()) {
          const narrationEntry = await story.addEntry('narration', fullResponse);
          log('Narration entry saved');

          // Emit NarrativeResponse event
          emitNarrativeResponse(narrationEntry.id, fullResponse);

          // Phase 3: Classify the response to extract world state changes
          log('Starting classification phase...');
          try {
            const classificationResult = await aiService.classifyResponse(
              fullResponse,
              content, // The user action
              worldState,
              story.currentStory
            );

            log('Classification complete', {
              newCharacters: classificationResult.entryUpdates.newCharacters.length,
              newLocations: classificationResult.entryUpdates.newLocations.length,
              newItems: classificationResult.entryUpdates.newItems.length,
              newStoryBeats: classificationResult.entryUpdates.newStoryBeats.length,
            });

            // Emit ClassificationComplete event
            eventBus.emit<ClassificationCompleteEvent>({
              type: 'ClassificationComplete',
              messageId: narrationEntry.id,
              result: classificationResult,
            });

            // Phase 4: Apply classification results to world state
            await story.applyClassificationResult(classificationResult);
            log('World state updated from classification');
          } catch (classifyError) {
            // Classification failure shouldn't break the main flow
            log('Classification failed (non-fatal)', classifyError);
            console.warn('World state classification failed:', classifyError);
          }

          // Phase 5: Check if auto-summarization is needed (background, non-blocking)
          if (story.memoryConfig.autoSummarize) {
            checkAutoSummarize().catch(err => {
              log('Auto-summarize check failed (non-fatal)', err);
            });
          }

          // Phase 6: Generate suggestions for creative writing mode (background, non-blocking)
          if (isCreativeMode) {
            refreshSuggestions().catch(err => {
              log('Suggestions generation failed (non-fatal)', err);
            });
          }
        }
      } catch (error) {
        log('Generation failed', error);
        console.error('Generation failed:', error);
        await story.addEntry('system', 'Failed to generate response. Please check your API settings.');
      } finally {
        ui.endStreaming();
        ui.setGenerating(false);
        log('Generation complete, UI reset');
      }
    } else {
      log('No API key configured');
      await story.addEntry('system', 'Please configure your OpenRouter API key in settings to enable AI generation.');
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }
</script>

<div class="space-y-3">
  {#if isCreativeMode}
    <!-- Creative Writing Mode: Suggestions -->
    <Suggestions
      {suggestions}
      loading={suggestionsLoading}
      onSelect={handleSuggestionSelect}
      onRefresh={refreshSuggestions}
    />

    <!-- Creative Writing Mode: Direction Input -->
    <div class="flex gap-2">
      <div class="relative flex-1">
        <textarea
          bind:value={inputValue}
          onkeydown={handleKeydown}
          placeholder="Describe what happens next in the story..."
          class="input min-h-[60px] resize-none pr-12"
          rows="2"
          disabled={ui.isGenerating}
        ></textarea>
      </div>
      <button
        onclick={handleSubmit}
        disabled={!inputValue.trim() || ui.isGenerating}
        class="btn btn-primary self-end px-4 py-3"
        title="Continue story"
      >
        <Feather class="h-5 w-5" />
      </button>
    </div>
  {:else}
    <!-- Adventure Mode: Action type buttons -->
    <div class="flex gap-2">
      <button
        class="btn flex items-center gap-1.5 text-sm"
        class:btn-primary={actionType === 'do'}
        class:btn-secondary={actionType !== 'do'}
        onclick={() => actionType = 'do'}
      >
        <Wand2 class="h-4 w-4" />
        Do
      </button>
      <button
        class="btn flex items-center gap-1.5 text-sm"
        class:btn-primary={actionType === 'say'}
        class:btn-secondary={actionType !== 'say'}
        onclick={() => actionType = 'say'}
      >
        <MessageSquare class="h-4 w-4" />
        Say
      </button>
      <button
        class="btn flex items-center gap-1.5 text-sm"
        class:btn-primary={actionType === 'think'}
        class:btn-secondary={actionType !== 'think'}
        onclick={() => actionType = 'think'}
      >
        <Brain class="h-4 w-4" />
        Think
      </button>
      <button
        class="btn flex items-center gap-1.5 text-sm"
        class:btn-primary={actionType === 'story'}
        class:btn-secondary={actionType !== 'story'}
        onclick={() => actionType = 'story'}
      >
        <Sparkles class="h-4 w-4" />
        Story
      </button>
    </div>

    <!-- Adventure Mode: Input area -->
    <div class="flex gap-2">
      <div class="relative flex-1">
        <textarea
          bind:value={inputValue}
          onkeydown={handleKeydown}
          placeholder={actionType === 'story' ? 'Describe what happens...' : 'What do you do?'}
          class="input min-h-[60px] resize-none pr-12"
          rows="2"
          disabled={ui.isGenerating}
        ></textarea>
      </div>
      <button
        onclick={handleSubmit}
        disabled={!inputValue.trim() || ui.isGenerating}
        class="btn btn-primary self-end px-4 py-3"
      >
        <Send class="h-5 w-5" />
      </button>
    </div>
  {/if}
</div>
