//go:build !windows

package video

import (
	"os"
	"syscall"
)

func interruptSignal() os.Signal { return syscall.SIGTERM }
