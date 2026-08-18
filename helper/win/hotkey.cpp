// FX Premiere hotkey listener (Windows), plus the one-shot modes un-nesting needs.
//
// Premiere cannot bind a keyboard shortcut to a CEP panel, so this agent owns the shortcut.
// The combo is only registered while Premiere is the foreground application, which keeps the
// key available to every other program.
//
// Protocol: reads `HOTKEY <spec>`, `SETTINGS_HOTKEY <spec>` and `QUIT` on stdin,
// writes `READY <spec>`, `TRIGGER`, `TRIGGER_SETTINGS` and `ERROR <message>` on stdout.
//
// The one-shot modes — `preflight`, `request`, `pasteboard`, `keys`, `clipboard` — run instead of
// the listener, print `FXP_NAME=value` lines and exit. Most of them are there because Premiere has
// no scripting API for Copy and Paste, so the only way to reach its own clipboard commands is to
// press the keys. Windows grants no permission for that up front and offers no way to ask, but it
// does refuse the injection outright when the target runs at a higher integrity level, so the
// permission is reported unknown until an attempt answers it. `clipboard` covers the other half of
// the same gap: Premiere cannot read an image back off the clipboard either, so the helper reads it
// and hands over a file.

#include <windows.h>

#include <objidl.h>
// After objidl.h, whose COM types gdiplus.h refers to without declaring them itself.
#include <gdiplus.h>

#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <iostream>
#include <map>
#include <string>
#include <thread>
#include <vector>

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

struct PostCombo {
  std::string spec;
  WORD key = 0;
  /** In the order they go down, so they can come back up in the reverse. */
  std::vector<WORD> modifiers;
  bool valid = false;
};

PostCombo parsePostCombo(const std::string& spec) {
  PostCombo combo;
  combo.spec = spec;
  const std::string remaining = toLower(spec);
  std::string keyName;
  size_t start = 0;
  while (start <= remaining.size()) {
    const size_t plus = remaining.find('+', start);
    const std::string token =
        trim(remaining.substr(start, plus == std::string::npos ? std::string::npos : plus - start));
    if (token == "ctrl" || token == "control") {
      combo.modifiers.push_back(VK_CONTROL);
    } else if (token == "alt" || token == "option") {
      combo.modifiers.push_back(VK_MENU);
    } else if (token == "shift") {
      combo.modifiers.push_back(VK_SHIFT);
    } else if (token == "meta" || token == "cmd" || token == "command" || token == "win") {
      combo.modifiers.push_back(VK_LWIN);
    } else if (!token.empty()) {
      keyName = token;
    }
    if (plus == std::string::npos) {
      break;
    }
    start = plus + 1;
  }
  combo.key = static_cast<WORD>(keyFromName(keyName));
  combo.valid = combo.key != 0;
  return combo;
}

/** How much of a combination reached the input queue, and whether Windows itself refused it. */
struct PostResult {
  UINT asked = 0;
  UINT sent = 0;
  bool refused = false;
};

void sendKey(WORD key, bool down, PostResult* result) {
  INPUT input = {};
  input.type = INPUT_KEYBOARD;
  input.ki.wVk = key;
  input.ki.wScan = static_cast<WORD>(MapVirtualKeyW(key, MAPVK_VK_TO_VSC));
  input.ki.dwFlags = down ? 0 : KEYEVENTF_KEYUP;
  SetLastError(ERROR_SUCCESS);
  const UINT inserted = SendInput(1, &input, sizeof(INPUT));
  result->asked += 1;
  result->sent += inserted;
  // UIPI refuses injection into a process of higher integrity than this one, which is what a
  // Premiere started as administrator is. It is the one short insert that has a cause worth naming.
  if (inserted == 0 && GetLastError() == ERROR_ACCESS_DENIED) {
    result->refused = true;
  }
}

/**
 * Presses one combination the way a keyboard does: modifiers down, key down and up, modifiers back
 * up in reverse. The scan code goes along with the virtual key because applications that read the
 * raw scan code see nothing without it.
 *
 * The releases are attempted even after an insert that failed: giving up half way through would
 * leave a modifier held down across the whole session.
 */
PostResult postCombo(const PostCombo& combo, DWORD delayMs) {
  PostResult result;
  for (const WORD modifier : combo.modifiers) {
    sendKey(modifier, true, &result);
    Sleep(delayMs);
  }
  sendKey(combo.key, true, &result);
  Sleep(delayMs);
  sendKey(combo.key, false, &result);
  Sleep(delayMs);
  for (auto it = combo.modifiers.rbegin(); it != combo.modifiers.rend(); ++it) {
    sendKey(*it, false, &result);
    Sleep(delayMs);
  }
  return result;
}

void report(const std::string& name, const std::string& value) {
  emit("FXP_" + name + "=" + value);
}

void reportClipboard() {
  report("PASTEBOARD", std::to_string(GetClipboardSequenceNumber()));
}

/** Set once an injection has come back refused, which is the only proof Windows ever offers. */
bool g_postRefused = false;

/**
 * Windows has no API that answers whether this process may inject input before it tries: UIPI is
 * decided per target window, at the moment of the call. So the answer is unknown until an attempt
 * has been made, and denied from the moment one has come back refused.
 */
const char* postAccess() {
  return g_postRefused ? "denied" : "unknown";
}

/** Everything the panel needs to decide whether pressing keys is allowed. */
bool reportAccess() {
  const std::string process = foregroundProcessName();
  const bool frontIsTarget = !process.empty() && process.find(g_targetProcess) != std::string::npos;
  report("PLATFORM", "win32");
  report("POST_ACCESS", postAccess());
  report("SCREEN_LOCKED", "false");
  report("FRONTMOST", process.empty() ? "unknown" : process);
  report("FRONT_IS_TARGET", frontIsTarget ? "true" : "false");
  report("RESPONSIBLE", "self");
  return frontIsTarget;
}

struct PngInfo {
  UINT width = 0;
  UINT height = 0;
  bool alpha = false;
};

/** What ended up on disk, so every clipboard source can be reported the same way. */
struct ImageWrite {
  bool ok = false;
  bool alpha = false;
  UINT width = 0;
  UINT height = 0;
  unsigned long long bytes = 0;
  std::string error;
};

std::wstring widePath(const std::string& utf8) {
  if (utf8.empty()) {
    return L"";
  }
  const int size = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
  if (size <= 1) {
    return L"";
  }
  std::wstring wide(static_cast<size_t>(size - 1), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, wide.data(), size);
  return wide;
}

bool writeFile(const std::wstring& path, const void* data, size_t size) {
  const HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                  FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return false;
  }
  DWORD written = 0;
  const BOOL ok =
      size == 0 ? TRUE : WriteFile(file, data, static_cast<DWORD>(size), &written, nullptr);
  CloseHandle(file);
  return ok != 0 && static_cast<size_t>(written) == size;
}

bool fileSize(const std::wstring& path, unsigned long long* size) {
  WIN32_FILE_ATTRIBUTE_DATA attributes = {};
  if (GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &attributes) == 0) {
    return false;
  }
  *size = (static_cast<unsigned long long>(attributes.nFileSizeHigh) << 32) |
          static_cast<unsigned long long>(attributes.nFileSizeLow);
  return true;
}

/** Every integer in a PNG chunk is big-endian, whatever the machine reading it is. */
UINT readBigEndian(const BYTE* bytes) {
  return (static_cast<UINT>(bytes[0]) << 24) | (static_cast<UINT>(bytes[1]) << 16) |
         (static_cast<UINT>(bytes[2]) << 8) | static_cast<UINT>(bytes[3]);
}

/**
 * The size and the colour type as the IHDR chunk states them, or zeros for bytes that are no PNG at
 * all. Colour type 4 is greyscale plus alpha and 6 is truecolour plus alpha; the other three carry
 * no transparency beyond a palette index, which is not what the panel means by an alpha channel.
 */
PngInfo readPngHeader(const BYTE* bytes, size_t size) {
  PngInfo info;
  static const BYTE signature[8] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
  if (size < 33 || std::memcmp(bytes, signature, sizeof(signature)) != 0 ||
      std::memcmp(bytes + 12, "IHDR", 4) != 0) {
    return info;
  }
  const BYTE colourType = bytes[25];
  info.width = readBigEndian(bytes + 16);
  info.height = readBigEndian(bytes + 20);
  info.alpha = colourType == 4 || colourType == 6;
  return info;
}

bool pngEncoderClsid(CLSID* clsid) {
  UINT count = 0;
  UINT bytes = 0;
  if (Gdiplus::GetImageEncodersSize(&count, &bytes) != Gdiplus::Ok || bytes == 0) {
    return false;
  }
  std::vector<BYTE> buffer(bytes);
  auto* codecs = reinterpret_cast<Gdiplus::ImageCodecInfo*>(buffer.data());
  if (Gdiplus::GetImageEncoders(count, bytes, codecs) != Gdiplus::Ok) {
    return false;
  }
  for (UINT i = 0; i < count; ++i) {
    if (std::wcscmp(codecs[i].MimeType, L"image/png") == 0) {
      *clsid = codecs[i].Clsid;
      return true;
    }
  }
  return false;
}

/**
 * GDI+ is started for the encode alone: the listener never needs it, and every Bitmap has to be
 * gone before the shutdown, so the scope wraps a whole source's work rather than only the save.
 */
struct GdiplusScope {
  ULONG_PTR token = 0;
  bool ok = false;

  GdiplusScope() {
    const Gdiplus::GdiplusStartupInput input;
    ok = Gdiplus::GdiplusStartup(&token, &input, nullptr) == Gdiplus::Ok;
  }

  ~GdiplusScope() {
    if (ok) {
      Gdiplus::GdiplusShutdown(token);
    }
  }
};

ImageWrite savePng(Gdiplus::Bitmap* bitmap, const CLSID& encoder, const std::wstring& path) {
  ImageWrite result;
  // GDI+ answers an unwritable path and an encoder that gave up with the same status, so the path
  // is proved writable first and the caller gets to tell the two apart.
  if (!writeFile(path, nullptr, 0)) {
    result.error = "write-failed";
    return result;
  }
  if (bitmap->Save(path.c_str(), &encoder, nullptr) != Gdiplus::Ok) {
    DeleteFileW(path.c_str());
    result.error = "encode-failed";
    return result;
  }
  if (!fileSize(path, &result.bytes)) {
    result.error = "write-failed";
    return result;
  }
  result.ok = true;
  return result;
}

ImageWrite writePngBytes(const BYTE* bytes, size_t size, const std::wstring& path) {
  ImageWrite result;
  const PngInfo info = readPngHeader(bytes, size);
  result.width = info.width;
  result.height = info.height;
  result.alpha = info.alpha;
  if (!writeFile(path, bytes, size)) {
    result.error = "write-failed";
    return result;
  }
  result.bytes = size;
  result.ok = true;
  return result;
}

ImageWrite writePngFromDibV5(const BYTE* blob, size_t size, const std::wstring& path) {
  ImageWrite result;
  if (size < sizeof(BITMAPV5HEADER)) {
    result.error = "encode-failed";
    return result;
  }
  const auto* header = reinterpret_cast<const BITMAPV5HEADER*>(blob);
  // A header claiming to be shorter than a V5 one would put the pixels somewhere they are not: the
  // fields read below only exist because this clipboard format promises a V5 header.
  size_t headerSize = static_cast<size_t>(header->bV5Size);
  if (headerSize < sizeof(BITMAPV5HEADER)) {
    headerSize = sizeof(BITMAPV5HEADER);
  }
  const LONG signedWidth = header->bV5Width;
  const LONG signedHeight = header->bV5Height;
  const UINT bits = header->bV5BitCount;
  const UINT width = static_cast<UINT>(signedWidth < 0 ? 0 : signedWidth);
  const UINT height = static_cast<UINT>(signedHeight < 0 ? -signedHeight : signedHeight);
  result.width = width;
  result.height = height;

  // Rows are padded to a 4-byte boundary, and a positive height means they are stored bottom-up.
  const size_t stride = ((static_cast<size_t>(width) * bits + 31) / 32) * 4;
  const size_t pixelOffset = headerSize + static_cast<size_t>(header->bV5ClrUsed) * sizeof(RGBQUAD);
  const bool rawPixels =
      header->bV5Compression == BI_RGB || header->bV5Compression == BI_BITFIELDS;
  // The last term divides rather than multiplies, so a header describing more pixels than a size_t
  // can hold is refused instead of wrapping around into a copy past the end of the blob.
  if (width == 0 || height == 0 || (bits != 24 && bits != 32) || !rawPixels ||
      pixelOffset >= size || stride > (size - pixelOffset) / height) {
    result.error = "encode-failed";
    return result;
  }
  const bool alpha = bits == 32 && header->bV5AlphaMask != 0;
  const bool topDown = signedHeight < 0;
  const BYTE* pixels = blob + pixelOffset;

  const GdiplusScope gdiplus;
  if (!gdiplus.ok) {
    result.error = "encode-failed";
    return result;
  }
  CLSID encoder = {};
  if (!pngEncoderClsid(&encoder)) {
    result.error = "encode-failed";
    return result;
  }
  const Gdiplus::PixelFormat format = alpha ? PixelFormat32bppARGB : PixelFormat24bppRGB;
  Gdiplus::Bitmap bitmap(static_cast<INT>(width), static_cast<INT>(height), format);
  if (bitmap.GetLastStatus() != Gdiplus::Ok) {
    result.error = "encode-failed";
    return result;
  }
  const Gdiplus::Rect rect(0, 0, static_cast<INT>(width), static_cast<INT>(height));
  Gdiplus::BitmapData data;
  if (bitmap.LockBits(&rect, Gdiplus::ImageLockModeWrite, format, &data) != Gdiplus::Ok) {
    result.error = "encode-failed";
    return result;
  }
  const size_t sourcePixel = bits / 8;
  const size_t destinationPixel = alpha ? 4 : 3;
  for (UINT row = 0; row < height; ++row) {
    const size_t sourceRow = topDown ? row : height - 1 - row;
    const BYTE* from = pixels + sourceRow * stride;
    // Row n lives at Scan0 + n * Stride whichever way round GDI+ laid the buffer out, which is why
    // the stride stays signed.
    BYTE* to = static_cast<BYTE*>(data.Scan0) + static_cast<std::ptrdiff_t>(row) * data.Stride;
    if (sourcePixel == destinationPixel) {
      std::memcpy(to, from, static_cast<size_t>(width) * destinationPixel);
      continue;
    }
    // 32 bits per pixel with no alpha mask: the fourth byte is undefined padding rather than
    // transparency, so it is dropped instead of being encoded as an alpha channel.
    for (size_t column = 0; column < width; ++column) {
      std::memcpy(to + column * 3, from + column * sourcePixel, 3);
    }
  }
  bitmap.UnlockBits(&data);

  ImageWrite written = savePng(&bitmap, encoder, path);
  written.width = width;
  written.height = height;
  written.alpha = alpha;
  return written;
}

ImageWrite writePngFromHbitmap(HBITMAP source, const std::wstring& path) {
  ImageWrite result;
  const GdiplusScope gdiplus;
  if (!gdiplus.ok) {
    result.error = "encode-failed";
    return result;
  }
  CLSID encoder = {};
  if (!pngEncoderClsid(&encoder)) {
    result.error = "encode-failed";
    return result;
  }
  Gdiplus::Bitmap* bitmap = Gdiplus::Bitmap::FromHBITMAP(source, nullptr);
  if (bitmap == nullptr || bitmap->GetLastStatus() != Gdiplus::Ok) {
    delete bitmap;
    result.error = "encode-failed";
    return result;
  }
  const UINT width = bitmap->GetWidth();
  const UINT height = bitmap->GetHeight();
  result = savePng(bitmap, encoder, path);
  result.width = width;
  result.height = height;
  delete bitmap;
  return result;
}

/** One clipboard format's bytes, borrowed until the matching unlockFormat. */
struct ClipboardBlob {
  HANDLE handle = nullptr;
  const BYTE* bytes = nullptr;
  size_t size = 0;
};

ClipboardBlob lockFormat(UINT format) {
  ClipboardBlob blob;
  if (format == 0) {
    return blob;
  }
  blob.handle = GetClipboardData(format);
  if (blob.handle == nullptr) {
    return blob;
  }
  blob.bytes = static_cast<const BYTE*>(GlobalLock(blob.handle));
  blob.size = blob.bytes == nullptr ? 0 : GlobalSize(blob.handle);
  return blob;
}

void unlockFormat(const ClipboardBlob& blob) {
  if (blob.bytes != nullptr) {
    GlobalUnlock(blob.handle);
  }
}

/**
 * Any application may hold the clipboard open for a moment while it finishes its own copy, and a
 * first failure usually means no more than that, so the refusal waits for a few attempts.
 */
bool openClipboard() {
  for (int attempt = 0; attempt < 5; ++attempt) {
    if (OpenClipboard(nullptr) != 0) {
      return true;
    }
    Sleep(20);
  }
  return false;
}

/**
 * Writes whatever image is on the clipboard to `outPath` as a PNG, preferring the source most
 * likely to carry an alpha channel, and names the source it used so the panel can tell the user
 * when transparency was never on offer. The registered "PNG" format goes to disk untouched: Figma,
 * Photoshop and Chrome all put a real PNG there, and decoding it only to encode it again would
 * cost quality for nothing.
 */
int runClipboard(const std::string& outPath) {
  report("PLATFORM", "win32");
  const std::wstring path = widePath(outPath);
  std::string source = "none";
  ImageWrite written;
  if (path.empty()) {
    written.error = "no-output-path";
  } else if (!openClipboard()) {
    written.error = "clipboard-busy";
  } else {
    const ClipboardBlob png = lockFormat(RegisterClipboardFormatW(L"PNG"));
    if (png.size > 0) {
      source = "png";
      written = writePngBytes(png.bytes, png.size, path);
    }
    unlockFormat(png);
    if (source == "none") {
      const ClipboardBlob dib = lockFormat(CF_DIBV5);
      if (dib.size > 0) {
        source = "dibv5";
        written = writePngFromDibV5(dib.bytes, dib.size, path);
      }
      unlockFormat(dib);
    }
    if (source == "none") {
      // Also what Windows synthesises from a plain DIB, so it is worth asking for even when no
      // application put an HBITMAP on the clipboard itself.
      const HANDLE handle = GetClipboardData(CF_BITMAP);
      if (handle != nullptr) {
        source = "bitmap";
        written = writePngFromHbitmap(static_cast<HBITMAP>(handle), path);
      }
    }
    CloseClipboard();
    if (source == "none") {
      written.error = "no-image";
    }
  }

  report("CLIPBOARD_SOURCE", source);
  // Transparency describes the file, and a run that wrote nothing has none to describe.
  report("CLIPBOARD_ALPHA", written.ok && written.alpha ? "true" : "false");
  report("WIDTH", std::to_string(written.width));
  report("HEIGHT", std::to_string(written.height));
  if (!written.ok) {
    report("OK", "false");
    report("ERROR", written.error);
    return 0;
  }
  report("PATH", outPath);
  report("BYTES", std::to_string(written.bytes));
  report("OK", "true");
  return 0;
}

/**
 * Runs a one-shot mode and exits, or returns -1 when there is no mode to run, which is how the same
 * binary stays the long-running listener.
 *
 * A first argument that is a word rather than a flag is meant as a mode, so one that names no mode is
 * refused: falling through would silently start the listener instead.
 */
int runOneShot(int argc, char** argv) {
  const std::string mode = argc > 1 ? argv[1] : "";
  if (mode != "preflight" && mode != "request" && mode != "pasteboard" && mode != "keys" &&
      mode != "clipboard") {
    if (mode.empty() || mode.rfind("-", 0) == 0) {
      return -1;
    }
    report("PLATFORM", "win32");
    report("OK", "false");
    report("ERROR", "unknown-mode");
    return 2;
  }
  std::string comboSpec = "ctrl+c";
  std::string outPath;
  DWORD delayMs = 24;
  for (int i = 2; i < argc; ++i) {
    const std::string flag = argv[i];
    const std::string value = i + 1 < argc ? argv[i + 1] : "";
    if (flag == "--combo" && !value.empty()) {
      comboSpec = value;
      ++i;
    } else if ((flag == "--target" || flag == "--process") && !value.empty()) {
      g_targetProcess = toLower(value);
      ++i;
    } else if (flag == "--delay" && !value.empty()) {
      delayMs = static_cast<DWORD>(std::stoul(value));
      ++i;
    } else if (flag == "--out" && !value.empty()) {
      outPath = value;
      ++i;
    }
  }

  if (mode == "preflight") {
    reportAccess();
    reportClipboard();
    report("OK", "true");
    return 0;
  }
  if (mode == "request") {
    report("PLATFORM", "win32");
    report("REQUESTED", "false");
    report("POST_ACCESS", postAccess());
    report("OK", "true");
    return 0;
  }
  if (mode == "pasteboard") {
    report("PLATFORM", "win32");
    reportClipboard();
    report("OK", "true");
    return 0;
  }
  if (mode == "clipboard") {
    return runClipboard(outPath);
  }

  const bool frontIsTarget = reportAccess();
  const PostCombo combo = parsePostCombo(comboSpec);
  if (!combo.valid) {
    report("OK", "false");
    report("ERROR", "bad-combo");
    return 0;
  }
  if (!frontIsTarget) {
    report("OK", "false");
    report("ERROR", "not-frontmost");
    return 0;
  }
  const PostResult posted = postCombo(combo, delayMs);
  report("EVENTS_ASKED", std::to_string(posted.asked));
  report("EVENTS_SENT", std::to_string(posted.sent));
  if (posted.sent < posted.asked) {
    g_postRefused = posted.refused;
    // Said again now that there is an answer, which is the line the panel keeps.
    report("POST_ACCESS", postAccess());
    report("OK", "false");
    report("ERROR", posted.refused ? "input-blocked" : "input-short");
    return 0;
  }
  report("POSTED", combo.spec);
  // Read after posting as well, because a Copy that Premiere never acted on leaves the sequence
  // number alone. A Paste leaves it alone either way, which is why the count above is the only
  // evidence that half of un-nesting has of having happened at all.
  reportClipboard();
  report("OK", "true");
  return 0;
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
  const int oneShot = runOneShot(argc, argv);
  if (oneShot >= 0) {
    return oneShot;
  }

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
