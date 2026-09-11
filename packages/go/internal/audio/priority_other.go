//go:build !windows && !darwin

package audio

func RaiseProcessPriority() error { return nil }
func RaiseAudioThread() error     { return nil }
