//go:build !darwin && !windows

package files

func clipboardFile() (string, error) { return "", nil }
