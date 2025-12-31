<script lang="ts">
  import { onMount } from 'svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { OpenRouterProvider } from '$lib/services/ai/openrouter';
  import type { ModelInfo } from '$lib/services/ai/types';
  import { X, Key, Cpu, Palette, RefreshCw, Search } from 'lucide-svelte';

  let activeTab = $state<'api' | 'generation' | 'ui'>('api');

  // Local state for API key (to avoid showing actual key)
  let apiKeyInput = $state('');
  let apiKeySet = $state(false);

  // Model fetching state
  let models = $state<ModelInfo[]>([]);
  let isLoadingModels = $state(false);
  let modelError = $state<string | null>(null);
  let modelSearch = $state('');

  // Fallback models if API fetch fails
  const fallbackModels: ModelInfo[] = [
    { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', contextLength: 131072 },
    { id: 'x-ai/grok-4.1', name: 'Grok 4.1', contextLength: 131072 },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextLength: 200000 },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', contextLength: 200000 },
    { id: 'openai/gpt-4o', name: 'GPT-4o', contextLength: 128000 },
    { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', contextLength: 1000000 },
    { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', contextLength: 131072 },
  ];

  // Filtered and sorted models
  let filteredModels = $derived.by(() => {
    let result = models.length > 0 ? [...models] : [...fallbackModels];

    // Filter by search term
    if (modelSearch.trim()) {
      const search = modelSearch.toLowerCase();
      result = result.filter(m =>
        m.id.toLowerCase().includes(search) ||
        m.name.toLowerCase().includes(search)
      );
    }

    // Sort: prioritize popular providers, then alphabetically
    const providerPriority: Record<string, number> = {
      'x-ai': 1,
      'anthropic': 2,
      'openai': 3,
      'google': 4,
      'meta-llama': 5,
      'mistralai': 6,
    };

    return result.sort((a, b) => {
      const providerA = a.id.split('/')[0];
      const providerB = b.id.split('/')[0];
      const priorityA = providerPriority[providerA] ?? 99;
      const priorityB = providerPriority[providerB] ?? 99;

      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.name.localeCompare(b.name);
    });
  });

  $effect(() => {
    apiKeySet = !!settings.apiSettings.openrouterApiKey;
  });

  // Fetch models on mount (public endpoint, no API key needed)
  onMount(() => {
    console.log('[SettingsModal] onMount - starting model fetch');
    fetchModels();
  });

  async function fetchModels() {
    console.log('[SettingsModal] fetchModels called', { isLoadingModels });

    if (isLoadingModels) {
      console.log('[SettingsModal] Already loading, skipping');
      return;
    }

    isLoadingModels = true;
    modelError = null;

    try {
      console.log('[SettingsModal] Creating OpenRouterProvider...');
      // Models endpoint is public, doesn't need API key
      const provider = new OpenRouterProvider('');

      console.log('[SettingsModal] Calling listModels...');
      const fetchedModels = await provider.listModels();
      console.log('[SettingsModal] Received models:', fetchedModels.length);

      // Filter to only include text/chat models (exclude image, embedding, etc.)
      models = fetchedModels.filter(m => {
        const id = m.id.toLowerCase();
        // Exclude non-chat models
        if (id.includes('embedding') || id.includes('vision-only') || id.includes('tts') || id.includes('whisper')) {
          return false;
        }
        return true;
      });

      console.log(`[SettingsModal] Filtered to ${models.length} text/chat models`);
    } catch (error) {
      console.error('[SettingsModal] Failed to fetch models:', error);
      modelError = error instanceof Error ? error.message : 'Failed to load models. Using defaults.';
      models = [];
    } finally {
      isLoadingModels = false;
      console.log('[SettingsModal] fetchModels complete', { modelCount: models.length, error: modelError });
    }
  }

  async function saveApiKey() {
    if (apiKeyInput.trim()) {
      await settings.setApiKey(apiKeyInput.trim());
      apiKeyInput = '';
    }
  }

  function handleRefreshModels() {
    models = [];
    fetchModels();
  }

  async function clearApiKey() {
    await settings.setApiKey('');
    apiKeySet = false;
    models = [];
  }

  function formatContextLength(length: number): string {
    if (length >= 1000000) return `${(length / 1000000).toFixed(1)}M`;
    if (length >= 1000) return `${Math.round(length / 1000)}K`;
    return length.toString();
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onclick={() => ui.closeSettings()}>
  <div
    class="card w-full max-w-2xl max-h-[80vh] overflow-hidden"
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-surface-700 pb-4">
      <h2 class="text-xl font-semibold text-surface-100">Settings</h2>
      <button class="btn-ghost rounded-lg p-2" onclick={() => ui.closeSettings()}>
        <X class="h-5 w-5" />
      </button>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 border-b border-surface-700 py-2">
      <button
        class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
        class:bg-surface-700={activeTab === 'api'}
        class:text-surface-100={activeTab === 'api'}
        class:text-surface-400={activeTab !== 'api'}
        onclick={() => activeTab = 'api'}
      >
        <Key class="h-4 w-4" />
        API
      </button>
      <button
        class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
        class:bg-surface-700={activeTab === 'generation'}
        class:text-surface-100={activeTab === 'generation'}
        class:text-surface-400={activeTab !== 'generation'}
        onclick={() => activeTab = 'generation'}
      >
        <Cpu class="h-4 w-4" />
        Generation
      </button>
      <button
        class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
        class:bg-surface-700={activeTab === 'ui'}
        class:text-surface-100={activeTab === 'ui'}
        class:text-surface-400={activeTab !== 'ui'}
        onclick={() => activeTab = 'ui'}
      >
        <Palette class="h-4 w-4" />
        Interface
      </button>
    </div>

    <!-- Content -->
    <div class="max-h-96 overflow-y-auto py-4">
      {#if activeTab === 'api'}
        <div class="space-y-4">
          <div>
            <label class="mb-2 block text-sm font-medium text-surface-300">
              OpenRouter API Key
            </label>
            {#if apiKeySet}
              <div class="flex items-center gap-2">
                <div class="input flex-1 bg-surface-700 text-surface-400">
                  ••••••••••••••••••••
                </div>
                <button class="btn btn-secondary" onclick={clearApiKey}>
                  Clear
                </button>
              </div>
              <p class="mt-1 text-sm text-green-400">API key configured</p>
            {:else}
              <div class="flex gap-2">
                <input
                  type="password"
                  bind:value={apiKeyInput}
                  placeholder="sk-or-..."
                  class="input flex-1"
                />
                <button
                  class="btn btn-primary"
                  onclick={saveApiKey}
                  disabled={!apiKeyInput.trim()}
                >
                  Save
                </button>
              </div>
            {/if}
            <p class="mt-2 text-sm text-surface-500">
              Get your API key from <a href="https://openrouter.ai/keys" target="_blank" class="text-accent-400 hover:underline">openrouter.ai</a>
            </p>
          </div>

          <div>
            <div class="mb-2 flex items-center justify-between">
              <label class="text-sm font-medium text-surface-300">
                Default Model
              </label>
              <button
                class="flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300 disabled:opacity-50"
                onclick={handleRefreshModels}
                disabled={isLoadingModels}
              >
                <span class={isLoadingModels ? 'animate-spin' : ''}>
                  <RefreshCw class="h-3 w-3" />
                </span>
                Refresh
              </button>
            </div>

            {#if modelError}
              <p class="mb-2 text-xs text-amber-400">{modelError}</p>
            {/if}

            <!-- Search input -->
            <div class="relative mb-2">
              <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
              <input
                type="text"
                bind:value={modelSearch}
                placeholder="Search models..."
                class="input pl-9 text-sm"
              />
            </div>

            <!-- Model select -->
            <select
              class="input"
              value={settings.apiSettings.defaultModel}
              onchange={(e) => settings.setDefaultModel(e.currentTarget.value)}
              disabled={isLoadingModels}
            >
              {#if isLoadingModels}
                <option>Loading models...</option>
              {:else}
                {#each filteredModels as model}
                  <option value={model.id}>
                    {model.name} ({formatContextLength(model.contextLength)} ctx)
                  </option>
                {/each}
              {/if}
            </select>

            {#if models.length > 0}
              <p class="mt-1 text-xs text-surface-500">
                {models.length} models available
              </p>
            {/if}
          </div>
        </div>
      {:else if activeTab === 'generation'}
        <div class="space-y-4">
          <div>
            <label class="mb-2 block text-sm font-medium text-surface-300">
              Temperature: {settings.apiSettings.temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings.apiSettings.temperature}
              oninput={(e) => settings.setTemperature(parseFloat(e.currentTarget.value))}
              class="w-full"
            />
            <div class="flex justify-between text-xs text-surface-500">
              <span>Focused</span>
              <span>Creative</span>
            </div>
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-surface-300">
              Max Tokens: {settings.apiSettings.maxTokens}
            </label>
            <input
              type="range"
              min="256"
              max="4096"
              step="128"
              value={settings.apiSettings.maxTokens}
              oninput={(e) => settings.setMaxTokens(parseInt(e.currentTarget.value))}
              class="w-full"
            />
            <div class="flex justify-between text-xs text-surface-500">
              <span>Shorter</span>
              <span>Longer</span>
            </div>
          </div>
        </div>
      {:else if activeTab === 'ui'}
        <div class="space-y-4">
          <div>
            <label class="mb-2 block text-sm font-medium text-surface-300">
              Theme
            </label>
            <select
              class="input"
              value={settings.uiSettings.theme}
              onchange={(e) => settings.setTheme(e.currentTarget.value as 'dark' | 'light')}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-surface-300">
              Font Size
            </label>
            <select
              class="input"
              value={settings.uiSettings.fontSize}
              onchange={(e) => settings.setFontSize(e.currentTarget.value as 'small' | 'medium' | 'large')}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>

          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-surface-300">Show Word Count</label>
            <input
              type="checkbox"
              checked={settings.uiSettings.showWordCount}
              onchange={() => {
                settings.uiSettings.showWordCount = !settings.uiSettings.showWordCount;
              }}
              class="h-5 w-5 rounded border-surface-600 bg-surface-700"
            />
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
