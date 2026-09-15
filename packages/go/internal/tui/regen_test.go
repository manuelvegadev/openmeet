package tui

import (
	"encoding/json"
	"os"
	"testing"
)

// The room's reference frames are ours rather than the Node client's (see golden_test.go), so
// this is where they come from:
//
//	OPENMEET_REGEN=1 go test ./internal/tui -run GenerateRoomGoldens
//
// Running it is a decision to change the design, not a way to make a red test green.
func TestGenerateRoomGoldens(t *testing.T) {
	if os.Getenv("OPENMEET_REGEN") == "" {
		t.Skip("set OPENMEET_REGEN=1 to rewrite the room's reference frames")
	}
	write := func(name string, c *Canvas) {
		if err := os.WriteFile("testdata/"+name+".txt", []byte(c.Text()+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// The colour reference is every cell's effective foreground, background and weight —
	// which is what makes the fills and the two border colours part of the contract.
	colors := func(name string, c *Canvas) {
		grid := make([][][]interface{}, c.H)
		for y := 0; y < c.H; y++ {
			row := make([][]interface{}, c.W)
			for x := 0; x < c.W; x++ {
				ch := string(runeAt(c, x, y))
				st := c.StyleAt(x, y)
				fg, bg := st.FG, st.BG
				if fg == "" {
					fg = ThemeText
				}
				if bg == "" {
					bg = ThemeBG
				}
				row[x] = []interface{}{ch, fg, bg, st.Bold}
			}
			grid[y] = row
		}
		b, err := json.Marshal(grid)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile("testdata/"+name+".json", b, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	c := NewCanvas(120, 34)
	DrawRoom(c, poseRoom())
	write("room", c)
	colors("room", c)

	s, list := poseFiles()
	c = NewCanvas(120, 34)
	DrawRoom(c, s)
	write("room-files", c)
	c = NewCanvas(120, 34)
	DrawRoom(c, s)
	DrawModal(c, "Files in this room", FileRows(list), 0, FileHints(list[0]), "modal")
	write("files-modal", c)
}
