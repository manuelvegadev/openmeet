// Package files is sharing a file with the room: what a file is called and how big it is,
// how it is sent and received, and where a received one lands.
//
// Nothing here talks to the network. The bytes go over a data channel on the peer
// connections (internal/rtc), which is what keeps a transfer between the two machines and
// out of the server; this package reads and writes the disk at the rate that channel takes,
// and is careful about what it writes, because the name on the other end was chosen by
// somebody else.
package files

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// MaxSize is the largest file this client offers or accepts. It is not a judgement about
// what is reasonable to send, it is the point past which a mistake — a directory dragged in
// as a sparse image, a path that turned out to be a disk — stops being recoverable.
const MaxSize = 8 << 30

// The kinds a row draws, by extension. What a person needs from the mark is whether they can
// listen to it, watch it, look at it, unpack it, or none of those — and an image earns its
// own because a screenshot is the thing people most often put in a call, and calling one a
// document would be the mark getting it wrong in the commonest case.
const (
	KindAudio   = "aud"
	KindVideo   = "vid"
	KindImage   = "img"
	KindArchive = "zip"
	KindOther   = "doc"
)

var kindByExt = map[string]string{
	".mp3": KindAudio, ".m4a": KindAudio, ".aac": KindAudio, ".wav": KindAudio, ".flac": KindAudio,
	".ogg": KindAudio, ".opus": KindAudio, ".aiff": KindAudio, ".aif": KindAudio, ".wma": KindAudio,
	".mp4": KindVideo, ".mov": KindVideo, ".mkv": KindVideo, ".avi": KindVideo, ".webm": KindVideo,
	".m4v": KindVideo, ".wmv": KindVideo, ".flv": KindVideo, ".mpg": KindVideo, ".mpeg": KindVideo,
	".png": KindImage, ".jpg": KindImage, ".jpeg": KindImage, ".gif": KindImage, ".webp": KindImage,
	".heic": KindImage, ".heif": KindImage, ".tiff": KindImage, ".tif": KindImage, ".bmp": KindImage,
	".svg": KindImage, ".avif": KindImage,

	".zip": KindArchive, ".gz": KindArchive, ".tgz": KindArchive, ".bz2": KindArchive,
	".xz": KindArchive, ".7z": KindArchive, ".rar": KindArchive, ".tar": KindArchive,
	".zst": KindArchive, ".dmg": KindArchive,
}

// Kind is how a name draws. Unknown is `doc`, which is most things.
func Kind(name string) string {
	if k, ok := kindByExt[strings.ToLower(filepath.Ext(name))]; ok {
		return k
	}
	return KindOther
}

// Meta is a file as an offer describes it.
type Meta struct {
	Path   string
	Name   string
	Size   int64
	Kind   string
	SHA256 string
}

// Describe reads a file's size and digest. The digest is the sender's, so it proves nothing
// about the sender — it is there so the receiver can tell a complete file from a truncated
// one, which is the failure that otherwise looks like a corrupt file weeks later.
func Describe(path string) (Meta, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Meta{}, err
	}
	if info.IsDir() {
		return Meta{}, fmt.Errorf("%s is a folder", filepath.Base(path))
	}
	if !info.Mode().IsRegular() {
		return Meta{}, fmt.Errorf("%s is not a file", filepath.Base(path))
	}
	if info.Size() > MaxSize {
		return Meta{}, fmt.Errorf("%s is larger than %s", filepath.Base(path), FormatSize(MaxSize))
	}
	f, err := os.Open(path)
	if err != nil {
		return Meta{}, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return Meta{}, err
	}
	name := filepath.Base(path)
	return Meta{Path: path, Name: name, Size: info.Size(), Kind: Kind(name), SHA256: hex.EncodeToString(h.Sum(nil))}, nil
}

// NewID is an offer's id: unique in the room, and the label of the channel its bytes arrive
// on. Random rather than a counter, because two people can offer at the same moment.
func NewID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

// FormatSize is what a row shows. Three significant figures is what fits and what anyone
// reads: 1.2 MB, 950 KB, 14 B.
func FormatSize(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}
