//go:build windows

package rtc

import "golang.org/x/sys/windows"

// Windows drops IP_TOS unless a QoS policy allows it; set anyway, it costs nothing, and the
// qWAVE flow that Windows wants is the part still to do.
func setVoiceOptions(fd uintptr) {
	_ = windows.SetsockoptInt(windows.Handle(fd), windows.IPPROTO_IP, windows.IP_TOS, dscpEF)
}
