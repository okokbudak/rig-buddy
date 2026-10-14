#pragma once
// Minimal bit-banged single-wire UART for the TMC2209 (one MCU pin per driver, as wired on the Octopus Pro).
// Datagram format and CRC8 are the ones from the Trinamic datasheet (checked against TMCStepper's calcCRC).
// Interrupts are disabled while a datagram is on the wire (about 0.7 ms at 115200 baud).
#include "config.h"

// TMC2209 registers (addresses/bit layouts verified against the TMCStepper library headers)
constexpr uint8_t REG_GCONF = 0x00, REG_IFCNT = 0x02, REG_IOIN = 0x06, REG_IHOLD_IRUN = 0x10,
                  REG_TPOWERDOWN = 0x11, REG_TPWMTHRS = 0x13, REG_TCOOLTHRS = 0x14, REG_SGTHRS = 0x40,
                  REG_SG_RESULT = 0x41, REG_CHOPCONF = 0x6C, REG_DRV_STATUS = 0x6F, REG_PWMCONF = 0x70;

class TmcUart {
public:
  void begin(uint32_t pin) {
    _port = digitalPinToPort(pin);
    _mask = digitalPinToBitMask(pin);
    _shift = __builtin_ctz(_mask) * 2;
    pinMode(pin, OUTPUT);
    high();
    if (!(CoreDebug->DEMCR & CoreDebug_DEMCR_TRCENA_Msk)) {   // cycle counter for bit timing
      CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
      DWT->CYCCNT = 0;
      DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
    }
  }

  bool write(uint8_t reg, uint32_t value) {
    uint8_t d[8] = { 0x05, 0x00, (uint8_t)(reg | 0x80), (uint8_t)(value >> 24), (uint8_t)(value >> 16),
                     (uint8_t)(value >> 8), (uint8_t)value, 0 };
    d[7] = crc(d, 7);
    uint32_t primask = __get_PRIMASK();
    __disable_irq();
    sendBytes(d, 8);
    __set_PRIMASK(primask);
    return true;            // fire and forget; verify with IFCNT if needed
  }

  bool read(uint8_t reg, uint32_t &value) {
    uint8_t q[4] = { 0x05, 0x00, reg, 0 };
    q[3] = crc(q, 3);
    uint8_t r[8] = {0};
    bool ok = false;
    uint32_t primask = __get_PRIMASK();
    __disable_irq();
    sendBytes(q, 4);
    input();                                                  // with pull-up: PDN_UART has an internal pull-down
    const uint32_t bit = SystemCoreClock / TMC_BAUD;
    uint32_t timeout = DWT->CYCCNT + (SystemCoreClock / 1000) * 3;   // 3 ms for the whole answer
    lastBytes = 0;
    uint8_t m = 0;
    for (; m < 8; m++) {
      if (!waitStart(timeout)) break;                         // resync on every start bit
      uint32_t t0 = DWT->CYCCNT;
      uint8_t b = 0;
      for (uint8_t k = 0; k < 8; k++) {
        uint32_t t = t0 + (uint32_t)(1 + k) * bit + bit / 2;  // middle of data bit k
        while ((int32_t)(DWT->CYCCNT - t) < 0) {}
        if (_port->IDR & _mask) b |= (1 << k);
      }
      uint32_t t = t0 + 9 * bit + bit / 2;                    // middle of the stop bit
      while ((int32_t)(DWT->CYCCNT - t) < 0) {}
      r[m] = b;
    }
    lastBytes = m;
    for (uint8_t k = 0; k < 8; k++) lastRaw[k] = (k < m) ? r[k] : 0;
    ok = (m == 8 && r[0] == 0x05 && r[1] == 0xFF && r[2] == reg && crc(r, 7) == r[7]);
    output();
    high();
    __set_PRIMASK(primask);
    if (ok) value = ((uint32_t)r[3] << 24) | ((uint32_t)r[4] << 16) | ((uint32_t)r[5] << 8) | r[6];
    return ok;
  }

  uint8_t lastRaw[8] = {0};    // bytes of the last read answer (diagnostics)
  uint8_t lastBytes = 0;

private:
  GPIO_TypeDef* _port = nullptr;
  uint32_t _mask = 0;
  uint32_t _shift = 0;

  inline void high() { _port->BSRR = _mask; }
  inline void low()  { _port->BSRR = _mask << 16; }
  inline void output() { _port->MODER = (_port->MODER & ~(3UL << _shift)) | (1UL << _shift); }
  inline void input()  {
    _port->PUPDR = (_port->PUPDR & ~(3UL << _shift)) | (1UL << _shift);   // pull-up
    _port->MODER = (_port->MODER & ~(3UL << _shift));
  }

  bool waitStart(uint32_t timeout) {                          // line high (idle/stop), then the falling edge
    while (!(_port->IDR & _mask)) if ((int32_t)(DWT->CYCCNT - timeout) >= 0) return false;
    while (_port->IDR & _mask)    if ((int32_t)(DWT->CYCCNT - timeout) >= 0) return false;
    return true;
  }

  static uint8_t crc(const uint8_t* d, uint8_t len) {       // identical to TMCStepper::calcCRC
    uint8_t c = 0;
    for (uint8_t i = 0; i < len; i++) {
      uint8_t b = d[i];
      for (uint8_t j = 0; j < 8; j++) {
        if ((c >> 7) ^ (b & 1)) c = (c << 1) ^ 0x07; else c = (c << 1);
        b >>= 1;
      }
    }
    return c;
  }

  void sendBytes(const uint8_t* d, uint8_t n) {
    const uint32_t bit = SystemCoreClock / TMC_BAUD;
    uint32_t t = DWT->CYCCNT + bit * 2;                       // a short idle lead-in
    while ((int32_t)(DWT->CYCCNT - t) < 0) {}
    for (uint8_t i = 0; i < n; i++) {
      uint16_t frame = (1u << 9) | ((uint16_t)d[i] << 1);     // start bit 0, 8 data bits LSB first, stop bit 1
      for (uint8_t k = 0; k < 10; k++) {
        while ((int32_t)(DWT->CYCCNT - t) < 0) {}
        if ((frame >> k) & 1) high(); else low();
        t += bit;
      }
    }
    while ((int32_t)(DWT->CYCCNT - t) < 0) {}
    high();
  }
};
