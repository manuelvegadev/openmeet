package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/manuelvegadev/openmeet/packages/go/internal/files"
	"github.com/manuelvegadev/openmeet/packages/go/internal/rtc"
	"github.com/manuelvegadev/openmeet/packages/go/internal/signal"
	"github.com/manuelvegadev/openmeet/packages/go/internal/tui"
)

// Sharing a file with the room. What crosses the server is the announcement and nothing
// else: the request for a file and its bytes go over the peer connections, on a data channel
// of the file's own (internal/rtc), so the server never holds one and never sees one.
//
// Nothing is pushed. A file is offered, and it moves only when somebody asks for it — in a
// mesh a push is the same multiplication a screen share is, and almost all of it would be
// waste, because most of the time nobody wants the file at all.

// ctrlMsg is the control channel's whole vocabulary: ask for a file, or say it is not there
// any more. Everything else about a transfer is the channel it happens on.
type ctrlMsg struct {
	T  string `json:"t"`
	ID string `json:"id"`
}

type fileEntry struct {
	offer signal.FileOffer
	mine  bool
	// Ours: where the file is on this disk. Never sent, and never built from what a peer said.
	path    string
	state   string
	done    int64
	saved   string
	errMsg  string
	sending int
}

// fileByID hands back a *copy*. Everything that reads a file's state runs on its own
// goroutine while a transfer writes its progress under the lock, so a pointer out of here
// would be a read racing a write on the same struct; a snapshot cannot be.
func (e *Engine) fileByID(id string) (fileEntry, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	f := e.files[id]
	if f == nil {
		return fileEntry{}, false
	}
	return *f, true
}

// update changes a file's state and tells the interface, which finds the row by id.
func (e *Engine) updateFile(id string, apply func(*fileEntry)) {
	e.mu.Lock()
	f := e.files[id]
	if f == nil {
		e.mu.Unlock()
		return
	}
	apply(f)
	msg := tui.FileUpdate{ID: id, State: f.state, Done: f.done, Saved: f.saved, Error: f.errMsg}
	e.mu.Unlock()
	e.Emit(msg)
}

// ShareFile offers a file to the room. The digest is read first, on a goroutine, because a
// large file takes a moment and the keystroke that asked for it may not wait.
func (e *Engine) ShareFile(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("%s is not there", filepath.Base(path))
	}
	go func() {
		meta, err := files.Describe(path)
		if err != nil {
			e.Emit(tui.Toast{Kind: "warn", Text: "Could not share it: " + err.Error()})
			return
		}
		offer := signal.FileOffer{
			ID: files.NewID(), RoomID: e.opts.Room, FromID: e.myID, Username: e.opts.Name,
			Color: e.opts.Color, Name: meta.Name, Size: meta.Size, Kind: meta.Kind,
			SHA256: meta.SHA256, Timestamp: time.Now().UnixMilli(),
		}
		e.mu.Lock()
		e.files[offer.ID] = &fileEntry{mine: true, path: meta.Path, state: tui.FileOffered, offer: offer}
		e.mu.Unlock()
		err = e.sig.Send(signal.Message{
			Type: "file-offer", ID: offer.ID, RoomID: offer.RoomID, Username: offer.Username,
			Color: offer.Color, Name: offer.Name, Size: offer.Size, Kind: offer.Kind,
			SHA256: offer.SHA256, Timestamp: offer.Timestamp,
		})
		if err != nil {
			e.Emit(tui.Toast{Kind: "warn", Text: "Could not share it: " + err.Error()})
		}
	}()
	return nil
}

// onFileOffer is the announcement coming back from the server — ours included, which is how
// the sender's own row appears: one path, drawn the same for everyone.
func (e *Engine) onFileOffer(o signal.FileOffer) {
	mine := o.FromID == e.myID
	e.mu.Lock()
	f := e.files[o.ID]
	if f == nil {
		if mine {
			// Our own offer with no entry: a reconnect lost it. Nothing to serve from.
			e.mu.Unlock()
			return
		}
		f = &fileEntry{state: tui.FileOffered}
		e.files[o.ID] = f
	}
	f.offer = o
	f.mine = mine
	name := cleanName(o.Name)
	if name == "" {
		name = "file"
	}
	info := tui.FileInfo{
		ID: o.ID, Name: name, Size: o.Size, Kind: o.Kind, From: o.Username,
		Mine: mine, State: f.state, Done: f.done, Saved: f.saved,
	}
	e.mu.Unlock()
	e.Emit(tui.FileShared{At: time.UnixMilli(o.Timestamp), Who: o.Username, Color: o.Color, File: info})
}

// GetFile asks the peer who offered it to send it. The answer arrives as a channel of its
// own, which onFileStream takes.
func (e *Engine) GetFile(id string) error {
	f, ok := e.fileByID(id)
	if !ok {
		return fmt.Errorf("no such file")
	}
	if f.mine {
		return fmt.Errorf("that one is yours")
	}
	switch f.state {
	case tui.FileWaiting, tui.FileReceiving:
		return fmt.Errorf("already on its way")
	case tui.FileSaved:
		return files.Preview(f.saved)
	case tui.FileGone:
		return fmt.Errorf("whoever shared it has left")
	}
	e.updateFile(id, func(f *fileEntry) { f.state, f.errMsg, f.done = tui.FileWaiting, "", 0 })
	// The peer's connection may still be gathering candidates (gotcha 37), so asking waits —
	// and it waits here, not on the goroutine that draws the room.
	go func() {
		data, _ := json.Marshal(ctrlMsg{T: "get", ID: id})
		if err := e.peers.SendControl(f.offer.FromID, data); err != nil {
			e.updateFile(id, func(f *fileEntry) { f.state, f.errMsg = tui.FileFailed, err.Error() })
			e.Emit(tui.Toast{Kind: "warn", Text: "Could not ask for " + f.offer.Name + ": " + err.Error()})
		}
	}()
	return nil
}

// OpenFile is what to do with one that has arrived: how is "preview", "open" or "reveal".
func (e *Engine) OpenFile(id, how string) error {
	f, ok := e.fileByID(id)
	if !ok {
		return fmt.Errorf("no such file")
	}
	path := f.saved
	if f.mine {
		path = f.path
	}
	if path == "" {
		return fmt.Errorf("it is not on this machine yet")
	}
	switch how {
	case "reveal":
		return files.Reveal(path)
	case "open":
		return files.Open(path)
	}
	return files.Preview(path)
}

// onControl is a message from a peer's control channel.
func (e *Engine) onControl(peerID string, data []byte) {
	var msg ctrlMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}
	switch msg.T {
	case "get":
		go e.serveFile(peerID, msg.ID)
	case "gone":
		e.updateFile(msg.ID, func(f *fileEntry) {
			f.state, f.errMsg = tui.FileFailed, "the sender no longer has it"
		})
	}
}

// serveFile sends one of our files to the peer who asked. Each request gets its own channel
// and its own goroutine: two people downloading the same file do not queue behind each other,
// and neither of them is anywhere near the audio pump.
func (e *Engine) serveFile(peerID, id string) {
	f, ok := e.fileByID(id)
	if !ok || !f.mine || f.path == "" {
		data, _ := json.Marshal(ctrlMsg{T: "gone", ID: id})
		_ = e.peers.SendControl(peerID, data)
		return
	}
	who := e.peerName(peerID)
	s, err := e.peers.OpenStream(peerID, id)
	if err != nil {
		e.logf("file %s to %s: %v", f.offer.Name, rtc.Short(peerID), err)
		return
	}
	// On the local network there is no uplink to protect and a ceiling would be invented;
	// off it, a transfer gets well under what a screen share takes, because it is not the
	// call. Either way it is a goroutine of its own and the 20 ms pump never waits on it.
	rate := files.RemoteKbps
	how := fmt.Sprintf("over the internet, capped at %d kbps", rate)
	if e.peers.LocalPair(peerID) {
		rate = files.LocalKbps
		how = "over the local network, no ceiling"
	}
	e.logf("sending %s to %s %s", f.offer.Name, rtc.Short(peerID), how)
	e.updateFile(id, func(f *fileEntry) { f.sending++; f.state = tui.FileSending; f.done = 0 })
	err = files.Send(f.path, s, rate, f.offer.Size, func(n int64) {
		e.updateFile(id, func(f *fileEntry) { f.done = n })
	})
	s.Drain(30 * time.Second)
	_ = s.Close()
	e.updateFile(id, func(f *fileEntry) {
		f.sending--
		if f.sending <= 0 {
			f.sending = 0
			f.state = tui.FileOffered
			f.done = 0
		}
	})
	if err != nil {
		e.logf("file %s to %s: %v", f.offer.Name, rtc.Short(peerID), err)
		e.Emit(tui.Toast{Kind: "warn", Text: "Sending " + f.offer.Name + " failed: " + err.Error()})
		return
	}
	e.Emit(tui.Toast{Kind: "ok", Text: who + " downloaded " + f.offer.Name})
}

// onFileStream is a file arriving. Only a file we asked for, from the peer who offered it,
// is taken: nobody pushes anything onto this disk.
func (e *Engine) onFileStream(peerID, id string, s *rtc.Stream) {
	f, ok := e.fileByID(id)
	if !ok || f.mine || f.offer.FromID != peerID || f.state != tui.FileWaiting {
		_ = s.Close()
		return
	}
	dir, err := files.DownloadDir()
	if err == nil {
		var dst string
		dst, err = files.Destination(dir, f.offer.Name)
		if err == nil {
			e.updateFile(id, func(f *fileEntry) { f.state, f.done = tui.FileReceiving, 0 })
			err = files.Receive(s, f.offer.Size, f.offer.SHA256, dst, func(n int64) {
				e.updateFile(id, func(f *fileEntry) { f.done = n })
			})
			if err == nil {
				e.updateFile(id, func(f *fileEntry) { f.state, f.saved, f.done = tui.FileSaved, dst, f.offer.Size })
				e.Emit(tui.Toast{Kind: "ok", Text: "Saved to " + dst})
				_ = s.Close()
				return
			}
		}
	}
	_ = s.Close()
	e.updateFile(id, func(f *fileEntry) { f.state, f.errMsg = tui.FileFailed, err.Error() })
	e.Emit(tui.Toast{Kind: "warn", Text: "Could not save " + f.offer.Name + ": " + err.Error()})
}

// forgetPeerFiles marks what somebody was offering as gone when they leave: nobody else has
// the file, so the row says so rather than failing when it is asked for.
func (e *Engine) forgetPeerFiles(peerID string) {
	e.mu.Lock()
	var ids []string
	for id, f := range e.files {
		if f.offer.FromID == peerID && !f.mine && f.state != tui.FileSaved {
			ids = append(ids, id)
		}
	}
	e.mu.Unlock()
	for _, id := range ids {
		e.updateFile(id, func(f *fileEntry) { f.state = tui.FileGone })
	}
}

func (e *Engine) peerName(peerID string) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if p := e.people[peerID]; p != nil {
		return p.p.Username
	}
	return "Someone"
}
