# Rig Buddy sound plugin (`rigbuddy-sound.dll`)

A telemetry plugin for Euro Truck Simulator 2 / American Truck Simulator that plays **FMOD sound mods** (`.bank`
files) in the game. Rig Buddy builds it, puts it into each game's `bin\win_x64\plugins` folder and manages the mods from
its **Sound mods…** window.

## Credit

This is [ts-fmod-plugin](https://github.com/dariowouters/ts-fmod-plugin) by **Dario Wouters**, MIT license (see
`LICENSE.md`), renamed and changed for Rig Buddy. The commit it is based on is in `UPSTREAM`. All the work of finding
the game's memory structures and wiring the sounds is his.

FMOD Studio by Firelight Technologies Pty Ltd. `inc/fmod` and `lib/` are FMOD API files, as the upstream project ships
them; the plugin uses the FMOD libraries that come with the game.

## What Rig Buddy changed

- **Name:** `rigbuddy-sound.dll`, files in `plugins\rigbuddy-sound\` (so it never clashes with a ts-fmod-plugin a user
  installed by hand), log lines start with `[rigbuddy-sound]`.
- **Live reload:** about once a second the plugin looks at `selected.bank.txt` and `sound_levels.txt`; when one changed,
  it unloads the old sound mods and loads the new ones (or the new levels) while the game runs. No `sdk reload`, no
  restart.
- **No mod, no failure:** an empty or missing `selected.bank.txt`, a mod that cannot be loaded or one without its
  `.bank.guids` file is skipped (and logged) instead of keeping the whole plugin from loading, so a mod picked later
  can still be loaded live.
- **Fix:** the sound-levels file path was kept as a reference to a temporary.

## Game updates

The plugin reads values from the game's memory and only loads on the game version it was made for
(`common::supported_game_version`). When the game updates: take over the upstream changes for the new version
(memory offsets / patterns in `dllmain.cpp` and `memory_structure.h`, the version in `common.h` and the `.rc`), keep
the Rig Buddy changes above, and release a new Rig Buddy.

## Build

Windows, Visual Studio (C++ desktop workload): `msbuild rigbuddy-sound.sln /p:Configuration=Release /p:Platform=x64`.
The release workflow does this on GitHub (`.github/workflows/release.yml`); the DLL lands in `dist\`. `game-files\`
holds what goes next to it in the game (`master.bank` per game, the default `sound_levels.txt`).
