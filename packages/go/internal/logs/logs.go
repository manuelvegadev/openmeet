// Package logs is the debug log on disk: one file, appended to, capped, and followed by
// `openmeet --logs` in whatever window you put it in.
//
// It is a file and a stream rather than a second interface on purpose. A terminal already
// has infinite scrollback, a search, and a selection that copies — three things a viewer of
// our own would have to reimplement worse, and the last of which it would have to *take
// away* to get the mouse (gotcha 28). What is ours is the colouring, the following across a
// restart, and working the same on Windows, where there is no `tail`.
package logs

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// MaxBytes is what the file is allowed to reach before the oldest half of it goes. A few
// megabytes is a long call's worth and nothing anybody notices on a disk; unbounded is how a
// debug log quietly becomes the largest thing in a home directory.
const MaxBytes = 4 << 20

// Path is where it lives: beside settings.json, so a report is two files from one place.
func Path(dir string) string { return filepath.Join(dir, "debug.log") }

// Writer appends lines, on its own goroutine, and never blocks whoever calls it: a line that
// cannot be queued is dropped. Nothing in this application may wait on a disk — the 20 ms
// pump is one goroutine away from most of what logs.
type Writer struct {
	path string
	ch   chan string
	done chan struct{}
	once sync.Once
}

// Open starts appending to the log, trimming it first if the last run left it at the cap.
func Open(path, version string) (*Writer, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if err := trim(path, MaxBytes); err != nil {
		return nil, err
	}
	w := &Writer{path: path, ch: make(chan string, 256), done: make(chan struct{})}
	go w.run()
	w.Print(fmt.Sprintf("── openmeet %s started %s ──", version, time.Now().Format("2006-01-02 15:04:05")))
	return w, nil
}

// Print queues one line. Safe from any goroutine, and free when the queue is full.
func (w *Writer) Print(line string) {
	if w == nil {
		return
	}
	select {
	case w.ch <- line:
	default: // the disk is behind; a lost log line is cheaper than a late one
	}
}

func (w *Writer) Close() {
	if w == nil {
		return
	}
	w.once.Do(func() {
		close(w.ch)
		<-w.done
	})
}

func (w *Writer) run() {
	defer close(w.done)
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		for range w.ch { // drain, so nothing blocks on a log we cannot write
		}
		return
	}
	defer f.Close()
	buf := bufio.NewWriter(f)
	defer buf.Flush()
	flush := time.NewTicker(time.Second)
	defer flush.Stop()
	written := int64(0)
	if st, err := f.Stat(); err == nil {
		written = st.Size()
	}
	pid := os.Getpid()
	for {
		select {
		case line, ok := <-w.ch:
			if !ok {
				return
			}
			s := fmt.Sprintf("%s [%d] %s\n", time.Now().Format("15:04:05.000"), pid, line)
			n, _ := buf.WriteString(s)
			written += int64(n)
			if written > MaxBytes {
				// Start again from the newest half, in place, so anything following the file
				// sees it shrink and picks up from the top.
				buf.Flush()
				if trim(w.path, MaxBytes/2) == nil {
					if st, err := f.Stat(); err == nil {
						written = st.Size()
					}
				}
			}
		case <-flush.C:
			buf.Flush()
		}
	}
}

// trim keeps the newest `keep` bytes of the file, starting at the first whole line, and
// rewrites it in place. A no-op when the file is already smaller.
func trim(path string, keep int64) error {
	st, err := os.Stat(path)
	if err != nil || st.Size() <= keep {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	if _, err := f.Seek(st.Size()-keep, io.SeekStart); err != nil {
		f.Close()
		return err
	}
	tail, err := io.ReadAll(f)
	f.Close()
	if err != nil {
		return err
	}
	if i := strings.IndexByte(string(tail), '\n'); i >= 0 {
		tail = tail[i+1:]
	}
	return os.WriteFile(path, tail, 0o644)
}
