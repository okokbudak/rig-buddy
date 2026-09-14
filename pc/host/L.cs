// UI text in the supported languages. The setting (HKCU\Software\Rig Buddy\
// Language) defaults to "system": Windows' display language when supported,
// English otherwise. Keys missing a translation fall back to English.

using System.Globalization;
using Microsoft.Win32;

static class L
{
    const string Key = @"Software\Rig Buddy";

    public static readonly (string Code, string Name)[] Languages =
    [
        ("tr", "Türkçe"), ("en", "English"), ("de", "Deutsch"), ("ru", "Русский"),
        ("pt", "Português"), ("es", "Español"), ("fr", "Français"),
    ];

    public static string Code { get; private set; } = Resolve();

    /** Raised when the language changes (UI is rebuilt). */
    public static event Action? Changed;

    public static string Setting
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(Key);
            return key?.GetValue("Language") as string ?? "system";
        }
        set
        {
            using (var key = Registry.CurrentUser.CreateSubKey(Key)) key.SetValue("Language", value);
            string code = Resolve();
            if (code == Code) return;
            Code = code;
            Changed?.Invoke();
        }
    }

    public static string T(string key)
    {
        if (!Strings.TryGetValue(key, out var t)) return key;
        int i = Array.FindIndex(Languages, l => l.Code == Code);
        return i >= 0 && i < t.Length && !string.IsNullOrEmpty(t[i]) ? t[i] : t[1];
    }

    public static string T(string key, params object?[] args) => string.Format(T(key), args);

    public static string LanguageName(string setting) =>
        setting == "system" ? T("lang.system") : Languages.FirstOrDefault(l => l.Code == setting).Name ?? setting;

    static string Resolve()
    {
        string s = Setting;
        if (s != "system" && Languages.Any(l => l.Code == s)) return s;
        string ui = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        return Languages.Any(l => l.Code == ui) ? ui : "en";
    }

    // key -> [tr, en, de, ru, pt, es, fr]
    static readonly Dictionary<string, string[]> Strings = new()
    {
        // tray
        ["tray.open"] = ["Pencereyi aç", "Open window", "Fenster öffnen", "Открыть окно", "Abrir janela", "Abrir ventana", "Ouvrir la fenêtre"],
        ["tray.restart_hint"] = ["Tıkla: yeniden başlat", "Click: restart", "Klicken: neu starten", "Нажмите: перезапустить", "Clique: reiniciar", "Clic: reiniciar", "Clic : redémarrer"],
        ["tray.copy_hint"] = ["Tıkla: kopyala", "Click: copy", "Klicken: kopieren", "Нажмите: копировать", "Clique: copiar", "Clic: copiar", "Clic : copier"],
        ["tray.logs"] = ["Logları göster", "Show logs", "Protokolle anzeigen", "Показать журналы", "Mostrar logs", "Mostrar registros", "Afficher les journaux"],
        ["tray.theme"] = ["Tema", "Theme", "Design", "Тема", "Tema", "Tema", "Thème"],
        ["tray.language"] = ["Dil", "Language", "Sprache", "Язык", "Idioma", "Idioma", "Langue"],
        ["tray.exit"] = ["Çıkış", "Exit", "Beenden", "Выход", "Sair", "Salir", "Quitter"],
        ["tray.hidden"] = [
            "Arka planda çalışmaya devam ediyor. Kapatmak için simgeye sağ tıklayıp Çıkış'ı seçin.",
            "Still running in the background. To quit, right-click the icon and choose Exit.",
            "Läuft im Hintergrund weiter. Zum Beenden mit der rechten Maustaste auf das Symbol klicken und „Beenden“ wählen.",
            "Продолжает работать в фоне. Чтобы выйти, щёлкните значок правой кнопкой и выберите «Выход».",
            "Continua em execução em segundo plano. Para sair, clique com o botão direito no ícone e escolha Sair.",
            "Sigue funcionando en segundo plano. Para salir, haz clic derecho en el icono y elige Salir.",
            "Continue de fonctionner en arrière-plan. Pour quitter, faites un clic droit sur l’icône et choisissez Quitter.",
        ],
        ["tray.game_on"] = ["Oyun: bağlı", "Game: connected", "Spiel: verbunden", "Игра: подключена", "Jogo: conectado", "Juego: conectado", "Jeu : connecté"],
        ["tray.game_off"] = ["Oyun: bekleniyor", "Game: waiting", "Spiel: wird erwartet", "Игра: ожидание", "Jogo: aguardando", "Juego: esperando", "Jeu : en attente"],
        ["tray.pair"] = ["Eşleştirme kodu: {0}", "Pairing code: {0}", "Kopplungscode: {0}", "Код сопряжения: {0}", "Código de pareamento: {0}", "Código de emparejamiento: {0}", "Code d’appairage : {0}"],
        ["tray.address"] = ["PC adresi: {0}", "PC address: {0}", "PC-Adresse: {0}", "Адрес ПК: {0}", "Endereço do PC: {0}", "Dirección del PC: {0}", "Adresse du PC : {0}"],
        ["tray.no_network"] = ["PC adresi: ağ yok", "PC address: no network", "PC-Adresse: kein Netzwerk", "Адрес ПК: нет сети", "Endereço do PC: sem rede", "Dirección del PC: sin red", "Adresse du PC : pas de réseau"],
        ["state.running"] = ["çalışıyor", "running", "läuft", "работает", "em execução", "en marcha", "en cours"],
        ["state.starting"] = ["başlatılıyor…", "starting…", "startet…", "запускается…", "iniciando…", "iniciando…", "démarrage…"],
        ["state.restarting"] = ["yeniden başlatılacak", "restarting soon", "startet gleich neu", "скоро перезапуск", "reiniciando em breve", "se reiniciará pronto", "redémarrage imminent"],
        ["state.waiting"] = ["bekliyor", "waiting", "wartet", "ожидание", "aguardando", "esperando", "en attente"],
        ["state.stopped"] = ["durduruldu", "stopped", "gestoppt", "остановлен", "parado", "detenido", "arrêté"],
        ["tip.ready"] = ["hazır", "ready", "bereit", "готов", "pronto", "listo", "prêt"],
        ["tip.starting"] = ["başlatılıyor", "starting", "startet", "запуск", "iniciando", "iniciando", "démarrage"],
        ["tip.setup"] = ["kurulum eksik", "setup incomplete", "Einrichtung unvollständig", "установка не завершена", "instalação incompleta", "instalación incompleta", "installation incomplète"],
        ["tip.game"] = ["oyun bağlı", "game connected", "Spiel verbunden", "игра подключена", "jogo conectado", "juego conectado", "jeu connecté"],

        // main window
        ["win.subtitle"] = ["PC servisi · v{0}", "PC service · v{0}", "PC-Dienst · v{0}", "Служба ПК · v{0}", "Serviço do PC · v{0}", "Servicio del PC · v{0}", "Service PC · v{0}"],
        ["win.theme"] = ["Tema", "Theme", "Design", "Тема", "Tema", "Tema", "Thème"],
        ["win.language"] = ["Dil", "Language", "Sprache", "Язык", "Idioma", "Idioma", "Langue"],
        ["lang.auto"] = ["Otomatik", "Auto", "Automatisch", "Авто", "Automático", "Automático", "Auto"],
        ["win.preparing"] = ["Hazırlanıyor…", "Getting ready…", "Wird vorbereitet…", "Подготовка…", "Preparando…", "Preparando…", "Préparation…"],
        ["win.ready"] = ["Hazır", "Ready", "Bereit", "Готово", "Pronto", "Listo", "Prêt"],
        ["win.setup"] = ["Kurulum eksik", "Setup incomplete", "Einrichtung unvollständig", "Установка не завершена", "Instalação incompleta", "Instalación incompleta", "Installation incomplète"],
        ["win.game_connected"] = ["Oyun bağlı, iyi yolculuklar", "Game connected, drive safe", "Spiel verbunden, gute Fahrt", "Игра подключена, счастливого пути", "Jogo conectado, boa viagem", "Juego conectado, buen viaje", "Jeu connecté, bonne route"],
        ["win.open_game"] = ["Oyunu açabilirsiniz", "You can start the game", "Du kannst das Spiel starten", "Можно запускать игру", "Você já pode abrir o jogo", "Ya puedes abrir el juego", "Vous pouvez lancer le jeu"],
        ["win.server_stopped"] = ["Navigasyon sunucusu durduruldu", "Navigation server stopped", "Navigationsserver gestoppt", "Сервер навигации остановлен", "Servidor de navegação parado", "Servidor de navegación detenido", "Serveur de navigation arrêté"],
        ["win.address_title"] = ["Uygulamada girilecek PC adresi", "PC address to enter in the app", "PC-Adresse für die App", "Адрес ПК для ввода в приложении", "Endereço do PC para digitar no app", "Dirección del PC para la app", "Adresse du PC à saisir dans l’appli"],
        ["win.no_network"] = ["Ağ bağlantısı yok", "No network", "Kein Netzwerk", "Нет сети", "Sem rede", "Sin red", "Pas de réseau"],
        ["win.copied"] = ["Kopyalandı ✓", "Copied ✓", "Kopiert ✓", "Скопировано ✓", "Copiado ✓", "Copiado ✓", "Copié ✓"],
        ["win.pair"] = ["Eşleştirme kodu: {0}  ·  uygulama otomatik eşleşir", "Pairing code: {0}  ·  the app pairs automatically", "Kopplungscode: {0}  ·  die App koppelt automatisch", "Код сопряжения: {0}  ·  приложение подключится само", "Código: {0}  ·  o app pareia automaticamente", "Código: {0}  ·  la app se empareja sola", "Code : {0}  ·  l’appli s’appaire automatiquement"],
        ["win.click_copy"] = ["Tıklayınca kopyalanır", "Click to copy", "Klicken zum Kopieren", "Нажмите, чтобы скопировать", "Clique para copiar", "Haz clic para copiar", "Cliquez pour copier"],
        ["win.features"] = ["Özellikler", "Features", "Funktionen", "Функции", "Recursos", "Funciones", "Fonctions"],
        ["win.autostart"] = ["Windows açılışında başlat", "Start with Windows", "Mit Windows starten", "Запускать вместе с Windows", "Iniciar com o Windows", "Iniciar con Windows", "Lancer avec Windows"],
        ["win.restart"] = ["Servisleri yeniden başlat", "Restart services", "Dienste neu starten", "Перезапустить службы", "Reiniciar serviços", "Reiniciar servicios", "Redémarrer les services"],
        ["win.logs"] = ["Loglar", "Logs", "Protokolle", "Журналы", "Logs", "Registros", "Journaux"],
        ["f.nav"] = ["Navigasyon ve rota", "Navigation and routes", "Navigation und Routen", "Навигация и маршруты", "Navegação e rotas", "Navegación y rutas", "Navigation et itinéraires"],
        ["f.vehicle"] = ["Araç bilgisayarı", "Trip computer", "Bordcomputer", "Бортовой компьютер", "Computador de bordo", "Ordenador de a bordo", "Ordinateur de bord"],
        ["f.jobs"] = ["İşler ve profil", "Jobs and profile", "Aufträge und Profil", "Заказы и профиль", "Fretes e perfil", "Trabajos y perfil", "Missions et profil"],
        ["f.media"] = ["Medya ve radyo", "Media and radio", "Medien und Radio", "Медиа и радио", "Mídia e rádio", "Multimedia y radio", "Médias et radio"],
        ["f.devices"] = ["Bağlı cihazlar", "Connected devices", "Verbundene Geräte", "Подключённые устройства", "Dispositivos conectados", "Dispositivos conectados", "Appareils connectés"],
        ["fs.ready"] = ["Hazır", "Ready", "Bereit", "Готово", "Pronto", "Listo", "Prêt"],
        ["fs.stopped"] = ["Durduruldu", "Stopped", "Gestoppt", "Остановлено", "Parado", "Detenido", "Arrêté"],
        ["fs.loading"] = ["Yükleniyor… %{0}", "Loading… {0}%", "Lädt… {0} %", "Загрузка… {0}%", "Carregando… {0}%", "Cargando… {0} %", "Chargement… {0} %"],
        ["fs.starting"] = ["Başlatılıyor…", "Starting…", "Startet…", "Запуск…", "Iniciando…", "Iniciando…", "Démarrage…"],
        ["fs.game_data"] = ["Oyundan veri geliyor", "Receiving game data", "Spieldaten kommen an", "Данные из игры поступают", "Recebendo dados do jogo", "Recibiendo datos del juego", "Données du jeu reçues"],
        ["fs.game_wait"] = ["Oyun bekleniyor", "Waiting for the game", "Warte auf das Spiel", "Ожидание игры", "Aguardando o jogo", "Esperando el juego", "En attente du jeu"],
        ["fs.save_ok"] = ["Kayıt okundu", "Save game read", "Spielstand gelesen", "Сохранение прочитано", "Save lido", "Partida guardada leída", "Sauvegarde lue"],
        ["fs.save_wait"] = ["Kayıt bekleniyor", "Waiting for a save", "Warte auf Spielstand", "Ожидание сохранения", "Aguardando save", "Esperando partida guardada", "En attente d’une sauvegarde"],
        ["fs.devices"] = ["{0} cihaz bağlı", "{0} connected", "{0} verbunden", "Подключено: {0}", "{0} conectado(s)", "{0} conectado(s)", "{0} connecté(s)"],
        ["fs.devices_wait"] = ["Cihaz bekleniyor", "Waiting for a device", "Warte auf ein Gerät", "Ожидание устройства", "Aguardando dispositivo", "Esperando un dispositivo", "En attente d’un appareil"],
        ["percent"] = ["%{0}", "{0}%", "{0} %", "{0}%", "{0}%", "{0} %", "{0} %"],

        ["theme.system"] = ["Sistem", "System", "System", "Системная", "Sistema", "Sistema", "Système"],
        ["theme.system_long"] = ["Sistem (Windows temasını izler)", "System (follows Windows)", "System (folgt Windows)", "Системная (как в Windows)", "Sistema (segue o Windows)", "Sistema (sigue a Windows)", "Système (suit Windows)"],
        ["theme.light"] = ["Açık", "Light", "Hell", "Светлая", "Claro", "Claro", "Clair"],
        ["theme.dark"] = ["Koyu", "Dark", "Dunkel", "Тёмная", "Escuro", "Oscuro", "Sombre"],
        ["lang.system"] = ["Sistem dili", "System language", "Systemsprache", "Язык системы", "Idioma do sistema", "Idioma del sistema", "Langue du système"],

        // map build
        ["map.check"] = ["Harita kontrol ediliyor", "Checking the map", "Karte wird geprüft", "Проверка карты", "Verificando o mapa", "Comprobando el mapa", "Vérification de la carte"],
        ["map.parse"] = ["Oyun dosyaları okunuyor ({0})", "Reading game files ({0})", "Spieldateien werden gelesen ({0})", "Чтение файлов игры ({0})", "Lendo os arquivos do jogo ({0})", "Leyendo archivos del juego ({0})", "Lecture des fichiers du jeu ({0})"],
        ["map.labels"] = ["Yer adları hazırlanıyor ({0})", "Preparing place names ({0})", "Ortsnamen werden vorbereitet ({0})", "Подготовка названий ({0})", "Preparando nomes de lugares ({0})", "Preparando nombres de lugares ({0})", "Préparation des noms de lieux ({0})"],
        ["map.search"] = ["Arama verisi hazırlanıyor ({0})", "Building search data ({0})", "Suchdaten werden erstellt ({0})", "Подготовка данных поиска ({0})", "Criando dados de busca ({0})", "Creando datos de búsqueda ({0})", "Création des données de recherche ({0})"],
        ["map.graph"] = ["Yol ağı oluşturuluyor ({0})", "Building the road network ({0})", "Straßennetz wird erstellt ({0})", "Построение дорожной сети ({0})", "Montando a malha viária ({0})", "Creando la red de carreteras ({0})", "Création du réseau routier ({0})"],
        ["map.roundabouts"] = ["Kavşaklar işleniyor ({0})", "Processing roundabouts ({0})", "Kreisverkehre werden verarbeitet ({0})", "Обработка кольцевых развязок ({0})", "Processando rotatórias ({0})", "Procesando rotondas ({0})", "Traitement des ronds-points ({0})"],
        ["map.zip"] = ["Rota verisi paketleniyor ({0})", "Packing route data ({0})", "Routendaten werden gepackt ({0})", "Упаковка данных маршрутов ({0})", "Empacotando dados de rotas ({0})", "Empaquetando datos de rutas ({0})", "Empaquetage des données d’itinéraire ({0})"],
        ["map.geojson"] = ["Harita çiziliyor ({0})", "Drawing the map ({0})", "Karte wird gezeichnet ({0})", "Отрисовка карты ({0})", "Desenhando o mapa ({0})", "Dibujando el mapa ({0})", "Dessin de la carte ({0})"],
        ["map.postprocess"] = ["Yollar düzenleniyor ({0})", "Tidying up roads ({0})", "Straßen werden bereinigt ({0})", "Обработка дорог ({0})", "Ajustando estradas ({0})", "Ajustando carreteras ({0})", "Nettoyage des routes ({0})"],
        ["map.tiles"] = ["Harita parçaları üretiliyor ({0})", "Creating map tiles ({0})", "Kartenkacheln werden erstellt ({0})", "Создание фрагментов карты ({0})", "Criando blocos do mapa ({0})", "Creando teselas del mapa ({0})", "Création des tuiles de carte ({0})"],
        ["map.copy"] = ["Kaydediliyor ({0})", "Saving ({0})", "Wird gespeichert ({0})", "Сохранение ({0})", "Salvando ({0})", "Guardando ({0})", "Enregistrement ({0})"],
        ["map.sprites"] = ["Simgeler hazırlanıyor", "Preparing icons", "Symbole werden vorbereitet", "Подготовка значков", "Preparando ícones", "Preparando iconos", "Préparation des icônes"],
        ["map.done"] = ["Harita hazır", "Map ready", "Karte fertig", "Карта готова", "Mapa pronto", "Mapa listo", "Carte prête"],
        ["map.uptodate"] = ["Harita güncel", "Map is up to date", "Karte ist aktuell", "Карта актуальна", "Mapa atualizado", "Mapa al día", "Carte à jour"],
        ["win.map_building"] = ["Harita hazırlanıyor…", "Preparing the map…", "Karte wird vorbereitet…", "Подготовка карты…", "Preparando o mapa…", "Preparando el mapa…", "Préparation de la carte…"],
        ["win.map_once"] = ["Bu işlem yalnızca bir kez yapılır", "This is done only once", "Das passiert nur einmal", "Это делается только один раз", "Isso é feito só uma vez", "Esto solo se hace una vez", "Cela n’est fait qu’une fois"],
        ["win.map_failed"] = ["Harita hazırlanamadı", "Map could not be prepared", "Karte konnte nicht erstellt werden", "Не удалось подготовить карту", "Não foi possível preparar o mapa", "No se pudo preparar el mapa", "Impossible de préparer la carte"],
        ["win.map_retry"] = ["Tekrar dene", "Try again", "Erneut versuchen", "Повторить", "Tentar novamente", "Reintentar", "Réessayer"],
        ["win.map_update"] = ["Harita güncellemesi var · Güncelle", "Map update available · Update", "Kartenupdate verfügbar · Aktualisieren", "Доступно обновление карты · Обновить", "Atualização do mapa · Atualizar", "Actualización del mapa · Actualizar", "Mise à jour de la carte · Mettre à jour"],
        ["win.no_game"] = ["Oyun bulunamadı", "Game not found", "Spiel nicht gefunden", "Игра не найдена", "Jogo não encontrado", "Juego no encontrado", "Jeu introuvable"],
        ["win.no_game_hint"] = ["ETS2 ya da ATS'nin Steam'de kurulu olduğundan emin olun", "Make sure ETS2 or ATS is installed in Steam", "ETS2 oder ATS muss in Steam installiert sein", "Убедитесь, что ETS2 или ATS установлены в Steam", "Verifique se ETS2 ou ATS está instalado na Steam", "Asegúrate de tener ETS2 o ATS instalado en Steam", "Vérifiez que ETS2 ou ATS est installé dans Steam"],
        ["fs.map_building"] = ["Harita hazırlanıyor… %{0}", "Preparing map… {0}%", "Karte wird vorbereitet… {0} %", "Подготовка карты… {0}%", "Preparando o mapa… {0}%", "Preparando el mapa… {0} %", "Préparation de la carte… {0} %"],
        ["tray.map_update"] = ["Haritayı güncelle", "Update map", "Karte aktualisieren", "Обновить карту", "Atualizar mapa", "Actualizar mapa", "Mettre à jour la carte"],
        ["tray.map_rebuild"] = ["Haritayı yeniden oluştur", "Rebuild map", "Karte neu erstellen", "Пересоздать карту", "Recriar mapa", "Reconstruir mapa", "Reconstruire la carte"],

        // log window
        ["logs.title"] = ["Rig Buddy – Loglar", "Rig Buddy – Logs", "Rig Buddy – Protokolle", "Rig Buddy – Журналы", "Rig Buddy – Logs", "Rig Buddy – Registros", "Rig Buddy – Journaux"],
        ["logs.agent"] = ["Agent", "Agent", "Agent", "Агент", "Agente", "Agente", "Agent"],
        ["logs.telemetry"] = ["Telemetri", "Telemetry", "Telemetrie", "Телеметрия", "Telemetria", "Telemetría", "Télémétrie"],
        ["logs.folder"] = ["Klasörü aç", "Open folder", "Ordner öffnen", "Открыть папку", "Abrir pasta", "Abrir carpeta", "Ouvrir le dossier"],
        ["logs.copy"] = ["Kopyala", "Copy", "Kopieren", "Копировать", "Copiar", "Copiar", "Copier"],
        ["logs.pause"] = ["Duraklat", "Pause", "Pausieren", "Пауза", "Pausar", "Pausar", "Pause"],
        ["logs.resume"] = ["Devam et", "Resume", "Fortsetzen", "Продолжить", "Continuar", "Reanudar", "Reprendre"],
        ["logs.empty"] = ["(henüz log yok)", "(no log yet)", "(noch kein Protokoll)", "(журнала пока нет)", "(ainda sem log)", "(aún no hay registro)", "(pas encore de journal)"],

        // supervisor
        ["setup.missing"] = [
            "Kurulum eksik: setup\\setup-pc.ps1 çalıştırın.", "Setup incomplete: run setup\\setup-pc.ps1.",
            "Einrichtung unvollständig: setup\\setup-pc.ps1 ausführen.", "Установка не завершена: запустите setup\\setup-pc.ps1.",
            "Instalação incompleta: execute setup\\setup-pc.ps1.", "Instalación incompleta: ejecuta setup\\setup-pc.ps1.",
            "Installation incomplète : lancez setup\\setup-pc.ps1.",
        ],
        ["setup.nodata"] = [
            "Harita verisi yok: pipeline\\build-map-data.ps1 çalıştırın.", "No map data: run pipeline\\build-map-data.ps1.",
            "Keine Kartendaten: pipeline\\build-map-data.ps1 ausführen.", "Нет данных карты: запустите pipeline\\build-map-data.ps1.",
            "Sem dados do mapa: execute pipeline\\build-map-data.ps1.", "Sin datos del mapa: ejecuta pipeline\\build-map-data.ps1.",
            "Pas de données de carte : lancez pipeline\\build-map-data.ps1.",
        ],
        ["svc.server"] = ["Navigasyon sunucusu", "Navigation server", "Navigationsserver", "Сервер навигации", "Servidor de navegação", "Servidor de navegación", "Serveur de navigation"],
        ["svc.agent"] = ["Agent (araç, işler, medya)", "Agent (vehicle, jobs, media)", "Agent (Fahrzeug, Aufträge, Medien)", "Агент (машина, заказы, медиа)", "Agente (veículo, fretes, mídia)", "Agente (vehículo, trabajos, multimedia)", "Agent (véhicule, missions, médias)"],
        ["svc.telemetry"] = ["Telemetri istemcisi", "Telemetry client", "Telemetrie-Client", "Клиент телеметрии", "Cliente de telemetria", "Cliente de telemetría", "Client de télémétrie"],
        ["stage.init"] = ["Başlatılıyor", "Starting", "Startet", "Запуск", "Iniciando", "Iniciando", "Démarrage"],
        ["stage.start"] = ["Navigasyon sunucusu başlatılıyor", "Starting the navigation server", "Navigationsserver startet", "Запуск сервера навигации", "Iniciando o servidor de navegação", "Iniciando el servidor de navegación", "Démarrage du serveur de navigation"],
        ["stage.read"] = ["Harita verisi okunuyor ({0})", "Reading map data ({0})", "Kartendaten werden gelesen ({0})", "Чтение данных карты ({0})", "Lendo dados do mapa ({0})", "Leyendo datos del mapa ({0})", "Lecture des données de carte ({0})"],
        ["stage.graph"] = ["Yol ağı yükleniyor ({0})", "Loading the road network ({0})", "Straßennetz wird geladen ({0})", "Загрузка дорожной сети ({0})", "Carregando a malha viária ({0})", "Cargando la red de carreteras ({0})", "Chargement du réseau routier ({0})"],
        ["stage.geometry"] = ["Yol geometrisi hesaplanıyor", "Computing road geometry", "Straßengeometrie wird berechnet", "Расчёт геометрии дорог", "Calculando a geometria das vias", "Calculando la geometría de las vías", "Calcul de la géométrie des routes"],
        ["stage.index"] = ["Arama dizinleri hazırlanıyor", "Building search indexes", "Suchindizes werden erstellt", "Построение поисковых индексов", "Criando índices de busca", "Creando índices de búsqueda", "Création des index de recherche"],
        ["stage.open"] = ["Sunucu açılıyor", "Opening the server", "Server wird geöffnet", "Открытие сервера", "Abrindo o servidor", "Abriendo el servidor", "Ouverture du serveur"],
        ["stage.telemetry"] = ["Telemetri istemcisi bağlanıyor", "Connecting the telemetry client", "Telemetrie-Client verbindet", "Подключение клиента телеметрии", "Conectando o cliente de telemetria", "Conectando el cliente de telemetría", "Connexion du client de télémétrie"],
        ["stage.ready"] = ["Hazır", "Ready", "Bereit", "Готово", "Pronto", "Listo", "Prêt"],
    };
}
