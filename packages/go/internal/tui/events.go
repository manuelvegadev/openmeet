package tui

import "time"

// What the engine tells the interface. One snapshot type for the room's state, sent whole
// whenever something in it changed, and appends for the two streams that only grow.

// Snapshot is the room as the engine sees it. Fields mirror RoomState's; the model copies
// them over and keeps its own view state (focus, drafts, scroll).
type Snapshot struct {
	Connected bool
	JoinedAt  time.Time
	Me        Peer
	Peers     []Peer
	Stats     *Stats
	Error     string
	Debug     bool
}

// Line is one chat entry to append.
type Line ChatEntry

// DebugLine is one `[DBG]` line for the panel.
type DebugLine ChatEntry

// Left says the engine has left the room (on request, or because the server went away).
type Left struct{ Reason string }
