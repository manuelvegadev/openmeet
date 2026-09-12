package rtc

import (
	"net"
	"syscall"

	"github.com/pion/transport/v4"
	"github.com/pion/transport/v4/stdnet"
)

// qosNet is the network pion opens its sockets through, with every UDP socket marked as
// voice: DSCP EF (46) in the IP header, and on macOS the socket's service class set to
// voice as well, which is what puts the packets in Wi-Fi's voice access category (WMM
// AC_VO) ahead of a browser's downloads. A router that honours DSCP does the same on its
// side; one that does not simply ignores the mark. Windows ignores IP_TOS on its own —
// marking there goes through the qWAVE API, per destination, which is still to do.
//
// The sockets also get generous buffers: a video keyframe arrives as a burst of a couple
// of hundred packets, and Windows' default receive buffer (64 KB) holds a fraction of
// one, so the tail was dropped before pion ever read it.
type qosNet struct {
	*stdnet.Net
}

func newQOSNet() (transport.Net, error) {
	n, err := stdnet.NewNet()
	if err != nil {
		return nil, err
	}
	return &qosNet{Net: n}, nil
}

func (q *qosNet) ListenUDP(network string, laddr *net.UDPAddr) (transport.UDPConn, error) {
	c, err := q.Net.ListenUDP(network, laddr)
	if err == nil {
		tuneSocket(c)
	}
	return c, err
}

func (q *qosNet) ListenPacket(network, address string) (net.PacketConn, error) {
	c, err := q.Net.ListenPacket(network, address)
	if err == nil {
		tuneSocket(c)
	}
	return c, err
}

// Enough for a keyframe burst — a 1080p IDR is 100-300 KB — with room to spare. The send
// side needs nothing like it, and pion opens a socket per local interface per peer, so the
// ceiling is charged tens of times over.
const readBuffer = 1 << 20

// tuneSocket is everything a fresh pion socket gets: the voice marking and the room to
// absorb a burst. One function, so a new listen path cannot take half of it.
func tuneSocket(c interface{}) {
	markVoice(c)
	if b, ok := c.(interface{ SetReadBuffer(int) error }); ok {
		_ = b.SetReadBuffer(readBuffer)
	}
}

const dscpEF = 46 << 2

func markVoice(c interface{}) {
	sc, ok := c.(syscall.Conn)
	if !ok {
		return
	}
	raw, err := sc.SyscallConn()
	if err != nil {
		return
	}
	_ = raw.Control(func(fd uintptr) { setVoiceOptions(fd) })
}
