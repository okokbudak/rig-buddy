// dllmain.cpp : Defines the entry point for the DLL application.
#include "pch.h"

#include "sdk_stores.h"
#include "telemetry_data.h"
#include "memory_structure.h"
#include "memory.h"

fmod_manager* fmod_manager_instance = nullptr;

telemetry_data_t telemetry_data;

scs_log_t scs_log;

uintptr_t base_ctrl_ptr = NULL;
uintptr_t sound_system_ptr = NULL;
uint32_t game_actor_offset = 0;
uintptr_t game_base = NULL;
voice_navigation_sound_t* last_played = nullptr;
DWORD image_size = 0;

uint32_t stored_engine_state = 0;
byte indicator_stick_state = false;
bool was_indicator_light_on = false;
bool was_park_brake_on = false;
uint32_t prev_retarder_level = 0;
bool high_beams_enabled = false;
bool wipers_enabled = false;
float hazard_warning_state = 0.0f;
float light_horn_state = 0.0f;
float light_stick_state = 0.0f;
float wipers_stick_state = 0.0f;
float last_left_window_pos = 0.f;
float last_right_window_pos = 0.f;
bool is_air_pressure_warning_on = true;
bool is_window_moving = false;
bool is_left_window_button_active = false;
bool is_right_window_button_active = false;

// Rig Buddy: the game's objects are read through pointers whose layout can change with a game update. Never read
// memory that is not mapped: a wrong offset then gives a wrong value, not a crash.
static bool readable(const void* p, const size_t n)
{
    if (p == nullptr) return false;
    const auto* c = static_cast<const char*>(p);
    const auto* const end = c + n;
    MEMORY_BASIC_INFORMATION mbi;
    while (c < end)
    {
        if (VirtualQuery(c, &mbi, sizeof(mbi)) == 0) return false;
        if (mbi.State != MEM_COMMIT || (mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD)) != 0) return false;
        c = static_cast<const char*>(mbi.BaseAddress) + mbi.RegionSize;
    }
    return true;
}

// Rig Buddy: a file called debug.txt in the plugin's folder (<game>\bin\win_x64\plugins\rigbuddy-sound) switches on a
// log line every 3 s with the raw floats of the truck's control block and what the plugin makes of them. After a game
// update this is how the offsets in memory_structure.h are checked against the running game.
static void debug_dump(const game_actor_u* actor, const sound_library_t* interior)
{
    static ULONGLONG next_check = 0;
    static bool enabled = false;
    static ULONGLONG next_dump = 0;
    const auto now = GetTickCount64();
    if (now >= next_check)
    {
        next_check = now + 5000;
        char dll_path[MAX_PATH] = {};
        HMODULE module = nullptr;
        GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                           reinterpret_cast<LPCSTR>(&debug_dump), &module);
        GetModuleFileNameA(module, dll_path, MAX_PATH);
        std::string path(dll_path);
        path = path.substr(0, path.find_last_of("\\/") + 1) + "rigbuddy-sound\\debug.txt";
        enabled = GetFileAttributesA(path.c_str()) != INVALID_FILE_ATTRIBUTES;
    }
    if (!enabled || now < next_dump || !readable(actor, 0x480)) return;
    next_dump = now + 3000;

    const auto* raw = reinterpret_cast<const uint8_t*>(actor);
    char line[512];
    for (uint32_t base = 0x370; base < 0x470; base += 0x40)
    {
        std::string text;
        for (uint32_t o = base; o < base + 0x40; o += 4)
        {
            float f;
            memcpy(&f, raw + o, sizeof(f));
            snprintf(line, sizeof(line), " %03X=%.3f", o, f);
            text += line;
        }
        scs_log(SCS_LOG_TYPE_message, ("[rigbuddy-sound][debug] actor" + text).c_str());
    }
    snprintf(line, sizeof(line),
             "[rigbuddy-sound][debug] engine_state=%u turbo=%.3f lights=%.3f horn=%.3f hazard=%.3f wipers=%.3f "
             "engine_brake=%.3f | win L dir=%u mov=%u state=%.3f btn=%.3f | R dir=%u mov=%u state=%.3f btn=%.3f | rpm=%.0f gear=%d",
             actor->get_engine_state(), actor->get_turbo_pressure(), actor->get_light_switch_state(),
             actor->get_light_horn_state(), actor->get_hazard_warning_state(), actor->get_wipers_state(),
             actor->get_engine_brake_state(), actor->left_window_moving_direction, actor->is_left_window_moving,
             actor->left_window_state, actor->left_window_btn_state, actor->right_window_moving_direction,
             actor->is_right_window_moving, actor->right_window_state, actor->right_window_btn_state,
             telemetry_data.rpm, telemetry_data.gear);
    scs_log(SCS_LOG_TYPE_message, line);
    if (interior != nullptr && readable(interior, 0x1CC8))
    {
        snprintf(line, sizeof(line),
                 "[rigbuddy-sound][debug] sound_library interior_cam=%d camera_inside=%d window_state=(%.3f, %.3f) "
                 "cabin_out=%.3f cabin_rot=%.3f echo=%u now_playing_nav=%p",
                 interior->get_is_on_interior_cam(), interior->get_is_camera_inside(), interior->get_window_state().x,
                 interior->get_window_state().y, interior->cabin_out, interior->get_camera_rotation_in_cabin(),
                 interior->get_has_echo(), static_cast<const void*>(interior->get_now_playing_navigation_sound()));
        scs_log(SCS_LOG_TYPE_message, line);
    }
}

// Rig Buddy: the bus DLC's job. The telemetry plugin Rig Buddy reads (scs-sdk-plugin) predates it, and SCS has not
// documented the "bus_job" configuration's attributes yet (telemetry 1.20: "added bus job related configs, events and
// channels"). This plugin is a telemetry plugin too: it writes whatever the game sends for "bus_job" to bus_job.json in
// its folder (for the PC agent) and logs it, with every gameplay event, to the game log.
static std::string plugin_folder()
{
    char dll_path[MAX_PATH] = {};
    HMODULE module = nullptr;
    GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCSTR>(&plugin_folder), &module);
    GetModuleFileNameA(module, dll_path, MAX_PATH);
    std::string path(dll_path);
    return path.substr(0, path.find_last_of("\\/") + 1) + "rigbuddy-sound\\";
}

static std::string value_text(const scs_value_t& v)
{
    char b[160];
    switch (v.type)
    {
    case SCS_VALUE_TYPE_bool: return v.value_bool.value ? "true" : "false";
    case SCS_VALUE_TYPE_s32: return std::to_string(v.value_s32.value);
    case SCS_VALUE_TYPE_u32: return std::to_string(v.value_u32.value);
    case SCS_VALUE_TYPE_u64: return std::to_string(v.value_u64.value);
    case SCS_VALUE_TYPE_s64: return std::to_string(v.value_s64.value);
    case SCS_VALUE_TYPE_float: snprintf(b, sizeof(b), "%g", v.value_float.value); return b;
    case SCS_VALUE_TYPE_double: snprintf(b, sizeof(b), "%.10g", v.value_double.value); return b;
    case SCS_VALUE_TYPE_fvector:
        snprintf(b, sizeof(b), "%g %g %g", v.value_fvector.x, v.value_fvector.y, v.value_fvector.z); return b;
    case SCS_VALUE_TYPE_dvector:
        snprintf(b, sizeof(b), "%.10g %.10g %.10g", v.value_dvector.x, v.value_dvector.y, v.value_dvector.z); return b;
    case SCS_VALUE_TYPE_fplacement:
        snprintf(b, sizeof(b), "%g %g %g", v.value_fplacement.position.x, v.value_fplacement.position.y,
                 v.value_fplacement.position.z); return b;
    case SCS_VALUE_TYPE_dplacement:
        snprintf(b, sizeof(b), "%.10g %.10g %.10g", v.value_dplacement.position.x, v.value_dplacement.position.y,
                 v.value_dplacement.position.z); return b;
    case SCS_VALUE_TYPE_string: return v.value_string.value ? v.value_string.value : "";
    default: return "?";
    }
}

static std::string json_quote(const std::string& s)
{
    std::string out = "\"";
    for (const char ch : s)
    {
        if (ch == '"' || ch == '\\') { out += '\\'; out += ch; }
        else if (static_cast<unsigned char>(ch) < 0x20) out += ' ';
        else out += ch;
    }
    return out + "\"";
}

/** "name[3]=value ..." for the log and {"name[3]": "value", ...} for the file. */
static void describe(const scs_named_value_t* attributes, std::string& text, std::string& json)
{
    bool first = true;
    for (const auto* a = attributes; a != nullptr && a->name != nullptr; ++a)
    {
        std::string key = a->name;
        if (a->index != SCS_U32_NIL) key += "[" + std::to_string(a->index) + "]";
        const std::string val = value_text(a->value);
        text += " " + key + "=" + val;
        json += (first ? "" : ",") + json_quote(key) + ":" + json_quote(val);
        first = false;
    }
}

static void log_long(const std::string& line)
{
    for (size_t i = 0; i < line.size(); i += 900) scs_log(SCS_LOG_TYPE_message, line.substr(i, 900).c_str());
}

SCSAPI_VOID telemetry_configuration(const scs_event_t, const void* const event_info, scs_context_t)
{
    const auto* cfg = static_cast<const scs_telemetry_configuration_t*>(event_info);
    if (cfg == nullptr || cfg->id == nullptr) return;
    const std::string id = cfg->id;
    if (id != "bus_job" && id != "job") return;
    std::string text, json;
    describe(cfg->attributes, text, json);
    log_long("[rigbuddy-sound][config " + id + "]" + (text.empty() ? " (empty: no job)" : text));
    if (id != "bus_job") return;
    const std::string file = plugin_folder() + "bus_job.json";
    const std::string tmp = file + ".tmp";
    if (FILE* f = fopen(tmp.c_str(), "wb"))
    {
        const std::string body = "{\"attributes\":{" + json + "}}";
        fwrite(body.data(), 1, body.size(), f);
        fclose(f);
        MoveFileExA(tmp.c_str(), file.c_str(), MOVEFILE_REPLACE_EXISTING);
    }
}

SCSAPI_VOID telemetry_gameplay(const scs_event_t, const void* const event_info, scs_context_t)
{
    const auto* e = static_cast<const scs_telemetry_gameplay_event_t*>(event_info);
    if (e == nullptr || e->id == nullptr) return;
    std::string text, json;
    describe(e->attributes, text, json);
    log_long(std::string("[rigbuddy-sound][event ") + e->id + "]" + text);
}

scs_telemetry_register_for_channel_t register_for_channel = nullptr;
scs_telemetry_unregister_from_channel_t unregister_from_channel = nullptr;
#define register_channel(name, index, type, field) register_for_channel(SCS_TELEMETRY_##name, index, SCS_VALUE_TYPE_##type, SCS_TELEMETRY_CHANNEL_FLAG_no_value, telemetry_store_##type, &telemetry_data.field);

SCSAPI_VOID telemetry_pause(const scs_event_t event, const void* const event_info, scs_context_t context)
{
    fmod_manager_instance->set_paused(event == SCS_TELEMETRY_EVENT_paused);
}

bool should_engine_brake_sound_play()
{
    return telemetry_data.engine_brake && telemetry_data.effective_throttle < 0.05f && telemetry_data.gear != 0 &&
        telemetry_data.effective_clutch < 0.05f;
}

SCSAPI_VOID telemetry_tick(const scs_event_t event, const void* const event_info, scs_context_t context)
{
    // Rig Buddy: new sound mods while the game runs. The new events start silent, so forget what was playing: a running
    // engine is started again below on this very frame, the warnings on theirs.
    if (fmod_manager_instance->check_for_changes())
    {
        stored_engine_state = 0;
        last_played = nullptr;
        is_air_pressure_warning_on = false;
        is_window_moving = false;
    }

    fmod_manager_instance->set_event_parameter("engine/engine", "rpm", telemetry_data.rpm);
    fmod_manager_instance->set_event_parameter("engine/exhaust", "rpm", telemetry_data.rpm);
    fmod_manager_instance->set_event_parameter("engine/engine", "load", telemetry_data.effective_throttle);
    // The game might use some other value, but this seems close enough
    fmod_manager_instance->set_event_parameter("engine/exhaust", "load", telemetry_data.effective_throttle);

    if (base_ctrl_ptr != NULL)
    {
        if (game_actor_offset != 0)
        {
            const auto base_ctrl_address = *reinterpret_cast<uint64_t*>(base_ctrl_ptr);
            const auto game_actor_ptr = base_ctrl_address + game_actor_offset;
            const auto* game_actor = *reinterpret_cast<game_actor_u**>(game_actor_ptr);

            if (game_actor != nullptr && readable(game_actor, 0x480))
            {
                debug_dump(game_actor, *reinterpret_cast<sound_library_t**>(sound_system_ptr));
                const auto turbo_pressure = game_actor->get_turbo_pressure();
                if (turbo_pressure >= 0 && turbo_pressure <= 1)
                {
                    fmod_manager_instance->set_event_parameter("engine/turbo", "turbo", turbo_pressure);
                }

                const auto engine_state = game_actor->get_engine_state();
                if (engine_state != stored_engine_state) // engine state changed TODO: Find start_bad
                {
                    if (engine_state > 0 && stored_engine_state == 0)
                    {
                        // engine is starting/running
                        fmod_manager_instance->set_event_parameter("engine/engine", "play", 1);
                        fmod_manager_instance->set_event_parameter("engine/exhaust", "play", 1);
                        fmod_manager_instance->set_event_state("engine/engine", true);
                        fmod_manager_instance->set_event_state("engine/exhaust", true);

                        fmod_manager_instance->set_event_parameter("engine/turbo", "play", 1);
                        fmod_manager_instance->set_event_state("engine/turbo", true);
                    }
                    else if (engine_state == 0 || engine_state == 3) // engine is no longer running
                    {
                        fmod_manager_instance->set_event_parameter("engine/engine", "play", 0);
                        fmod_manager_instance->set_event_parameter("engine/exhaust", "play", 0);
                        fmod_manager_instance->set_event_parameter("engine/turbo", "play", 0);
                    }
                    stored_engine_state = engine_state;
                }

                fmod_manager_instance->set_event_parameter("engine/engine",
                                                           "brake",
                                                           should_engine_brake_sound_play()
                                                               ? game_actor->get_engine_brake_state()
                                                               : 0.0f);

                const auto hazard_warning = game_actor->get_hazard_warning_state();
                if (!common::cmpf(hazard_warning, hazard_warning_state))
                {
                    fmod_manager_instance->set_event_state("interior/stick_hazard_warning", true);
                    hazard_warning_state = hazard_warning;
                }

                const auto light_horn = game_actor->get_light_horn_state();
                if (!common::cmpf(light_horn, light_horn_state))
                {
                    fmod_manager_instance->set_event_state("interior/stick_light_horn", true);
                    light_horn_state = light_horn;
                }

                const auto stick_lights = game_actor->get_light_switch_state();
                if (!common::cmpf(stick_lights, light_stick_state))
                {
                    fmod_manager_instance->set_event_state("interior/stick_lights", true);
                    light_stick_state = stick_lights;
                }

                const auto wipers_stick = game_actor->get_wipers_state();
                if (!common::cmpf(wipers_stick, wipers_stick_state))
                {
                    fmod_manager_instance->set_event_state("interior/stick_wipers", true);
                    wipers_stick_state = wipers_stick;
                }

                if ((game_actor->is_left_window_moving != 0 || game_actor->is_right_window_moving != 0) &&
                    (game_actor->left_window_moving_direction > 2 || game_actor->right_window_moving_direction > 2))
                {
                    is_window_moving = true;
                    fmod_manager_instance->set_global_parameter("window_stop", 0.f);
                    fmod_manager_instance->set_event_state("interior/window_move", true, true);
                }
                else if (is_window_moving)
                {
                    is_window_moving = false;
                    fmod_manager_instance->set_global_parameter("window_stop", 1.0f);
                    fmod_manager_instance->set_event_state("interior/window_move", false);
                }
                if ((game_actor->left_window_state == 1.f && game_actor->left_window_btn_state == 1.f) ||
                    (game_actor->left_window_state == 0.f && game_actor->left_window_btn_state == 0.f))
                {
                    if (!is_left_window_button_active)
                    {
                        fmod_manager_instance->set_event_state("interior/window_click", true, false);
                    }
                    is_left_window_button_active = true;
                }
                else if (is_left_window_button_active)
                {
                    is_left_window_button_active = false;
                }
                if ((game_actor->right_window_state == 1.f && game_actor->right_window_btn_state == 1.f) ||
                    (game_actor->right_window_state == 0.f && game_actor->right_window_btn_state == 0.f))
                {
                    if (!is_right_window_button_active)
                    {
                        fmod_manager_instance->set_event_state("interior/window_click", true, false);
                    }
                    is_right_window_button_active = true;
                }
                else if (is_right_window_button_active)
                {
                    is_right_window_button_active = false;
                }
            }
        }

        const auto* interior = *reinterpret_cast<sound_library_t**>(sound_system_ptr);

        if (interior != nullptr && readable(interior, 0x1CC8))
        {
            const auto window_pos = interior->get_window_state();
            if (window_pos.x >= 0 && window_pos.x <= 1)
                fmod_manager_instance->set_global_parameter(
                    "wnd_left",
                    window_pos.x);
            if (window_pos.y >= 0 && window_pos.y <= 1)
                fmod_manager_instance->set_global_parameter(
                    "wnd_right",
                    window_pos.y);

            if (common::cmpf(window_pos.x, 0) && common::cmpf(window_pos.y, 0) && interior->
                get_is_camera_inside())
            {
                fmod_manager_instance->set_bus_volume("outside", fmod_manager_instance->config->windows_closed);
                fmod_manager_instance->set_bus_volume("exterior", fmod_manager_instance->config->windows_closed);
                // backward compatibility
            }
            else
            {
                fmod_manager_instance->set_bus_volume("outside", 1);
                fmod_manager_instance->set_bus_volume("exterior", 1); // backward compatibility
            }

            if (interior->get_is_on_interior_cam())
            {
                fmod_manager_instance->set_bus_volume("cabin/interior", fmod_manager_instance->config->interior);
            }
            else
            {
                fmod_manager_instance->set_bus_volume("cabin/interior", 0);
            }

            fmod_manager_instance->set_global_parameter("cabin_out", interior->get_cabin_out());
            fmod_manager_instance->set_global_parameter("cabin_rot",
                                                        interior->get_camera_rotation_in_cabin());
            fmod_manager_instance->set_global_parameter("surr_type", interior->get_has_echo());

            const auto now_playing_navigation_sound = interior->get_now_playing_navigation_sound();
            // (readable: a wrong offset would otherwise hand a wild pointer to get_event_name())
            if (now_playing_navigation_sound != nullptr && last_played != now_playing_navigation_sound &&
                readable(now_playing_navigation_sound, sizeof(voice_navigation_sound_t)) &&
                readable(now_playing_navigation_sound->get_event_name(), 1))
            {
                fmod_manager_instance->set_event_state(now_playing_navigation_sound->get_event_name(), true, true);
            }
            last_played = now_playing_navigation_sound;
        }
    }

#pragma region interior
    if (telemetry_data.brake_air_pressure_warning && telemetry_data.engine_enabled)
    {
        is_air_pressure_warning_on = true;
        fmod_manager_instance->set_event_state("interior/air_warning", true, true);
    }
    else if (is_air_pressure_warning_on)
    {
        is_air_pressure_warning_on = false;
        fmod_manager_instance->set_event_state("interior/air_warning", false);
    }

    if ((telemetry_data.light_lblinker || telemetry_data.light_rblinker) && !was_indicator_light_on)
    {
        fmod_manager_instance->set_event_state("interior/blinker_on", true);
        was_indicator_light_on = true;
    }
    else if (!telemetry_data.light_lblinker && !telemetry_data.light_rblinker && was_indicator_light_on)
    {
        fmod_manager_instance->set_event_state("interior/blinker_off", true);
        was_indicator_light_on = false;
    }

    if (telemetry_data.park_brake_on != was_park_brake_on)
    {
        if (was_park_brake_on) fmod_manager_instance->set_event_state("interior/stick_park_brake_off", true);
        else fmod_manager_instance->set_event_state("interior/stick_park_brake", true);
        was_park_brake_on = telemetry_data.park_brake_on;
    }

    const byte current_blinker_stick = telemetry_data.lblinker ? 1 : telemetry_data.rblinker ? 2 : 0;
    // 1 if lblinker, 2 if rblinker, 0 if off
    if (current_blinker_stick != indicator_stick_state && current_blinker_stick != 0)
    {
        fmod_manager_instance->set_event_state("interior/stick_blinker", true);
        indicator_stick_state = current_blinker_stick;
    }
    else if (current_blinker_stick == 0 && indicator_stick_state != 0)
    {
        fmod_manager_instance->set_event_state("interior/stick_blinker_off", true);
        indicator_stick_state = 0;
    }

    if (telemetry_data.retarder_level != prev_retarder_level)
    {
        fmod_manager_instance->set_event_state("interior/stick_retarder", true);
        prev_retarder_level = telemetry_data.retarder_level;
    }

    if (telemetry_data.high_beam != high_beams_enabled)
    {
        fmod_manager_instance->set_event_state("interior/stick_high_beam", true);
        high_beams_enabled = telemetry_data.high_beam;
    }
#pragma endregion
    fmod_manager_instance->update();
}


// https://stackoverflow.com/questions/940707/how-do-i-programmatically-get-the-version-of-a-dll-or-exe-file
DWORD get_product_version()
{
    DWORD ver_handle = 0;
    UINT size = 0;
    LPBYTE lp_buffer = nullptr;
    char module_file_name[MAX_PATH];
    module_file_name[0] = '\0';
    GetModuleFileNameA(nullptr, module_file_name, sizeof(module_file_name));
    const DWORD ver_size = GetFileVersionInfoSizeA(module_file_name, &ver_handle);

    DWORD version = 0;

    if (ver_size != NULL)
    {
        const auto ver_data = new char[ver_size];

        if (GetFileVersionInfoA(module_file_name, ver_handle, ver_size, ver_data))
        {
            if (VerQueryValueA(ver_data, "\\", reinterpret_cast<void* *>(&lp_buffer), &size))
            {
                if (size)
                {
                    if (const auto ver_info = reinterpret_cast<VS_FIXEDFILEINFO*>(lp_buffer); ver_info->dwSignature ==
                        0xfeef04bd)
                    {
                        version = (ver_info->dwFileVersionMS >> 0) & 0xffff;
                    }
                }
            }
        }
        delete[] ver_data;
    }
    return version;
}

void register_telem_channels()
{
    register_channel(TRUCK_CHANNEL_engine_rpm, SCS_U32_NIL, float, rpm)
    register_channel(TRUCK_CHANNEL_effective_throttle, SCS_U32_NIL, float, effective_throttle)
    register_channel(TRUCK_CHANNEL_effective_clutch, SCS_U32_NIL, float, effective_clutch)
    register_channel(TRUCK_CHANNEL_motor_brake, SCS_U32_NIL, bool, engine_brake)
    register_channel(TRUCK_CHANNEL_brake_air_pressure_warning, SCS_U32_NIL, bool, brake_air_pressure_warning)
    register_channel(TRUCK_CHANNEL_engine_enabled, SCS_U32_NIL, bool, engine_enabled)
    register_channel(TRUCK_CHANNEL_lblinker, SCS_U32_NIL, bool, lblinker)
    register_channel(TRUCK_CHANNEL_rblinker, SCS_U32_NIL, bool, rblinker)
    register_channel(TRUCK_CHANNEL_light_lblinker, SCS_U32_NIL, bool, light_lblinker)
    register_channel(TRUCK_CHANNEL_light_rblinker, SCS_U32_NIL, bool, light_rblinker)
    register_channel(TRUCK_CHANNEL_head_offset, SCS_U32_NIL, fplacement, head_offset)
    register_channel(TRUCK_CHANNEL_parking_brake, SCS_U32_NIL, bool, park_brake_on)
    register_channel(TRUCK_CHANNEL_retarder_level, SCS_U32_NIL, u32, retarder_level)
    register_channel(TRUCK_CHANNEL_light_high_beam, SCS_U32_NIL, bool, high_beam)
    register_channel(TRUCK_CHANNEL_wipers, SCS_U32_NIL, bool, wipers)
    register_channel(TRUCK_CHANNEL_engine_gear, SCS_U32_NIL, s32, gear)
}

SCSAPI_RESULT scs_telemetry_init(const scs_u32_t version, const scs_telemetry_init_params_t* const params)
{
    const auto* const version_params = reinterpret_cast<const scs_telemetry_init_params_v101_t*>(params);

    scs_log = version_params->common.log;
    const auto game_version = get_product_version();

    if (game_version != common::supported_game_version)
    {
        std::stringstream ss;
        ss << "[rigbuddy-sound V" << common::plugin_version << "] Detected game version 1." << game_version
            << " while plugin is made for version 1." << common::supported_game_version <<
            ". The plugin will not load to prevent crashes.";
        scs_log(SCS_LOG_TYPE_error, ss.str().c_str());
        return SCS_RESULT_generic_error;
    }
    std::stringstream ss;
    ss << "[rigbuddy-sound V" << common::plugin_version <<
        "] Searching for memory offsets... If this is one of the last messages in the log after a crash, try disabling this plugin.";
    scs_log(SCS_LOG_TYPE_message, ss.str().c_str());

    const auto base_ctrl_ptr_offset = pattern::scan("48 8b ? ? ? ? ? 48 8b ? 48 8b ? 48 8b 80", game_base, image_size);
    if (base_ctrl_ptr_offset == NULL)
    {
        version_params->common.log(SCS_LOG_TYPE_error, "[rigbuddy-sound] Unable to find base_ctrl pointer offset");
        return SCS_RESULT_generic_error;
    }
    base_ctrl_ptr = base_ctrl_ptr_offset + *reinterpret_cast<int32_t*>(base_ctrl_ptr_offset + 3) + 7;
    game_actor_offset = *reinterpret_cast<uint32_t*>(base_ctrl_ptr_offset + 16);

    const auto sound_system_ptr_offset = pattern::scan("44 38 3b 0f 84 ? ? ? ? 8b 05 ? ? ? ? 48 8b 3d ? ? ? ? 85 c0 74", game_base, image_size);
    if (sound_system_ptr_offset == NULL)
    {
        version_params->common.log(SCS_LOG_TYPE_error, "[rigbuddy-sound] Unable to find sound_system pointer offset");
        return SCS_RESULT_generic_error;
    }
    sound_system_ptr = sound_system_ptr_offset + *reinterpret_cast<int32_t*>(sound_system_ptr_offset + 18) + 22;

    ss.str("");
    ss << "[rigbuddy-sound] Found base_ctrl @ " << std::hex << (base_ctrl_ptr - game_base) << " and sound_system @ " << (sound_system_ptr - game_base);
    scs_log(SCS_LOG_TYPE_message, ss.str().c_str());

    const auto events_registered =
        (version_params->register_for_event(SCS_TELEMETRY_EVENT_paused, telemetry_pause, nullptr) == SCS_RESULT_ok) &&
        (version_params->register_for_event(SCS_TELEMETRY_EVENT_started, telemetry_pause, nullptr) == SCS_RESULT_ok) &&
        (version_params->register_for_event(SCS_TELEMETRY_EVENT_frame_end, telemetry_tick, nullptr) == SCS_RESULT_ok);

    if (!events_registered)
    {
        version_params->common.log(SCS_LOG_TYPE_error, "[rigbuddy-sound] Unable to register event callbacks");
        return SCS_RESULT_generic_error;
    }
    // Rig Buddy: the bus job and gameplay events (see telemetry_configuration); not needed for the sounds, so a game that
    // refuses them only loses that
    if (version_params->register_for_event(SCS_TELEMETRY_EVENT_configuration, telemetry_configuration, nullptr) != SCS_RESULT_ok ||
        version_params->register_for_event(SCS_TELEMETRY_EVENT_gameplay, telemetry_gameplay, nullptr) != SCS_RESULT_ok)
    {
        version_params->common.log(SCS_LOG_TYPE_warning, "[rigbuddy-sound] No configuration / gameplay events: the bus job is not passed on");
    }
    register_for_channel = version_params->register_for_channel;

    fmod_manager_instance = new fmod_manager(scs_log);

    if (!fmod_manager_instance->init())
    {
        scs_log(SCS_LOG_TYPE_error, "[rigbuddy-sound] Could not init fmod");
        return SCS_RESULT_generic_error;
    }

    register_telem_channels();

    scs_log(0, "[rigbuddy-sound] Plugin loaded");

    return SCS_RESULT_ok;
}

void shutdown()
{
    if (fmod_manager_instance != nullptr)
    {
        delete fmod_manager_instance;
        fmod_manager_instance = nullptr;
    }
}

SCSAPI_VOID scs_telemetry_shutdown(void)
{
    shutdown();
}

BOOL APIENTRY DllMain(HMODULE hModule,
                      DWORD ul_reason_for_call,
                      LPVOID lpReserved
)
{
    if (ul_reason_for_call == DLL_PROCESS_ATTACH)
    {
        game_base = reinterpret_cast<uintptr_t>(GetModuleHandleA(nullptr));
        const auto* header = reinterpret_cast<const IMAGE_DOS_HEADER*>(game_base);
        const auto* nt_header = reinterpret_cast<const IMAGE_NT_HEADERS64*>(reinterpret_cast<const uint8_t*>(
            header) + header->e_lfanew);
        image_size = nt_header->OptionalHeader.SizeOfImage;
    }
    return TRUE;
}
