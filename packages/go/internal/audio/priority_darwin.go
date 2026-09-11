//go:build darwin

package audio

/*
#include <pthread.h>
#include <sys/qos.h>
static int om_qos_interactive(void) {
	return pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
}
*/
import "C"
import "errors"

// RaiseProcessPriority: macOS has no priority classes a process may raise without root;
// the thread QoS below is what counts there.
func RaiseProcessPriority() error { return nil }

// RaiseAudioThread gives the pump's thread the user-interactive QoS class: scheduled
// ahead of everything a browser or a game runs at, and never on an efficiency core.
func RaiseAudioThread() error {
	if C.om_qos_interactive() != 0 {
		return errors.New("pthread_set_qos_class_self_np failed")
	}
	return nil
}
