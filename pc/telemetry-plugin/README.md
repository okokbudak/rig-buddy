# rigbuddy-telemetry.dll

Rig Buddy's own SCS telemetry plugin. It goes into each game's `bin\win_x64\plugins` folder next to
`scs-telemetry.dll` (scs-sdk-plugin, which Rig Buddy reads everything else from) and passes on what that plugin
predates: the bus DLC's job (the `bus_job` configuration and `bus_job.*` gameplay events of telemetry 1.20).

It writes `%LOCALAPPDATA%\Rig Buddy\live\<ets2|ats>-bus.json` whenever the bus job changes; the PC agent
(`pc/agent`) reads it and the app shows the line and routes to its next stop. It reads no game memory, so it does
not depend on the game version.

- Built with MSVC in CI (`.github/workflows/release.yml`, `rigbuddy-telemetry.sln`, Release|x64); the SCS SDK
  headers come from `../sound-plugin/inc`.
- A compile check without Windows: `x86_64-w64-mingw32-g++ -std=c++17 -shared -I ../sound-plugin/inc
  rigbuddy-telemetry/dllmain.cpp rigbuddy-telemetry.def -o rigbuddy-telemetry.dll`.
- Rig Buddy puts it into the games (`pc/host/PluginCheck.cs`, `--install-plugin`), together with scs-telemetry.dll.
