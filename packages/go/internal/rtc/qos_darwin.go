//go:build darwin

package rtc

import "syscall"

// From xnu's sys/socket.h: the socket's network service type, and the voice class.
const (
	soNetServiceType = 0x1116
	netServiceTypeVO = 4
	ipv6TrafficClass = 36 // IPV6_TCLASS
)

func setVoiceOptions(fd uintptr) {
	_ = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_TOS, dscpEF)
	_ = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IPV6, ipv6TrafficClass, dscpEF)
	_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, soNetServiceType, netServiceTypeVO)
}
