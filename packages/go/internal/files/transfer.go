package files

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"time"
)

// ChunkSize matches the data channel's: one read from the disk is one message on the wire.
const ChunkSize = 16 * 1024

// Rates. A transfer is not the call, so on a link that has to carry both it gets a ceiling
// well under what a screen share takes. On the local network there is no uplink to protect
// and the ceiling is an invented limit, so there is none — see rtc.LocalPair, which is what
// decides between these.
const (
	RemoteKbps = 2000
	LocalKbps  = 0 // as fast as the channel drains
)

// Progress is called as bytes move, already thinned: a whole percent must have changed *and*
// a fifth of a second have passed, because a repaint costs more than the byte it reports
// (gotcha 24) and a transfer over a local network passes a hundred percent marks in a
// second. The final call is always made, so a row never stops short of where it got to.
type Progress func(done int64)

type throttle struct {
	report  Progress
	total   int64
	lastPct int
	lastAt  time.Time
}

func (t *throttle) tick(done int64) {
	if t.report == nil {
		return
	}
	pct := 0
	if t.total > 0 {
		pct = int(done * 100 / t.total)
	}
	now := time.Now()
	if pct != t.lastPct && now.Sub(t.lastAt) > 200*time.Millisecond {
		t.lastPct, t.lastAt = pct, now
		t.report(done)
	}
}

// Send streams a file onto a writer, no faster than rateKbps and never holding more of it in
// memory than one chunk. The writer blocks when the channel is already carrying enough, so
// the disk is read at the speed of the wire: a file larger than this process is not a
// problem, because it never passes through it.
func Send(path string, w io.Writer, rateKbps int, size int64, report Progress) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	buf := make([]byte, ChunkSize)
	t := &throttle{report: report, total: size, lastPct: -1}
	var sent int64
	// A token bucket, filled as time passes: it smooths a transfer rather than sending a
	// second's worth and sleeping, which would show up in the call as a second of jitter.
	var allowance float64
	last := time.Now()
	for {
		n, err := f.Read(buf)
		if n > 0 {
			if rateKbps > 0 {
				now := time.Now()
				allowance += now.Sub(last).Seconds() * float64(rateKbps) * 1000 / 8
				last = now
				if max := float64(rateKbps) * 1000 / 8 * 0.25; allowance > max {
					allowance = max
				}
				if need := float64(n) - allowance; need > 0 {
					time.Sleep(time.Duration(need / (float64(rateKbps) * 1000 / 8) * float64(time.Second)))
					allowance += time.Since(last).Seconds() * float64(rateKbps) * 1000 / 8
					last = time.Now()
				}
				allowance -= float64(n)
			}
			if _, werr := w.Write(buf[:n]); werr != nil {
				return werr
			}
			sent += int64(n)
			t.tick(sent)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	if report != nil {
		report(sent)
	}
	return nil
}

// Receive writes what arrives to dst, checking as it goes. It writes beside the destination
// and renames at the end, so a transfer that fails leaves no file that looks complete, and
// it refuses more bytes than were offered rather than filling a disk on somebody's word.
func Receive(r io.Reader, size int64, sum, dst string, report Progress) error {
	part := dst + ".part"
	f, err := os.OpenFile(part, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	done := false
	defer func() {
		f.Close()
		if !done {
			os.Remove(part)
		}
	}()

	h := sha256.New()
	buf := make([]byte, 64*1024)
	t := &throttle{report: report, total: size, lastPct: -1}
	var got int64
	for got < size {
		n, rerr := r.Read(buf)
		if n > 0 {
			if got+int64(n) > size {
				return fmt.Errorf("the sender sent more than they offered")
			}
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			h.Write(buf[:n])
			got += int64(n)
			t.tick(got)
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return fmt.Errorf("the transfer stopped: %w", rerr)
		}
	}
	if got != size {
		return fmt.Errorf("the transfer stopped at %s of %s", FormatSize(got), FormatSize(size))
	}
	if sum != "" && hex.EncodeToString(h.Sum(nil)) != sum {
		return fmt.Errorf("what arrived does not match what was offered")
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(part, dst); err != nil {
		return err
	}
	done = true
	if report != nil {
		report(got)
	}
	return nil
}
