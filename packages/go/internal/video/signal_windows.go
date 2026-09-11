//go:build windows

package video

import "os"

// Windows has no SIGTERM to speak of: Kill is what Signal becomes.
func interruptSignal() os.Signal { return os.Kill }
