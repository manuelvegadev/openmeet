package files

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// Open hands a file to whatever the system opens it with.
func Open(path string) error {
	if err := exists(path); err != nil {
		return err
	}
	return openFile(path)
}

// Reveal shows the file in its folder, picked out: `open -R` on macOS, Explorer's /select on
// Windows.
func Reveal(path string) error {
	if err := exists(path); err != nil {
		return err
	}
	return revealFile(path)
}

// Preview is whatever this system means by looking at a file without opening it — Quick Look
// on macOS, and on Windows, which has no such thing, the same as Open.
func Preview(path string) error {
	if err := exists(path); err != nil {
		return err
	}
	return previewFile(path)
}

func exists(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("%s is not there any more", filepath.Base(path))
	}
	return nil
}

func dirOf(path string) string { return filepath.Dir(path) }

// start runs something and lets it go: the window it opens is the user's, and waiting for it
// would hold the key that asked for it. Waiting happens on a goroutine only to reap it.
func start(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}
