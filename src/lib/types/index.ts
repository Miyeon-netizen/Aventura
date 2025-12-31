// Core entity types for Aventura

export type StoryMode = 'adventure' | 'creative-writing';
export type POV = 'first' | 'second' | 'third';

export interface Story {
  id: string;
  title: string;
  description: string | null;
  genre: string | null;
  templateId: string | null;
  mode: StoryMode;
  createdAt: number;
  updatedAt: number;
  settings: StorySettings | null;
  memoryConfig: MemoryConfig | null;
}

export interface MemoryConfig {
  chapterThreshold: number;  // Messages before considering a chapter (default: 50)
  chapterBuffer: number;     // Recent messages protected from chapter end (default: 10)
  autoSummarize: boolean;    // Enable auto-summarization
  enableRetrieval: boolean;  // Enable memory retrieval
  maxChaptersPerRetrieval: number; // Max chapters to retrieve per query
}

export interface StorySettings {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPromptOverride?: string;
  pov?: POV;
}

export interface StoryEntry {
  id: string;
  storyId: string;
  type: 'user_action' | 'narration' | 'system' | 'retry';
  content: string;
  parentId: string | null;
  position: number;
  createdAt: number;
  metadata: EntryMetadata | null;
}

export interface EntryMetadata {
  tokenCount?: number;
  model?: string;
  generationTime?: number;
  source?: string;
}

export interface Character {
  id: string;
  storyId: string;
  name: string;
  description: string | null;
  relationship: string | null;
  traits: string[];
  status: 'active' | 'inactive' | 'deceased';
  metadata: Record<string, unknown> | null;
}

export interface Location {
  id: string;
  storyId: string;
  name: string;
  description: string | null;
  visited: boolean;
  current: boolean;
  connections: string[];
  metadata: Record<string, unknown> | null;
}

export interface Item {
  id: string;
  storyId: string;
  name: string;
  description: string | null;
  quantity: number;
  equipped: boolean;
  location: string;
  metadata: Record<string, unknown> | null;
}

export interface StoryBeat {
  id: string;
  storyId: string;
  title: string;
  description: string | null;
  type: 'milestone' | 'quest' | 'revelation' | 'event';
  status: 'pending' | 'active' | 'completed' | 'failed';
  triggeredAt: number | null;
  metadata: Record<string, unknown> | null;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  genre: string | null;
  systemPrompt: string;
  initialState: TemplateInitialState | null;
  isBuiltin: boolean;
  createdAt: number;
}

export interface TemplateInitialState {
  protagonist?: Partial<Character>;
  startingLocation?: Partial<Location>;
  initialItems?: Partial<Item>[];
  openingScene?: string;
}

// Chapter for memory system
export interface Chapter {
  id: string;
  storyId: string;
  number: number;
  title: string | null;

  // Boundaries
  startEntryId: string;
  endEntryId: string;
  entryCount: number;

  // Content
  summary: string;

  // Retrieval optimization metadata
  keywords: string[];
  characters: string[];   // Character names mentioned
  locations: string[];    // Location names mentioned
  plotThreads: string[];
  emotionalTone: string | null;

  // Hierarchy (for future arc support)
  arcId: string | null;

  createdAt: number;
}

// Checkpoint for save/restore functionality
export interface Checkpoint {
  id: string;
  storyId: string;
  name: string;

  // Snapshot boundaries
  lastEntryId: string;
  lastEntryPreview: string | null;
  entryCount: number;

  // Deep copy of state
  entriesSnapshot: StoryEntry[];
  charactersSnapshot: Character[];
  locationsSnapshot: Location[];
  itemsSnapshot: Item[];
  storyBeatsSnapshot: StoryBeat[];
  chaptersSnapshot: Chapter[];

  createdAt: number;
}

// UI State types
export type ActivePanel = 'story' | 'library' | 'settings' | 'templates';
export type SidebarTab = 'characters' | 'locations' | 'inventory' | 'quests';

export interface UIState {
  activePanel: ActivePanel;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  settingsModalOpen: boolean;
}

// API Settings
export interface APISettings {
  openrouterApiKey: string | null;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
}

export interface UISettings {
  theme: 'dark' | 'light';
  fontSize: 'small' | 'medium' | 'large';
  showWordCount: boolean;
  autoSave: boolean;
}
