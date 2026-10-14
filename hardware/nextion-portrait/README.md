# Dikey Scania ekranı (Nextion 272×480)

Ekrandaki **değişen her şeyi Rig Buddy Studio çizer** (Nextion'un `xstr` / `xpic` / `fill` komutlarıyla). Nextion projesi sadece bir tuval: **resimler + fontlar + boş sayfalar**. Projede **hiç bileşen (text, picture, button…) yok**, dokunmatik sayfa geçişlerini de Studio yapar.

## Dosyalar
| Dosya | Ne |
|---|---|
| `layout.mjs` | **Tek kaynak**: sayfaların resimleri ve Studio'nun çizdiği her öğe (konum, font, renk, formül) |
| `layout.json`, `studio-display.json`, `preview-values.json` | `node layout.mjs` ve `node preview-values.mjs` üretir (git dışı; resim çizici ve Studio için) |
| `out\pictures\*.png` | **Nextion'a yüklenecek 8 resim** (numara sırasıyla; git dışı, `render.ps1` üretir) |
| `out\preview\*.png`, `out\sheet.png` | Örnek değerlerle sayfaların görünüşü (git dışı) |
| `render.ps1`, `preview-values.mjs` | Resimleri ve önizlemeleri üretir |
| `assets\logo.png` | Logo sayfasının resmi. **Depoda yok** (Scania amblemi ticari marka): kendi resmini koy, bkz. `assets\README.md` |

Tasarımı değiştirmek için `layout.mjs`'i düzenle, sonra (`hardware/nextion-portrait` klasöründe):
```
node layout.mjs
node preview-values.mjs
powershell -ExecutionPolicy Bypass -File render.ps1
```
İlk ikisi Ubuntu'da, `render.ps1` Windows PowerShell'de (System.Drawing) çalışır. `preview-values.mjs` Studio'nun formül motorunu depodan alır (`../../pc/agent/studio/expr.mjs`).
Değişen resimleri Nextion projesine yeniden ekle, değişen `studio-display.json`'ı Studio'ya uygula.

## Nextion Editor'de proje (bir kere, ~15 dk)
1. **Yeni proje**: aynı ekran modelini seç (şimdiki Scania projesindeki model). **Display Direction: 90°** (dikey) seç. Ekran 272×480 olmalı.
2. **Program.s**: en üstteki baud satırını `baud=115200` yap (Studio ve Octopus 115200 kullanıyor).
3. **Karakter seti**: proje ayarlarında (Settings → Character encoding) **iso-8859-9** seç.
4. **Fontlar** (Tools → Font Generator, font **Arial**, encoding **iso-8859-9**). **Bu sırayla** ekle, numaraları önemli:

   | No | Yükseklik | Kalın | Nerede |
   |---|---|---|---|
   | 0 | 16 | hayır | saat, küçük yazılar |
   | 1 | 24 | hayır | değerler |
   | 2 | 24 | **evet** | hız sabitleyici, hız limiti, ikaz başlığı |
   | 3 | 32 | **evet** | hedef şehir, kontak kapalıyken saat |
   | 4 | 112 | **evet** | hız (sadece rakamlar yeter) |

5. **Resimler**: `out\pictures` içindeki 8 PNG'yi **dosya adındaki numara sırasıyla** ekle (00 → resim 0 … 07 → resim 7). Sıkıştırma/dönüştürme sorulursa varsayılan.
6. **Sayfalar**: `page0` … `page6` (7 sayfa). Her sayfada **sta = image**, **pic** şu numara:

   | Sayfa | Ne | pic |
   |---|---|---|
   | page0 | Logo (kontak açık, motor kapalı) | 0 |
   | page1 | Sürüş | 1 |
   | page2 | İş ve yol | 3 |
   | page3 | Araç sistemleri | 4 |
   | page4 | Hasar | 5 |
   | page5 | Kontak kapalı | 6 |
   | page6 | İkaz | 7 |

   Resim 2 (`02_page1_lit.png`) bir sayfanın arka planı değil, Studio lambaları yakarken ondan kesit alıyor.
7. **Compile**, sonra **File → TFT file output**.
8. **Yükleme** (biri):
   - **microSD**: boş FAT32 karta sadece `.tft` dosyasını koy, Nextion'a tak, gücü aç, "Update successed" yazınca gücü kes, kartı çıkar.
   - **USB-TTL** ile Nextion Editor'den Upload (Nextion'u o sırada Octopus'tan söküp USB-TTL'e bağlaman gerekir).

## Studio'da
**Ekran** sayfasında **Scania dikey**'i aç ("Octopus gauges üzerinden" bağlı). Tanım dosyası `studio-display.json` (Studio'ya bu dosyadan eklenir). Sayfa geçişi: ekranın en altına dokun, sağ yarı sonraki, sol yarı önceki.

## Logo
`assets/logo.png` logo sayfasının (page0) resmidir, 136×130, `layout.mjs` onu yerleştirir. Yazarın kullandığı Scania amblemi ticari marka olduğu için depoda yok (git dışı, yalnızca yazarın bilgisayarında); kendi resmini koy. Yoksa `render.ps1` uyarı verip o resmi atlar. Sayfaların zemin rengi (`#0B1119`) amblemin zeminiyle aynı seçilmiştir.

## Sayfalar ne zaman açılır
- **page6 İkaz**: motor çalışırken hava basıncı acil / yağ basıncı / su sıcaklığı ikazı varken (diğer her şeyin önüne geçer)
- **page5 Kontak kapalı**: elektrik kapalı
- **page0 Logo**: kontak açık, motor kapalı
- **page1–4**: dokunarak gezilen sayfalar
- Oyun kapalıyken ekran uyur.
