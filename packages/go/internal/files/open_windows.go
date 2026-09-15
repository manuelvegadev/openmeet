package files

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// Windows has no Quick Look. The one people remember is a third-party app from the Store, so
// a preview here is what a Windows user actually expects: the file opened by whatever
// handles it, and the folder with the file picked out.
//
// Nothing is spawned by bare name: a window opened from a shortcut inherits Explorer's stale
// environment (gotcha 21), so the two tools that matter are taken from %SystemRoot%.

// winPath is a tool under %SystemRoot%. Every tool this package spawns comes from here, in
// one place, because gotcha 21 — never spawn by bare name — is a rule that can only be
// enforced where the path is built.
func winPath(parts ...string) string {
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	return filepath.Join(append([]string{root}, parts...)...)
}

func system32(name string) string { return winPath("System32", name) }

func openFile(path string) error {
	// `start` is a shell built-in, not a program, and its first quoted argument is the window
	// title — which is why the empty one has to be there before the path.
	cmd := exec.Command(system32("cmd.exe"))
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `/c start "" "` + path + `"`, HideWindow: true}
	return start(cmd)
}

func revealFile(path string) error {
	// Explorer parses its own command line and does it badly: `/select,` and the quoted path
	// have to arrive as one string, which is what SysProcAttr.CmdLine is for. It also exits
	// non-zero when it has done exactly what was asked, so nothing here waits on its status.
	cmd := exec.Command(winPath("explorer.exe"))
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + path + `"`}
	return start(cmd)
}

func previewFile(path string) error { return openFile(path) }

// HasPreview: there is no Quick Look here. The one people remember on Windows is a
// third-party app from the Store, so opening and previewing are the same act and the
// interface draws no third button.
const HasPreview = false
