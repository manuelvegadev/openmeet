//go:build !darwin && !windows

package rtc

import "syscall"

func setVoiceOptions(fd uintptr) {
	_ = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_TOS, dscpEF)
}
