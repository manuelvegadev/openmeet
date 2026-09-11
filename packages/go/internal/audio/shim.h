#ifndef OM_SHIM_H
#define OM_SHIM_H
#include <stdint.h>
typedef struct om_stream om_stream;
int om_init(void);
int om_refresh(void);
int om_device_count(int playback);
int om_device_name(int playback, int index, char* buf, int len, int* isDefault);
om_stream* om_open(int playback, int deviceIndex, int channels, int rate, int periodMs, int ringMs, int prefillMs);
int om_rate(om_stream* s);
int om_available(om_stream* s);
int om_underruns(om_stream* s);
int om_read(om_stream* s, int16_t* out, int frames);
int om_write(om_stream* s, const int16_t* in, int frames);
void om_close(om_stream* s);
#endif
