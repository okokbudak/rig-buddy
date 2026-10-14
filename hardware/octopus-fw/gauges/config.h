#pragma once
// ETS2 analog dashboard firmware for the BTT Octopus Pro V1.0 / V1.0.1 (STM32F446ZET6).
// Pins: Klipper's generic-bigtreetech-octopus-pro-v1.0.cfg (NOT V1.1: MOTOR3 EN is PA0 here, HE0 is PA2).
// All user-tunable settings live in this file.
#include <Arduino.h>

#define FW_VERSION "1.0"

constexpr uint8_t N_MOTORS = 6;

struct MotorPins { uint32_t step, dir, en, uart, diag; };

// MOTOR0..MOTOR5 sockets: 0 RPM, 1 TURBO, 2 AIR, 3 SPEED, 4 ADBLUE, 5 FUEL
const MotorPins MOTOR[N_MOTORS] = {
  { PF13, PF12, PF14, PC4,  PG6  },   // MOTOR0  RPM
  { PG0,  PG1,  PF15, PD11, PG9  },   // MOTOR1  TURBO
  { PF11, PG3,  PG5,  PC6,  PG10 },   // MOTOR2  AIR
  { PG4,  PC1,  PA0,  PC7,  PG11 },   // MOTOR3  SPEED  (EN = PA0 on V1.0; PA2 is HE0 here!)
  { PF9,  PF10, PG2,  PF2,  PG12 },   // MOTOR4  ADBLUE
  { PC13, PF0,  PF1,  PE4,  PG13 },   // MOTOR5  FUEL
};
const char* const NAME[N_MOTORS] = { "RPM", "TURBO", "AIR", "SPEED", "ADBLUE", "FUEL" };

// Value of each serial field at full scale. The host sends PLAIN INTEGERS, one line per update:
//   rpm,turbo,air,speed,adblue,fuel\n
//   rpm 0..3000 | turbo = bar x1000 | air = bar x100 | speed = km/h x10 | adblue = % x10 | fuel = % x10
const long FULLSCALE[N_MOTORS] = { 3000, 3000, 1200, 1200, 1000, 1000 };

// ---- motors (NEMA17 pancake "41ME3991AL", 21 ohm per coil, rated current unknown: start low!) ----
constexpr uint16_t FULL_STEPS_PER_REV = 200;     // 1.8 deg motors. If the needle only covers half the dial, use 400.
constexpr uint8_t  MICROSTEPS = 16;              // TMC2209 interpolates this to 256 internally
constexpr float    SWEEP_DEG = 240.0f;           // dial: first tick -120 deg .. last tick +120 deg
constexpr float    USTEPS_PER_DEG = (float)FULL_STEPS_PER_REV * MICROSTEPS / 360.0f;
constexpr int32_t  SWEEP_USTEPS = (int32_t)(SWEEP_DEG * USTEPS_PER_DEG + 0.5f);

// positive direction = needle clockwise (up the scale). Flip a motor with the D command, then set it here.
bool DIR_INVERT[N_MOTORS] = { true, true, true, true, false, true };

uint16_t RUN_MA[N_MOTORS] = { 500, 500, 500, 500, 500, 500 };   // RMS mA while moving (21 ohm coils: keep low)
constexpr float HOLD_FRACTION = 0.30f;           // holding current = this fraction of RUN_MA
constexpr float R_SENSE = 0.11f;                 // ohm, sense resistor of the TMC2209 modules (0.11 on BTT/Watterott)

constexpr float MAX_DEG_S = 500.0f;              // needle speed limit, degrees per second
constexpr float ACC_DEG_S2 = 5000.0f;            // acceleration, degrees per second^2
constexpr int32_t DEADBAND_USTEPS = 2;           // ignore target changes smaller than this

// ---- homing: StallGuard against the mechanical stop at the 0 tick ----
constexpr bool    HOME_ON_BOOT = false;          // false: needles are assumed to be at 0 at power-up
constexpr uint8_t SGTHRS_DEFAULT = 40;           // 0..255, higher = triggers earlier. TUNE with the G/H commands.
constexpr float   HOME_DEG_S = 360.0f;           // speed towards the stop (StallGuard needs some speed)
constexpr uint16_t HOME_BLANK_MS = 150;          // ignore DIAG this long after starting (acceleration)
constexpr float   HOME_BACKOFF_DEG = 0.5f;       // after the stall, rest this far off the stop
constexpr float   HOME_MAX_DEG = SWEEP_DEG + 40.0f;   // give up after this much travel without a stall

// ---- Nextion display on the TFT connector (5V, GND, TX, RX): USART1 ----
constexpr uint32_t NEXTION_TX = PA9;             // board TX -> display RX
constexpr uint32_t NEXTION_RX = PA10;            // board RX <- display TX
constexpr uint32_t NEXTION_BAUD = 115200;        // what the display runs at (Rig Buddy Studio uses the same)

// ---- internals ----
constexpr uint32_t TICK_HZ = 20000;              // step generator rate (max 20 kHz step rate per motor)
constexpr uint32_t TMC_BAUD = 115200;            // bit-banged single-wire UART to the TMC2209
constexpr uint16_t PARSE_INTERVAL_MS = 20;       // apply at most 50 data lines per second (keep the newest)
