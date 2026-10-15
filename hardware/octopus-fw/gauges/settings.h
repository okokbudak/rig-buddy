#pragma once
// Board settings that the PC (Rig Buddy Studio, "Board" page) uploads: per motor socket and the display.
// They live in RAM (S) and, after "CFG SAVE", in the last flash sector (sector 7, 0x08060000, 128 KiB),
// far above the firmware (which starts at 0x08008000 and is ~60 KiB). A firmware update over DFU or
// the SD card only erases the sectors the new firmware occupies, so the settings survive it.
// Without valid saved settings the board starts with the defaults below (= the values in config.h).
#include "config.h"

struct MotorSettings {
  uint8_t  enabled;        // 1: driver powered, takes its field of the data line
  uint8_t  dirInvert;      // 1: reverse the rotation
  uint16_t microsteps;     // 1..256, a power of two
  uint16_t runMa;          // RMS mA while moving
  uint8_t  holdPct;        // holding current, % of runMa
  uint8_t  homeOnBoot;     // 1: find the mechanical stop with StallGuard at power-up
  uint16_t stepsPerRev;    // full steps per motor turn (200 = 1.8 deg, 400 = 0.9 deg)
  uint16_t sweepDeg10;     // needle travel from the first to the last mark, 0.1 deg (2400 = 240 deg)
  uint32_t fullScale;      // data value that puts the needle on the last mark
  uint16_t maxDegS;        // needle speed limit, deg/s
  uint16_t accDegS2;       // acceleration, deg/s^2
  uint8_t  sgthrs;         // StallGuard threshold for homing
  uint8_t  reserved;
  int16_t  homeOffset10;   // 0.1 deg from the mechanical stop to the dial's zero mark: after the stall the needle goes
                           // this far clockwise and that spot becomes 0 (was reserved[3], zero in older saved settings)
};
static_assert(sizeof(MotorSettings) == 24, "settings v1/v2 saved by older firmware must keep their layout");

// The LED chain on PB0: split into segments (start pixel, length, colour); pixels in no segment stay dark.
struct LedSeg { uint8_t start, len, r, g, b, on; };
struct LedSettings {
  uint8_t count;           // pixels (ICs) in the chain, 1..LED_MAX_PIXELS
  uint8_t order;           // colour order on the wire (see config.h)
  uint8_t bri;             // overall brightness 0..255
  uint8_t nseg;            // segments in use
  LedSeg  seg[LED_MAX_SEGS];   // later segments paint over earlier ones
};

struct Settings {
  uint32_t magic;
  uint16_t version;
  uint16_t size;
  MotorSettings m[N_MOTORS];
  uint8_t  nxEnabled;      // 1: the Nextion tunnel on the TFT connector is on
  uint8_t  reserved[3];
  uint32_t nxBaud;
  LedSettings led;         // since settings version 2
  uint32_t crc;            // CRC-32 of everything above
};

// Version 1 had no LED block. Firmware 1.2 still reads it (the LED settings then start from the defaults).
struct SettingsV1 {
  uint32_t magic;
  uint16_t version;
  uint16_t size;
  MotorSettings m[N_MOTORS];
  uint8_t  nxEnabled;
  uint8_t  reserved[3];
  uint32_t nxBaud;
  uint32_t crc;
};
static_assert(offsetof(SettingsV1, crc) == offsetof(Settings, led), "version 2 only appends the LED block");

constexpr uint32_t SETTINGS_MAGIC = 0x4F435447;  // "OCTG"
constexpr uint16_t SETTINGS_VERSION = 2;
constexpr uint32_t SETTINGS_ADDR = 0x08060000;   // flash sector 7 of the STM32F446ZE
constexpr uint32_t SETTINGS_SECTOR = FLASH_SECTOR_7;

static Settings S;                               // what the board runs with right now
static float uPerDeg[N_MOTORS];                  // microsteps per degree, from S
static int32_t sweepU[N_MOTORS];                 // microsteps from the first to the last mark, from S

static uint32_t crc32(const uint8_t* d, uint32_t n) {
  uint32_t c = 0xFFFFFFFF;
  while (n--) {
    c ^= *d++;
    for (uint8_t k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1)));
  }
  return ~c;
}
static uint32_t settingsCrc(const Settings& s) { return crc32((const uint8_t*)&s, offsetof(Settings, crc)); }

static void ledDefaults(LedSettings& l) {
  memset(&l, 0, sizeof(l));
  l.count = LED_DEFAULT_COUNT;
  l.order = LED_DEFAULT_ORDER;
  l.bri = 255;
  l.nseg = LED_DEFAULT_SEGMENTS;
  uint8_t at = 0;
  for (uint8_t i = 0; i < LED_DEFAULT_SEGMENTS; i++) {
    l.seg[i] = { at, LED_DEFAULT_SEG_PIXELS[i], LED_DEFAULT_RGB[0], LED_DEFAULT_RGB[1], LED_DEFAULT_RGB[2], 1 };
    at += LED_DEFAULT_SEG_PIXELS[i];
  }
}

static void settingsDefaults(Settings& s) {
  memset(&s, 0, sizeof(s));
  s.magic = SETTINGS_MAGIC;
  s.version = SETTINGS_VERSION;
  s.size = sizeof(Settings);
  for (uint8_t i = 0; i < N_MOTORS; i++) {
    MotorSettings& m = s.m[i];
    m.enabled = 1;
    m.dirInvert = DIR_INVERT[i];
    m.microsteps = MICROSTEPS;
    m.runMa = RUN_MA[i];
    m.holdPct = (uint8_t)(HOLD_FRACTION * 100.0f + 0.5f);
    m.homeOnBoot = HOME_ON_BOOT;
    m.stepsPerRev = FULL_STEPS_PER_REV;
    m.sweepDeg10 = (uint16_t)(SWEEP_DEG * 10.0f + 0.5f);
    m.fullScale = FULLSCALE[i];
    m.maxDegS = (uint16_t)MAX_DEG_S;
    m.accDegS2 = (uint16_t)ACC_DEG_S2;
    m.sgthrs = SGTHRS_DEFAULT;
    m.homeOffset10 = (int16_t)(HOME_BACKOFF_DEG * 10.0f + 0.5f);
  }
  s.nxEnabled = 1;
  s.nxBaud = NEXTION_BAUD;
  ledDefaults(s.led);
  s.crc = settingsCrc(s);
}

static bool settingsValid(const Settings& s) {
  return s.magic == SETTINGS_MAGIC && s.version == SETTINGS_VERSION && s.size == sizeof(Settings) && s.crc == settingsCrc(s);
}

/** The saved copy in flash, or false when there is none (or it is damaged). */
static bool settingsFromFlash(Settings& out) {
  const Settings* f = (const Settings*)SETTINGS_ADDR;
  if (settingsValid(*f)) {
    memcpy(&out, f, sizeof(Settings));
    return true;
  }
  const SettingsV1* o = (const SettingsV1*)SETTINGS_ADDR;   // saved by firmware 1.0 / 1.1: take it over
  if (o->magic == SETTINGS_MAGIC && o->version == 1 && o->size == sizeof(SettingsV1) &&
      o->crc == crc32((const uint8_t*)o, offsetof(SettingsV1, crc))) {
    settingsDefaults(out);                                   // the LED block keeps the defaults
    memcpy(&out, o, offsetof(SettingsV1, crc));
    out.version = SETTINGS_VERSION;
    out.size = sizeof(Settings);
    out.crc = settingsCrc(out);
    return true;
  }
  return false;
}

static bool settingsLoad() {
  if (settingsFromFlash(S)) return true;
  settingsDefaults(S);
  return false;
}

/** Erases sector 7 and writes S. The CPU stalls for ~1-2 s while the sector is erased. */
static bool settingsSave() {
  S.magic = SETTINGS_MAGIC;
  S.version = SETTINGS_VERSION;
  S.size = sizeof(Settings);
  S.crc = settingsCrc(S);
  HAL_FLASH_Unlock();
  __HAL_FLASH_CLEAR_FLAG(FLASH_FLAG_EOP | FLASH_FLAG_OPERR | FLASH_FLAG_WRPERR | FLASH_FLAG_PGAERR | FLASH_FLAG_PGPERR | FLASH_FLAG_PGSERR);
  FLASH_EraseInitTypeDef er = {};
  er.TypeErase = FLASH_TYPEERASE_SECTORS;
  er.Sector = SETTINGS_SECTOR;
  er.NbSectors = 1;
  er.VoltageRange = FLASH_VOLTAGE_RANGE_3;
  uint32_t bad = 0;
  bool ok = HAL_FLASHEx_Erase(&er, &bad) == HAL_OK;
  const uint32_t* w = (const uint32_t*)&S;
  for (uint32_t k = 0; ok && k < (sizeof(Settings) + 3) / 4; k++) {
    ok = HAL_FLASH_Program(FLASH_TYPEPROGRAM_WORD, SETTINGS_ADDR + 4 * k, w[k]) == HAL_OK;
  }
  HAL_FLASH_Lock();
  return ok && memcmp((const void*)SETTINGS_ADDR, &S, sizeof(Settings)) == 0;
}

/** true when RAM equals what is saved in flash. */
static bool settingsSaved() {
  Settings f;
  if (!settingsFromFlash(f)) return false;
  Settings r = S;
  r.crc = settingsCrc(r);
  return memcmp(&f, &r, sizeof(Settings)) == 0;
}

static void settingsDerive(uint8_t i) {
  const MotorSettings& m = S.m[i];
  uPerDeg[i] = (float)m.stepsPerRev * m.microsteps / 360.0f;
  sweepU[i] = (int32_t)(m.sweepDeg10 / 10.0f * uPerDeg[i] + 0.5f);
}
