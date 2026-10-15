# Octopus Pro gösterge firmware'i (V1.0.1, STM32F446ZET6)

6 gösterge motorunu (MOTOR0…MOTOR5) ve TFT konnektöründeki Nextion ekranını sürer. Verileri USB'den **Rig Buddy Studio** gönderir (SimHub Custom Serial de olur). Motor ayarları (yön, akım, skala, hız…) **kartın kendi flash'ında** durur ve Studio'nun **Kart** sayfasından yüklenir. Bunlar için firmware'i yeniden derlemek gerekmez.

## Klasörler
| Yol | Ne |
|---|---|
| `gauges\` | Asıl firmware (`gauges.ino`; `settings.h` = karta yüklenen ayarlar; `config.h` = pinler ve ilk açılış varsayılanları) |
| `hello\` | Sadece USB testi, motorlara dokunmaz |
| `build.sh` | Derler, bağlanma adresini denetler, `out\firmware.bin` üretir (karta yazmaz) |
| `flash.ps1` | `out\firmware.bin`'i USB'den karta yazar (Windows) |
| `out\` | Derleme ürünleri (git dışı): `firmware.bin`, ve istersen karttaki ikilinin kopyası `firmware-on-board.bin` |

BTT önyükleyicisinin yedeği (ilk 64 KB flash) depoda **yok** (ikili dosyalar git dışı); `Simdash\octopus-fw\backup\flash_first64k.bin` içinde duruyor, silme.

## Kartı hazırlama (bir kere)
1. **24 V** kaynağı Octopus'un **POWER** terminaline bağla (12 V mantık için yetmez). MOTOR jumper'larını **VIN** tarafına koy (güç kapalıyken).
2. Altı **TMC2209**'u **UART modunda** tak: sürücü soketlerinin altındaki UART jumper'ı. Sürücüler **DRIVER0–5** soketlerinde. Dikkat: kartta 9 motor konnektörü var (M2_1 ve M2_2 aynı DRIVER2'den beslenir), sürücü soketlerini konnektör etiketlerine bakarak sayma.
3. Motor konnektörleri: M0, M1, **M2_1**, M3, M4, M5.
4. Nextion: **TFT** konnektörü → 5V kırmızı, GND siyah, **TX → sarı (Nextion RX)**, **RX → mavi (Nextion TX)**.

## Firmware yükleme
**USB ile (normal yol):** kart USB'ye bağlı, firmware çalışıyor ve COM portunu başka program (Studio, SimHub) tutmuyorken:
```
powershell -ExecutionPolicy Bypass -File flash.ps1
```
Betik karta `BOOTLOADER` yollar, kart ST DFU'ya geçer, `out\firmware.bin` **0x08008000**'e yazılır, geri okunup doğrulanır, kart kendiliğinden açılır. BTT önyükleyicisine (0x08000000) ve ayar sektörüne (0x08060000) dokunulmaz: **ayarlar firmware güncellemesinde kaybolmaz.** dfu-util 0.11 ya da daha yenisi lazım: yolu `-DfuUtil C:\yol\dfu-util.exe` ile ya da `DFU_UTIL` ortam değişkeniyle ver (yoksa PATH'teki kullanılır). **Karta yazmadan önce sor**; `build.sh`'ın doğrulamadığı bir dosyayı yazma.

**Jumper'lı yol (firmware cevap vermiyorsa, ya da kartta 0.7 varsa):** BOOT0 jumper'ını tak, RESET'e bas, `flash.ps1`'i çalıştır, jumper'ı çıkar, RESET'e bas.
> 0.7 ve 0.8'in `BOOTLOADER` komutu çalışmıyor: DFU işareti RTC yedek register'ına yazılıyor ama hemen ardından gelen reset yazmayı kaybettirebiliyordu. 1.0 işareti geri okuyup doğrulayınca reset atıyor (arka arkaya 5/5 denendi). Bu sürümlerden 1.0'a bir kez jumper'la geçilir.

**SD kart ile (yedek yol):** FAT32 SD'nin köküne `firmware.bin`, kartı tak, reset; dosya **FIRMWARE.CUR** olursa yüklendi.

## Veri satırı
`v0,v1,v2,...\n`: düz tam sayılar, **n. alan MOTORn'i** sürer. Bir motorun `full` değeri ibreyi skalanın son çizgisine götürür, 0 ilk çizgiye. Az alanlı satır sadece o motorları oynatır. Tam sayı olmayan bir alan bütün satırı geçersiz kılar. Kapalı motorun alanı yok sayılır.

**Güç çıkışı (firmware 1.1):** motorlardan sonraki **7. alan** FAN0'ı (PA8) açar (`1`) ya da kapatır (`0`). FAN0'ın MOSFET'i fan konnektörünün eksi ucunu GND'ye bağlar (alçak taraf anahtarlama); 12 V jumper'ı takılıysa `1` head unit'e 12 V verir. Çıkış kart açılırken ve reset'te **kapalıdır**; 7. alanlı satır `POWER_TIMEOUT_MS` (5 dk, `config.h`) boyunca gelmezse kart kendisi keser. 7. alan olmayan satır çıkışa dokunmaz. Motorlar 7. alandan etkilenmez. Elle deneme: `W1` / `W0` (sonraki veri satırı yine yazar), `W` durumu söyler. Studio'da Kart sayfasındaki "Güç çıkışı" bölümü formülü (örn. `truck.electric.enabled`) ve kapanma gecikmesini (varsayılan 60 sn) yönetir.

**Elektrik:** FAN0 çıkışının gerilimi konnektörün jumper'ıyla seçilir (12 V'a getirmeden çoklu metreyle ölç; HE/BED çıkışları 24 V taşır, head unit'i oraya bağlama). ES3400 MOSFET 25 °C'de 5,8 A taşır ama JST-XH konnektör ~3 A ile sınırlı; head unit ≤2 A, araya 2,5–3 A'lik sigorta koy, en az 22 AWG tel kullan.

**LED şeritler (firmware 1.2):** 12 V WS2811 tipi şeritler (3 LED'de bir IC) tek zincirde PB0'dan (NeoPixel soketinin veri pini) sürülür: 24 IC (72 LED), en çok 64 IC. Zincir en çok 16 **parçaya** bölünür (başlangıç, uzunluk, renk, açık/kapalı); parçada olmayan IC'ler sönük, sonraki parça öncekinin üstüne boyar. Renk sırası (`order`: 0 RGB, 1 GRB, 2 BRG ← bu şeritler, 3 RBG, 4 GBR, 5 BGR) ve parlaklık da ayardır. Studio'nun Kart sayfasındaki "LED şeritler" bölümü bunları WLED gibi canlı değiştirir; `config.h`'deki `LED_DEFAULT_*` değerleri sadece kayıtlı ayarı olmayan kartın başlangıcıdır (6+6+3+3+3+3, sıcak beyaz). Komut: `LED n=24 order=2 bri=255 seg=<başlangıç>,<uzunluk>,<r>,<g>,<b>,<açık> …` (önce hepsi denetlenir; ilk `seg=` ya da `clear` eski parçaları siler; yanıt `OK LED`), `LED?` zinciri listeler. `CFG SAVE` zinciri de flash'a yazar (ayar sürümü 2; 1.0/1.1'in kayıtlı ayarları açılışta otomatik taşınır), `CFG?` `CFG LED …` ve `CFG SEG …` satırlarını da verir. Renkler kart açılırken ve sonra her 2 sn'de bir gönderilir (şeridin 12 V'u karttan sonra gelirse karanlık kalmasın); bir ibre hareket ediyorsa bekler, çünkü bir kare ~0,7 ms kesmeleri kapatır. Şeridin +12 V'u kartın **hep açık** FAN6/FAN7 soketinden (jumper 12 V), GND'si ortak GND'den; veri hattında 330–470 Ω seri direnç. FAN0..FAN5 anahtarlamalıdır, şerit gücü için kullanma.

`@<komut>\n` satırları Nextion'a gider (kart sonuna FF FF FF ekler). Ekrandan gelen her çerçeve `@<hex>\n` olarak geri döner.

## Ayarlar (`CFG`): Studio'nun Kart sayfası bunları kullanır
| Komut | Ne yapar |
|---|---|
| `CFG?` | Tüm ayarlar: `CFG M0 en=1 dir=1 ms=16 ma=500 hold=30 home=0 spr=200 sweep=2400 full=3000 vmax=500 acc=5000 sg=40` ×6, `CFG NX en=1 baud=115200`, `CFG END motors=6 saved=1` |
| `CFG M<n\|*> anahtar=değer …` | Motor ayarı, hemen uygulanır. Önce hepsi denetlenir, biri hatalıysa hiçbiri değişmez (`ERR CFG bad setting: …`) |
| `CFG NX en=0\|1 baud=…` | Ekran tüneli |
| `CFG SAVE` | Flash'a kaydet (~1 sn), güç kesilse de kalır |
| `CFG LOAD` / `CFG DEFAULTS` | Kayıtlıya / ilk açılış varsayılanlarına dön (kaydetmez) |

Anahtarlar: `en` motor açık, `dir` yön ters, `ms` mikroadım (1…256), `ma` akım mA (30–1500), `hold` beklerken akım %, `home` açılışta StallGuard sıfırlama, `spr` tur başına adım (200/400), `sweep` ibre açısı ×0,1° (2400 = 240°), `full` son çizgideki değer, `vmax` °/sn, `acc` °/sn², `sg` StallGuard eşiği, `hoff` (firmware 1.3) durdurucudan skalanın 0 çizgisine kaç derece ×0,1 (0…1800; 50 = 5°, varsayılan 5 = 0,5°): StallGuard sıfırlamasından sonra ibre saat yönünde bu kadar gider ve orası 0 olur. `H<n>` ile (Studio'da "Şimdi sıfırla") yeniden sıfırlayıp deneyebilirsin.

## Diğer komutlar (teşhis)
| Komut | Ne yapar |
|---|---|
| `?` | `OCTOPUS-GAUGES 1.2 motors=6 cfg=1 power=1 leds=24` |
| `LED?` / `LED n=… order=… bri=… seg=…` | LED zincirini listele / değiştir (yukarıdaki LED şeritler bölümü) |
| `W1` / `W0` / `W` | Güç çıkışı (FAN0) aç / kapat / durum |
| `I` | Her motorun durumu (ve güç çıkışı): TMC2209 cevabı, konum, akım, yön, skala; ayarlar kayıtlı mı; ekran sayaçları |
| `E1` / `E0` | Sürücüleri aç / kapat |
| `Z` | Şu anki iğne konumlarını 0 kabul et |
| `P<n>,<derece>` | Motor n'yi (ya da `*`) o açıya götür |
| `D<n>,<0\|1>` / `C<n>,<mA>` | Yön / akım (`CFG M<n> dir=` / `ma=` ile aynı; `CFG SAVE` kalıcı yapar) |
| `S<n>,<eşik>` / `G<n>` / `H<n>[,<eşik>]` | StallGuard eşiği / sonucu / sıfırlama denemesi |
| `T` | Hepsi 0 → tam skala → 0 |
| `U<n>` | TMC2209 UART ham okuma |
| `BOOTLOADER` | Motorları kapatır, karta DFU modunda reset atar (`flash.ps1` kullanır) |

## Derleme
Ubuntu'da (arduino-cli 1.5.1 ve `STMicroelectronics:stm32` çekirdeği **3.0.0** kurulu olmalı):
```
bash hardware/octopus-fw/build.sh gauges
```
Script `arduino-cli compile`'ı şu üç ayarla çalıştırır (elle derlersen üçünü de ekle):
- `build.flash_offset=0x8000`: uygulama 0x08008000'dan başlar, BTT önyükleyicisi (32 KiB) 0x08000000'da. **Bu olmadan ikili 0x08000000'a göre bağlanır ve karta yazılınca açılmaz.**
- `upload.maximum_size=360448` (0x58000): firmware 0x08060000'ın altında kalmalı, orası ayar sektörü (sektör 7).
- `build.extra_flags=-DHSE_VALUE=12000000UL`: karttaki 12 MHz kristal.

Kart tanımı (FQBN): `STMicroelectronics:stm32:GenF4:pnum=GENERIC_F446ZETX,usb=CDCgen,xusb=FS`. `gauges\build_opt.h` seri tamponlarını büyütür (Nextion için).

Script ELF'teki `.isr_vector` adresinin tam `0x08008000` olduğunu denetler (değilse hata verip çıkar), ikiliyi `out\firmware.bin` olarak koyar ve `out\firmware-on-board.bin` varsa onunla kaç baytın farklı olduğunu yazar (Windows'ta derlenmiş karttaki ikiliyle 9 bayt fark normal: derleyicinin yol metni `win32-x64` / `linux-x64`). Sonra, sorarak, `flash.ps1`.
