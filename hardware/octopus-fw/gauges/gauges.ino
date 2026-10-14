// ETS2 analog dashboard firmware, BTT Octopus Pro V1.0 / V1.0.1 (STM32F446ZET6).
// Six NEMA17 gauge motors on MOTOR0..MOTOR5 (TMC2209, UART mode) and a Nextion display on the TFT
// connector, all fed over USB CDC by Rig Buddy Studio (or SimHub's Custom Serial device):
//   data line   "v0,v1,...\n"   plain integers, field n drives MOTORn (fewer fields: the rest stay put);
//                               the value fullScale (per motor) puts the needle on its last mark;
//                               field 7 (after the six motors) is the power output FAN0: 1 on, 0 off
//   "@<cmd>\n"                  a Nextion command (see the tunnel below)
//   anything else               a text command (see README.md); "?" answers "OCTOPUS-GAUGES <version> motors=6 cfg=1"
// Per-motor settings (direction, current, steps, sweep, scale, speed...) come from settings.h: the PC
// uploads them with "CFG ..." commands and "CFG SAVE" keeps them in flash.
#include "config.h"
#include "settings.h"
#include "tmc_uart.h"
#include "motion.h"

static void dfuCheck();

// ---- clock: 180 MHz from the 12 MHz crystal, 48 MHz USB from PLLSAI, HSI fallback (needs -DHSE_VALUE=12000000UL) ----
// The core calls this from premain() -> init(), after HAL_Init() and BEFORE it starts USB, so it is also
// the earliest reliable place to hand the chip to the ROM DFU bootloader. (A constructor is not: the
// linker does not keep constructor priorities, so premain() - which starts USB - may run first.)
extern "C" void SystemClock_Config(void) {
  dfuCheck();
  RCC_OscInitTypeDef osc = {};
  RCC_ClkInitTypeDef clk = {};
  RCC_PeriphCLKInitTypeDef per = {};
  __HAL_RCC_PWR_CLK_ENABLE();
  __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE1);
  bool hse = true;
  osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState = RCC_HSE_ON;
  osc.PLL.PLLState = RCC_PLL_ON;
  osc.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLM = 6; osc.PLL.PLLN = 180; osc.PLL.PLLP = RCC_PLLP_DIV2; osc.PLL.PLLQ = 8; osc.PLL.PLLR = 2;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) {
    hse = false;
    osc = {};
    osc.OscillatorType = RCC_OSCILLATORTYPE_HSI;
    osc.HSIState = RCC_HSI_ON;
    osc.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
    osc.PLL.PLLState = RCC_PLL_ON;
    osc.PLL.PLLSource = RCC_PLLSOURCE_HSI;
    osc.PLL.PLLM = 8; osc.PLL.PLLN = 180; osc.PLL.PLLP = RCC_PLLP_DIV2; osc.PLL.PLLQ = 8; osc.PLL.PLLR = 2;
    if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();
  }
  if (HAL_PWREx_EnableOverDrive() != HAL_OK) Error_Handler();
  clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLRCLK;
  clk.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV4;
  clk.APB2CLKDivider = RCC_HCLK_DIV2;
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_5) != HAL_OK) Error_Handler();
  per.PeriphClockSelection = RCC_PERIPHCLK_SDIO | RCC_PERIPHCLK_CLK48;
  per.PLLSAI.PLLSAIM = hse ? 12 : 16;
  per.PLLSAI.PLLSAIN = 192; per.PLLSAI.PLLSAIQ = 2; per.PLLSAI.PLLSAIP = RCC_PLLSAIP_DIV4;
  per.PLLSAIDivQ = 1;
  per.Clk48ClockSelection = RCC_CLK48CLKSOURCE_PLLSAIP;
  per.SdioClockSelection = RCC_SDIOCLKSOURCE_CLK48;
  if (HAL_RCCEx_PeriphCLKConfig(&per) != HAL_OK) Error_Handler();
}

// ---- TMC2209 drivers ----
static TmcUart tmc[N_MOTORS];
static bool tmcOk[N_MOTORS];
static uint8_t tmcVersion[N_MOTORS];
static bool driversEnabled = false;
static bool drvOn[N_MOTORS];

static uint32_t chopconfFor(bool vsense, uint16_t microsteps) {
  uint32_t mres = 4;
  switch (microsteps) { case 256: mres = 0; break; case 128: mres = 1; break; case 64: mres = 2; break;
    case 32: mres = 3; break; case 16: mres = 4; break; case 8: mres = 5; break; case 4: mres = 6; break;
    case 2: mres = 7; break; case 1: mres = 8; break; }
  return (0x10000053u & ~(0xFu << 24)) | (mres << 24) | (vsense ? (1u << 17) : 0);   // intpol on, toff 3
}

static void tmcSetCurrent(uint8_t i) {                 // same method as TMCStepper::rms_current
  const MotorSettings& m = S.m[i];
  float a = m.runMa / 1000.0f;
  int cs = (int)(32.0f * 1.41421f * a * (R_SENSE + 0.02f) / 0.325f - 1.0f);
  bool vs = false;
  if (cs < 16) { vs = true; cs = (int)(32.0f * 1.41421f * a * (R_SENSE + 0.02f) / 0.180f - 1.0f); }
  cs = constrain(cs, 0, 31);
  uint8_t hold = (uint8_t)constrain((int)(cs * m.holdPct / 100), 0, 31);
  tmc[i].write(REG_CHOPCONF, chopconfFor(vs, m.microsteps));
  tmc[i].write(REG_IHOLD_IRUN, (uint32_t)hold | ((uint32_t)cs << 8) | (8UL << 16));
}

static void tmcInit(uint8_t i) {
  tmc[i].begin(MOTOR[i].uart);
  tmc[i].write(REG_GCONF, (1u << 6) | (1u << 7) | (1u << 8));   // pdn_disable (pin is UART), mstep_reg_select, multistep_filt
  tmc[i].write(REG_TPOWERDOWN, 20);
  tmc[i].write(REG_TPWMTHRS, 0);                                 // stealthChop at every speed
  tmc[i].write(REG_PWMCONF, 0xC10D0024u);
  tmc[i].write(REG_TCOOLTHRS, 0);
  tmc[i].write(REG_SGTHRS, 0);
  tmcSetCurrent(i);
  uint32_t ioin = 0;
  tmcOk[i] = false;
  if (tmc[i].read(REG_IOIN, ioin)) { tmcVersion[i] = (uint8_t)(ioin >> 24); tmcOk[i] = (tmcVersion[i] == 0x21); }
}

// Only drivers that are enabled in the settings AND answered on UART (so their current is really set)
// get powered. Drivers that did not answer are configured again first (24 V may have come after USB).
static void setDrivers(bool on) {
  for (uint8_t i = 0; i < N_MOTORS; i++) {
    if (on && S.m[i].enabled && !tmcOk[i]) tmcInit(i);
    drvOn[i] = on && S.m[i].enabled && tmcOk[i];
    digitalWrite(MOTOR[i].en, drvOn[i] ? LOW : HIGH);   // EN is active low
  }
  driversEnabled = on;
}

// ---- software entry into the STM32 ROM DFU bootloader (no BOOT0 jumper needed) ----
// A magic value in an RTC backup register survives the reset; the check below runs before the core's
// USB is started (see SystemClock_Config), so the ROM bootloader starts from an almost clean chip.
constexpr uint32_t DFU_MAGIC = 0xB007DF00;

static void jumpToDfu() {
  for (uint8_t i = 0; i < N_MOTORS; i++) digitalWrite(MOTOR[i].en, HIGH);   // motors off first
  __HAL_RCC_PWR_CLK_ENABLE();
  PWR->CR |= PWR_CR_DBP;                               // allow writes to the backup domain
  RTC->BKP0R = DFU_MAGIC;
  // The backup domain is written through a slow path: a reset right after the write can lose it
  // (the board then restarts the gauges instead of the DFU). Wait until it reads back.
  for (uint32_t k = 0; k < 1000000 && RTC->BKP0R != DFU_MAGIC; k++) {}
  __DSB();
  NVIC_SystemReset();
}

static void dfuCheck() {   // first thing in SystemClock_Config: before the core starts USB (see there)
  RCC->APB1ENR |= RCC_APB1ENR_PWREN; (void)RCC->APB1ENR;
  if (RTC->BKP0R != DFU_MAGIC) return;
  PWR->CR |= PWR_CR_DBP;
  RTC->BKP0R = 0;                                      // one shot: the next reset runs the gauges again
  __disable_irq();
  SysTick->CTRL = 0;
  for (uint8_t k = 0; k < 8; k++) { NVIC->ICER[k] = 0xFFFFFFFF; NVIC->ICPR[k] = 0xFFFFFFFF; }
  RCC->CR |= RCC_CR_HSION; while (!(RCC->CR & RCC_CR_HSIRDY)) {}
  RCC->CFGR = 0; while ((RCC->CFGR & RCC_CFGR_SWS) != 0) {}   // the BTT bootloader may have left PLL on
  RCC->CR &= ~(RCC_CR_PLLON | RCC_CR_PLLSAION | RCC_CR_HSEON);
  RCC->APB2ENR |= RCC_APB2ENR_SYSCFGEN; (void)RCC->APB2ENR;
  SYSCFG->MEMRMP = SYSCFG_MEMRMP_MEM_MODE_0;           // system memory at 0x00000000
  const uint32_t sys = 0x1FFF0000;
  SCB->VTOR = sys;
  __set_MSP(*(volatile uint32_t*)sys);
  __enable_irq();
  ((void (*)(void))(*(volatile uint32_t*)(sys + 4)))();
  while (true) {}
}

// ---- homing against the mechanical stop with StallGuard ----
enum { H_IDLE = 0, H_RUN, H_DONE, H_FAIL };
static uint8_t hstate[N_MOTORS];
static uint32_t hT0[N_MOTORS];

static void homeStart(uint8_t i) {
  tmc[i].write(REG_SGTHRS, S.m[i].sgthrs);
  tmc[i].write(REG_TCOOLTHRS, 0xFFFFF);                          // StallGuard active at every speed
  setLimits(i, HOME_DEG_S, S.m[i].accDegS2);
  setPosition(i, 0);
  hT0[i] = millis();
  hstate[i] = H_RUN;
  setTarget(i, -(int32_t)((S.m[i].sweepDeg10 / 10.0f + 40.0f) * uPerDeg[i]));   // towards the stop
}

static void homeFinish(uint8_t i) {
  tmc[i].write(REG_TCOOLTHRS, 0);
  setLimits(i, S.m[i].maxDegS, S.m[i].accDegS2);
}

static void homeUpdate(uint8_t i) {
  if (hstate[i] != H_RUN) return;
  if (millis() - hT0[i] > HOME_BLANK_MS && digitalRead(MOTOR[i].diag)) {        // DIAG high = stall
    haltAxis(i);
    setPosition(i, -(int32_t)(HOME_BACKOFF_DEG * uPerDeg[i]));                   // the stop sits this far below 0
    setTarget(i, 0);
    homeFinish(i);
    hstate[i] = H_DONE;
  } else if (getPos(i) <= -(int32_t)((S.m[i].sweepDeg10 / 10.0f + 40.0f) * uPerDeg[i])) {   // never stalled
    haltAxis(i);
    setPosition(i, 0);
    homeFinish(i);
    hstate[i] = H_FAIL;
  }
}

// ---- applying changed settings while running ----
static void applyMotor(uint8_t i, const MotorSettings& old) {
  const MotorSettings& m = S.m[i];
  float oldU = uPerDeg[i];
  settingsDerive(i);
  if (uPerDeg[i] != oldU && oldU > 0) {                // keep the needle where it is: rescale the positions
    float k = uPerDeg[i] / oldU;
    noInterrupts();
    ax[i].pos = (int32_t)lroundf(ax[i].pos * k);
    ax[i].target = (int32_t)lroundf(ax[i].target * k);
    ax[i].v = 0; ax[i].acc = 0;
    interrupts();
  }
  if (m.dirInvert != old.dirInvert) ax[i].lastDir = 0;  // re-set DIR before the next step
  setLimits(i, m.maxDegS, m.accDegS2);
  if (m.runMa != old.runMa || m.holdPct != old.holdPct || m.microsteps != old.microsteps) tmcSetCurrent(i);
  if (m.enabled != old.enabled) setDrivers(driversEnabled);
}

// ---- serial input ----
static char rx[512];                                   // Nextion text commands can be long
static uint16_t rxLen = 0;
static bool rxOverflow = false;
static uint32_t nxToDisplay = 0, nxFromDisplay = 0;    // Nextion tunnel counters (see below)
static char ready[128];
static bool pending = false;
static uint32_t lastParse = 0;
static uint8_t testStage = 0;
static uint32_t testT0 = 0;

// ---- power output (FAN0): off until a data line asks for it, off again when the lines stop ----
static bool powerOn = false;
static uint32_t powerAt = 0;                           // when the power field (or the W command) last spoke

static void setPower(bool on) {
  powerOn = on;
  digitalWrite(POWER_PIN, on ? HIGH : LOW);
}

// ---- LED strips (WS2811 protocol, 800 kHz) on PB0, bit-banged with the cycle counter ----
// A frame of 24 ICs takes ~0.7 ms with interrupts off, so it is sent at power-up and then only every
// LED_REFRESH_MS, and not while a needle is moving.
static bool ledColorsChanged = true;
static uint32_t ledAt = 0;

static void ledShow() {
  uint8_t buf[LED_COUNT * 3];
  uint8_t n = 0;
  for (uint8_t s = 0; s < LED_SEGMENTS; s++) {
    for (uint8_t k = 0; k < LED_SEG_PIXELS[s]; k++) {
      const Rgb& c = LED_COLOR[s];
      buf[n++] = LED_ORDER_GRB ? c.g : c.r;
      buf[n++] = LED_ORDER_GRB ? c.r : c.g;
      buf[n++] = c.b;
    }
  }
  const uint32_t period = SystemCoreClock / 800000UL;          // 1.25 us
  const uint32_t hi0 = period * 28 / 100, hi1 = period * 72 / 100;   // 0.35 us / 0.9 us high
  noInterrupts();
  GPIOB->BSRR = (uint32_t)GPIO_PIN_0 << 16;
  uint32_t next = DWT->CYCCNT;
  for (uint8_t i = 0; i < n; i++) {
    for (uint8_t bit = 0x80; bit; bit >>= 1) {
      while ((int32_t)(DWT->CYCCNT - next) < 0) {}
      uint32_t start = next;
      GPIOB->BSRR = GPIO_PIN_0;
      uint32_t hi = (buf[i] & bit) ? hi1 : hi0;
      while ((DWT->CYCCNT - start) < hi) {}
      GPIOB->BSRR = (uint32_t)GPIO_PIN_0 << 16;
      next = start + period;
    }
  }
  interrupts();                                                // the line stays low: the ICs latch after 50 us
  ledColorsChanged = false;
  ledAt = millis();
}

static bool anyNeedleMoving() {
  for (uint8_t i = 0; i < N_MOTORS; i++) if (ax[i].v != 0 || ax[i].pos != ax[i].target) return true;
  return false;
}

static void ledInit() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
  delay(2);
  ledShow();
}

// Field n -> MOTORn; the field after the last motor (field 7) is the power output, 0 or 1. A line with
// fewer fields moves only those motors; a field that is not a plain integer drops the whole line (a broken
// line must never move a needle or switch the head unit).
static void applyData(char* s) {
  long val[N_MOTORS + 1];
  uint8_t count = 0;
  char* tok = strtok(s, ",");
  while (tok && count < N_MOTORS + 1) {
    char* end;
    long v = strtol(tok, &end, 10);
    if (end == tok || (*end != 0 && *end != '\r')) return;
    val[count++] = v;
    tok = strtok(NULL, ",");
  }
  if (count > N_MOTORS) { setPower(val[N_MOTORS] != 0); powerAt = millis(); }
  for (uint8_t i = 0; i < count && i < N_MOTORS; i++) {
    const MotorSettings& m = S.m[i];
    if (!m.enabled || hstate[i] == H_RUN || testStage) continue;
    long v = constrain(val[i], 0L, (long)m.fullScale);
    int32_t t = (int32_t)((int64_t)v * sweepU[i] / (int64_t)m.fullScale);
    if (labs(t - getTarget(i)) >= DEADBAND_USTEPS || t == 0 || t == sweepU[i]) setTarget(i, t);
  }
}

static bool parseMotor(const char*& p, int& first, int& last) {
  if (*p == '*') { first = 0; last = N_MOTORS - 1; p++; return true; }
  if (*p < '0' || *p > '9') return false;
  int n = atoi(p);
  if (n < 0 || n >= N_MOTORS) return false;
  while (*p >= '0' && *p <= '9') p++;
  first = last = n;
  return true;
}

static void say(const char* fmt, ...) {
  char b[200];
  va_list ap; va_start(ap, fmt); vsnprintf(b, sizeof(b), fmt, ap); va_end(ap);
  Serial.println(b);
}

// ---- Nextion tunnel (display on the TFT connector, USART1) ----
// PC -> display:  "@<command>\n"  is sent as <command> FF FF FF (an empty command just ends a half-written one).
// display -> PC:  every frame the display sends (bytes before FF FF FF) comes back as "@<hex>\n".
// The PC (Rig Buddy Studio) keeps all display logic: pages, bindings, touch hotspots.
static Uart NxSerial((pin_size_t)NEXTION_RX, (pin_size_t)NEXTION_TX);   // STM32 core 3.x: "Uart" is the hardware serial class
static uint8_t nxRx[64];
static uint8_t nxLen = 0, nxFF = 0;

static void nextionSend(const char* cmd) {
  if (!S.nxEnabled) return;
  NxSerial.write((const uint8_t*)cmd, strlen(cmd));
  NxSerial.write(0xFF); NxSerial.write(0xFF); NxSerial.write(0xFF);
  nxToDisplay++;
}

static void nextionPoll() {
  static const char HEX_DIGITS[] = "0123456789ABCDEF";
  if (!S.nxEnabled) return;
  while (NxSerial.available()) {
    uint8_t c = NxSerial.read();
    if (c == 0xFF) {
      if (++nxFF < 3) continue;
      char line[2 + 2 * sizeof(nxRx) + 1];
      uint8_t n = 0;
      line[n++] = '@';
      for (uint8_t k = 0; k < nxLen; k++) { line[n++] = HEX_DIGITS[nxRx[k] >> 4]; line[n++] = HEX_DIGITS[nxRx[k] & 15]; }
      line[n] = 0;
      Serial.println(line);
      nxFromDisplay++;
      nxLen = 0; nxFF = 0;
      continue;
    }
    while (nxFF) { nxFF--; if (nxLen < sizeof(nxRx)) nxRx[nxLen++] = 0xFF; }   // FFs that were data after all
    if (nxLen < sizeof(nxRx)) nxRx[nxLen++] = c;
  }
}

static bool nxStarted = false;
static void nextionStart() {
  if (nxStarted) { NxSerial.end(); nxStarted = false; }   // end() only after a begin()
  nxLen = 0; nxFF = 0;
  if (S.nxEnabled) { NxSerial.begin(S.nxBaud); nxStarted = true; }
}

// ---- settings commands: CFG ... ----
//   CFG?                          every setting: "CFG M<n> en=.. dir=.. ..." x6, "CFG NX ...", "CFG END motors=6 saved=0|1"
//   CFG M<n|*> key=value ...      change motor settings (all checked first; nothing changes on an error)
//   CFG NX en=0|1 baud=115200     the display tunnel
//   CFG SAVE                      keep the current settings in flash (survives power-off and firmware updates)
//   CFG LOAD                      back to what is saved;  CFG DEFAULTS  back to the built-in defaults (not saved)
static const uint32_t NX_BAUDS[] = { 9600, 19200, 38400, 57600, 115200, 230400, 250000, 512000, 921600 };

static void cfgDumpMotor(uint8_t i) {
  const MotorSettings& m = S.m[i];
  say("CFG M%u en=%u dir=%u ms=%u ma=%u hold=%u home=%u spr=%u sweep=%u full=%lu vmax=%u acc=%u sg=%u", i, m.enabled, m.dirInvert,
      m.microsteps, m.runMa, m.holdPct, m.homeOnBoot, m.stepsPerRev, m.sweepDeg10, (unsigned long)m.fullScale, m.maxDegS, m.accDegS2, m.sgthrs);
}

static void cfgDump() {
  for (uint8_t i = 0; i < N_MOTORS; i++) cfgDumpMotor(i);
  say("CFG NX en=%u baud=%lu", S.nxEnabled, (unsigned long)S.nxBaud);
  say("CFG END motors=%u saved=%u", N_MOTORS, settingsSaved() ? 1 : 0);
}

// Applies "key=value" pairs to m. Returns nullptr or the name of the first bad pair.
static const char* cfgMotorPairs(char* args, MotorSettings& m) {
  for (char* kv = strtok(args, " "); kv; kv = strtok(NULL, " ")) {
    char* eq = strchr(kv, '=');
    if (!eq) return kv;
    *eq = 0;
    const char* k = kv;
    char* end;
    long v = strtol(eq + 1, &end, 10);
    if (end == eq + 1 || *end) { *eq = '='; return kv; }
    bool ok = true;
    if (!strcmp(k, "en")) { ok = v == 0 || v == 1; m.enabled = v; }
    else if (!strcmp(k, "dir")) { ok = v == 0 || v == 1; m.dirInvert = v; }
    else if (!strcmp(k, "ms")) { ok = v >= 1 && v <= 256 && (v & (v - 1)) == 0; m.microsteps = v; }
    else if (!strcmp(k, "ma")) { ok = v >= 30 && v <= 1500; m.runMa = v; }
    else if (!strcmp(k, "hold")) { ok = v >= 0 && v <= 100; m.holdPct = v; }
    else if (!strcmp(k, "home")) { ok = v == 0 || v == 1; m.homeOnBoot = v; }
    else if (!strcmp(k, "spr")) { ok = v >= 20 && v <= 2000; m.stepsPerRev = v; }
    else if (!strcmp(k, "sweep")) { ok = v >= 100 && v <= 3600; m.sweepDeg10 = v; }
    else if (!strcmp(k, "full")) { ok = v >= 1 && v <= 1000000; m.fullScale = v; }
    else if (!strcmp(k, "vmax")) { ok = v >= 1 && v <= 3000; m.maxDegS = v; }
    else if (!strcmp(k, "acc")) { ok = v >= 1 && v <= 60000; m.accDegS2 = v; }
    else if (!strcmp(k, "sg")) { ok = v >= 0 && v <= 255; m.sgthrs = v; }
    else ok = false;
    if (!ok) { *eq = '='; return kv; }
  }
  return nullptr;
}

static void cfgCommand(char* s) {
  char* p = s + 3;
  while (*p == ' ') p++;
  if (*p == '?' || !*p) { cfgDump(); return; }
  if (!strcmp(p, "SAVE")) {
    bool ok = settingsSave();
    if (ok) say("OK CFG SAVED"); else say("ERR CFG SAVE failed");
    return;
  }
  if (!strcmp(p, "LOAD") || !strcmp(p, "DEFAULTS")) {
    Settings old = S;
    if (p[0] == 'L') { if (!settingsFromFlash(S)) { say("ERR CFG nothing saved"); return; } }
    else settingsDefaults(S);
    for (uint8_t i = 0; i < N_MOTORS; i++) applyMotor(i, old.m[i]);
    if (S.nxEnabled != old.nxEnabled || S.nxBaud != old.nxBaud) nextionStart();
    say("OK CFG %s", p);
    return;
  }
  if (p[0] == 'M') {
    const char* q = p + 1;
    int a, b;
    if (!parseMotor(q, a, b) || (*q && *q != ' ')) { say("ERR CFG usage: CFG M<n|*> key=value ..."); return; }
    char args[200];
    strncpy(args, q, sizeof(args) - 1); args[sizeof(args) - 1] = 0;
    for (int i = a; i <= b; i++) {                     // check on a copy first: all or nothing
      MotorSettings m = S.m[i];
      char tmp[200]; strcpy(tmp, args);
      const char* bad = cfgMotorPairs(tmp, m);
      if (bad) { say("ERR CFG bad setting: %s", bad); return; }
    }
    for (int i = a; i <= b; i++) {
      MotorSettings old = S.m[i];
      char tmp[200]; strcpy(tmp, args);
      cfgMotorPairs(tmp, S.m[i]);
      applyMotor(i, old);
    }
    if (a == b) { say("OK CFG M%d", a); } else say("OK CFG M*");
    return;
  }
  if (!strncmp(p, "NX", 2)) {
    uint8_t en = S.nxEnabled;
    uint32_t baud = S.nxBaud;
    for (char* kv = strtok(p + 2, " "); kv; kv = strtok(NULL, " ")) {
      long v = atol(strchr(kv, '=') ? strchr(kv, '=') + 1 : "x");
      if (!strncmp(kv, "en=", 3) && (v == 0 || v == 1)) en = v;
      else if (!strncmp(kv, "baud=", 5)) {
        bool known = false;
        for (uint32_t bd : NX_BAUDS) known |= (bd == (uint32_t)v);
        if (!known) { say("ERR CFG bad setting: %s", kv); return; }
        baud = v;
      } else { say("ERR CFG bad setting: %s", kv); return; }
    }
    bool restart = en != S.nxEnabled || baud != S.nxBaud;
    S.nxEnabled = en; S.nxBaud = baud;
    if (restart) nextionStart();
    say("OK CFG NX");
    return;
  }
  say("ERR CFG unknown: %s", p);
}

static void command(char* s) {
  if (!strncmp(s, "CFG", 3)) { cfgCommand(s); return; }
  const char* p = s + 1;
  int a, b;
  switch (s[0]) {
    case 'I': {
      say("OCTOPUS-GAUGES %s  drivers=%s  settings=%s", FW_VERSION, driversEnabled ? "ENABLED" : "disabled", settingsSaved() ? "saved" : "NOT saved");
      for (uint8_t i = 0; i < N_MOTORS; i++) {
        uint32_t ifcnt = 0; bool ok = tmc[i].read(REG_IFCNT, ifcnt);
        say("M%u tmc=%s ver=0x%02X en=%d ifcnt=%lu pos=%ld tgt=%ld sweep=%ld I=%umA dirInv=%u full=%lu homing=%u diag=%d", i,
            tmcOk[i] ? "ok" : "NO-ANSWER", tmcVersion[i], drvOn[i], ok ? (unsigned long)ifcnt : 0UL, (long)getPos(i), (long)getTarget(i),
            (long)sweepU[i], S.m[i].runMa, S.m[i].dirInvert, (unsigned long)S.m[i].fullScale, hstate[i], digitalRead(MOTOR[i].diag));
      }
      say("NX en=%u baud=%lu commands-to-display=%lu frames-from-display=%lu", S.nxEnabled, (unsigned long)S.nxBaud,
          (unsigned long)nxToDisplay, (unsigned long)nxFromDisplay);
      say("POWER %s (FAN0, off after %lu s without the power field)", powerOn ? "ON" : "off", (unsigned long)(POWER_TIMEOUT_MS / 1000));
      break;
    }
    case 'W':                                          // W1 / W0: power output on / off by hand, W: its state
      if (*p == '0' || *p == '1') { setPower(*p == '1'); powerAt = millis(); say("OK power %s", powerOn ? "on" : "off"); }
      else say("power %s", powerOn ? "on" : "off");
      break;
    case 'L': {                                        // L<seg|*>,<r>,<g>,<b>: try a colour (not saved); L: list
      if (!*p) {
        for (uint8_t i = 0; i < LED_SEGMENTS; i++) say("LED %u pixels=%u rgb=%u,%u,%u", i, LED_SEG_PIXELS[i], LED_COLOR[i].r, LED_COLOR[i].g, LED_COLOR[i].b);
        break;
      }
      int first, last;
      if (*p == '*') { first = 0; last = LED_SEGMENTS - 1; p++; }
      else if (*p >= '0' && *p <= '9' && atoi(p) < LED_SEGMENTS) { first = last = atoi(p); while (*p >= '0' && *p <= '9') p++; }
      else { say("ERR usage L<segment|*>,<r>,<g>,<b>"); break; }
      int r, g, bl;
      if (*p++ != ',' || sscanf(p, "%d,%d,%d", &r, &g, &bl) != 3 || r < 0 || r > 255 || g < 0 || g > 255 || bl < 0 || bl > 255) { say("ERR usage L<segment|*>,<r>,<g>,<b>"); break; }
      for (int i = first; i <= last; i++) LED_COLOR[i] = { (uint8_t)r, (uint8_t)g, (uint8_t)bl };
      ledColorsChanged = true;
      say("OK LED colour set (until the next reset; edit LED_COLOR in config.h to keep it)");
      break;
    }
    case 'E': {
      setDrivers(*p == '1');
      char list[3 * N_MOTORS + 1] = ""; uint8_t n = 0;
      for (uint8_t i = 0; i < N_MOTORS; i++) if (drvOn[i]) { list[n++] = 'M'; list[n++] = '0' + i; list[n++] = ' '; }
      list[n] = 0;
      say("OK drivers %s, enabled: %s", driversEnabled ? "on" : "off", n ? list : "none");
      break;
    }
    case 'U': {                                        // U<n>: raw UART read of IOIN (diagnostics)
      if (!parseMotor(p, a, b)) { say("ERR usage U<n|*>"); break; }
      for (int i = a; i <= b; i++) {
        uint32_t v = 0; bool ok = tmc[i].read(REG_IOIN, v);
        const uint8_t* r = tmc[i].lastRaw;
        say("M%d IOIN %s bytes=%u raw=%02X %02X %02X %02X %02X %02X %02X %02X val=0x%08lX", i, ok ? "OK" : "FAIL",
            tmc[i].lastBytes, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], (unsigned long)(ok ? v : 0));
      }
      break;
    }
    case 'Z': for (uint8_t i = 0; i < N_MOTORS; i++) setPosition(i, 0); say("OK all positions set to 0"); break;
    case 'P': {                                        // P<n>,<degrees>
      if (!parseMotor(p, a, b) || *p++ != ',') { say("ERR usage P<n|*>,<degrees>"); break; }
      float deg = constrain(atof(p), -30.0f, 360.0f);
      for (int i = a; i <= b; i++) { hstate[i] = H_IDLE; setTarget(i, (int32_t)(deg * uPerDeg[i])); }
      say("OK move to %ld deg (x0.1)", (long)(deg * 10.0f));
      break;
    }
    case 'D': {                                        // D<n>,<0|1>   (same as CFG M<n> dir=..)
      if (!parseMotor(p, a, b) || *p++ != ',') { say("ERR usage D<n|*>,<0|1>"); break; }
      for (int i = a; i <= b; i++) { S.m[i].dirInvert = (*p == '1'); ax[i].lastDir = 0; }
      say("OK dirInvert=%c (CFG SAVE keeps it)", *p);
      break;
    }
    case 'C': {                                        // C<n>,<mA RMS>   (same as CFG M<n> ma=..)
      if (!parseMotor(p, a, b) || *p++ != ',') { say("ERR usage C<n|*>,<mA>"); break; }
      uint16_t mA = (uint16_t)constrain(atoi(p), 30, 1500);
      for (int i = a; i <= b; i++) { S.m[i].runMa = mA; tmcSetCurrent(i); }
      say("OK run current %u mA RMS (CFG SAVE keeps it)", mA);
      break;
    }
    case 'S': {                                        // S<n>,<sgthrs 0..255>
      if (!parseMotor(p, a, b) || *p++ != ',') { say("ERR usage S<n|*>,<0..255>"); break; }
      uint8_t t = (uint8_t)constrain(atoi(p), 0, 255);
      for (int i = a; i <= b; i++) { S.m[i].sgthrs = t; tmc[i].write(REG_SGTHRS, t); }
      say("OK SGTHRS=%u", t);
      break;
    }
    case 'G': {                                        // G<n>: StallGuard result (use while a motor moves)
      if (!parseMotor(p, a, b)) { say("ERR usage G<n|*>"); break; }
      for (int i = a; i <= b; i++) {
        uint32_t sg = 0, st = 0;
        bool o1 = tmc[i].read(REG_SG_RESULT, sg), o2 = tmc[i].read(REG_DRV_STATUS, st);
        say("M%d SG_RESULT=%s%lu DRV_STATUS=0x%08lX diag=%d", i, o1 ? "" : "?", (unsigned long)sg, (unsigned long)(o2 ? st : 0), digitalRead(MOTOR[i].diag));
      }
      break;
    }
    case 'H': {                                        // H<n|*>[,<sgthrs>]
      if (!parseMotor(p, a, b)) { say("ERR usage H<n|*>[,<sgthrs>]"); break; }
      if (*p == ',') { uint8_t t = (uint8_t)constrain(atoi(p + 1), 0, 255); for (int i = a; i <= b; i++) S.m[i].sgthrs = t; }
      for (int i = a; i <= b; i++) homeStart(i);
      say("OK homing started");
      break;
    }
    case 'T':                                          // T: self test, all needles 0 -> full scale -> 0
      testStage = 1; testT0 = millis();
      for (uint8_t i = 0; i < N_MOTORS; i++) if (S.m[i].enabled) setTarget(i, sweepU[i]);
      say("OK sweep test");
      break;
    case 'B':                                          // BOOTLOADER: jump to the ST ROM DFU bootloader
      if (strcmp(s, "BOOTLOADER") != 0) { say("ERR send BOOTLOADER (whole word) to enter DFU"); break; }
      say("OK entering DFU"); Serial.flush(); delay(100);
      jumpToDfu();
      break;
    case '?': say("OCTOPUS-GAUGES %s motors=%u cfg=1 power=1 leds=%u", FW_VERSION, N_MOTORS, LED_COUNT); break;
    default: say("ERR unknown command. I E Z P D C S G H T U W L CFG BOOTLOADER ?"); break;
  }
}

static void handleLine(char* s) {
  if (*s == '@') { nextionSend(s + 1); return; }       // Nextion command, sent as is (no trimming)
  while (*s == ' ') s++;
  if (!*s) return;
  if ((*s >= '0' && *s <= '9') || *s == '-') {         // a data line: keep only the newest one
    strncpy(ready, s, sizeof(ready) - 1); ready[sizeof(ready) - 1] = 0;
    pending = true;
  } else command(s);
}

// ---- main ----
void setup() {
  pinMode(POWER_PIN, OUTPUT); setPower(false);         // the head unit stays off until Studio asks for power
  Serial.begin(115200);                                // USB CDC, baud is ignored
  settingsLoad();
  for (uint8_t i = 0; i < N_MOTORS; i++) settingsDerive(i);
  nextionStart();
  for (uint8_t i = 0; i < N_MOTORS; i++) {             // drivers off until they are configured
    pinMode(MOTOR[i].en, OUTPUT); digitalWrite(MOTOR[i].en, HIGH);
    pinMode(MOTOR[i].diag, INPUT);
  }
  motionInit();
  for (uint8_t i = 0; i < N_MOTORS; i++) tmcInit(i);
  setDrivers(true);
  for (uint8_t i = 0; i < N_MOTORS; i++) if (S.m[i].enabled && S.m[i].homeOnBoot) homeStart(i);
  ledInit();                                           // the strips light up with the board
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { rx[rxLen] = 0; if (!rxOverflow) handleLine(rx); rxLen = 0; rxOverflow = false; }
    else if (c == '\r') {}
    else if (rxLen < sizeof(rx) - 1) rx[rxLen++] = c;
    else rxOverflow = true;                            // too long: drop the whole line, never send half of it
  }
  nextionPoll();
  if (pending && millis() - lastParse >= PARSE_INTERVAL_MS) {
    pending = false;
    lastParse = millis();
    char tmp[128]; strncpy(tmp, ready, sizeof(tmp)); tmp[sizeof(tmp) - 1] = 0;
    applyData(tmp);
  }
  for (uint8_t i = 0; i < N_MOTORS; i++) homeUpdate(i);
  if ((ledColorsChanged || millis() - ledAt >= LED_REFRESH_MS) && !anyNeedleMoving()) ledShow();
  if (powerOn && millis() - powerAt > POWER_TIMEOUT_MS) {   // the PC went away: do not keep the head unit on forever
    setPower(false);
    say("power off: no power field for %lu s", (unsigned long)(POWER_TIMEOUT_MS / 1000));
  }
  if (testStage == 1 && millis() - testT0 > 2500) { for (uint8_t i = 0; i < N_MOTORS; i++) setTarget(i, 0); testStage = 2; testT0 = millis(); }
  else if (testStage == 2 && millis() - testT0 > 2500) testStage = 0;
}
