// rigbuddy-telemetry.dll: Rig Buddy's own SCS telemetry plugin. It sits next to scs-telemetry.dll (scs-sdk-plugin, the
// one Rig Buddy reads everything else from) and passes on what that plugin predates: the bus DLC's job (telemetry
// 1.20 "added bus job related configs, events and channels"; SCS has not documented the attributes yet).
//
// Whenever the game sends the "bus_job" configuration or a "bus_job.*" gameplay event, this writes
//   %LOCALAPPDATA%\Rig Buddy\live\<ets2|ats>-bus.json
//   {"game":"ets2","written":<unix ms>,"active":true,"job":{"<attribute>[<index>]":"<value>",...},
//    "event":{"id":"bus_job.completed","at":<unix ms>,"attributes":{...}}}
// which the PC agent (pc/agent) reads. What a bus job sends (seen on 1.62):
//   bus.stages.count=1 bus.stages.current=0 income=1977 planned_distance.km=90 bus_job.market=company_job
//   source_stop.type[0]=city source_stop.id[0]=akureyri source_stop.name[0]=Akureyri
//   destination_stop.type[0]=city destination_stop.id[0]=husavik destination_stop.name[0]=Húsavík
//   source_stop.departure_time.planned[0]=3510 destination_stop.arrival_time.planned[0]=3625
//   source_stop.entering_passengers.planned[0]=26 destination_stop.leaving_passengers.planned[0]=26
// and without a job the configuration comes with no attributes (active: false). Values are passed on as text, so
// attributes a later game version adds come along without a new plugin.
//
// No game memory is read: the plugin works with any game version that has the telemetry API.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdio>
#include <string>

#include "scssdk/scssdk_telemetry.h"

namespace
{
    scs_log_t game_log = nullptr;
    std::wstring out_file;        // ...\Rig Buddy\live\ets2-bus.json
    std::string game_name = "ets2";
    std::string job_json;         // the last "bus_job" configuration's attributes (without braces)
    bool job_active = false;
    std::string event_json;       // the last bus_job.* event, or empty

    void log(const scs_log_type_t type, const std::string& text)
    {
        if (game_log != nullptr) game_log(type, ("[rigbuddy-telemetry] " + text).c_str());
    }

    unsigned long long now_ms()
    {
        FILETIME ft;
        GetSystemTimeAsFileTime(&ft);
        const unsigned long long t = (static_cast<unsigned long long>(ft.dwHighDateTime) << 32) | ft.dwLowDateTime;
        return t / 10000ULL - 11644473600000ULL; // 100 ns since 1601 -> ms since 1970
    }

    std::string value_text(const scs_value_t& v)
    {
        char b[200];
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
            snprintf(b, sizeof(b), "%g %g %g", v.value_fvector.x, v.value_fvector.y, v.value_fvector.z);
            return b;
        case SCS_VALUE_TYPE_dvector:
            snprintf(b, sizeof(b), "%.10g %.10g %.10g", v.value_dvector.x, v.value_dvector.y, v.value_dvector.z);
            return b;
        case SCS_VALUE_TYPE_fplacement:
            snprintf(b, sizeof(b), "%g %g %g", v.value_fplacement.position.x, v.value_fplacement.position.y,
                     v.value_fplacement.position.z);
            return b;
        case SCS_VALUE_TYPE_dplacement:
            snprintf(b, sizeof(b), "%.10g %.10g %.10g", v.value_dplacement.position.x, v.value_dplacement.position.y,
                     v.value_dplacement.position.z);
            return b;
        case SCS_VALUE_TYPE_string: return v.value_string.value != nullptr ? v.value_string.value : "";
        default: return "";
        }
    }

    std::string json_quote(const std::string& s)
    {
        std::string out = "\"";
        for (const char ch : s)
        {
            if (ch == '"' || ch == '\\')
            {
                out += '\\';
                out += ch;
            }
            else if (static_cast<unsigned char>(ch) < 0x20) out += ' ';
            else out += ch; // the game's strings are UTF-8 already
        }
        return out + "\"";
    }

    /** "name":"value","name[1]":"value",... (attributes end with a NULL name). */
    std::string attributes_json(const scs_named_value_t* attributes, bool& any)
    {
        std::string json;
        any = false;
        for (const auto* a = attributes; a != nullptr && a->name != nullptr; ++a)
        {
            std::string key = a->name;
            if (a->index != SCS_U32_NIL) key += "[" + std::to_string(a->index) + "]";
            json += (any ? "," : "") + json_quote(key) + ":" + json_quote(value_text(a->value));
            any = true;
        }
        return json;
    }

    /** The whole state into the file: a temporary file first, then moved over the old one (no half-read file). */
    void write_state()
    {
        if (out_file.empty()) return;
        const std::string body = "{\"game\":" + json_quote(game_name) + ",\"written\":" + std::to_string(now_ms()) +
            ",\"active\":" + (job_active ? "true" : "false") + ",\"job\":{" + (job_active ? job_json : "") + "}" +
            (event_json.empty() ? "" : ",\"event\":" + event_json) + "}";
        const std::wstring tmp = out_file + L".tmp";
        const HANDLE h = CreateFileW(tmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (h == INVALID_HANDLE_VALUE)
        {
            log(SCS_LOG_TYPE_warning, "cannot write the bus job file");
            return;
        }
        DWORD written = 0;
        const BOOL ok = WriteFile(h, body.data(), static_cast<DWORD>(body.size()), &written, nullptr);
        CloseHandle(h);
        if (!ok || written != body.size() || !MoveFileExW(tmp.c_str(), out_file.c_str(), MOVEFILE_REPLACE_EXISTING))
        {
            log(SCS_LOG_TYPE_warning, "cannot write the bus job file");
            DeleteFileW(tmp.c_str());
        }
    }

    /** %LOCALAPPDATA%\Rig Buddy\live\<game>-bus.json, creating the folders; empty when there is no LOCALAPPDATA. */
    std::wstring state_file(const std::string& game)
    {
        wchar_t base[MAX_PATH] = {};
        const DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", base, MAX_PATH);
        if (n == 0 || n >= MAX_PATH) return L"";
        std::wstring dir = std::wstring(base) + L"\\Rig Buddy";
        CreateDirectoryW(dir.c_str(), nullptr);
        dir += L"\\live";
        CreateDirectoryW(dir.c_str(), nullptr);
        return dir + L"\\" + std::wstring(game.begin(), game.end()) + L"-bus.json";
    }

    SCSAPI_VOID on_configuration(const scs_event_t, const void* const event_info, scs_context_t)
    {
        const auto* cfg = static_cast<const scs_telemetry_configuration_t*>(event_info);
        if (cfg == nullptr || cfg->id == nullptr || std::string(cfg->id) != "bus_job") return;
        bool any = false;
        const std::string json = attributes_json(cfg->attributes, any);
        if (any == job_active && json == job_json) return; // sent again unchanged
        job_json = json;
        job_active = any;
        log(SCS_LOG_TYPE_message, any ? "bus job: " + json : "no bus job");
        write_state();
    }

    SCSAPI_VOID on_gameplay(const scs_event_t, const void* const event_info, scs_context_t)
    {
        const auto* e = static_cast<const scs_telemetry_gameplay_event_t*>(event_info);
        if (e == nullptr || e->id == nullptr) return;
        const std::string id = e->id;
        if (id.rfind("bus_job.", 0) != 0) return; // bus_job.completed and friends only
        bool any = false;
        const std::string attrs = attributes_json(e->attributes, any);
        event_json = "{\"id\":" + json_quote(id) + ",\"at\":" + std::to_string(now_ms()) + ",\"attributes\":{" + attrs + "}}";
        log(SCS_LOG_TYPE_message, id + ": " + attrs);
        write_state();
    }
}

SCSAPI_RESULT scs_telemetry_init(const scs_u32_t version, const scs_telemetry_init_params_t* const params)
{
    if (version < SCS_TELEMETRY_VERSION_1_01) return SCS_RESULT_unsupported;
    const auto* const p = reinterpret_cast<const scs_telemetry_init_params_v101_t*>(params);
    game_log = p->common.log;
    const std::string id = p->common.game_id != nullptr ? p->common.game_id : "";
    game_name = id == "ats" ? "ats" : "ets2"; // "eut2" is ETS2
    out_file = state_file(game_name);
    job_json.clear();
    job_active = false;
    event_json.clear();
    if (p->register_for_event(SCS_TELEMETRY_EVENT_configuration, on_configuration, nullptr) != SCS_RESULT_ok ||
        p->register_for_event(SCS_TELEMETRY_EVENT_gameplay, on_gameplay, nullptr) != SCS_RESULT_ok)
    {
        log(SCS_LOG_TYPE_error, "the game refused the configuration / gameplay events");
        return SCS_RESULT_generic_error;
    }
    write_state(); // no bus job until the game says otherwise (a job left over from a crash is not kept)
    log(SCS_LOG_TYPE_message, "1.0 ready: the bus job goes to Rig Buddy");
    return SCS_RESULT_ok;
}

SCSAPI_VOID scs_telemetry_shutdown(void)
{
    job_active = false; // the game is closing: no job any more
    write_state();
    game_log = nullptr;
}

BOOL APIENTRY DllMain(HMODULE, DWORD, LPVOID)
{
    return TRUE;
}
