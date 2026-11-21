/* SPDX-License-Identifier: GPL-3.0-or-later */
#include <espeak-ng/speak_lib.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static int16_t *pcm;
static size_t length, capacity;
static int rate, failed;

static int collect(short *samples, int count, espeak_EVENT *events) {
  (void)events;
  if (!samples || count <= 0) return 0;
  size_t needed = length + (size_t)count;
  /* Bound memory even for pathological input. Never return truncated audio. */
  if (needed > (size_t)rate * 300) { failed = 1; return 1; }
  if (needed > capacity) {
    size_t next = needed * 2;
    int16_t *replacement = realloc(pcm, next * sizeof(*pcm));
    if (!replacement) { failed = 1; return 1; }
    pcm = replacement;
    capacity = next;
  }
  memcpy(pcm + length, samples, (size_t)count * sizeof(*pcm));
  length = needed;
  return 0;
}

int speech_init(void) {
  rate = espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, "/speech", espeakINITIALIZE_DONT_EXIT);
  if (rate <= 0 || espeak_SetVoiceByName("en-us") != EE_OK) return 0;
  espeak_SetSynthCallback(collect);
  espeak_SetParameter(espeakRATE, 175, 0);
  espeak_SetParameter(espeakPITCH, 50, 0);
  return rate;
}

int speech_synthesize(const char *text) {
  length = 0;
  failed = 0;
  /* Plain UTF-8: punctuation and capitalization remain meaningful; no SSML. */
  espeak_ERROR result = espeak_Synth(text, strlen(text) + 1, 0, POS_CHARACTER,
    0, espeakCHARS_UTF8 | espeakENDPAUSE, NULL, NULL);
  return result == EE_OK && !failed && length > 0;
}

int16_t *speech_pcm(void) { return pcm; }
int speech_length(void) { return (int)length; }
