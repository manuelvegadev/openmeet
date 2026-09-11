# miniaudio, and the one thing we changed in it

`miniaudio.h` is vendored verbatim except for the edits marked `/* OpenMeet patch */`, all of
which add **one** feature: `ma_device_config.wasapi.voiceCommunications`.

Setting it opens the WASAPI stream in `AudioCategory_Communications` instead of
`AudioCategory_Other`. That is the switch Windows reads to apply the endpoint driver's
communications processing — echo cancellation, noise suppression, gain — and Windows Studio
Effects on machines with an NPU. It is the nearest thing Windows has to the Voice Processing
I/O unit we use on macOS (`vpio_darwin.c`), and it is what the app's *Audio Processing*
setting turns on there.

It cannot be done from outside miniaudio: `IAudioClient2::SetClientProperties` must be called
after the client is created and **before** `Initialize`, and miniaudio owns both. It only
touched client properties inside its hardware-offloading branch, which almost never runs.

The edits, should miniaudio ever be upgraded (grep `OpenMeet patch`, eight places):

1. `MA_AudioCategory_Communications = 3` added to the category enum.
2. `voiceCommunications` on `ma_device_config.wasapi`.
3. `voiceCommunications` on `ma_device.wasapi` (so a stream reroute keeps it).
4. `voiceCommunications` on `ma_device_init_internal_data__wasapi`.
5. The `SetClientProperties` call itself, in `ma_device_init_internal__wasapi`.
6-8. The field copied through at the four places its neighbours are copied.

Nothing else in the file is ours.
