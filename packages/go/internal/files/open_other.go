//go:build !darwin && !windows

package files

import "os/exec"

// HasPreview: nothing here means anything by previewing that it does not mean by opening.
const HasPreview = false

func openFile(path string) error    { return start(exec.Command("xdg-open", path)) }
func revealFile(path string) error  { return start(exec.Command("xdg-open", dirOf(path))) }
func previewFile(path string) error { return openFile(path) }
