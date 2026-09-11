// macOS: the microphone and the speaker through Apple's Voice Processing I/O unit — the
// path FaceTime, Zoom and Chrome take, and the only one the system's Mic Modes (Voice
// Isolation, Wide Spectrum) apply to. It also brings Apple's echo cancellation, automatic
// gain and noise suppression, which raw HAL capture never sees.
//
// Callbacks stay in C: the unit renders playback out of our ring and hands captured audio
// into the other, and Go pumps the rings as it does with miniaudio's devices.
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <stdatomic.h>
#include <string.h>
#include "shim_internal.h"

struct om_duplex {
  AudioUnit unit;
  om_stream* cap;
  om_stream* play;
  int16_t* inBuf;
  UInt32 inCap;
  AudioDeviceID inDev, outDev;
  int inDefault, outDefault;
};

static char lastError[256];
const char* om_duplex_error(void) { return lastError; }

// ── watching devices, for either path ─────────────────────────────────────
// A Bluetooth headset switching profile changes its nominal rate; the default device can
// move. Either is a reason to open again, and only the pump can do that.
static atomic_int devicesChanged;
static AudioDeviceID watchIn = kAudioObjectUnknown, watchOut = kAudioObjectUnknown;
static int watchInDefault, watchOutDefault, watching;

static OSStatus on_device_change(AudioObjectID obj, UInt32 n, const AudioObjectPropertyAddress* addrs, void* ref) {
  (void)obj; (void)n; (void)addrs; (void)ref;
  atomic_store(&devicesChanged, 1);
  return noErr;
}

static void watch_one(AudioObjectID obj, AudioObjectPropertySelector sel, int add) {
  AudioObjectPropertyAddress a = { sel, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  if (add) AudioObjectAddPropertyListener(obj, &a, on_device_change, NULL);
  else AudioObjectRemovePropertyListener(obj, &a, on_device_change, NULL);
}

static void watch_all(int add) {
  if (watchIn != kAudioObjectUnknown) watch_one(watchIn, kAudioDevicePropertyNominalSampleRate, add);
  if (watchOut != kAudioObjectUnknown && watchOut != watchIn) watch_one(watchOut, kAudioDevicePropertyNominalSampleRate, add);
  if (watchInDefault) watch_one(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultInputDevice, add);
  if (watchOutDefault) watch_one(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultOutputDevice, add);
}

static void fail(const char* what, OSStatus st) {
  snprintf(lastError, sizeof lastError, "%s (%d)", what, (int)st);
}

static AudioDeviceID device_for_uid(const char* uid) {
  if (!uid || !uid[0]) return kAudioObjectUnknown;
  CFStringRef s = CFStringCreateWithCString(NULL, uid, kCFStringEncodingUTF8);
  AudioDeviceID id = kAudioObjectUnknown;
  AudioValueTranslation tr = { &s, sizeof s, &id, sizeof id };
  AudioObjectPropertyAddress a = { kAudioHardwarePropertyDeviceForUID, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  UInt32 sz = sizeof tr;
  AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, NULL, &sz, &tr);
  CFRelease(s);
  return id;
}

static AudioDeviceID default_device(int playback) {
  AudioDeviceID id = kAudioObjectUnknown;
  AudioObjectPropertyAddress a = { playback ? kAudioHardwarePropertyDefaultOutputDevice : kAudioHardwarePropertyDefaultInputDevice,
                                   kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  UInt32 sz = sizeof id;
  AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, NULL, &sz, &id);
  return id;
}

static OSStatus input_cb(void* ref, AudioUnitRenderActionFlags* flags, const AudioTimeStamp* ts, UInt32 bus, UInt32 frames, AudioBufferList* unused) {
  (void)unused;
  om_duplex* d = (om_duplex*)ref;
  if (frames > d->inCap) return noErr; // never expected; drop rather than overrun
  AudioBufferList list;
  list.mNumberBuffers = 1;
  list.mBuffers[0].mNumberChannels = 1;
  list.mBuffers[0].mDataByteSize = frames * sizeof(int16_t);
  list.mBuffers[0].mData = d->inBuf;
  OSStatus st = AudioUnitRender(d->unit, flags, ts, bus, frames, &list);
  if (st != noErr) return st;
  const int16_t* src = d->inBuf;
  while (frames > 0) {
    ma_uint32 n = frames;
    void* dst;
    if (ma_pcm_rb_acquire_write(&d->cap->rb, &n, &dst) != MA_SUCCESS || n == 0) { d->cap->overruns++; break; }
    memcpy(dst, src, (size_t)n * sizeof(int16_t));
    ma_pcm_rb_commit_write(&d->cap->rb, n);
    src += n;
    frames -= n;
  }
  return noErr;
}

static OSStatus render_cb(void* ref, AudioUnitRenderActionFlags* flags, const AudioTimeStamp* ts, UInt32 bus, UInt32 frames, AudioBufferList* io) {
  (void)flags; (void)ts; (void)bus;
  om_duplex* d = (om_duplex*)ref;
  int16_t* dst = (int16_t*)io->mBuffers[0].mData;
  const int ch = d->play->channels;
  while (frames > 0) {
    ma_uint32 n = frames;
    void* src;
    if (ma_pcm_rb_acquire_read(&d->play->rb, &n, &src) != MA_SUCCESS || n == 0) {
      memset(dst, 0, (size_t)frames * (size_t)ch * sizeof(int16_t));
      d->play->underruns++;
      return noErr;
    }
    memcpy(dst, src, (size_t)n * (size_t)ch * sizeof(int16_t));
    ma_pcm_rb_commit_read(&d->play->rb, n);
    dst += n * ch;
    frames -= n;
  }
  return noErr;
}

om_duplex* om_open_duplex(int inIndex, int outIndex, int rate, int ringMs, int prefillMs, int bypass, om_stream** cap, om_stream** play) {
  lastError[0] = 0;
  om_duplex* d = (om_duplex*)calloc(1, sizeof(om_duplex));
  if (!d) return NULL;
  char uid[256];
  d->inDefault = inIndex < 0;
  d->outDefault = outIndex < 0;
  om_device_uid(0, inIndex, uid, sizeof uid);
  d->inDev = d->inDefault ? default_device(0) : device_for_uid(uid);
  om_device_uid(1, outIndex, uid, sizeof uid);
  d->outDev = d->outDefault ? default_device(1) : device_for_uid(uid);
  if (d->inDev == kAudioObjectUnknown || d->outDev == kAudioObjectUnknown) { fail("device not found", 0); free(d); return NULL; }

  AudioComponentDescription desc = { kAudioUnitType_Output, kAudioUnitSubType_VoiceProcessingIO, kAudioUnitManufacturer_Apple, 0, 0 };
  AudioComponent comp = AudioComponentFindNext(NULL, &desc);
  if (!comp) { fail("no voice processing unit", 0); free(d); return NULL; }
  OSStatus st = AudioComponentInstanceNew(comp, &d->unit);
  if (st != noErr) { fail("instance", st); free(d); return NULL; }

  UInt32 one = 1;
  if ((st = AudioUnitSetProperty(d->unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &one, sizeof one)) != noErr) { fail("enable input", st); goto bad; }
  if ((st = AudioUnitSetProperty(d->unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0, &one, sizeof one)) != noErr) { fail("enable output", st); goto bad; }
  if (bypass) {
    // Voice Isolation still applies with the processing bypassed; the echo canceller, the
    // gain control and the noise suppressor do not. For headphones, and for measuring.
    UInt32 b = 1;
    AudioUnitSetProperty(d->unit, kAUVoiceIOProperty_BypassVoiceProcessing, kAudioUnitScope_Global, 0, &b, sizeof b);
  }
  // The microphone on the input element, the speaker on the output one: the unit builds
  // what it needs to run both from one clock.
  if ((st = AudioUnitSetProperty(d->unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 1, &d->inDev, sizeof d->inDev)) != noErr) { fail("input device", st); goto bad; }
  if ((st = AudioUnitSetProperty(d->unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &d->outDev, sizeof d->outDev)) != noErr) { fail("output device", st); goto bad; }

  AudioStreamBasicDescription capFmt = { (Float64)rate, kAudioFormatLinearPCM, kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked, 2, 1, 2, 1, 16, 0 };
  AudioStreamBasicDescription playFmt = { (Float64)rate, kAudioFormatLinearPCM, kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked, 4, 1, 4, 2, 16, 0 };
  if ((st = AudioUnitSetProperty(d->unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &capFmt, sizeof capFmt)) != noErr) { fail("capture format", st); goto bad; }
  if ((st = AudioUnitSetProperty(d->unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &playFmt, sizeof playFmt)) != noErr) { fail("playback format", st); goto bad; }

  d->cap = om_stream_ring(0, 1, rate, ringMs);
  d->play = om_stream_ring(1, 2, rate, ringMs);
  if (!d->cap || !d->play) { fail("ring", 0); goto bad; }
  d->inCap = 8192;
  d->inBuf = (int16_t*)calloc(d->inCap, sizeof(int16_t));
  if (prefillMs > 0) {
    ma_uint32 n = (ma_uint32)(rate * prefillMs / 1000);
    while (n > 0) {
      ma_uint32 got = n;
      void* dst;
      if (ma_pcm_rb_acquire_write(&d->play->rb, &got, &dst) != MA_SUCCESS || got == 0) break;
      memset(dst, 0, (size_t)got * 2 * sizeof(int16_t));
      ma_pcm_rb_commit_write(&d->play->rb, got);
      n -= got;
    }
  }

  AURenderCallbackStruct rc = { render_cb, d };
  if ((st = AudioUnitSetProperty(d->unit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &rc, sizeof rc)) != noErr) { fail("render callback", st); goto bad; }
  AURenderCallbackStruct ic = { input_cb, d };
  if ((st = AudioUnitSetProperty(d->unit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 1, &ic, sizeof ic)) != noErr) { fail("input callback", st); goto bad; }
  if ((st = AudioUnitInitialize(d->unit)) != noErr) { fail("initialize", st); goto bad; }
  if ((st = AudioOutputUnitStart(d->unit)) != noErr) { fail("start", st); goto bad; }
  *cap = d->cap;
  *play = d->play;
  return d;
bad:
  om_stream_free_ring(d->cap);
  om_stream_free_ring(d->play);
  free(d->inBuf);
  AudioComponentInstanceDispose(d->unit);
  free(d);
  return NULL;
}

// The devices as opened, either path: resolve them once and listen.
int om_watch(int inIndex, int outIndex) {
  om_unwatch();
  char uid[256];
  watchInDefault = inIndex < 0;
  watchOutDefault = outIndex < 0;
  om_device_uid(0, inIndex, uid, sizeof uid);
  watchIn = watchInDefault ? default_device(0) : device_for_uid(uid);
  om_device_uid(1, outIndex, uid, sizeof uid);
  watchOut = watchOutDefault ? default_device(1) : device_for_uid(uid);
  atomic_store(&devicesChanged, 0);
  watch_all(1);
  watching = 1;
  return 0;
}

void om_unwatch(void) {
  if (!watching) return;
  watch_all(0);
  watching = 0;
}

int om_devices_changed(void) { return atomic_exchange(&devicesChanged, 0) | om_device_event(); }

int om_device_transport(int playback, int index, char* buf, int len) {
  char uid[256];
  if (len > 0) buf[0] = 0;
  if (om_device_uid(playback, index, uid, sizeof uid) != 0) return -1;
  AudioDeviceID id = device_for_uid(uid);
  if (id == kAudioObjectUnknown) return -1;
  UInt32 tt = 0, sz = sizeof tt;
  AudioObjectPropertyAddress a = { kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  if (AudioObjectGetPropertyData(id, &a, 0, NULL, &sz, &tt) != noErr || len < 5) return -1;
  buf[0] = (char)(tt >> 24); buf[1] = (char)(tt >> 16); buf[2] = (char)(tt >> 8); buf[3] = (char)tt; buf[4] = 0;
  return 0;
}

void om_close_duplex(om_duplex* d) {
  if (!d) return;
  AudioOutputUnitStop(d->unit);
  AudioUnitUninitialize(d->unit);
  AudioComponentInstanceDispose(d->unit);
  om_stream_free_ring(d->cap);
  om_stream_free_ring(d->play);
  free(d->inBuf);
  free(d);
}
