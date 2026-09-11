#ifndef OM_SHIM_H
#define OM_SHIM_H
#include <stdint.h>
typedef struct om_stream om_stream;
typedef struct om_duplex om_duplex;
int om_init(void);
int om_refresh(void);
int om_device_count(int playback);
int om_device_name(int playback, int index, char* buf, int len, int* isDefault);
// How the device is attached, where the platform says: "blue" for Bluetooth on macOS
// (CoreAudio's transport type as four characters), empty elsewhere.
int om_device_transport(int playback, int index, char* buf, int len);
// rate 0: the device's own rate (read it back with om_rate; the ring is sized at it).
om_stream* om_open(int playback, int deviceIndex, int channels, int rate, int periodMs, int ringMs, int prefillMs);
int om_rate(om_stream* s);
int om_available(om_stream* s);
int om_underruns(om_stream* s);
int om_read(om_stream* s, int16_t* out, int frames);
int om_write(om_stream* s, const int16_t* in, int frames);
void om_close(om_stream* s);

// Apple's voice processing unit: one unit carrying both the microphone and the speaker, so
// its echo canceller hears what it plays, with the system's Mic Modes (Voice Isolation,
// Wide Spectrum) applied. Both streams share the unit; close it through om_close_duplex.
// NULL where the platform has no such thing, or when the unit refused (om_duplex_error).
om_duplex* om_open_duplex(int inIndex, int outIndex, int rate, int ringMs, int prefillMs, int bypass, om_stream** cap, om_stream** play);
void om_close_duplex(om_duplex* d);
// Watch the devices in use, either path: their sample rate, and the default device while
// that is what is open. om_devices_changed is non-zero once something moved, and clears.
int om_watch(int inIndex, int outIndex);
void om_unwatch(void);
int om_devices_changed(void);
const char* om_duplex_error(void);
#endif
