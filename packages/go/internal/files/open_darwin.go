package files

import "os/exec"

// Opening a received file, on the system's own terms.
//
// macOS has exactly the thing people mean by a preview: `qlmanage -p` is the Quick Look
// panel the space bar opens in the Finder. It is a developer tool and it talks to stderr,
// which is why nothing here is wired to ours — a line from it landing in the frame would
// scramble the canvas.

// HasPreview: macOS means something by previewing a file that it does not mean by
// opening one — `qlmanage -p` is the Quick Look panel the space bar opens in the Finder.
const HasPreview = true

func openFile(path string) error   { return start(exec.Command("open", path)) }
func revealFile(path string) error { return start(exec.Command("open", "-R", path)) }

func previewFile(path string) error {
	if err := start(exec.Command("qlmanage", "-p", path)); err != nil {
		return openFile(path)
	}
	return nil
}
