; Rig Buddy installer (Inno Setup 6). Built by setup\build-release.ps1, which
; stages the files first:
;   <SourceDir>\RigBuddy.exe          self-contained .NET app
;   <SourceDir>\node\node.exe         Node.js runtime for the services
;   <SourceDir>\dist\...              bundled services + map pipeline (setup\bundle.mjs)
;   <SourceDir>\plugin\scs-telemetry.dll
;   <SourceDir>\licenses\...
;
;   ISCC.exe /DAppVersion=0.1.0 /DSourceDir=... /DOutputDir=... setup\rigbuddy.iss
;
; What it does besides copying files: firewall rules for the phone / head unit
; (private networks only), the SCS telemetry plugin into ETS2 / ATS, and
; optionally autostart. The map data is built by the app on first start, from
; the user's own game files.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\local\release\app"
#endif
#ifndef OutputDir
  #define OutputDir "..\local\release"
#endif

[Setup]
AppId={{6B1C7E2A-4F0D-4B8E-9C3A-52D1E8A7F3B4}
AppName=Rig Buddy
AppVersion={#AppVersion}
AppVerName=Rig Buddy {#AppVersion}
AppPublisher=Orhan Kökbudak
AppPublisherURL=https://github.com/okokbudak/rig-buddy
AppSupportURL=https://github.com/okokbudak/rig-buddy/issues
AppCopyright=Copyright (C) 2026 Orhan Kökbudak. GPL-3.0-or-later.
DefaultDirName={autopf}\Rig Buddy
DefaultGroupName=Rig Buddy
DisableProgramGroupPage=yes
; admin: firewall rules, and the plugin goes into the game folders
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=RigBuddy-Setup
SetupIconFile=..\pc\host\rigbuddy.ico
UninstallDisplayIcon={app}\RigBuddy.exe
UninstallDisplayName=Rig Buddy
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
ShowLanguageDialog=auto
UsePreviousLanguage=no
VersionInfoVersion={#AppVersion}
VersionInfoProductName=Rig Buddy

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "pt"; MessagesFile: "compiler:Languages\Portuguese.isl"
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[CustomMessages]
en.TaskPlugin=Install the telemetry plugin into ETS2 / ATS (needed for navigation and the trip computer)
en.TaskAutostart=Start Rig Buddy with Windows
en.StatusFirewall=Allowing Rig Buddy through the Windows firewall...
en.StatusPlugin=Installing the telemetry plugin...
en.RemoveData=Also delete the map data and settings Rig Buddy created?%n%n%1
tr.TaskPlugin=Telemetri eklentisini ETS2 / ATS'ye kur (navigasyon ve yol bilgisayarı için gerekli)
tr.TaskAutostart=Rig Buddy'yi Windows ile birlikte başlat
tr.StatusFirewall=Windows güvenlik duvarı izinleri ekleniyor...
tr.StatusPlugin=Telemetri eklentisi kuruluyor...
tr.RemoveData=Rig Buddy'nin oluşturduğu harita verileri ve ayarlar da silinsin mi?%n%n%1
de.TaskPlugin=Telemetrie-Plugin in ETS2 / ATS installieren (für Navigation und Bordcomputer nötig)
de.TaskAutostart=Rig Buddy mit Windows starten
de.StatusFirewall=Windows-Firewall-Regeln werden hinzugefügt...
de.StatusPlugin=Telemetrie-Plugin wird installiert...
de.RemoveData=Auch die von Rig Buddy erstellten Kartendaten und Einstellungen löschen?%n%n%1
ru.TaskPlugin=Установить плагин телеметрии в ETS2 / ATS (нужен для навигации и бортового компьютера)
ru.TaskAutostart=Запускать Rig Buddy вместе с Windows
ru.StatusFirewall=Добавление правил брандмауэра Windows...
ru.StatusPlugin=Установка плагина телеметрии...
ru.RemoveData=Удалить также данные карты и настройки, созданные Rig Buddy?%n%n%1
ptbr.TaskPlugin=Instalar o plugin de telemetria no ETS2 / ATS (necessário para a navegação e o computador de bordo)
ptbr.TaskAutostart=Iniciar o Rig Buddy com o Windows
ptbr.StatusFirewall=Adicionando regras ao firewall do Windows...
ptbr.StatusPlugin=Instalando o plugin de telemetria...
ptbr.RemoveData=Excluir também os dados de mapa e as configurações criados pelo Rig Buddy?%n%n%1
pt.TaskPlugin=Instalar o plugin de telemetria no ETS2 / ATS (necessário para a navegação e o computador de bordo)
pt.TaskAutostart=Iniciar o Rig Buddy com o Windows
pt.StatusFirewall=A adicionar regras à firewall do Windows...
pt.StatusPlugin=A instalar o plugin de telemetria...
pt.RemoveData=Eliminar também os dados de mapa e as definições criados pelo Rig Buddy?%n%n%1
es.TaskPlugin=Instalar el plugin de telemetría en ETS2 / ATS (necesario para la navegación y el ordenador de a bordo)
es.TaskAutostart=Iniciar Rig Buddy con Windows
es.StatusFirewall=Añadiendo reglas al firewall de Windows...
es.StatusPlugin=Instalando el plugin de telemetría...
es.RemoveData=¿Eliminar también los datos de mapa y la configuración creados por Rig Buddy?%n%n%1
fr.TaskPlugin=Installer le plugin de télémétrie dans ETS2 / ATS (nécessaire pour la navigation et l'ordinateur de bord)
fr.TaskAutostart=Lancer Rig Buddy au démarrage de Windows
fr.StatusFirewall=Ajout des règles du pare-feu Windows...
fr.StatusPlugin=Installation du plugin de télémétrie...
fr.RemoveData=Supprimer aussi les données de carte et les réglages créés par Rig Buddy ?%n%n%1

[Tasks]
Name: "plugin"; Description: "{cm:TaskPlugin}"
Name: "autostart"; Description: "{cm:TaskAutostart}"
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[InstallDelete]
; an update replaces the bundle as a whole (no stale files from older versions)
Type: filesandordirs; Name: "{app}\dist"

[Files]
Source: "{#SourceDir}\RigBuddy.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs
Source: "{#SourceDir}\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs
Source: "{#SourceDir}\plugin\*"; DestDir: "{app}\plugin"; Flags: ignoreversion
Source: "{#SourceDir}\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Rig Buddy"; Filename: "{app}\RigBuddy.exe"
Name: "{autodesktop}\Rig Buddy"; Filename: "{app}\RigBuddy.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Rig Buddy"; \
  ValueData: """{app}\RigBuddy.exe"" --autostart"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
; firewall: the Node services (TCP 62840 navigation, 62843 agent) and the PC
; discovery (UDP 62846), private networks only; re-created on every install
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rig Buddy (Node.js)"""; Flags: runhidden; StatusMsg: "{cm:StatusFirewall}"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rig Buddy (discovery)"""; Flags: runhidden; StatusMsg: "{cm:StatusFirewall}"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Rig Buddy (Node.js)"" dir=in action=allow profile=private protocol=TCP localport=62840,62843 program=""{app}\node\node.exe"""; Flags: runhidden; StatusMsg: "{cm:StatusFirewall}"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Rig Buddy (discovery)"" dir=in action=allow profile=private protocol=UDP localport=62846 program=""{app}\RigBuddy.exe"""; Flags: runhidden; StatusMsg: "{cm:StatusFirewall}"
Filename: "{app}\RigBuddy.exe"; Parameters: "--install-plugin"; Flags: runhidden; Tasks: plugin; StatusMsg: "{cm:StatusPlugin}"
Filename: "{app}\RigBuddy.exe"; Description: "{cm:LaunchProgram,Rig Buddy}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rig Buddy (Node.js)"""; Flags: runhidden; RunOnceId: "FirewallNode"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rig Buddy (discovery)"""; Flags: runhidden; RunOnceId: "FirewallDiscovery"
; the telemetry plugin stays in the games: other telemetry tools use the same one

[Code]
const
  AppMutex = 'Local\RigBuddy.Host';

{ Asks a running Rig Buddy (any copy) to quit and waits for it, so its files
  and ports are free. }
procedure QuitRunningApp(Exe: String);
var
  Code, Waited: Integer;
begin
  if not CheckForMutexes(AppMutex) then Exit;
  Exec(Exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Waited := 0;
  while CheckForMutexes(AppMutex) and (Waited < 15000) do
  begin
    Sleep(250);
    Waited := Waited + 250;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  if CheckForMutexes(AppMutex) then
  begin
    ExtractTemporaryFile('RigBuddy.exe');
    QuitRunningApp(ExpandConstant('{tmp}\RigBuddy.exe'));
  end;
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  QuitRunningApp(ExpandConstant('{app}\RigBuddy.exe'));
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep <> usPostUninstall then Exit;
  Data := ExpandConstant('{localappdata}\Rig Buddy');
  { silent uninstalls (updates by script) keep the data }
  if (not UninstallSilent) and DirExists(Data) and
     (MsgBox(FmtMessage(CustomMessage('RemoveData'), [Data]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES) then
  begin
    DelTree(Data, True, True, True);
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Rig Buddy');
  end;
end;
