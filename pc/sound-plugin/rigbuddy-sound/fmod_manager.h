#pragma once
#include <scssdk/scssdk.h>

#include <chrono>

#include "config.h"
#include "nlohmann/json.hpp"

using json = nlohmann::json;

#include "fmod_event.h"


class fmod_manager
{
    FMOD::System* core_system_ = nullptr;
    FMOD::Studio::System* system_ = nullptr;
    std::vector<std::string> selected_bank_names_;
    std::vector<FMOD::Studio::Bank*> selected_banks_; // unloaded again when the selection changes

    scs_log_t scs_log_;

    std::unordered_map<std::string, fmod_event> fmod_events_map_;
    std::unordered_map<std::string, FMOD::Studio::Bus*> fmod_busses_map_;

    // Rig Buddy: live reload. selected.bank.txt / sound_levels.txt are watched while the game runs.
    std::filesystem::path plugin_files_dir_;
    std::filesystem::file_time_type selected_time_{};
    std::filesystem::file_time_type levels_time_{};
    std::chrono::steady_clock::time_point next_check_{};

    bool load_selected_bank(const std::filesystem::path& plugin_files_dir);
    bool init_channels(const std::filesystem::path& plugin_files_dir);
    void apply_volumes();
    void reload_banks();
    void reload_levels();
    std::filesystem::file_time_type write_time(const char* file_name) const;

public:
    config* config = nullptr;

    explicit fmod_manager(scs_log_t scs_log);
    ~fmod_manager();

    bool init();

    /**
     * Called every frame: about once a second looks whether Rig Buddy (or the user) changed the selected sound mods or
     * the sound levels, and loads them. Returns true when the sound mods were reloaded (all events start over).
     */
    bool check_for_changes();

    void add_event(const char*, fmod_event event);
    void add_bus(const char* name, FMOD::Studio::Bus* bus);
    std::unique_ptr<fmod_event> get_event(const char* name);
    FMOD::Studio::Bus* get_bus(const char* name);

    void set_paused(bool state);
    FMOD_RESULT update() const;
    FMOD_RESULT set_global_parameter(const char* param_name, float value) const;
    FMOD_RESULT set_event_parameter(const char* event_name, const char* param_name, float value);
    FMOD_RESULT set_event_state(const char* event_name, bool state, bool only_when_event_stopped = false);
    FMOD_RESULT set_bus_volume(const char* bus_name, float value);
    FMOD_RESULT pause_bus(const char* bus_name, bool state);
};
