<script lang="ts">
  import { story } from '$lib/stores/story.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import { Lightbulb, ArrowRight, Loader2, RefreshCw } from 'lucide-svelte';
  import type { StorySuggestion } from '$lib/services/ai/suggestions';

  interface Props {
    suggestions: StorySuggestion[];
    loading: boolean;
    onSelect: (text: string) => void;
    onRefresh: () => void;
  }

  let { suggestions, loading, onSelect, onRefresh }: Props = $props();

  const typeColors: Record<string, string> = {
    action: 'text-blue-400',
    dialogue: 'text-green-400',
    revelation: 'text-yellow-400',
    twist: 'text-purple-400',
  };

  const typeLabels: Record<string, string> = {
    action: 'Action',
    dialogue: 'Dialogue',
    revelation: 'Revelation',
    twist: 'Twist',
  };
</script>

{#if story.storyMode === 'creative-writing'}
  <div class="border-t border-surface-700 pt-4">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2 text-surface-300">
        <Lightbulb class="h-4 w-4" />
        <span class="text-sm font-medium">What happens next?</span>
      </div>
      <button
        class="btn-ghost p-1.5 rounded text-surface-400 hover:text-surface-200"
        onclick={onRefresh}
        disabled={loading}
        title="Generate new suggestions"
      >
        <RefreshCw class="h-4 w-4 {loading ? 'animate-spin' : ''}" />
      </button>
    </div>

    {#if loading}
      <div class="flex items-center justify-center py-6 text-surface-400">
        <Loader2 class="h-5 w-5 animate-spin mr-2" />
        <span class="text-sm">Generating suggestions...</span>
      </div>
    {:else if suggestions.length === 0}
      <div class="text-center py-4 text-surface-500 text-sm">
        No suggestions available. Click refresh to generate some.
      </div>
    {:else}
      <div class="space-y-2">
        {#each suggestions as suggestion}
          <button
            class="w-full text-left card p-3 hover:bg-surface-700/50 transition-colors group"
            onclick={() => onSelect(suggestion.text)}
          >
            <div class="flex items-start gap-3">
              <ArrowRight class="h-4 w-4 mt-0.5 text-surface-500 group-hover:text-primary-400 transition-colors shrink-0" />
              <div class="flex-1 min-w-0">
                <p class="text-sm text-surface-200 group-hover:text-surface-100">
                  {suggestion.text}
                </p>
                <span class="text-xs {typeColors[suggestion.type]} mt-1 inline-block">
                  {typeLabels[suggestion.type]}
                </span>
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
