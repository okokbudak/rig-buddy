#pragma once
// Step generator: a fixed-rate timer interrupt runs a trapezoidal velocity profile for every motor.
// Positions are in microsteps; positive = needle clockwise (after DIR_INVERT).
#include "settings.h"

struct Axis {
  volatile int32_t pos = 0;
  volatile int32_t target = 0;
  float v = 0;                 // steps/s, signed (interrupt only)
  float acc = 0;               // fractional step accumulator (interrupt only)
  float vmax = 0, accel = 0;   // steps/s and steps/s^2
  GPIO_TypeDef* stepPort = nullptr; uint32_t stepMask = 0;
  GPIO_TypeDef* dirPort = nullptr;  uint32_t dirMask = 0;
  int8_t lastDir = 0;
  bool stepHigh = false;
};

static Axis ax[N_MOTORS];
static HardwareTimer* motionTimer = nullptr;

static void motionTick() {
  constexpr float dt = 1.0f / TICK_HZ;
  for (uint8_t i = 0; i < N_MOTORS; i++) {            // end the previous step pulses first
    Axis& a = ax[i];
    if (a.stepHigh) { a.stepPort->BSRR = a.stepMask << 16; a.stepHigh = false; }
  }
  for (uint8_t i = 0; i < N_MOTORS; i++) {
    Axis& a = ax[i];
    int32_t d = a.target - a.pos;
    if (d == 0) { a.v = 0; a.acc = 0; continue; }
    float want = sqrtf(2.0f * a.accel * (float)labs(d));     // fastest speed from which we can still stop in time
    if (want > a.vmax) want = a.vmax;
    if (d < 0) want = -want;
    float dv = a.accel * dt;
    if (a.v < want - dv) a.v += dv; else if (a.v > want + dv) a.v -= dv; else a.v = want;
    a.acc += fabsf(a.v) * dt;
    if (a.acc >= 1.0f) {
      a.acc -= 1.0f;
      if (a.acc > 1.0f) a.acc = 1.0f;                         // at most one step per tick
      int8_t dir = (a.v >= 0) ? 1 : -1;
      if (dir != a.lastDir) {
        bool level = (dir > 0) != (bool)S.m[i].dirInvert;
        if (level) a.dirPort->BSRR = a.dirMask; else a.dirPort->BSRR = a.dirMask << 16;
        a.lastDir = dir;
        for (uint8_t k = 0; k < 12; k++) __NOP();             // DIR setup time before STEP
      }
      a.stepPort->BSRR = a.stepMask;
      a.stepHigh = true;
      a.pos += dir;
    }
  }
}

static void motionInit() {
  for (uint8_t i = 0; i < N_MOTORS; i++) {
    Axis& a = ax[i];
    pinMode(MOTOR[i].step, OUTPUT); digitalWrite(MOTOR[i].step, LOW);
    pinMode(MOTOR[i].dir, OUTPUT);  digitalWrite(MOTOR[i].dir, LOW);
    a.stepPort = digitalPinToPort(MOTOR[i].step); a.stepMask = digitalPinToBitMask(MOTOR[i].step);
    a.dirPort = digitalPinToPort(MOTOR[i].dir);   a.dirMask = digitalPinToBitMask(MOTOR[i].dir);
    a.vmax = S.m[i].maxDegS * uPerDeg[i];
    a.accel = S.m[i].accDegS2 * uPerDeg[i];
    a.lastDir = 0;
  }
  motionTimer = new HardwareTimer(TIM6);
  motionTimer->setOverflow(TICK_HZ, HERTZ_FORMAT);
  motionTimer->attachInterrupt(motionTick);
  motionTimer->resume();
}

static inline void setTarget(uint8_t i, int32_t t) { ax[i].target = t; }
static inline int32_t getPos(uint8_t i) { return ax[i].pos; }
static inline int32_t getTarget(uint8_t i) { return ax[i].target; }

static void setPosition(uint8_t i, int32_t p) {           // declare "the needle is here"
  noInterrupts();
  ax[i].pos = p; ax[i].target = p; ax[i].v = 0; ax[i].acc = 0;
  interrupts();
}

static void haltAxis(uint8_t i) {                         // stop at once
  noInterrupts();
  ax[i].target = ax[i].pos; ax[i].v = 0; ax[i].acc = 0;
  interrupts();
}

static void setLimits(uint8_t i, float degPerSec, float degPerSec2) {
  noInterrupts();
  ax[i].vmax = degPerSec * uPerDeg[i];
  ax[i].accel = degPerSec2 * uPerDeg[i];
  interrupts();
}
