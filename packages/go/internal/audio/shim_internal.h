// Shared between shim.c (miniaudio, all platforms) and vpio_darwin.c (Apple's voice
// processing unit): the stream and its ring.
#ifndef OM_SHIM_INTERNAL_H
#define OM_SHIM_INTERNAL_H
#include "miniaudio/miniaudio.h"
#include "shim.h"

struct om_stream {
  ma_device dev;      // miniaudio's device; unused by a duplex stream
  ma_pcm_rb rb;
  int channels;
  int playback;
  int duplex;         // owned by an om_duplex: no ma_device here
  ma_uint32 underruns;
  ma_uint32 overruns;
};

// A stream with a ring and no device of its own, for vpio_darwin.c.
om_stream* om_stream_ring(int playback, int channels, int rate, int ringMs);
void om_stream_free_ring(om_stream* s);
int om_device_uid(int playback, int index, char* buf, int len);
int om_device_event(void);
#endif
