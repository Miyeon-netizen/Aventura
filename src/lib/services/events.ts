/**
 * Event Bus for Aventura
 * Per design doc section 2.1: Event-Driven Architecture
 *
 * Modules subscribe to events they care about, do their work, and emit new events.
 * Modules don't call each other directly—they communicate through events and shared state.
 */

const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[EventBus]', ...args);
  }
}

// Event types per design doc section 2.3
export type EventType =
  | 'UserInput'              // User sends a message
  | 'ContextReady'           // Memory + entries prepared for narrator
  | 'ResponseStreaming'      // Tokens arriving from narrator
  | 'SentenceComplete'       // Full sentence ready for TTS
  | 'NarrativeResponse'      // Complete response from narrator
  | 'ClassificationComplete' // Structured analysis ready
  | 'SuggestionsReady'       // AI suggestions generated (creative mode)
  | 'StateUpdated'           // Entries/world state changed
  | 'ChapterCreated'         // New chapter summarized
  | 'ImageQueued'            // Image generation requested
  | 'ImageReady'             // Image generation complete
  | 'SaveComplete'           // Autosave finished
  | 'CheckpointCreated'      // Checkpoint saved
  | 'CheckpointRestored'     // Checkpoint restored
  | 'StoryLoaded'            // Story loaded into state
  | 'StoryCreated'           // New story created
  | 'ModeChanged';           // Story mode changed

// Event payloads
export interface UserInputEvent {
  type: 'UserInput';
  text: string;
  actionType?: 'do' | 'say' | 'think' | 'story' | 'direction';
}

export interface ContextReadyEvent {
  type: 'ContextReady';
  userInput: string;
  retrievedContext: string | null;
}

export interface ResponseStreamingEvent {
  type: 'ResponseStreaming';
  chunk: string;
  accumulated: string;
}

export interface SentenceCompleteEvent {
  type: 'SentenceComplete';
  text: string;
}

export interface NarrativeResponseEvent {
  type: 'NarrativeResponse';
  messageId: string;
  content: string;
}

export interface ClassificationCompleteEvent {
  type: 'ClassificationComplete';
  messageId: string;
  result: any; // ClassificationResult
}

export interface SuggestionsReadyEvent {
  type: 'SuggestionsReady';
  suggestions: { text: string; type: string }[];
}

export interface StateUpdatedEvent {
  type: 'StateUpdated';
  changes: {
    characters?: number;
    locations?: number;
    items?: number;
    storyBeats?: number;
  };
}

export interface ChapterCreatedEvent {
  type: 'ChapterCreated';
  chapterId: string;
  chapterNumber: number;
  title: string | null;
}

export interface CheckpointCreatedEvent {
  type: 'CheckpointCreated';
  checkpointId: string;
  name: string;
}

export interface CheckpointRestoredEvent {
  type: 'CheckpointRestored';
  checkpointId: string;
}

export interface StoryLoadedEvent {
  type: 'StoryLoaded';
  storyId: string;
  mode: 'adventure' | 'creative-writing';
}

export interface StoryCreatedEvent {
  type: 'StoryCreated';
  storyId: string;
  mode: 'adventure' | 'creative-writing';
}

export interface ModeChangedEvent {
  type: 'ModeChanged';
  mode: 'adventure' | 'creative-writing';
}

export interface SaveCompleteEvent {
  type: 'SaveComplete';
  storyId: string;
}

export interface GenericEvent {
  type: EventType;
  payload?: any;
}

// Union of all event types
export type AventuraEvent =
  | UserInputEvent
  | ContextReadyEvent
  | ResponseStreamingEvent
  | SentenceCompleteEvent
  | NarrativeResponseEvent
  | ClassificationCompleteEvent
  | SuggestionsReadyEvent
  | StateUpdatedEvent
  | ChapterCreatedEvent
  | CheckpointCreatedEvent
  | CheckpointRestoredEvent
  | StoryLoadedEvent
  | StoryCreatedEvent
  | ModeChangedEvent
  | SaveCompleteEvent
  | GenericEvent;

// Handler function type
export type EventHandler<T extends AventuraEvent = AventuraEvent> = (event: T) => void | Promise<void>;

// Unsubscribe function type
export type Unsubscribe = () => void;

// Logged event with metadata
interface LoggedEvent {
  id: string;
  type: EventType;
  timestamp: number;
  payload: any;
}

class EventBus {
  private listeners: Map<EventType, Set<EventHandler>> = new Map();
  private eventLog: LoggedEvent[] = [];
  private maxLogSize = 100;

  /**
   * Subscribe to an event type.
   * Returns an unsubscribe function.
   */
  subscribe<T extends AventuraEvent>(type: EventType, handler: EventHandler<T>): Unsubscribe {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler as EventHandler);
    log('Subscribed to', type);

    return () => {
      this.listeners.get(type)?.delete(handler as EventHandler);
      log('Unsubscribed from', type);
    };
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<T extends AventuraEvent>(event: T): void {
    const logEntry: LoggedEvent = {
      id: crypto.randomUUID(),
      type: event.type as EventType,
      timestamp: Date.now(),
      payload: event,
    };

    // Log the event
    this.eventLog.push(logEntry);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }

    log('Emit', event.type, event);

    // Notify subscribers
    const handlers = this.listeners.get(event.type as EventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(event);
          // Handle async handlers
          if (result instanceof Promise) {
            result.catch(err => {
              console.error(`Error in event handler for ${event.type}:`, err);
            });
          }
        } catch (err) {
          console.error(`Error in event handler for ${event.type}:`, err);
        }
      }
    }
  }

  /**
   * Get recent events from the log.
   */
  getRecentEvents(count = 10): LoggedEvent[] {
    return this.eventLog.slice(-count);
  }

  /**
   * Get events of a specific type from the log.
   */
  getEventsByType(type: EventType, count = 10): LoggedEvent[] {
    return this.eventLog
      .filter(e => e.type === type)
      .slice(-count);
  }

  /**
   * Clear all listeners (useful for cleanup/testing).
   */
  clear(): void {
    this.listeners.clear();
    log('All listeners cleared');
  }

  /**
   * Get count of listeners for a specific event type.
   */
  listenerCount(type: EventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

// Singleton instance
export const eventBus = new EventBus();

// Helper functions for common event emissions
export function emitUserInput(text: string, actionType?: UserInputEvent['actionType']): void {
  eventBus.emit<UserInputEvent>({ type: 'UserInput', text, actionType });
}

export function emitNarrativeResponse(messageId: string, content: string): void {
  eventBus.emit<NarrativeResponseEvent>({ type: 'NarrativeResponse', messageId, content });
}

export function emitClassificationComplete(messageId: string, result: any): void {
  eventBus.emit<ClassificationCompleteEvent>({ type: 'ClassificationComplete', messageId, result });
}

export function emitStateUpdated(changes: StateUpdatedEvent['changes']): void {
  eventBus.emit<StateUpdatedEvent>({ type: 'StateUpdated', changes });
}

export function emitChapterCreated(chapterId: string, chapterNumber: number, title: string | null): void {
  eventBus.emit<ChapterCreatedEvent>({ type: 'ChapterCreated', chapterId, chapterNumber, title });
}

export function emitSuggestionsReady(suggestions: { text: string; type: string }[]): void {
  eventBus.emit<SuggestionsReadyEvent>({ type: 'SuggestionsReady', suggestions });
}

export function emitStoryLoaded(storyId: string, mode: 'adventure' | 'creative-writing'): void {
  eventBus.emit<StoryLoadedEvent>({ type: 'StoryLoaded', storyId, mode });
}

export function emitModeChanged(mode: 'adventure' | 'creative-writing'): void {
  eventBus.emit<ModeChangedEvent>({ type: 'ModeChanged', mode });
}
