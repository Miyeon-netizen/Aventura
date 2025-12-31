-- Chapters table for memory system
CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT,

    -- Boundaries
    start_entry_id TEXT NOT NULL,
    end_entry_id TEXT NOT NULL,
    entry_count INTEGER NOT NULL,

    -- Content
    summary TEXT NOT NULL,

    -- Metadata for retrieval optimization
    keywords TEXT,       -- JSON array
    characters TEXT,     -- JSON array of character names mentioned
    locations TEXT,      -- JSON array of location names mentioned
    plot_threads TEXT,   -- JSON array
    emotional_tone TEXT,

    -- Hierarchy (for future arc support)
    arc_id TEXT,

    created_at INTEGER NOT NULL,

    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
    FOREIGN KEY (start_entry_id) REFERENCES story_entries(id),
    FOREIGN KEY (end_entry_id) REFERENCES story_entries(id)
);

-- Checkpoints table for save/restore functionality
CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    name TEXT NOT NULL,

    -- Snapshot boundaries
    last_entry_id TEXT NOT NULL,
    last_entry_preview TEXT,
    entry_count INTEGER NOT NULL,

    -- Deep copy of state (JSON blobs)
    entries_snapshot TEXT NOT NULL,
    characters_snapshot TEXT NOT NULL,
    locations_snapshot TEXT NOT NULL,
    items_snapshot TEXT NOT NULL,
    story_beats_snapshot TEXT NOT NULL,
    chapters_snapshot TEXT NOT NULL,

    created_at INTEGER NOT NULL,

    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

-- Memory configuration per story
ALTER TABLE stories ADD COLUMN memory_config TEXT;
-- Format: { chapterThreshold: 50, chapterBuffer: 10, autoSummarize: true, enableRetrieval: true }

-- Mode field for story (adventure vs creative-writing)
ALTER TABLE stories ADD COLUMN mode TEXT DEFAULT 'adventure';

-- Indexes for chapters
CREATE INDEX IF NOT EXISTS idx_chapters_story ON chapters(story_id);
CREATE INDEX IF NOT EXISTS idx_chapters_number ON chapters(story_id, number);

-- Indexes for checkpoints
CREATE INDEX IF NOT EXISTS idx_checkpoints_story ON checkpoints(story_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints(story_id, created_at);
