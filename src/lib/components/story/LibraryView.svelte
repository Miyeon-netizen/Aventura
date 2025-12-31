<script lang="ts">
  import { story } from '$lib/stores/story.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import { templateService, BUILTIN_TEMPLATES } from '$lib/services/templates';
  import { exportService } from '$lib/services/export';
  import { Plus, BookOpen, Trash2, Clock, Sparkles, Wand2, Rocket, Search, Skull, Heart, FileText, Upload, Sword, Feather } from 'lucide-svelte';
  import type { Template, StoryMode } from '$lib/types';

  let showNewStoryModal = $state(false);
  let newStoryTitle = $state('');
  let selectedTemplateId = $state<string | null>(null);
  let selectedMode = $state<StoryMode>('adventure');
  let step = $state<'template' | 'details'>('template');

  // Derived template based on selection
  let selectedTemplate = $derived(
    selectedTemplateId ? BUILTIN_TEMPLATES.find(t => t.id === selectedTemplateId) : null
  );

  const templateIcons: Record<string, typeof Wand2> = {
    'fantasy-adventure': Wand2,
    'scifi-exploration': Rocket,
    'mystery-investigation': Search,
    'horror-survival': Skull,
    'slice-of-life': Heart,
    'custom': FileText,
  };

  // Load stories on mount
  $effect(() => {
    story.loadAllStories();
  });

  function selectTemplate(templateId: string) {
    selectedTemplateId = templateId;
    step = 'details';

    // Set default title based on template
    const template = BUILTIN_TEMPLATES.find(t => t.id === templateId);
    if (template && template.id !== 'custom') {
      newStoryTitle = `My ${template.genre} Adventure`;
    }
  }

  async function createNewStory() {
    if (!newStoryTitle.trim() || !selectedTemplateId) return;

    const template = BUILTIN_TEMPLATES.find(t => t.id === selectedTemplateId);
    const newStoryData = await story.createStoryFromTemplate(
      newStoryTitle.trim(),
      selectedTemplateId,
      template?.genre ?? undefined,
      selectedMode
    );

    await story.loadStory(newStoryData.id);
    ui.setActivePanel('story');
    closeModal();
  }

  function closeModal() {
    showNewStoryModal = false;
    newStoryTitle = '';
    selectedTemplateId = null;
    selectedMode = 'adventure';
    step = 'template';
  }

  function goBackToTemplates() {
    step = 'template';
    newStoryTitle = '';
  }

  async function openStory(storyId: string) {
    await story.loadStory(storyId);
    ui.setActivePanel('story');
  }

  async function deleteStory(storyId: string, event: MouseEvent) {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this story?')) {
      await story.deleteStory(storyId);
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function getGenreColor(genre: string | null): string {
    switch (genre) {
      case 'Fantasy': return 'bg-purple-500/20 text-purple-400';
      case 'Sci-Fi': return 'bg-cyan-500/20 text-cyan-400';
      case 'Mystery': return 'bg-amber-500/20 text-amber-400';
      case 'Horror': return 'bg-red-500/20 text-red-400';
      case 'Slice of Life': return 'bg-green-500/20 text-green-400';
      default: return 'bg-surface-700 text-surface-400';
    }
  }

  let importError = $state<string | null>(null);

  async function importStory() {
    importError = null;
    const result = await exportService.importFromAventura();

    if (result.success && result.storyId) {
      await story.loadAllStories();
      await story.loadStory(result.storyId);
      ui.setActivePanel('story');
    } else if (result.error) {
      importError = result.error;
      setTimeout(() => importError = null, 5000);
    }
  }
</script>

<div class="h-full overflow-y-auto p-6">
  <div class="mx-auto max-w-4xl">
    <!-- Header -->
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-surface-100">Story Library</h1>
        <p class="text-surface-400">Your adventures await</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="btn btn-secondary flex items-center gap-2"
          onclick={importStory}
        >
          <Upload class="h-5 w-5" />
          Import
        </button>
        <button
          class="btn btn-primary flex items-center gap-2"
          onclick={() => showNewStoryModal = true}
        >
          <Plus class="h-5 w-5" />
          New Story
        </button>
      </div>
    </div>

    <!-- Import error message -->
    {#if importError}
      <div class="mb-4 rounded-lg bg-red-500/20 p-3 text-sm text-red-400">
        {importError}
      </div>
    {/if}

    <!-- Stories grid -->
    {#if story.allStories.length === 0}
      <div class="flex flex-col items-center justify-center py-20 text-center">
        <BookOpen class="mb-4 h-16 w-16 text-surface-600" />
        <h2 class="text-xl font-semibold text-surface-300">No stories yet</h2>
        <p class="mt-2 text-surface-500">Create your first adventure to get started</p>
        <button
          class="btn btn-primary mt-6 flex items-center gap-2"
          onclick={() => showNewStoryModal = true}
        >
          <Plus class="h-5 w-5" />
          Create Story
        </button>
      </div>
    {:else}
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each story.allStories as s (s.id)}
          <div
            role="button"
            tabindex="0"
            onclick={() => openStory(s.id)}
            onkeydown={(e) => e.key === 'Enter' && openStory(s.id)}
            class="card group cursor-pointer text-left transition-colors hover:border-accent-500/50 hover:bg-surface-700/50"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <h3 class="font-semibold text-surface-100 group-hover:text-accent-400">
                  {s.title}
                </h3>
                {#if s.genre}
                  <span class="mt-1 inline-block rounded-full px-2 py-0.5 text-xs {getGenreColor(s.genre)}">
                    {s.genre}
                  </span>
                {/if}
              </div>
              <button
                onclick={(e) => deleteStory(s.id, e)}
                class="rounded p-1 text-surface-500 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                title="Delete story"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
            {#if s.description}
              <p class="mt-2 line-clamp-2 text-sm text-surface-400">
                {s.description}
              </p>
            {/if}
            <div class="mt-3 flex items-center gap-1 text-xs text-surface-500">
              <Clock class="h-3 w-3" />
              <span>Updated {formatDate(s.updatedAt)}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- New Story Modal -->
{#if showNewStoryModal}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    role="dialog"
    aria-modal="true"
  >
    <div class="card w-full max-w-2xl max-h-[80vh] overflow-hidden">
      {#if step === 'template'}
        <!-- Template Selection Step -->
        <div class="flex items-center justify-between border-b border-surface-700 pb-4">
          <div>
            <h2 class="text-xl font-semibold text-surface-100">Choose Your Adventure</h2>
            <p class="text-sm text-surface-400">Select a genre template to get started</p>
          </div>
          <button
            class="btn-ghost rounded-lg p-2 text-surface-400 hover:text-surface-100"
            onclick={closeModal}
          >
            ✕
          </button>
        </div>

        <div class="grid gap-3 py-4 sm:grid-cols-2 max-h-96 overflow-y-auto">
          {#each BUILTIN_TEMPLATES as template}
            {@const Icon = templateIcons[template.id] ?? Sparkles}
            <button
              onclick={() => selectTemplate(template.id)}
              class="card flex items-start gap-3 p-4 text-left transition-all hover:border-accent-500/50 hover:bg-surface-700/50"
              class:border-accent-500={selectedTemplateId === template.id}
            >
              <div class="rounded-lg bg-surface-700 p-2">
                <Icon class="h-5 w-5 text-accent-400" />
              </div>
              <div class="flex-1">
                <h3 class="font-medium text-surface-100">{template.name}</h3>
                <p class="mt-1 text-sm text-surface-400 line-clamp-2">{template.description}</p>
              </div>
            </button>
          {/each}
        </div>
      {:else}
        <!-- Story Details Step -->
        <div class="flex items-center justify-between border-b border-surface-700 pb-4">
          <div class="flex items-center gap-3">
            <button
              class="btn-ghost rounded-lg p-2 text-surface-400 hover:text-surface-100"
              onclick={goBackToTemplates}
            >
              ←
            </button>
            <div>
              <h2 class="text-xl font-semibold text-surface-100">Name Your Story</h2>
              {#if selectedTemplate}
                <p class="text-sm text-surface-400">Template: {selectedTemplate.name}</p>
              {/if}
            </div>
          </div>
          <button
            class="btn-ghost rounded-lg p-2 text-surface-400 hover:text-surface-100"
            onclick={closeModal}
          >
            ✕
          </button>
        </div>

        <div class="py-4 space-y-4">
          <!-- Mode Selection -->
          <div>
            <label class="mb-2 block text-sm font-medium text-surface-300">
              Story Mode
            </label>
            <div class="grid grid-cols-2 gap-3">
              <button
                class="card p-4 text-left transition-all"
                class:ring-2={selectedMode === 'adventure'}
                class:ring-primary-500={selectedMode === 'adventure'}
                onclick={() => selectedMode = 'adventure'}
              >
                <div class="flex items-center gap-3 mb-2">
                  <div class="rounded-lg bg-primary-900/50 p-2">
                    <Sword class="h-5 w-5 text-primary-400" />
                  </div>
                  <span class="font-medium text-surface-100">Adventure</span>
                </div>
                <p class="text-xs text-surface-400">
                  You are the protagonist. Explore, interact, and make choices.
                </p>
              </button>
              <button
                class="card p-4 text-left transition-all"
                class:ring-2={selectedMode === 'creative-writing'}
                class:ring-primary-500={selectedMode === 'creative-writing'}
                onclick={() => selectedMode = 'creative-writing'}
              >
                <div class="flex items-center gap-3 mb-2">
                  <div class="rounded-lg bg-secondary-900/50 p-2">
                    <Feather class="h-5 w-5 text-secondary-400" />
                  </div>
                  <span class="font-medium text-surface-100">Creative Writing</span>
                </div>
                <p class="text-xs text-surface-400">
                  You are the author. Direct the story and craft the narrative.
                </p>
              </button>
            </div>
          </div>

          <!-- Story Title -->
          <div>
            <label class="mb-2 block text-sm font-medium text-surface-300">
              Story Title
            </label>
            <input
              type="text"
              bind:value={newStoryTitle}
              placeholder={selectedMode === 'adventure' ? 'Enter a title for your adventure...' : 'Enter a title for your story...'}
              class="input"
              onkeydown={(e) => e.key === 'Enter' && newStoryTitle.trim() && createNewStory()}
            />
          </div>

          {#if selectedTemplate?.initialState?.openingScene}
            <div class="mt-4">
              <label class="mb-2 block text-sm font-medium text-surface-300">
                Opening Scene Preview
              </label>
              <div class="rounded-lg bg-surface-900 p-4 text-sm text-surface-400 max-h-32 overflow-y-auto">
                {selectedTemplate.initialState.openingScene}
              </div>
            </div>
          {/if}
        </div>

        <div class="flex justify-end gap-2 border-t border-surface-700 pt-4">
          <button class="btn btn-secondary" onclick={goBackToTemplates}>
            Back
          </button>
          <button
            class="btn btn-primary flex items-center gap-2"
            onclick={createNewStory}
            disabled={!newStoryTitle.trim()}
          >
            {#if selectedMode === 'adventure'}
              <Sword class="h-4 w-4" />
              Begin Adventure
            {:else}
              <Feather class="h-4 w-4" />
              Start Writing
            {/if}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
