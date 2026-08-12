// FX Premiere hotkey listener (Windows).
//
// Premiere cannot bind a keyboard shortcut to a CEP panel, so this agent owns the shortcut.
// The combo is only registered while Premiere is the foreground application, which keeps the
// key available to every other program.
//
// Protocol: reads `HOTKEY <spec>`, `SETTINGS_HOTKEY <spec>` and `QUIT` on stdin,
// writes `READY <spec>`, `TRIGGER`, `TRIGGER_SETTINGS` and `ERROR <message>` on stdout.

#include <windows.h>

#include <algorithm>
#include <cstdio>
#include <iostream>
#include <map>
#include <string>
#include <thread>

namespace {

constexpr int kPaletteId = 1;
constexpr int kSettingsId = 2;
constexpr UINT kStdinMessage = WM_APP + 1;
constexpr UINT_PTR kForegroundTimer = 1;

struct Binding {
  std::string spec;
  UINT modifiers = 0;
  UINT key = 0;
  bool valid = false;
};

std::string g_targetProcess = "adobe premiere pro.exe";
Binding g_palette;
Binding g_settings;
bool g_targetActive = false;
bool g_paletteRegistered = false;
bool g_settingsRegistered = false;
DWORD g_mainThread = 0;

void emit(const std::string& line) {
  std::fputs(line.c_str(), stdout);
  std::fputc('\n', stdout);
  std::fflush(stdout);
}

std::string toLower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  return value;
}

std::string trim(const std::string& value) {
  const auto first = value.find_first_not_of(" \t\r\n");
  if (first == std::string::npos) {
    return "";
  }
  const auto last = value.find_last_not_of(" \t\r\n");
  return value.substr(first, last - first + 1);
}

const std::map<std::string, UINT>& keyTable() {
  static const std::map<std::string, UINT> table = {
      {"space", VK_SPACE},      {"enter", VK_RETURN},   {"tab", VK_TAB},
      {"backspace", VK_BACK},   {"delete", VK_DELETE},  {"insert", VK_INSERT},
      {"home", VK_HOME},        {"end", VK_END},        {"pageup", VK_PRIOR},
      {"pagedown", VK_NEXT},    {"up", VK_UP},          {"down", VK_DOWN},
      {"left", VK_LEFT},        {"right", VK_RIGHT},    {"comma", VK_OEM_COMMA},
      {"period", VK_OEM_PERIOD},{"slash", VK_OEM_2},    {"semicolon", VK_OEM_1},
      {"quote", VK_OEM_7},      {"backquote", VK_OEM_3},{"minus", VK_OEM_MINUS},
      {"equal", VK_OEM_PLUS},   {"backslash", VK_OEM_5},{"bracketleft", VK_OEM_4},
      {"bracketright", VK_OEM_6},
  };
  return table;
}

UINT keyFromName(const std::string& name) {
  if (name.size() == 1) {
    const char c = name[0];
    if (c >= 'a' && c <= 'z') {
      return static_cast<UINT>('A' + (c - 'a'));
    }
    if (c >= '0' && c <= '9') {
      return static_cast<UINT>(c);
    }
  }
  if (name.size() >= 2 && name[0] == 'f') {
    const std::string digits = name.substr(1);
    if (digits.find_first_not_of("0123456789") == std::string::npos) {
      const int index = std::stoi(digits);
      if (index >= 1 && index <= 24) {
        return static_cast<UINT>(VK_F1 + index - 1);
      }
    }
  }
  const auto& table = keyTable();
  const auto found = table.find(name);
  return found == table.end() ? 0 : found->second;
}

Binding parseBinding(const std::string& spec) {
  Binding binding;
  binding.spec = spec;
  std::string remaining = toLower(spec);
  std::string keyName;
  size_t start = 0;
  while (start <= remaining.size()) {
    const size_t plus = remaining.find('+', start);
    const std::string token =
        trim(remaining.substr(start, plus == std::string::npos ? std::string::npos : plus - start));
    if (token == "ctrl" || token == "control") {
      binding.modifiers |= MOD_CONTROL;
    } else if (token == "alt" || token == "option") {
      binding.modifiers |= MOD_ALT;
    } else if (token == "shift") {
      binding.modifiers |= MOD_SHIFT;
    } else if (token == "meta" || token == "cmd" || token == "command" || token == "win") {
      binding.modifiers |= MOD_WIN;
    } else if (!token.empty()) {
      keyName = token;
    }
    if (plus == std::string::npos) {
      break;
    }
    start = plus + 1;
  }
  binding.key = keyFromName(keyName);
  binding.valid = binding.key != 0;
  return binding;
}

std::string foregroundProcessName() {
  HWND window = GetForegroundWindow();
  if (window == nullptr) {
    return "";
  }
  DWORD processId = 0;
  GetWindowThreadProcessId(window, &processId);
  if (processId == 0) {
    return "";
  }
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (process == nullptr) {
    return "";
  }
  wchar_t buffer[MAX_PATH] = {0};
  DWORD size = MAX_PATH;
  std::string name;
  if (QueryFullProcessImageNameW(process, 0, buffer, &size) != 0) {
    const std::wstring full(buffer, size);
    const size_t slash = full.find_last_of(L"\\/");
    const std::wstring file = slash == std::wstring::npos ? full : full.substr(slash + 1);
    const int bytes = WideCharToMultiByte(CP_UTF8, 0, file.c_str(), -1, nullptr, 0, nullptr, nullptr);
    if (bytes > 1) {
      name.resize(static_cast<size_t>(bytes - 1));
      WideCharToMultiByte(CP_UTF8, 0, file.c_str(), -1, name.data(), bytes, nullptr, nullptr);
    }
  }
  CloseHandle(process);
  return toLower(name);
}

void unregisterAll() {
  if (g_paletteRegistered) {
    UnregisterHotKey(nullptr, kPaletteId);
    g_paletteRegistered = false;
  }
  if (g_settingsRegistered) {
    UnregisterHotKey(nullptr, kSettingsId);
    g_settingsRegistered = false;
  }
}

void registerBinding(const Binding& binding, int id, const char* label, bool* flag) {
  if (!binding.valid) {
    return;
  }
  if (RegisterHotKey(nullptr, id, binding.modifiers | MOD_NOREPEAT, binding.key) != 0) {
    *flag = true;
    emit(std::string("READY ") + label + " " + binding.spec);
  } else {
    emit("ERROR could not reserve " + binding.spec + " (another application already owns it)");
  }
}

void refreshRegistration() {
  unregisterAll();
  if (!g_targetActive) {
    return;
  }
  registerBinding(g_palette, kPaletteId, "palette", &g_paletteRegistered);
  registerBinding(g_settings, kSettingsId, "settings", &g_settingsRegistered);
}

void checkForeground() {
  const std::string process = foregroundProcessName();
  const bool active = !process.empty() && process.find(g_targetProcess) != std::string::npos;
  if (active != g_targetActive) {
    g_targetActive = active;
    refreshRegistration();
  }
}

void handleCommand(const std::string& raw) {
  const std::string line = trim(raw);
  if (line.empty()) {
    return;
  }
  const size_t space = line.find(' ');
  const std::string command = toLower(space == std::string::npos ? line : line.substr(0, space));
  const std::string argument = space == std::string::npos ? "" : trim(line.substr(space + 1));

  if (command == "quit") {
    unregisterAll();
    PostQuitMessage(0);
    return;
  }
  if (command == "hotkey") {
    const Binding binding = parseBinding(argument);
    if (!binding.valid) {
      emit("ERROR unsupported shortcut " + argument);
      return;
    }
    g_palette = binding;
    refreshRegistration();
    return;
  }
  if (command == "settings_hotkey") {
    if (argument.empty() || toLower(argument) == "none") {
      g_settings = Binding();
    } else {
      const Binding binding = parseBinding(argument);
      if (!binding.valid) {
        emit("ERROR unsupported shortcut " + argument);
        return;
      }
      g_settings = binding;
    }
    refreshRegistration();
    return;
  }
  emit("ERROR unknown command " + command);
}

void stdinLoop() {
  std::string line;
  while (std::getline(std::cin, line)) {
    auto* copy = new std::string(line);
    if (PostThreadMessage(g_mainThread, kStdinMessage, 0, reinterpret_cast<LPARAM>(copy)) == 0) {
      delete copy;
      break;
    }
  }
  PostThreadMessage(g_mainThread, WM_QUIT, 0, 0);
}

}  // namespace

int main(int argc, char** argv) {
  std::string paletteSpec = "ctrl+space";
  std::string settingsSpec;
  for (int i = 1; i < argc; ++i) {
    const std::string flag = argv[i];
    const std::string value = i + 1 < argc ? argv[i + 1] : "";
    if (flag == "--hotkey" && !value.empty()) {
      paletteSpec = value;
      ++i;
    } else if (flag == "--settings-hotkey" && !value.empty()) {
      settingsSpec = value;
      ++i;
    } else if (flag == "--process" && !value.empty()) {
      g_targetProcess = toLower(value);
      ++i;
    }
  }

  g_mainThread = GetCurrentThreadId();
  g_palette = parseBinding(paletteSpec);
  if (!g_palette.valid) {
    emit("ERROR unsupported shortcut " + paletteSpec);
  }
  if (!settingsSpec.empty()) {
    g_settings = parseBinding(settingsSpec);
  }

  std::thread reader(stdinLoop);
  reader.detach();

  SetTimer(nullptr, kForegroundTimer, 250, nullptr);
  checkForeground();
  emit("STARTED " + paletteSpec);

  MSG message;
  while (GetMessage(&message, nullptr, 0, 0) > 0) {
    if (message.message == WM_HOTKEY) {
      if (message.wParam == kPaletteId) {
        emit("TRIGGER");
      } else if (message.wParam == kSettingsId) {
        emit("TRIGGER_SETTINGS");
      }
    } else if (message.message == WM_TIMER && message.wParam == kForegroundTimer) {
      checkForeground();
    } else if (message.message == kStdinMessage) {
      auto* payload = reinterpret_cast<std::string*>(message.lParam);
      if (payload != nullptr) {
        handleCommand(*payload);
        delete payload;
      }
    }
  }

  unregisterAll();
  return 0;
}
