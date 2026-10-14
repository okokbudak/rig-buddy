# BTT Octopus Pro V1.0 / V1.0.1 (STM32F446ZET6) – Pin ve Elektriksel Sınırlar Referansı

Dashboard projesi için derlenmiştir. Ezberden değil, aşağıdaki kaynaklardan yazıldı. Her değerin yanında **güvenilirliği** var:

| Etiket | Anlamı |
|---|---|
| **[RESMİ]** | BTT'nin kendi kılavuzu / wiki sayfası / pin diyagramı |
| **[ŞEMATİK]** | BTT'nin V1.0 şematiğinden okunan parça adı, ya da Klipper'in resmî **v1.0** kart yapılandırması |
| **[PARÇA]** | Şematikteki parçanın üretici datasheet'i (kartın değil, parçanın sınırı) |
| **[TÜRETİLMİŞ]** | Resmî rakamlardan hesapladım ya da kendi muhafazakâr tavsiyem. **Üretici değeri değil.** |
| **[V1.1]** | Sadece V1.1 pin diyagramında gördüm, bu kart (V1.0) için **doğrulanmadı** |
| **[YOK]** | BTT bunu yayımlamıyor |

> **Önemli:** BTT, ısıtıcı/fan çıkışları için "şu kadar amper" diye bir rakam **yayımlamıyor** (kılavuzda, wiki'de, README'de yok). Elimizde sadece şematikteki **MOSFET parçaları ve onların datasheet sınırları** var, bunlar çıkışın gerçek sürekli akım sınırı değildir (kart yolları, konnektörler, sigorta da sınırlar).

## 0. Bu kart hangisi?

- Senin kartın: **Octopus Pro V1.0.1, STM32F446ZET6** (çipte yazıyor). Klipper'in resmî **v1.0** yapılandırması bu kart ailesini kapsıyor ("F446, F429 ya da H723 olabilir") **[ŞEMATİK]**. Bu belgedeki pinler o dosyadan.
- **V1.1 kartların pinleri farklıdır**, ve Klipper uyarıyor: bir yapılandırmayı diğer kartta kullanırsan **bir ısıtıcı istemeden açılabilir**. Karıştırma: aşağıdaki "V1.1'den farklar" tablosuna bak.
- MCU: **STM32F446ZET6**, Cortex-M4, **180 MHz**, **512 KB flash** **[RESMİ, kılavuz "Option A"]**. Kristal: **12 MHz** **[RESMİ + ŞEMATİK]**. Klipper için BTT önyükleyici ofseti: **32 KiB** **[ŞEMATİK, Klipper yapılandırması]**, yani kendi firmware'imiz flash'ta **0x08008000**'den başlar. USB: **PA11 / PA12** (USB-C, sanal COM portu).
- Kart: **160 × 100 mm**, montaj delikleri 150 × 90 mm **[RESMİ]**. Konnektör etiketlerinin çoğu kartın **alt yüzünde** basılı, üst yüzde yok **[RESMİ, kılavuz 2. bölüm]**. Kurulumdan önce alt yüzün fotoğrafını çek. Bu klasörde V1.0 pin diyagramı PDF olarak var: `Octopus_Pro_V1.0_PIN_BTT.pdf` (kendi PDF okuyucunda aç). `..._V1.1_..._REFERANS_SENDE_V1.0.jpg` sadece genel yerleşim için, pinleri V1.0 ile birebir aynı değil.

### V1.1'den farklar (Klipper'in iki resmî yapılandırması karşılaştırıldı) [ŞEMATİK]

| Konu | **V1.0 / V1.0.1 (senin kartın)** | V1.1 |
|---|---|---|
| **HE0** çıkışı | **PA2** | PA0 |
| **HE2** çıkışı | **PB10** | PB0 |
| **MOTOR3** EN pini | **PA0** | PA2 |
| NeoPixel (RGB) | **PB0** | PB10 |
| EXP2'nin 10. pini | **PC5** | bağlı değil |
| MCU | **F446 / F429 / H723** | sadece H723 |

Diğer sürücü pinleri (STEP/DIR/UART/DIAG), fan, termistör, uç anahtarı pinleri iki sürümde aynı.

---

## 1. Güç girişleri ve gerilim sınırları

| Terminal (alt yüz yazısı) | Ne besler | Gerilim | Akım / güç |
|---|---|---|---|
| **POWER** (VIN) | Kart mantığı, fanlar, **HE0–HE3 çıkışları**, iç regülatörler | Önerilen **15–28 V**. Mantık için **> 14,1 V ve < 28 V** olmalı. **12 V mantık için desteklenmiyor** (12 V sadece motor ve yatak girişlerinde) **[RESMİ]** | **[YOK]** (değiştirilebilir sigortalı, değeri belgede yok) |
| **MOTOR-POWER** (HV) | Sürücülerin yüksek gerilim hattı | **12–60 V** **[RESMİ]** | **[YOK]** |
| **BED-POWER** / **BED-OUT** | Yatak ısıtıcı | **12–28 V**. **28 V üstünü asla bağlama.** **[RESMİ]** | Yatak **en fazla 300 W**. 24 V'ta bu yaklaşık **12,5 A** **[TÜRETİLMİŞ: 300 W ÷ 24 V]** |

Her sürücü sokedinin yanındaki jumper, sürücüye **VIN** (ana giriş, ≤28 V) ya da **HV** (MOTOR-POWER, ≤60 V) gerilimini seçtirir **[RESMİ]**. Jumper'ı yanlış koymak sürücüyü (TMC2209 gibi 29 V'a kadar olanları) yakar, **güç açıkken jumper takıp çıkarma**.

### Karttaki regülatör raylar **[RESMİ]**
| Ray | En fazla | Not |
|---|---|---|
| 12 V | **4 A** | BTT: kartta başka bileşenler de bu raylardan beslendiği için sınıra dayamayın |
| 5 V | **8 A** | " |
| 3,3 V | **1 A** | " |

Şematikte regülatör parçaları **[ŞEMATİK, V1.0]**: SY8368AQQC, AOZ1283PI, AMS1117, HT7550-2, B340A diyot. Hangisinin hangi rayı ürettiği şematik metninden kesin çıkmıyor, o yüzden eşleştirmiyorum. Karttaki **kısa devre uyarı buzzer'ı** 5 V ray regülatörün verebileceğinden fazla yüklenince öter **[RESMİ]**. **USB-C sadece veri içindir, harici cihazı besleyemezsin** **[RESMİ]**.

---

## 2. Step sürücü soketleri (8 adet + MOTOR2 ile paralel çıkış)

Soket adları: MOTOR0, MOTOR1, MOTOR2_1, MOTOR2_2 (MOTOR2 ile paralel), MOTOR3, MOTOR4, MOTOR5, MOTOR6, MOTOR7 **[RESMİ]**. Pinler **[ŞEMATİK, Klipper v1.0]**.

| Soket | STEP | DIR | EN (aktif düşük) | UART (TMC2209) / CS (SPI) | DIAG → uç anahtarı pini |
|---|---|---|---|---|---|
| **MOTOR0** | PF13 | PF12 | PF14 | PC4 | PG6 (Stop0) |
| **MOTOR1** | PG0 | PG1 | PF15 | PD11 | PG9 (Stop1) |
| **MOTOR2** | PF11 | PG3 | PG5 | PC6 | PG10 (Stop2) |
| **MOTOR3** | PG4 | PC1 | **PA0** | PC7 | PG11 (Stop3) |
| **MOTOR4** | PF9 | PF10 | PG2 | PF2 | PG12 (Stop4) |
| **MOTOR5** | PC13 | PF0 | PF1 | PE4 | PG13 (Stop5) |
| **MOTOR6** | PE2 | PE3 | PD4 | PE1 | PG14 (Stop6) |
| **MOTOR7** | PE6 | PA14 | PE0 | PD3 | PG15 (Stop7) |

> **Dikkat, MOTOR3'ün EN pini PA0** (V1.1'de PA2). V1.0'da HE0 çıkışı PA2'dedir. V1.1 pinini kullanırsan MOTOR3'ü açmaya çalışırken HE0 ısıtıcı çıkışını açarsın.

- **DIAG jumper'ları** (sürücü soketlerinin altı) StallGuard çıkışını yukarıdaki uç anahtarı pinine bağlar **[RESMİ]**. Sensorless homing için o motorun DIAG jumper'ı takılı, ilgili Stop girişi de boş olmalı.
- **Sürücü modları** **[RESMİ]**: step/dir, **UART**, SPI. TMC2209 için UART modu: sürücü altındaki jumper'ları kılavuzdaki UART konumuna koy.
- SPI sürücü başlığında PA5/PA6/PA7 ortak SPI hattıdır **[V1.1]**.

### Takılacak sürücü (TMC2209, Trinamic datasheet rev 1.08 **[PARÇA]**)
Besleme **4,75–29 V**, sürekli **2,0 A RMS**, tepe **2,8 A**, StallGuard4, UART arayüzü. Octopus'un VIN sınırı 28 V olduğu için TMC2209'u **VIN tarafında** (≤28 V) çalıştır, **HV ≥ 29 V seçme**.

---

## 3. Isıtıcı, fan, yatak çıkışları

Çıkış MOSFET'leri **[ŞEMATİK, V1.0]** (4 × HY1904C, 1 × IPD036N04L, 6 × ES3400) ve parça datasheet'leri **[PARÇA]**:

| Çıkış (alt yüz yazısı) | MCU pini | MOSFET | Parça sınırı | Not |
|---|---|---|---|---|
| **HE0** | **PA2** | HY1904C | 40 V / 65 A (HY1904C2 datasheet'i) | Çıkış gerilimi = POWER (VIN) |
| **HE1** | PA3 | HY1904C | " | " |
| **HE2** | **PB10** | HY1904C | " | " |
| **HE3** | PB11 | HY1904C | " | HE terminal bloğu şematikte "KF128-8P", akım değeri **[YOK]** |
| **BED-OUT** | PA1 | IPD036N04L | 40 V / 90 A, RDS(on) ≤ 3,6 mΩ (Infineon) | Kılavuz sınırı: **≤300 W**, giriş ≤28 V **[RESMİ]** |
| **FAN0** | PA8 | ES3400 | 30 V, RDS(on) < 28 mΩ @10 V, **5,8 A @25 °C, 4,6 A @70 °C, darbe (IDM) 30 A** (ElecSuper datasheet'i **[PARÇA]**; "3400" adını başka üreticiler de kullanıyor, değerleri farklı: karttaki parçanın üreticisini doğrula). Bu, çıkışın sürekli akımı değil, sadece MOSFET'in sınırı | PWM |
| **FAN1** | PE5 | ES3400 | " | PWM |
| **FAN2** | PD12 | ES3400 | " | PWM |
| **FAN3** | PD13 | ES3400 | " | PWM |
| **FAN4** | PD14 | ES3400 | " | PWM |
| **FAN5** | PD15 | ES3400 | " | PWM |
| **FAN6, FAN7** | (MCU pini yok) | MOSFET yok | – | **Her zaman açık** fanlar **[RESMİ]** |

Hangi Q numarasının hangi çıkışa gittiğini şematik metninden kesin çıkaramadım **[TÜRETİLMİŞ]**. **BTT'nin ısıtıcı/yatak/fan çıkışları klasik olarak eksi ucu (GND) anahtarlar** (V1.1 görselinde HE terminalleri "VIN" ve "MCU pini" diye etiketli), bu kart için multimetreyle doğrula: sinyal kablosu olan cihazların (head unit, Nextion) GND'sini bu çıkışlarla anahtarlama, röle kullan.

**Fan ve prob gerilim seçimi** **[RESMİ]**: Her fan başlığının ve prob başlığının voltajı jumper ile **5 V / 12 V / VIN** olarak seçilir. Jumper hatları doğrudan regülatöre/girişe bağlı, **yanlış kısa devre kartı bozar**. PWM fan portlarında flyback koruması var **[RESMİ]**.

**Kardeş kart için BTT'nin yayımladığı tek fan değeri** **[RESMİ, başka kart]**: Octopus **MAX EZ** kılavuzu fan portu için **1 A sürekli, 1,5 A anlık** diyor. Octopus Pro için böyle bir rakam yok; BTT wiki'si orijinal Octopus Pro'da "kolay değiştirilebilir sigorta" olduğunu söylüyor ama değerini yazmıyor. Konnektör başlıkları genelde JST-XH (üretici değeri tipik 3 A): fanlar için, 2 A'lik bir cihaz için sınırda. Ayrıca bir kullanıcı forumda 12 V jumper'ı takılıyken fan pinlerinde 24 V ölçtüğünü yazmış (tek rapor): **jumper'a güvenme, cihazı bağlamadan multimetreyle ölç.**

### Akım için tavsiyem **[TÜRETİLMİŞ, üretici değeri DEĞİL]**
BTT sürekli akım vermediği için, onay alana kadar muhafazakâr kullan: **fan başına ≤ 1 A, ısıtıcı (HE) başına ≤ 5 A**. Toplam yük 12 V/5 V raylarda yukarıdaki sınırları aşmamalı. Dashboard'daki küçük fan, LED ve röle bobinleri bunun çok altında.

---

## 4. Sensör, prob, kontrol ve iletişim pinleri

MCU pinleri **3,3 V mantık**.

| Başlık | Pinler |
|---|---|
| **Termistörler** (her biri sinyal + GND) | **TB** PF3 · **T0** PF4 · **T1** PF5 · **T2** PF6 · **T3** PF7 **[ŞEMATİK]**. Giriş, VIN'e kadar kısa devreye karşı korumalı **[RESMİ]** |
| **Uç anahtarları (Stop0–7)** | PG6, PG9, PG10, PG11, PG12, PG13, PG14, PG15 (her biri sinyal + GND + 5 V) **[ŞEMATİK]** |
| **BLTouch** | kontrol **PB6**, sensör **PB7** **[ŞEMATİK]** |
| **PROBE (optokuplörlü giriş)** | **PC5** (kılavuza göre), 12 kΩ pull-up jumper'la **[RESMİ]** |
| **RGB (NeoPixel)** | **PB0** (V1.1'de PB10), 5 V, GND **[ŞEMATİK]** |
| **EXP1** | 1=PE8, 2=PE7, 3=PE9, 4=PE10, 5=PE12, 6=PE13, 7=PE14, 8=PE15, 9=GND, 10=5 V **[ŞEMATİK]** |
| **EXP2** | 1=PA6, 2=PA5, 3=PB1, 4=PA4, 5=PB2, 6=PA7, 7=PC15, 8=RESET, 9=GND, 10=**PC5** **[ŞEMATİK]** |
| **PS-ON** | PE11 **[V1.1]**. V1.0'da aynı pin olduğunu doğrulayamadım |
| **Power-Det** | PC0 **[V1.1 + şematikte PWR-DET / PC0 görünüyor]** |
| **PT100/PT1000 (MAX31865)** | MOSFET SPI1: MOSI PA7, MISO PA6, SCK PA5, CS PF8 **[V1.1]** |
| **I2C** | SCL PB8, SDA PB9 **[V1.1]** (şematikte SDA/SCL görünüyor) |
| **SPI başlığı** | MOSI PB5, CS PA15, MISO PB4, SCK PB3 **[V1.1]** (şematikte SPI3 görünüyor) |
| **Pi başlığı (UART)** | PA9 (TX), PA10 (RX) **[V1.1]** |
| **WiFi / UART3** | PD5/PD6 (UART2), PD8/PD9 (UART3) **[V1.1]** |
| **SD kart (SDIO)** | D0 PC8, D1 PC9, D2 PC10, D3 PC11, CLK PC12, CMD PD2 **[V1.1]** |
| **USB-C** | D−/D+ **PA11 / PA12** (sanal COM portu, veri yalnız) **[ŞEMATİK]** |
| **CAN** | CAN H (TX) PD1, CAN L (RX) PD0 **[V1.1]**. V1.0'da konnektör **RJ11 (6P6C)** **[RESMİ, kılavuz]** |
| **BOOT0 / RESET** | Kart üstünde |

**MCU güç jumper'ı:** takılırsa kart USB-C'den de beslenir (firmware yüklemek için kolaylık) **[RESMİ]**.

**Firmware yükleme** **[RESMİ]**: SD kart ile ("firmware.bin" adıyla, yükleme sonrası FIRMWARE.CUR olur) ya da DFU. DFU önyükleyiciyi siler, acemilere önerilmez.

---

## 5. Bu proje için çıkan sonuçlar

1. **12 V yetmez.** Ana giriş (**POWER**) en az **15 V, tercihen 24 V** olmalı.
2. **TMC2209 + VIN:** Sürücü jumper'larını VIN tarafına koy.
3. **6 motor için** MOTOR0–MOTOR5 yeter. Sensorless homing için o motorların DIAG jumper'larını tak: **PG6, PG9, PG10, PG11, PG12, PG13**. **MOTOR3'ün EN pini PA0 (V1.0)**, yazılımda bunu kullan.
4. **Boş kalan, kullanılabilir şeyler:** 6 PWM fan çıkışı (PA8, PE5, PD12–PD15), NeoPixel başlığı (PB0), HE çıkışları, EXP1/EXP2, **Stop6/Stop7 girişleri (PG14, PG15)** buton için.
5. **Akım planlarken** regülatör rayları (12 V 4 A, 5 V 8 A, 3,3 V 1 A) ve **toplam** yükü düşün.

---

## 6. Doğrulanmamış veya eksik

- Isıtıcı ve fan çıkışlarının **gerçek sürekli akım değeri** (BTT yayımlamıyor). Üretici desteğine sorulabilir: https://www.bigtree-tech.com/
- **Sigorta değerleri** (kartta değiştirilebilir sigorta var, değeri belgede yok): kendi kartındaki sigortanın üstündeki sayıya bak.
- **Konnektör akım değerleri** (HE terminal bloğu "KF128-8P", fan başlıkları 2,54 mm).
- **ES3400** MOSFET'in kendi datasheet'ini indirmedim. HY1904C için **HY1904C2**'nin datasheet'ini kullandım (aynı seri, parça no tam aynı değil).
- **[V1.1] etiketli pinler** (PS-ON, MAX31865, I2C, SPI, Pi/WiFi UART, SDIO, CAN pinleri): bu kart için doğrulanmadı. Sadece ihtiyaç duyduğumuz motor sürücü pinleri Klipper v1.0'dan kesin.
- Kartında **"V1.0.1"** yazdığından emin ol (silkscreen): "V1.0.1" kartların pin haritasının V1.0 ile aynı olduğunu satıcı listeleri ve Klipper'in v1.0 dosyası ima ediyor ama BTT'nin V1.0.1 için ayrı bir pin belgesi yok.
- **Kartın STM32F446ZET6 olduğu** kullanıcı tarafından bildirildi (çip yazısı).

---

## Kaynaklar

- BTT resmî depo: [BIGTREETECH-OCTOPUS-Pro (GitHub)](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro). Kullanılan dosyalar: `BTT_Octopus_pro_EN.pdf` (kılavuz, V1.0), `Hardware/BIGTREETECH Octopus Pro - PIN.pdf` (V1.0 pin diyagramı, bu klasörde), `Hardware/BIGTREETECH Octopus Pro V1.1-Pin.jpg` (V1.1 diyagram, referans), `Hardware/BIGTREETECH Octopus Pro_SCH.pdf` (V1.0 şematik), `...V1.1-sch.pdf`
- BTT wiki: [Octopus Pro](https://global.bttwiki.com/Octopus%20Pro.html)
- Klipper: [generic-bigtreetech-octopus-pro-v1.0.cfg](https://github.com/Klipper3d/klipper/blob/master/config/generic-bigtreetech-octopus-pro-v1.0.cfg) ve [v1.1.cfg](https://github.com/Klipper3d/klipper/blob/master/config/generic-bigtreetech-octopus-pro-v1.1.cfg)
- [TMC2209 datasheet rev 1.08 (Trinamic / Analog Devices)](https://wcm-cce.cldnet.analog.com/media/en/technical-documentation/data-sheets/TMC2209_datasheet_rev1.08.pdf)
- [HY1904C2 datasheet (Huayi, LCSC)](https://datasheet.lcsc.com/lcsc/2404031758_HUAYI-HY1904C2_C358116.pdf)
- [IPD036N04L (Infineon, Farnell)](https://uk.farnell.com/infineon/ipd036n04lgatma1/mosfet-n-ch-40v-90a-to-252/dp/3703584)
