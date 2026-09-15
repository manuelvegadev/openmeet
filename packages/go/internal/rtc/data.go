package rtc

import (
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/pion/datachannel"
	"github.com/pion/webrtc/v4"
)

// The data channels. Files move over the connections the call already has: SCTP inside the
// same DTLS association that carries the voice, so a transfer needs no new trust, no new
// port and no server — the announcement is all the server ever sees.
//
// Two kinds of channel. `control` is created by the offering side before the offer, which is
// what puts the `application` m-line in the SDP at a fixed place (see addContract, and
// gotcha 1: the m-lines are matched by position); the answering side takes the one it is
// given. Every file then gets **a channel of its own**, opened on demand and closed at the
// end. SCTP is already up by then, so a second channel costs no renegotiation, and it means
// a chunk is a chunk: no transfer id repeated on every message, no interleaving, and
// cancelling is closing the channel.

const (
	// How much may be in the sender's buffer before it waits, and the mark it waits for.
	// The point is to keep the file out of memory: the disk is read as the wire drains.
	bufHigh = 1 << 20
	bufLow  = 256 << 10
	// A transfer that cannot put a chunk on the wire in this long has lost its peer.
	stallTimeout = 30 * time.Second
)

// Stream is one open data channel, detached: reads and writes are ordinary io, and the
// SCTP message boundaries are kept, so one Write is one Read at the other end.
type Stream struct {
	dc    *webrtc.DataChannel
	rwc   datachannel.ReadWriteCloser
	low   chan struct{}
	stall *time.Timer
	once  sync.Once
}

func newStream(dc *webrtc.DataChannel, rwc datachannel.ReadWriteCloser) *Stream {
	s := &Stream{dc: dc, rwc: rwc, low: make(chan struct{}, 1), stall: stoppedTimer()}
	dc.SetBufferedAmountLowThreshold(bufLow)
	dc.OnBufferedAmountLow(func() {
		select {
		case s.low <- struct{}{}:
		default:
		}
	})
	return s
}

// Write blocks while the channel is already carrying enough, which is the whole of the flow
// control: the file is read from disk at the rate the wire takes it, never faster.
func (s *Stream) Write(p []byte) (int, error) {
	for s.dc.BufferedAmount() > bufHigh {
		// One timer, reset per wait: a fresh time.After here would strand a thirty-second
		// timer in the runtime's heap for every ~768 KiB sent.
		s.stall.Reset(stallTimeout)
		select {
		case <-s.low:
		case <-s.stall.C:
			return 0, fmt.Errorf("the connection stopped taking data")
		}
		s.stall.Stop()
	}
	return s.rwc.Write(p)
}

func (s *Stream) Read(p []byte) (int, error) { return s.rwc.Read(p) }

// Drain waits for what has been written to actually leave, which has to happen before the
// channel closes or the tail of the file goes with it. The channel says when, by the same
// callback the flow control uses, with the mark moved to nothing left.
func (s *Stream) Drain(timeout time.Duration) {
	if s.dc.BufferedAmount() == 0 {
		return
	}
	s.dc.SetBufferedAmountLowThreshold(0)
	defer s.dc.SetBufferedAmountLowThreshold(bufLow)
	s.stall.Reset(timeout)
	defer s.stall.Stop()
	for s.dc.BufferedAmount() > 0 {
		select {
		case <-s.low:
		case <-s.stall.C:
			return
		}
	}
}

// stoppedTimer is a timer that has not been started: Reset is what starts it.
func stoppedTimer() *time.Timer {
	t := time.NewTimer(time.Hour)
	if !t.Stop() {
		<-t.C
	}
	return t
}

func (s *Stream) Close() error {
	var err error
	s.once.Do(func() { err = s.rwc.Close() })
	return err
}

// detach turns an open channel into a Stream. It is called from OnOpen, which is the only
// place pion allows it once the setting engine has asked for detached channels.
func detach(dc *webrtc.DataChannel) (*Stream, error) {
	rwc, err := dc.Detach()
	if err != nil {
		return nil, err
	}
	return newStream(dc, rwc), nil
}

// wireData registers the incoming half: the control channel a peer offers us, and the file
// channels either side opens once SCTP is up.
func (m *Manager) wireData(c *conn, peerID string) {
	c.pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		label := dc.Label()
		dc.OnOpen(func() {
			s, err := detach(dc)
			if err != nil {
				m.log("data channel %q from %s: %v", label, Short(peerID), err)
				return
			}
			switch {
			case label == controlLabel:
				m.setControl(c, s)
				go m.readControl(peerID, s)
			case strings.HasPrefix(label, fileLabelPrefix):
				if m.onStream != nil {
					go m.onStream(peerID, strings.TrimPrefix(label, fileLabelPrefix), s)
				}
			default:
				_ = s.Close()
			}
		})
	})
}

const (
	controlLabel    = "control"
	fileLabelPrefix = "file:"
)

func (m *Manager) setControl(c *conn, s *Stream) {
	m.mu.Lock()
	c.ctrl = s
	close(m.ctrlChanged)
	m.ctrlChanged = make(chan struct{})
	m.mu.Unlock()
}

// readControl hands every control message to the engine, one Read per message.
func (m *Manager) readControl(peerID string, s *Stream) {
	buf := make([]byte, 64*1024)
	for {
		n, err := s.Read(buf)
		if err != nil {
			return
		}
		if m.onControl != nil && n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			m.onControl(peerID, data)
		}
	}
}

// addControl creates the control channel. Only the offering side does: the answer's m-lines
// mirror the offer's, so a channel created there would never be negotiated, and one control
// channel per connection is what leaves no question about which to send on.
func (m *Manager) addControl(c *conn, peerID string) error {
	dc, err := c.pc.CreateDataChannel(controlLabel, nil)
	if err != nil {
		return err
	}
	dc.OnOpen(func() {
		s, err := detach(dc)
		if err != nil {
			m.log("control channel to %s: %v", Short(peerID), err)
			return
		}
		m.setControl(c, s)
		go m.readControl(peerID, s)
	})
	return nil
}

// control waits for a peer's control channel and returns it.
//
// It waits for the *connection* as well, not only for the channel on it: a file offer
// travels over the WebSocket, which is fast, while the connection it will be fetched over is
// still gathering candidates — so somebody who asks for a file the moment they see it asks
// before there is anything to ask on. Waiting is the whole of the fix; failing there made a
// file look broken when it was only early.
//
// A peer running a binary from before any of this never opens a channel, and the wait ends
// with an error saying so rather than hanging.
func (m *Manager) control(peerID string, wait time.Duration) (*Stream, error) {
	timeout := time.NewTimer(wait)
	defer timeout.Stop()
	for {
		m.mu.Lock()
		var s *Stream
		if c := m.conns[peerID]; c != nil {
			s = c.ctrl
		}
		changed := m.ctrlChanged
		m.mu.Unlock()
		if s != nil {
			return s, nil
		}
		select {
		case <-changed: // some control channel opened; look again, it may be ours
		case <-timeout.C:
			return nil, fmt.Errorf("no file channel to that peer yet (they may be on an older version)")
		}
	}
}

// SendControl sends one control message to a peer.
func (m *Manager) SendControl(peerID string, data []byte) error {
	s, err := m.control(peerID, 10*time.Second)
	if err != nil {
		return err
	}
	_, err = s.Write(data)
	return err
}

// OpenStream opens a channel of its own for one file. The label carries the id, so the far
// side knows what is arriving without a byte of framing.
func (m *Manager) OpenStream(peerID, id string) (*Stream, error) {
	m.mu.Lock()
	c := m.conns[peerID]
	m.mu.Unlock()
	if c == nil {
		return nil, fmt.Errorf("not connected")
	}
	dc, err := c.pc.CreateDataChannel(fileLabelPrefix+id, nil)
	if err != nil {
		return nil, err
	}
	open := make(chan *Stream, 1)
	fail := make(chan error, 1)
	dc.OnOpen(func() {
		s, err := detach(dc)
		if err != nil {
			fail <- err
			return
		}
		open <- s
	})
	select {
	case s := <-open:
		return s, nil
	case err := <-fail:
		return nil, err
	case <-time.After(30 * time.Second):
		_ = dc.Close()
		return nil, fmt.Errorf("the peer never opened the channel")
	}
}

// LocalPair is whether the connection to a peer runs over the local network: both ends are
// host candidates and the peer's address is private. It decides how hard a transfer is
// allowed to push — on a LAN there is no uplink to protect, and holding a file back to a
// couple of megabits there would be an invented limit (see internal/files).
func (m *Manager) LocalPair(peerID string) bool {
	m.mu.Lock()
	c := m.conns[peerID]
	m.mu.Unlock()
	if c == nil {
		return false
	}
	stats := c.pc.GetStats()
	for _, st := range stats {
		pair, ok := st.(webrtc.ICECandidatePairStats)
		if !ok || pair.State != webrtc.StatsICECandidatePairStateSucceeded || !pair.Nominated {
			continue
		}
		local, lok := stats[pair.LocalCandidateID].(webrtc.ICECandidateStats)
		remote, rok := stats[pair.RemoteCandidateID].(webrtc.ICECandidateStats)
		if !lok || !rok {
			return false
		}
		return local.CandidateType == webrtc.ICECandidateTypeHost &&
			remote.CandidateType == webrtc.ICECandidateTypeHost &&
			privateIP(remote.IP)
	}
	return false
}

// privateIP is the RFC 1918 / RFC 4193 / link-local test: an address that cannot have come
// from the other side of a router.
func privateIP(s string) bool {
	ip := net.ParseIP(s)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}
