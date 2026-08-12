import AppKit
import Carbon.HIToolbox

// FX Premiere hotkey listener (macOS).
//
// Premiere cannot bind a keyboard shortcut to a CEP panel, so this tiny agent owns the
// shortcut instead. It registers the combo only while Premiere is the front application,
// which keeps the key usable in every other app.
//
// Protocol: reads `HOTKEY <spec>`, `SETTINGS_HOTKEY <spec>` and `QUIT` on stdin,
// writes `READY <spec>`, `TRIGGER`, `TRIGGER_SETTINGS` and `ERROR <message>` on stdout.

let keyCodes: [String: UInt32] = [
    "a": UInt32(kVK_ANSI_A), "b": UInt32(kVK_ANSI_B), "c": UInt32(kVK_ANSI_C),
    "d": UInt32(kVK_ANSI_D), "e": UInt32(kVK_ANSI_E), "f": UInt32(kVK_ANSI_F),
    "g": UInt32(kVK_ANSI_G), "h": UInt32(kVK_ANSI_H), "i": UInt32(kVK_ANSI_I),
    "j": UInt32(kVK_ANSI_J), "k": UInt32(kVK_ANSI_K), "l": UInt32(kVK_ANSI_L),
    "m": UInt32(kVK_ANSI_M), "n": UInt32(kVK_ANSI_N), "o": UInt32(kVK_ANSI_O),
    "p": UInt32(kVK_ANSI_P), "q": UInt32(kVK_ANSI_Q), "r": UInt32(kVK_ANSI_R),
    "s": UInt32(kVK_ANSI_S), "t": UInt32(kVK_ANSI_T), "u": UInt32(kVK_ANSI_U),
    "v": UInt32(kVK_ANSI_V), "w": UInt32(kVK_ANSI_W), "x": UInt32(kVK_ANSI_X),
    "y": UInt32(kVK_ANSI_Y), "z": UInt32(kVK_ANSI_Z),
    "0": UInt32(kVK_ANSI_0), "1": UInt32(kVK_ANSI_1), "2": UInt32(kVK_ANSI_2),
    "3": UInt32(kVK_ANSI_3), "4": UInt32(kVK_ANSI_4), "5": UInt32(kVK_ANSI_5),
    "6": UInt32(kVK_ANSI_6), "7": UInt32(kVK_ANSI_7), "8": UInt32(kVK_ANSI_8),
    "9": UInt32(kVK_ANSI_9),
    "space": UInt32(kVK_Space), "enter": UInt32(kVK_Return), "tab": UInt32(kVK_Tab),
    "backspace": UInt32(kVK_Delete), "delete": UInt32(kVK_ForwardDelete),
    "home": UInt32(kVK_Home), "end": UInt32(kVK_End),
    "pageup": UInt32(kVK_PageUp), "pagedown": UInt32(kVK_PageDown),
    "up": UInt32(kVK_UpArrow), "down": UInt32(kVK_DownArrow),
    "left": UInt32(kVK_LeftArrow), "right": UInt32(kVK_RightArrow),
    "comma": UInt32(kVK_ANSI_Comma), "period": UInt32(kVK_ANSI_Period),
    "slash": UInt32(kVK_ANSI_Slash), "semicolon": UInt32(kVK_ANSI_Semicolon),
    "quote": UInt32(kVK_ANSI_Quote), "backquote": UInt32(kVK_ANSI_Grave),
    "minus": UInt32(kVK_ANSI_Minus), "equal": UInt32(kVK_ANSI_Equal),
    "backslash": UInt32(kVK_ANSI_Backslash),
    "bracketleft": UInt32(kVK_ANSI_LeftBracket), "bracketright": UInt32(kVK_ANSI_RightBracket),
    "f1": UInt32(kVK_F1), "f2": UInt32(kVK_F2), "f3": UInt32(kVK_F3), "f4": UInt32(kVK_F4),
    "f5": UInt32(kVK_F5), "f6": UInt32(kVK_F6), "f7": UInt32(kVK_F7), "f8": UInt32(kVK_F8),
    "f9": UInt32(kVK_F9), "f10": UInt32(kVK_F10), "f11": UInt32(kVK_F11), "f12": UInt32(kVK_F12),
    "f13": UInt32(kVK_F13), "f14": UInt32(kVK_F14), "f15": UInt32(kVK_F15),
]

struct Binding {
    let spec: String
    let keyCode: UInt32
    let modifiers: UInt32
}

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

func parseBinding(_ spec: String) -> Binding? {
    var modifiers: UInt32 = 0
    var key: String?
    for rawToken in spec.lowercased().split(separator: "+") {
        let token = rawToken.trimmingCharacters(in: .whitespaces)
        switch token {
        case "ctrl", "control": modifiers |= UInt32(controlKey)
        case "alt", "option": modifiers |= UInt32(optionKey)
        case "shift": modifiers |= UInt32(shiftKey)
        case "meta", "cmd", "command": modifiers |= UInt32(cmdKey)
        case "": continue
        default: key = token
        }
    }
    guard let name = key, let code = keyCodes[name] else {
        return nil
    }
    return Binding(spec: spec, keyCode: code, modifiers: modifiers)
}

final class Listener {
    static let shared = Listener()

    private var paletteBinding: Binding?
    private var settingsBinding: Binding?
    private var registered: [UInt32: EventHotKeyRef] = [:]
    private var bundlePrefix = "com.adobe.PremierePro"
    private var isTargetActive = false

    private let paletteID: UInt32 = 1
    private let settingsID: UInt32 = 2

    func configure(palette: Binding?, settings: Binding?, bundlePrefix: String) {
        self.bundlePrefix = bundlePrefix
        paletteBinding = palette
        settingsBinding = settings
        refresh()
    }

    func setPalette(_ binding: Binding?) {
        paletteBinding = binding
        refresh()
    }

    func setSettings(_ binding: Binding?) {
        settingsBinding = binding
        refresh()
    }

    func frontmostChanged(bundleID: String?) {
        let active = bundleID?.hasPrefix(bundlePrefix) ?? false
        if active == isTargetActive {
            return
        }
        isTargetActive = active
        refresh()
    }

    func fire(id: UInt32) {
        if id == paletteID {
            emit("TRIGGER")
        } else if id == settingsID {
            emit("TRIGGER_SETTINGS")
        }
    }

    private func refresh() {
        unregisterAll()
        guard isTargetActive else {
            return
        }
        if let palette = paletteBinding {
            register(binding: palette, id: paletteID, label: "palette")
        }
        if let settings = settingsBinding {
            register(binding: settings, id: settingsID, label: "settings")
        }
    }

    private func register(binding: Binding, id: UInt32, label: String) {
        var reference: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: OSType(0x46585052), id: id)
        let status = RegisterEventHotKey(
            binding.keyCode,
            binding.modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &reference
        )
        if status == noErr, let reference = reference {
            registered[id] = reference
            emit("READY \(label) \(binding.spec)")
        } else {
            emit("ERROR could not reserve \(binding.spec) (status \(status)). Another app or a macOS shortcut already owns it.")
        }
    }

    private func unregisterAll() {
        for (_, reference) in registered {
            UnregisterEventHotKey(reference)
        }
        registered.removeAll()
    }
}

let hotkeyHandler: EventHandlerUPP = { (_, event, _) -> OSStatus in
    var hotKeyID = EventHotKeyID()
    let status = GetEventParameter(
        event,
        EventParamName(kEventParamDirectObject),
        EventParamType(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &hotKeyID
    )
    if status == noErr {
        Listener.shared.fire(id: hotKeyID.id)
    }
    return noErr
}

func readArguments() -> (palette: String, settings: String?, bundlePrefix: String) {
    var palette = "ctrl+space"
    var settings: String?
    var bundlePrefix = "com.adobe.PremierePro"
    let arguments = CommandLine.arguments
    var index = 1
    while index < arguments.count {
        let flag = arguments[index]
        let value = index + 1 < arguments.count ? arguments[index + 1] : nil
        switch flag {
        case "--hotkey":
            if let value = value { palette = value }
            index += 2
        case "--settings-hotkey":
            settings = value
            index += 2
        case "--bundle-prefix":
            if let value = value { bundlePrefix = value }
            index += 2
        default:
            index += 1
        }
    }
    return (palette, settings, bundlePrefix)
}

func handleCommand(_ line: String) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return
    }
    let parts = trimmed.split(separator: " ", maxSplits: 1).map(String.init)
    let command = parts[0].uppercased()
    let argument = parts.count > 1 ? parts[1] : ""
    switch command {
    case "QUIT":
        exit(0)
    case "HOTKEY":
        if let binding = parseBinding(argument) {
            Listener.shared.setPalette(binding)
        } else {
            emit("ERROR unsupported shortcut \(argument)")
        }
    case "SETTINGS_HOTKEY":
        if argument.isEmpty || argument.uppercased() == "NONE" {
            Listener.shared.setSettings(nil)
        } else if let binding = parseBinding(argument) {
            Listener.shared.setSettings(binding)
        } else {
            emit("ERROR unsupported shortcut \(argument)")
        }
    default:
        emit("ERROR unknown command \(command)")
    }
}

let options = readArguments()
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)

var eventHandler: EventHandlerRef?
var eventSpec = EventTypeSpec(
    eventClass: OSType(kEventClassKeyboard),
    eventKind: UInt32(kEventHotKeyPressed)
)
InstallEventHandler(GetApplicationEventTarget(), hotkeyHandler, 1, &eventSpec, nil, &eventHandler)

let paletteBinding = parseBinding(options.palette)
if paletteBinding == nil {
    emit("ERROR unsupported shortcut \(options.palette)")
}
let settingsBinding = options.settings.flatMap(parseBinding)

Listener.shared.configure(
    palette: paletteBinding,
    settings: settingsBinding,
    bundlePrefix: options.bundlePrefix
)
Listener.shared.frontmostChanged(bundleID: NSWorkspace.shared.frontmostApplication?.bundleIdentifier)

NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification,
    object: nil,
    queue: .main
) { notification in
    let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    Listener.shared.frontmostChanged(bundleID: app?.bundleIdentifier)
}

DispatchQueue.global(qos: .utility).async {
    while let line = readLine(strippingNewline: true) {
        DispatchQueue.main.async { handleCommand(line) }
    }
    // stdin closed: the panel that spawned us is gone.
    DispatchQueue.main.async { exit(0) }
}

emit("STARTED \(options.palette)")
application.run()
