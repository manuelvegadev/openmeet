//go:build !darwin && !windows

package logs

import "fmt"

func openWindow(string) error {
	return fmt.Errorf("opening a window is not wired up on this platform")
}
