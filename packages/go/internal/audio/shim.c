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
#include <string.h>

static ma_context ctx;
static int ctxReady = 0;
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

int om_device_name(int playback, int index, char* buf, int len, int* isDefault) {
  ma_device_info* infos = playback ? playbackInfos : captureInfos;
  int count = om_device_count(playback);
  if (index < 0 || index >= count) return -1;
  strncpy(buf, infos[index].name, (size_t)len - 1);
  buf[len - 1] = 0;
  *isDefault = infos[index].isDefault ? 1 : 0;
  return 0;
}

struct om_stream {
  ma_device dev;
  ma_pcm_rb rb;
  int channels;
  int playback;
  ma_uint32 underruns;
  ma_uint32 overruns;
};

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

om_stream* om_open(int playback, int deviceIndex, int channels, int rate, int periodMs, int ringMs) {
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
  if (ma_device_start(&s->dev) != MA_SUCCESS) {
    ma_device_uninit(&s->dev);
    ma_pcm_rb_uninit(&s->rb);
    free(s);
    return NULL;
  }
  return s;
}

int om_rate(om_stream* s) { return (int)s->dev.sampleRate; }
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
  ma_device_uninit(&s->dev);
  ma_pcm_rb_uninit(&s->rb);
  free(s);
}
