// The audio devices, in C, on purpose.
//
// miniaudio calls its data callback on a thread it owns. Letting that callback be a Go
// function means entering the Go runtime from a foreign thread two hundred times a second,
// and that measured at 1.9% of a core against 0.3% for the same devices in a C process
// (docs/performance.md). So the callback stays here and only moves samples between the
// device and a lock-free ring; Go pumps the rings from a goroutine with ordinary cgo calls,
// which cost nothing of the kind.
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_DECODING
#define MA_NO_ENCODING
#define MA_NO_GENERATION
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_ENGINE
#include "miniaudio/miniaudio.h"
#include "shim.h"
#include "shim_internal.h"
#include <string.h>

#define SAMPLE_RATE_DUPLEX 48000
static ma_context ctx;
static int ctxReady = 0;
// A device stopped or rerouted under us (miniaudio's notification): the pump reopens.
static volatile int deviceEvent = 0;

static void on_notification(const ma_device_notification* n) {
  if (n->type == ma_device_notification_type_stopped || n->type == ma_device_notification_type_rerouted) deviceEvent = 1;
}
static ma_device_info* playbackInfos = NULL;
static ma_device_info* captureInfos = NULL;
static ma_uint32 playbackCount = 0, captureCount = 0;

int om_init(void) {
  if (ctxReady) return 0;
  if (ma_context_init(NULL, 0, NULL, &ctx) != MA_SUCCESS) return -1;
  ctxReady = 1;
  return om_refresh();
}

int om_refresh(void) {
  if (ma_context_get_devices(&ctx, &playbackInfos, &playbackCount, &captureInfos, &captureCount) != MA_SUCCESS) return -1;
  return 0;
}

int om_device_count(int playback) { return playback ? (int)playbackCount : (int)captureCount; }

// The device's platform id: on macOS the CoreAudio UID, which vpio_darwin.c turns into an
// AudioDeviceID. Empty for the system default.
int om_device_uid(int playback, int index, char* buf, int len) {
  ma_device_info* infos = playback ? playbackInfos : captureInfos;
  int count = om_device_count(playback);
  buf[0] = 0;
  if (index < 0 || index >= count) return -1;
#if defined(__APPLE__)
  strncpy(buf, infos[index].id.coreaudio, (size_t)len - 1);
  buf[len - 1] = 0;
#else
  (void)infos;
#endif
  return 0;
}

// Stopped-or-rerouted, from miniaudio, for the macOS watcher to fold into its own answer.
int om_device_event(void) { int e = deviceEvent; deviceEvent = 0; return e; }

om_stream* om_stream_ring(int playback, int channels, int rate, int ringMs) {
  om_stream* s = (om_stream*)calloc(1, sizeof(om_stream));
  if (!s) return NULL;
  s->channels = channels;
  s->playback = playback;
  s->duplex = 1;
  if (ma_pcm_rb_init(ma_format_s16, (ma_uint32)channels, (ma_uint32)(rate * ringMs / 1000), NULL, NULL, &s->rb) != MA_SUCCESS) {
    free(s);
    return NULL;
  }
  return s;
}

void om_stream_free_ring(om_stream* s) {
  if (!s) return;
  ma_pcm_rb_uninit(&s->rb);
  free(s);
}

#if !defined(__APPLE__)
om_duplex* om_open_duplex(int inIndex, int outIndex, int rate, int ringMs, int prefillMs, int bypass, om_stream** cap, om_stream** play) {
  (void)inIndex; (void)outIndex; (void)rate; (void)ringMs; (void)prefillMs; (void)bypass; (void)cap; (void)play;
  return NULL;
}
void om_close_duplex(om_duplex* d) { (void)d; }
int om_watch(int inIndex, int outIndex) { (void)inIndex; (void)outIndex; deviceEvent = 0; return -1; }
void om_unwatch(void) {}
int om_devices_changed(void) { int e = deviceEvent; deviceEvent = 0; return e; }
int om_device_transport(int playback, int index, char* buf, int len) { (void)playback; (void)index; if (len > 0) buf[0] = 0; return 0; }
const char* om_duplex_error(void) { return "not on this platform"; }
#endif

int om_device_name(int playback, int index, char* buf, int len, int* isDefault) {
  ma_device_info* infos = playback ? playbackInfos : captureInfos;
  int count = om_device_count(playback);
  if (index < 0 || index >= count) return -1;
  strncpy(buf, infos[index].name, (size_t)len - 1);
  buf[len - 1] = 0;
  *isDefault = infos[index].isDefault ? 1 : 0;
  return 0;
}

static void capture_cb(ma_device* dev, void* out, const void* in, ma_uint32 frames) {
  (void)out;
  om_stream* s = (om_stream*)dev->pUserData;
  const ma_int16* src = (const ma_int16*)in;
  while (frames > 0) {
    ma_uint32 n = frames;
    void* dst;
    if (ma_pcm_rb_acquire_write(&s->rb, &n, &dst) != MA_SUCCESS || n == 0) { s->overruns++; return; }
    memcpy(dst, src, (size_t)n * (size_t)s->channels * sizeof(ma_int16));
    ma_pcm_rb_commit_write(&s->rb, n);
    src += n * s->channels;
    frames -= n;
  }
}

static void playback_cb(ma_device* dev, void* out, const void* in, ma_uint32 frames) {
  (void)in;
  om_stream* s = (om_stream*)dev->pUserData;
  ma_int16* dst = (ma_int16*)out;
  while (frames > 0) {
    ma_uint32 n = frames;
    void* src;
    if (ma_pcm_rb_acquire_read(&s->rb, &n, &src) != MA_SUCCESS || n == 0) {
      memset(dst, 0, (size_t)frames * (size_t)s->channels * sizeof(ma_int16));
      s->underruns++;
      return;
    }
    memcpy(dst, src, (size_t)n * (size_t)s->channels * sizeof(ma_int16));
    ma_pcm_rb_commit_read(&s->rb, n);
    dst += n * s->channels;
    frames -= n;
  }
}

om_stream* om_open(int playback, int deviceIndex, int channels, int rate, int periodMs, int ringMs, int prefillMs) {
  om_stream* s = (om_stream*)calloc(1, sizeof(om_stream));
  if (!s) return NULL;
  s->channels = channels;
  s->playback = playback;
  if (ma_pcm_rb_init(ma_format_s16, (ma_uint32)channels, (ma_uint32)(rate * ringMs / 1000), NULL, NULL, &s->rb) != MA_SUCCESS) {
    free(s);
    return NULL;
  }
  ma_device_config cfg = ma_device_config_init(playback ? ma_device_type_playback : ma_device_type_capture);
  cfg.sampleRate = (ma_uint32)rate;
  cfg.notificationCallback = on_notification;
  cfg.periodSizeInMilliseconds = (ma_uint32)periodMs;
  cfg.pUserData = s;
  if (playback) {
    cfg.playback.format = ma_format_s16;
    cfg.playback.channels = (ma_uint32)channels;
    cfg.playback.pDeviceID = deviceIndex >= 0 && deviceIndex < (int)playbackCount ? &playbackInfos[deviceIndex].id : NULL;
    cfg.dataCallback = playback_cb;
  } else {
    cfg.capture.format = ma_format_s16;
    cfg.capture.channels = (ma_uint32)channels;
    cfg.capture.pDeviceID = deviceIndex >= 0 && deviceIndex < (int)captureCount ? &captureInfos[deviceIndex].id : NULL;
    cfg.dataCallback = capture_cb;
  }
  if (ma_device_init(&ctx, &cfg, &s->dev) != MA_SUCCESS) {
    ma_pcm_rb_uninit(&s->rb);
    free(s);
    return NULL;
  }
  if (playback && prefillMs > 0) {
    // Silence ahead of the device before it starts, so its first callbacks find audio and
    // the pump has a period or two to arrive: the underruns a call used to begin with.
    ma_uint32 n = (ma_uint32)(rate * prefillMs / 1000);
    while (n > 0) {
      ma_uint32 got = n;
      void* dst;
      if (ma_pcm_rb_acquire_write(&s->rb, &got, &dst) != MA_SUCCESS || got == 0) break;
      memset(dst, 0, (size_t)got * (size_t)channels * sizeof(ma_int16));
      ma_pcm_rb_commit_write(&s->rb, got);
      n -= got;
    }
  }
  if (ma_device_start(&s->dev) != MA_SUCCESS) {
    ma_device_uninit(&s->dev);
    ma_pcm_rb_uninit(&s->rb);
    free(s);
    return NULL;
  }
  return s;
}

int om_rate(om_stream* s) { return s->duplex ? SAMPLE_RATE_DUPLEX : (int)s->dev.sampleRate; }
int om_available(om_stream* s) {
  return s->playback ? (int)ma_pcm_rb_available_write(&s->rb) : (int)ma_pcm_rb_available_read(&s->rb);
}
int om_underruns(om_stream* s) { return (int)(s->playback ? s->underruns : s->overruns); }

int om_read(om_stream* s, int16_t* out, int frames) {
  int done = 0;
  while (frames > 0) {
    ma_uint32 n = (ma_uint32)frames;
    void* src;
    if (ma_pcm_rb_acquire_read(&s->rb, &n, &src) != MA_SUCCESS || n == 0) break;
    memcpy(out + (size_t)done * s->channels, src, (size_t)n * (size_t)s->channels * sizeof(int16_t));
    ma_pcm_rb_commit_read(&s->rb, n);
    done += (int)n;
    frames -= (int)n;
  }
  return done;
}

int om_write(om_stream* s, const int16_t* in, int frames) {
  int done = 0;
  while (frames > 0) {
    ma_uint32 n = (ma_uint32)frames;
    void* dst;
    if (ma_pcm_rb_acquire_write(&s->rb, &n, &dst) != MA_SUCCESS || n == 0) break;
    memcpy(dst, in + (size_t)done * s->channels, (size_t)n * (size_t)s->channels * sizeof(int16_t));
    ma_pcm_rb_commit_write(&s->rb, n);
    done += (int)n;
    frames -= (int)n;
  }
  return done;
}

void om_close(om_stream* s) {
  if (!s) return;
  if (s->duplex) return; // the om_duplex owns it
  ma_device_uninit(&s->dev);
  ma_pcm_rb_uninit(&s->rb);
  free(s);
}
