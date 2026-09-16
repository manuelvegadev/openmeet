package logs

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// TailLines is how much of what is already there a window opens on. The file is capped at a
// few megabytes, and printing all of it would bury the reason you opened the window under an
// afternoon of someone else's call — `--all` is there for when that is what you want.
const TailLines = 200

// Follow prints the log to `out` and keeps printing as it grows — `openmeet --logs`.
//
// It follows the file rather than a handle, because the app trims it in place: when the size
// goes backwards the run has started again, and the right thing is to carry on from the top
// rather than sit on an offset that no longer means anything.
func Follow(path string, out io.Writer, grep string, colour, all bool) error {
	var at int64
	first := true
	if !all {
		at = tailFrom(path, TailLines)
	}
	for {
		st, err := os.Stat(path)
		if err != nil {
			if first {
				fmt.Fprintf(out, "%s\nNothing there yet — run openmeet with --debug.\n", path)
				first = false
			}
			time.Sleep(time.Second)
			continue
		}
		if st.Size() < at {
			at = 0 // trimmed, or a new run
		}
		if first && !all && at > st.Size() {
			at = 0
		}
		if st.Size() == at {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		if _, err := f.Seek(at, io.SeekStart); err != nil {
			f.Close()
			return err
		}
		r := bufio.NewReader(f)
		for {
			line, err := r.ReadString('\n')
			at += int64(len(line))
			if line != "" && (grep == "" || strings.Contains(strings.ToLower(line), strings.ToLower(grep))) {
				fmt.Fprint(out, paint(strings.TrimRight(line, "\n"), colour)+"\n")
			}
			if err != nil {
				break
			}
		}
		f.Close()
		first = false
	}
}

// tailFrom is the offset of the last `lines` lines, so a window opens on what just happened.
func tailFrom(path string, lines int) int64 {
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	const chunk = 64 << 10
	at := st.Size()
	seen := 0
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()
	buf := make([]byte, chunk)
	for at > 0 {
		n := int64(chunk)
		if at < n {
			n = at
		}
		at -= n
		if _, err := f.ReadAt(buf[:n], at); err != nil && err != io.EOF {
			return 0
		}
		for i := int(n) - 1; i >= 0; i-- {
			if buf[i] != '\n' {
				continue
			}
			seen++
			if seen > lines {
				return at + int64(i) + 1
			}
		}
	}
	return 0
}

// paint puts the room's own palette on a line: the clock and the pid dim, the rest in the
// colour the debug panel uses, and anything that reads like a failure in red.
func paint(line string, colour bool) string {
	if !colour {
		return line
	}
	const reset = "\x1b[0m"
	if strings.HasPrefix(line, "──") {
		return rgb("#E8B900") + line + reset
	}
	body := line
	head := ""
	if i := strings.Index(line, "] "); i > 0 && strings.HasPrefix(line, strings.Split(line, " ")[0]) {
		head, body = line[:i+1], line[i+2:]
	}
	fg := "#C084FC"
	for _, bad := range []string{"failed", "error", "could not", "not raised", "lost", "refused"} {
		if strings.Contains(strings.ToLower(body), bad) {
			fg = "#F87171"
			break
		}
	}
	return rgb("#8A8A8A") + head + reset + " " + rgb(fg) + body + reset
}

// rgb is a 24-bit foreground, the way the interface writes one: a named ANSI colour is a
// palette index and renders as a different hue in every terminal (theme.go).
func rgb(hex string) string {
	var r, g, b int
	if _, err := fmt.Sscanf(hex, "#%02x%02x%02x", &r, &g, &b); err != nil {
		return ""
	}
	return fmt.Sprintf("\x1b[38;2;%d;%d;%dm", r, g, b)
}
