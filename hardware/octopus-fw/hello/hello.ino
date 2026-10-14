// Octopus Pro V1.0.1 (STM32F446ZET6) toolchain smoke test.
// USB CDC serial: "?" -> "OCTOPUS-HELLO", everything else is echoed. No motors, no pins touched.
// Also overrides SystemClock_Config(): 180 MHz from the board's 12 MHz crystal, 48 MHz USB clock from PLLSAI,
// falling back to the internal oscillator (what the generic core does) if the crystal does not start.
// Build with -DHSE_VALUE=12000000UL.

extern "C" void SystemClock_Config(void) {
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
  osc.PLL.PLLM = 6;                       // 12 MHz / 6 = 2 MHz
  osc.PLL.PLLN = 180;                     // 360 MHz VCO
  osc.PLL.PLLP = RCC_PLLP_DIV2;           // 180 MHz SYSCLK
  osc.PLL.PLLQ = 8;
  osc.PLL.PLLR = 2;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) {   // no crystal: internal oscillator instead
    hse = false;
    osc = {};
    osc.OscillatorType = RCC_OSCILLATORTYPE_HSI;
    osc.HSIState = RCC_HSI_ON;
    osc.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
    osc.PLL.PLLState = RCC_PLL_ON;
    osc.PLL.PLLSource = RCC_PLLSOURCE_HSI;
    osc.PLL.PLLM = 8;                     // 16 MHz / 8 = 2 MHz
    osc.PLL.PLLN = 180;
    osc.PLL.PLLP = RCC_PLLP_DIV2;
    osc.PLL.PLLQ = 8;
    osc.PLL.PLLR = 2;
    if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();
  }
  if (HAL_PWREx_EnableOverDrive() != HAL_OK) Error_Handler();

  clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLRCLK;
  clk.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV4;     // 45 MHz
  clk.APB2CLKDivider = RCC_HCLK_DIV2;     // 90 MHz
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_5) != HAL_OK) Error_Handler();

  // 48 MHz for USB (and SDIO) from the SAI PLL: 1 MHz * 192 / 4
  per.PeriphClockSelection = RCC_PERIPHCLK_SDIO | RCC_PERIPHCLK_CLK48;
  per.PLLSAI.PLLSAIM = hse ? 12 : 16;     // 12 MHz or 16 MHz down to 1 MHz
  per.PLLSAI.PLLSAIN = 192;
  per.PLLSAI.PLLSAIQ = 2;
  per.PLLSAI.PLLSAIP = RCC_PLLSAIP_DIV4;
  per.PLLSAIDivQ = 1;
  per.Clk48ClockSelection = RCC_CLK48CLKSOURCE_PLLSAIP;
  per.SdioClockSelection = RCC_SDIOCLKSOURCE_CLK48;
  if (HAL_RCCEx_PeriphCLKConfig(&per) != HAL_OK) Error_Handler();
}

char line[64];
uint8_t len;

void setup() {
  Serial.begin(115200);       // USB CDC (PA11/PA12), baud is ignored
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      line[len] = 0;
      if (line[0] == '?') Serial.println("OCTOPUS-HELLO");
      else { Serial.print("echo: "); Serial.println(line); }
      len = 0;
    }
    else if (c != '\r' && len < sizeof(line) - 1) line[len++] = c;
  }
}
