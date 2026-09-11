//go:build windows

package audio

import "unsafe"

func unsafePointer[T any](p *T) unsafe.Pointer { return unsafe.Pointer(p) }
