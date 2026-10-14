# Dashboard hardware

The hardware side of Rig Buddy Studio: a gauge controller for analog dashboard needles and a Nextion touch display.
Rig Buddy Studio (the Studio page of the PC app) drives both over USB; see the main README.

## What is here

| Folder | What |
|---|---|
| `octopus-fw/` | Firmware for a **BTT Octopus Pro V1.0.1** (STM32F446ZET6) with six TMC2209 drivers and six NEMA17 motors: one gauge needle per motor. Settings live in the board's flash and are set from Studio's Board page. `build.sh` builds it, `flash.ps1` writes it over USB. Details in `octopus-fw/README.md` (Turkish). |
| `octopus-pro/` | Notes on the board (pins, electrical limits). |
| `nextion-portrait/` | A portrait (272 x 480) Nextion display: `layout.mjs` is the single source of the page pictures and of everything Studio draws on them. Steps for the Nextion Editor in `nextion-portrait/README.md` (Turkish). |

## What is not here

- The Scania emblem used on the logo page (trademark): put your own as `nextion-portrait/assets/logo.png`.
- BigTreeTech's PDFs and pictures: see `octopus-pro/README.md`.
- Built binaries (`*.bin`), the bootloader backup and generated files: they are git-ignored.

## Rules that save a board

- Every build for the Octopus **must** use the three properties `build.sh` sets: `build.flash_offset=0x8000`
  (the application starts at `0x08008000`; the BTT bootloader is at `0x08000000`), `upload.maximum_size=360448`
  (the settings sector at `0x08060000` must not be overwritten) and `-DHSE_VALUE=12000000UL` (12 MHz crystal).
  A binary linked for `0x08000000` does not start when written to `0x08008000`.
- Never write to `0x08000000` or `0x08060000`.
- Ask before anything that touches the board: flashing, `CFG SAVE`, driving motors, loading a `.tft` into the display.

---

# Gösterge donanımı

Rig Buddy Studio'nun donanım tarafı: analog gösterge ibreleri için bir kart ve bir Nextion dokunmatik ekran. İkisini de
Rig Buddy Studio (PC uygulamasındaki Studio sayfası) USB'den sürer; ana README'ye bakın.

| Klasör | Ne |
|---|---|
| `octopus-fw/` | **BTT Octopus Pro V1.0.1** (STM32F446ZET6) için firmware: altı TMC2209 ve altı NEMA17 motor, her motor bir gösterge ibresi. Ayarlar kartın flash'ında durur, Studio'nun Kart sayfasından yapılır. `build.sh` derler, `flash.ps1` USB'den yazar. |
| `octopus-pro/` | Kart notları (pinler, elektriksel sınırlar). |
| `nextion-portrait/` | Dikey (272 x 480) Nextion ekran: `layout.mjs`, sayfa resimlerinin ve Studio'nun üstlerine çizdiği her şeyin tek kaynağı. |

Depoya **girmeyenler**: Scania amblemi (ticari marka; kendi resminizi `nextion-portrait/assets/logo.png` olarak koyun), BTT'nin
PDF ve resimleri, derlenmiş `.bin` dosyaları, önyükleyici yedeği ve üretilen dosyalar (git bunları yok sayar).

**Kartı kurtaran kurallar:** Octopus'a giden her derleme `build.sh`'ın koyduğu üç ayarla yapılmalı
(`build.flash_offset=0x8000`, `upload.maximum_size=360448`, `-DHSE_VALUE=12000000UL`); `0x08000000` ve `0x08060000`
adreslerine yazılmaz; karta dokunan her işlemden önce (firmware yazma, `CFG SAVE`, motor sürme, `.tft` yükleme) sorulur.
