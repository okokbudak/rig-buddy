# ETS2 Nav

Euro Truck Simulator 2 için araç içi multimedya ekranı. Eski ve zayıf Android
head unit'lerde (Android 5+ / GLES2, 1 GB RAM) çalışır ve cihazın ana ekranı
(launcher) olur. Oyun PC'de çalışırken ekran gerçek bir kamyon multimedyası
gibi davranır:

- **Harita / Navigasyon:** Google Maps benzeri harita, oyunun kendi yol ağıyla
  rota hesaplama, dönüş dönüş yönlendirme, hedef arama, yakındaki
  benzinlik/servis/park yeri. Sahip olduğun **tüm harita DLC'leri** dahildir,
  çünkü veri doğrudan senin oyun kurulumundan üretilir.
- **Araç bilgisayarı:** hız, devir, vites, yakıt ve menzil, AdBlue, hasar,
  sıcaklıklar, basınçlar, uyarı lambaları, yolculuk verileri.
- **İşler:** kayıttaki iş pazarındaki işler (yük, kazanç, mesafe, süre). İşi
  işaretleyince uygulama o işin rotasını çizer.
- **Profil:** para, seviye ve XP, şirket, garajlar, kamyonlar, sürücüler,
  gezilen şehirler.
- **Medya:** PC'de çalan Spotify, Chrome, YouTube vb. (şarkı, kapak, oynat,
  duraklat, ileri, geri, ses) ve oyun içi radyo (istasyon ve çalan şarkı).

> Bu proje SCS Software ile bağlantılı değildir. Depoda oyun verisi **yoktur**:
> harita, rota, ikon ve şehir verileri kurulum sırasında senin kendi oyun
> dosyalarından üretilir.

## Mimari

```
 ┌─────────────────── Oyun PC'si: bin\ETS2Nav.exe (tepside) ──────────────┐
 │ ETS2 + scs-telemetry.dll ──(shared memory)──► telemetri köprüsü :62841 │
 │                                               medya oturumları  :62844 │
 │   Node servisleri (exe başlatır, izler, çökünce yeniden başlatır):     │
 │     telemetri istemcisi ──► navigasyon sunucusu :62840 (rota, arama)   │
 │     pc\agent :62843  tam telemetri, kayıt (işler, profil), medya, radyo │
 └───────────────────────────────┬────────────────────────────────────────┘
                                 │ Wi-Fi (WebSocket)
 ┌───────────────────────────────▼────────────────────────────────────────┐
 │ Head unit: ETS2 Nav APK (android\)                                      │
 │   MapLibre + yerel ets2.mbtiles (cihazda), ekranlar, launcher          │
 └────────────────────────────────────────────────────────────────────────┘
```

| Klasör | İçerik |
|---|---|
| `android/` | Head unit uygulaması (Java, MapLibre Native, OkHttp) |
| `pc/host/` | PC uygulaması `ETS2Nav.exe` (C#/.NET 8, tepsi uygulaması). SCS shared memory köprüsü, Windows medya oturumları, uygulama bazında ses; Node servislerini de yönetir |
| `pc/agent/` | Node servisi: tam telemetri, kayıt dosyası çözümü (işler, profil), medya ve radyo |
| `pc/patches/` | `truckermudgeon/maps` üzerine uygulanan yamalar ve telemetri eklentisi yerine geçen `scsSDKTelemetry.js` |
| `pipeline/` | Oyun dosyalarından harita, rota ve ikon verisini üreten script'ler (WSL) |
| `setup/` | Kurulum script'leri |
| `dev/` | Geliştirme araçları: simülasyon, deploy, protokol testleri |

Kurulumun ürettiği ve git'e girmeyen klasörler: `vendor/` (Node, Gradle,
tm-maps), `data/` (oyundan üretilen veri), `bin/` (ETS2Nav.exe), `logs/`, `local/`.

## Gereksinimler

**Oyun PC'si:** Windows 10/11, ETS2 **ve** ATS (Steam; navigasyon sunucusu iki
haritayı birlikte yüklüyor), [Git](https://git-scm.com), [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0),
JDK 17 (`winget install Microsoft.OpenJDK.17`), Android SDK platform-tools
(Android Studio veya `winget install Google.PlatformTools`), veri üretimi için
WSL'de Ubuntu ve Node.js 22+. Veri üretiminde 16 GB RAM önerilir.

**Head unit:** Android 5.0+ (API 21), ARMv7, Wi-Fi ile PC'yle aynı ağda,
ADB açık (USB veya Wi-Fi ADB).

## Kurulum

PowerShell'de, depo klasöründe çalıştır:

```powershell
# 1) Node, Gradle ve tm-maps'i vendor\ içine indirir ve yamaları uygular.
#    ETS2Nav.exe'yi derleyip Başlat menüsüne ekler, telemetri eklentisini ETS2
#    ve ATS'ye kurar, harita fontlarını indirir. Son adımda güvenlik duvarı
#    izni için yönetici onayı ister.
powershell -ExecutionPolicy Bypass -File setup\setup-pc.ps1

# 2) Oyun dosyalarından harita, rota, şehir ve ikon verisini üretir.
#    Bir kez yapılır; oyun güncellemesi veya yeni DLC sonrası tekrar çalıştırılır.
#    WSL'de 30-60 dk sürer.
powershell -ExecutionPolicy Bypass -File pipeline\build-map-data.ps1

# 3) APK'yı derler, head unit'e kurar, haritayı yükler, ana ekran yapar.
powershell -ExecutionPolicy Bypass -File setup\install-headunit.ps1 -Device 192.168.1.50:5555 -PcHost 192.168.1.10 -SetHome
```

`-Device`, head unit'in ADB adresidir; `-PcHost` bu PC'nin yerel IP'sidir
(`ipconfig`). `-PcHost` verilmezse uygulama ilk açılışta sorar; sonradan
**Ayarlar → PC adresi** menüsünden değiştirilebilir.

Head unit PC'ye 62840 ve 62843 portlarından bağlanır. İzin
`setup\allow-firewall.ps1` ile verilir (setup-pc.ps1 bunu otomatik çalıştırır).
Bu izin yalnızca **Özel** ağlarda geçerlidir, bu yüzden Windows ağ ayarlarında
ağın "Özel" olması gerekir. Windows'un güvenlik duvarı penceresi bir kez
"İptal" ile kapatıldıysa engelleme kuralı oluşur; script bu kuralı da temizler.

## Kullanım

1. Başlat menüsünden **ETS2 Nav**'ı aç. Pencere açılmaz; saat yanındaki
   tepside mavi bir simge belirir. Simgenin köşesindeki nokta durumu gösterir:
   yeşil hazır, turuncu başlatılıyor, kırmızı kurulum eksik.
   Simgeye tıklayınca şunlar görünür: servislerin durumu, oyun bağlantısı,
   PC adresi (head unit'e girilecek IP), servisleri yeniden başlat, log
   klasörünü aç, **Windows açılışında başlat**, çıkış.
2. Oyunu aç. Head unit kayıtlı PC adresine bağlanır ve otomatik eşleşir.

Script veya kısayoldan kontrol için:
`ETS2Nav.exe --quit`, `--restart [server|agent|telemetry]`, `--status`.

Loglar `logs\` klasörüne yazılır: `ets2nav.log`, `server.log`,
`agent.log`, `telemetry.log`.

**Not:** Kurulumdan sonra depo klasörünü taşırsan `setup\setup-pc.ps1`'i
tekrar çalıştır. npm'in oluşturduğu klasör bağlantıları mutlak yol kullanıyor.

## Geliştirme

- `dev\dev.env.example` dosyasını `dev\dev.env` olarak kopyala, sonra
  `dev/dev-deploy.sh` (Git Bash) ile derle, kur ve ekran görüntüsü al.
- Oyun olmadan test için simülasyon kullanılır (ETS2Nav.exe açıkken).
  `dev\dev-run-sim.ps1 berlin hamburg 90` sentetik bir sürüş kaydı üretir.
  `dev\dev-play-recording.ps1` bu kaydı telemetri istemcisine oynatır.
  Canlı telemetriye dönmek için tepsi menüsünde telemetri satırına tıkla.
- PC uygulamasını yeniden derlemek için:
  `dotnet publish pc\host\ETS2Nav.csproj -c Release -o bin`
- Protokol testleri `dev\test-*.mjs` dosyalarıdır, `vendor\node\node.exe` ile
  çalıştırılır.
- tm-maps'te değişiklik yaparsan `vendor\tm-maps` içinde `ets2nav-local`
  dalına commit at, sonra yamaları yeniden üret:
  `git -C vendor\tm-maps format-patch d56d0e3..ets2nav-local -o ..\..\pc\patches\tm-maps`

## Teşekkürler ve lisanslar

- [truckermudgeon/maps](https://github.com/truckermudgeon/maps) (GPL-3.0):
  oyun dosyası ayrıştırıcısı, harita ve rota verisi üretici, navigasyon sunucusu.
  Depoya kodu değil, yalnızca yamaları (`pc/patches/tm-maps`) dahil edildi.
- [truckermudgeon/scs-sdk-plugin](https://github.com/truckermudgeon/scs-sdk-plugin)
  (RenCloud/scs-sdk-plugin çatalı): oyun telemetri eklentisi.
- [trucksim-telemetry](https://github.com/kniffen/TruckSim-Telemetry) (MIT).
- [MapLibre Native](https://github.com/maplibre/maplibre-native) (BSD-2-Clause),
  [OkHttp](https://github.com/square/okhttp) (Apache-2.0),
  [NAudio](https://github.com/naudio/NAudio) (MIT),
  [ws](https://github.com/websockets/ws) (MIT).
- Harita fontları: [OpenMapTiles fonts](https://github.com/openmaptiles/fonts)
  (Noto Sans, SIL OFL 1.1).
- Euro Truck Simulator 2 ve American Truck Simulator, SCS Software'in
  ticari markalarıdır.
