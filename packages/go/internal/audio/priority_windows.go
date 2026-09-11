//go:build windows

package audio

import (
	"golang.org/x/sys/windows"
)

// THREAD_PRIORITY_TIME_CRITICAL, which x/sys does not name.
const threadPriorityTimeCritical = 15

var (
	avrt                          = windows.NewLazySystemDLL("avrt.dll")
	avSetMmThreadCharacteristicsW = avrt.NewProc("AvSetMmThreadCharacteristicsW")
	kernel32                      = windows.NewLazySystemDLL("kernel32.dll")
	setThreadPriority             = kernel32.NewProc("SetThreadPriority")
)

// RaiseProcessPriority puts the process in the high priority class: what the Node engine
// did at join, and what keeps a fullscreen game — Game Mode deprioritises everything
// behind it — from outranking the call. No elevation needed for HIGH (REALTIME would).
func RaiseProcessPriority() error {
	return windows.SetPriorityClass(windows.CurrentProcess(), windows.HIGH_PRIORITY_CLASS)
}

// RaiseAudioThread is for the pump's thread, which the goroutine locks itself to: the
// multimedia scheduler's "Pro Audio" class, the one WASAPI's own threads use, and the
// highest ordinary thread priority under it.
func RaiseAudioThread() error {
	if r, _, err := setThreadPriority.Call(uintptr(windows.CurrentThread()), threadPriorityTimeCritical); r == 0 {
		return err
	}
	task, _ := windows.UTF16PtrFromString("Pro Audio")
	var index uint32
	h, _, err := avSetMmThreadCharacteristicsW.Call(uintptr(unsafePointer(task)), uintptr(unsafePointer(&index)))
	if h == 0 {
		return err
	}
	return nil
}
