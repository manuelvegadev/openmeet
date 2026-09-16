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
	// Video: whether it is on here at all, whether a camera can be, and our shares.
	VideoEnabled  bool
	WebcamEnabled bool
	ScreenSharing bool
}

// Line is one chat entry to append.
type Line ChatEntry

// Draft is the composer written into from outside. The only thing that sends one is the
// scripted demo, which types its own messages so the interface can be watched being used
// rather than only being read; a real room never puts words in your composer.
type Draft struct{ Text string }

// DebugLine is one `[DBG]` line for the panel.
type DebugLine ChatEntry

// Left says the engine has left the room (on request, or because the server went away).
type Left struct{ Reason string }

// UpdateAvailable: a newer version, ready or only known (see internal/update).
type UpdateAvailable UpdateInfo

// Copy is Cmd+C, or whatever chord the terminal could only deliver through the kitty
// keyboard protocol (internal/keyboard). It copies the selection, and does nothing when
// there is none — unlike ctrl+c, which has a second job.
type Copy struct{}

// CopyKey is the terminal telling us which chord it can actually send, so the room can name
// the right one. Until it arrives the answer is ctrl+c, which every terminal can send.
type CopyKey struct{ Name string }

// UpToDate: an update check that found nothing newer. Only the home screen's `u` says so out
// loud; the one at startup passes in silence.
type UpToDate struct{}

// FileShared is a file someone put in the room: one entry appended to the log, with the
// transfer's state hanging off it from then on.
type FileShared struct {
	At    time.Time
	Who   string
	Color string
	File  FileInfo
}

// FileUpdate moves an existing file entry along: a transfer that started, got somewhere,
// finished, or failed. It carries only what changed, and the room finds the entry by ID.
type FileUpdate struct {
	ID    string
	State string
	Done  int64
	Rate  int64
	Saved string
	Error string
}
