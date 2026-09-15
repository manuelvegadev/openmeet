package files

import "fmt"

// Attaching what is on the clipboard, which is how a screenshot gets shared.
//
// A terminal application can never receive an image from a paste: the emulator turns the
// clipboard into text on Cmd+V, and a clipboard holding a PNG has no text to send. So
// reading it is our own, out of band — the mirror of internal/clip, which only ever writes.
//
// Two flavours are worth having. A file copied in the Finder or in Explorer arrives as a
// reference, and attaches as that file. An image — a screenshot, something copied out of a
// browser — arrives as pixels, and is written to a temporary file first, because a file is
// the only thing there is to send.
//
// None of this can work over SSH: the system tool would run on the wrong machine, and OSC 52
// is write-only in practice, since terminals disable reading it for good reason. The caller
// knows which case it is in (clip.Remote).

// Clipboard returns the path of a file to attach, or an error saying there is nothing there
// to attach. A path it created itself is in the temporary directory and is nobody's to keep.
func Clipboard() (string, error) {
	path, err := clipboardFile()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", fmt.Errorf("nothing on the clipboard to attach")
	}
	// Inspect, not Describe: the question here is "is this a file that can be sent", which is
	// a stat. The digest is read once, when it is actually offered.
	if _, err := Inspect(path); err != nil {
		return "", fmt.Errorf("the clipboard does not hold a file that can be sent")
	}
	return path, nil
}
