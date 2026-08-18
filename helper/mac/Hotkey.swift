import AppKit
import Carbon.HIToolbox
import CoreGraphics
import Darwin

// FX Premiere hotkey listener (macOS), plus the one-shot modes un-nesting needs.
//
// Premiere cannot bind a keyboard shortcut to a CEP panel, so this tiny agent owns the
// shortcut instead. It registers the combo only while Premiere is the front application,
// which keeps the key usable in every other app.
//
// Protocol: reads `HOTKEY <spec>`, `SETTINGS_HOTKEY <spec>` and `QUIT` on stdin,
// writes `READY <spec>`, `TRIGGER`, `TRIGGER_SETTINGS` and `ERROR <message>` on stdout.
//
// The one-shot modes — `preflight`, `request`, `pasteboard`, `keys`, `clipboard` — run instead
// of the listener, print `FXP_NAME=value` lines and exit. The first four exist because Premiere
// has no scripting API for Copy and Paste, so the only way to reach its own clipboard commands
// is to press the keys. Posting an event is gated on the permission macOS calls Accessibility,
// so each mode reports what it found rather than acting on a guess. `clipboard` needs no
// permission at all: it reads the pasteboard rather than driving it.

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
    "f16": UInt32(kVK_F16), "f17": UInt32(kVK_F17), "f18": UInt32(kVK_F18),
    "f19": UInt32(kVK_F19), "f20": UInt32(kVK_F20),
    // The panel's shortcut recorder accepts Insert, which Apple keyboards call Help.
    "insert": UInt32(kVK_Help),
]

/** The modifiers as CoreGraphics sees them, which is a different set of constants from Carbon's. */
let postFlags: [String: CGEventFlags] = [
    "ctrl": .maskControl, "control": .maskControl,
    "alt": .maskAlternate, "option": .maskAlternate, "opt": .maskAlternate,
    "shift": .maskShift,
    "meta": .maskCommand, "cmd": .maskCommand, "command": .maskCommand,
]

/** The modifier keys as keys, for the flagsChanged events some applications want to see. */
let postModifierKeys: [String: CGKeyCode] = [
    "ctrl": 0x3B, "control": 0x3B,
    "alt": 0x3A, "option": 0x3A, "opt": 0x3A,
    "shift": 0x38,
    "meta": 0x37, "cmd": 0x37, "command": 0x37,
]

struct PostCombo {
    let spec: String
    let key: CGKeyCode
    let flags: CGEventFlags
    /** In the order they go down, so they can come back up in the reverse. */
    let modifiers: [(code: CGKeyCode, flag: CGEventFlags)]
}

func parsePostCombo(_ spec: String) -> PostCombo? {
    var flags: CGEventFlags = []
    var modifiers: [(code: CGKeyCode, flag: CGEventFlags)] = []
    var key: CGKeyCode?
    for rawToken in spec.lowercased().split(separator: "+") {
        let token = rawToken.trimmingCharacters(in: .whitespaces)
        if token.isEmpty {
            continue
        }
        if let flag = postFlags[token] {
            flags.insert(flag)
            if let code = postModifierKeys[token] {
                modifiers.append((code, flag))
            }
            continue
        }
        guard let code = keyCodes[token] else {
            return nil
        }
        key = CGKeyCode(code)
    }
    guard let code = key else {
        return nil
    }
    return PostCombo(spec: spec, key: code, flags: flags, modifiers: modifiers)
}

/**
 * Who macOS holds responsible for what this process does. A helper launched by Premiere is
 * Premiere's responsibility, which is why the permission row names Adobe Premiere Pro and why
 * replacing this binary does not revoke the grant. The call is a private symbol, so it is looked
 * up rather than linked: a macOS that stops offering it reports nothing instead of failing to run.
 */
func responsibleExecutable() -> String? {
    typealias Responsible = @convention(c) (pid_t) -> pid_t
    guard let handle = dlopen(nil, RTLD_NOW),
          let symbol = dlsym(handle, "responsibility_get_pid_responsible_for_pid")
    else {
        return nil
    }
    let pid = unsafeBitCast(symbol, to: Responsible.self)(getpid())
    if pid < 0 {
        return nil
    }
    var buffer = [CChar](repeating: 0, count: 4096)
    if proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 {
        return String(cString: buffer)
    }
    return nil
}

/**
 * A locked screen still accepts posted events and still has a frontmost application, so nothing
 * else here would notice. Copy and Paste sent at a login window are keystrokes nobody can see
 * going somewhere nobody can check, which is the one case worth refusing outright.
 */
func screenIsLocked() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else {
        return false
    }
    return (session["CGSSessionScreenIsLocked"] as? Bool) ?? false
}

func frontmostBundleID() -> String {
    NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
}

func report(_ name: String, _ value: String) {
    emit("FXP_\(name)=\(value)")
}

/**
 * Posts one combination the way a keyboard does: the modifiers go down as their own events, the
 * key goes down and up with the modifier flags set on *both* halves, and the modifiers come back
 * up in reverse. A key-up without the flags reads as a different chord, and an application that
 * watches for the modifier keys themselves sees nothing at all without the flagsChanged pair.
 */
func postCombo(_ combo: PostCombo, delayMs: UInt32, modifierEvents: Bool) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let pause = { _ = usleep(delayMs * 1000) }
    let send = { (event: CGEvent?) in
        event?.post(tap: .cgSessionEventTap)
        pause()
    }
    var held: CGEventFlags = []
    if modifierEvents {
        for modifier in combo.modifiers {
            held.insert(modifier.flag)
            let event = CGEvent(keyboardEventSource: source, virtualKey: modifier.code, keyDown: true)
            event?.flags = held
            event?.type = .flagsChanged
            send(event)
        }
    }
    let down = CGEvent(keyboardEventSource: source, virtualKey: combo.key, keyDown: true)
    down?.flags = combo.flags
    send(down)
    let up = CGEvent(keyboardEventSource: source, virtualKey: combo.key, keyDown: false)
    up?.flags = combo.flags
    send(up)
    if modifierEvents {
        var releasing = combo.flags
        for modifier in combo.modifiers.reversed() {
            releasing.remove(modifier.flag)
            let event = CGEvent(keyboardEventSource: source, virtualKey: modifier.code, keyDown: false)
            event?.flags = releasing
            event?.type = .flagsChanged
            send(event)
        }
    }
}

/**
 * Writes whatever image is on the pasteboard to `file` as a PNG and reports where it came from.
 *
 * The pasteboard holds one image in several flavours at once and only some of them carry an alpha
 * channel, so the order here is the order of how much survives. PNG is taken byte for byte: it is
 * already the format being asked for, and going through a bitmap and back is the step that would
 * flatten a cut-out onto white. TIFF and the generic NSImage reading are re-encoded, which is
 * lossless — PNG always is — but only preserves transparency the source actually had.
 */
func writeClipboardImage(to file: String) {
    let board = NSPasteboard.general
    var png: Data?
    var rep: NSBitmapImageRep?
    var source = ""

    if let data = board.data(forType: .png), let bitmap = NSBitmapImageRep(data: data) {
        png = data
        rep = bitmap
        source = "png"
    } else if let data = board.data(forType: .tiff), let bitmap = NSBitmapImageRep(data: data) {
        png = bitmap.representation(using: .png, properties: [:])
        rep = bitmap
        source = "tiff"
    } else if let image = NSImage(pasteboard: board),
              let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff) {
        png = bitmap.representation(using: .png, properties: [:])
        rep = bitmap
        source = "nsimage"
    }

    guard let bitmap = rep else {
        report("CLIPBOARD_SOURCE", "none")
        report("OK", "false")
        report("ERROR", "no-image")
        exit(0)
    }
    report("CLIPBOARD_SOURCE", source)
    report("CLIPBOARD_ALPHA", bitmap.hasAlpha ? "true" : "false")
    report("WIDTH", String(bitmap.pixelsWide))
    report("HEIGHT", String(bitmap.pixelsHigh))
    guard let data = png, !data.isEmpty else {
        report("OK", "false")
        report("ERROR", "encode-failed")
        exit(0)
    }
    do {
        try data.write(to: URL(fileURLWithPath: file), options: .atomic)
    } catch {
        report("OK", "false")
        report("ERROR", "write-failed")
        exit(0)
    }
    report("PATH", file)
    report("BYTES", String(data.count))
    report("OK", "true")
    exit(0)
}

let oneShotModes = ["preflight", "request", "pasteboard", "keys", "clipboard"]

struct OneShot {
    var mode = ""
    var combo = "cmd+c"
    var bundlePrefix = "com.adobe.PremierePro"
    var delayMs: UInt32 = 24
    var modifierEvents = true
    var out = ""
}

func readOneShot(_ arguments: [String]) -> OneShot {
    var options = OneShot()
    options.mode = arguments.first ?? ""
    var index = 1
    while index < arguments.count {
        let flag = arguments[index]
        let value = index + 1 < arguments.count ? arguments[index + 1] : nil
        switch flag {
        case "--combo":
            if let value = value { options.combo = value }
            index += 2
        case "--target", "--bundle-prefix":
            if let value = value { options.bundlePrefix = value }
            index += 2
        case "--delay":
            if let value = value, let ms = UInt32(value) { options.delayMs = ms }
            index += 2
        case "--out":
            if let value = value { options.out = value }
            index += 2
        case "--no-modifier-events":
            options.modifierEvents = false
            index += 1
        default:
            index += 1
        }
    }
    return options
}

/** Everything the panel needs to decide whether pressing keys is allowed, and who would own it. */
func reportAccess(_ options: OneShot) -> (granted: Bool, locked: Bool, frontIsTarget: Bool) {
    let granted = CGPreflightPostEventAccess()
    let locked = screenIsLocked()
    let front = frontmostBundleID()
    let frontIsTarget = front.hasPrefix(options.bundlePrefix)
    report("PLATFORM", "darwin")
    report("POST_ACCESS", granted ? "granted" : "denied")
    report("SCREEN_LOCKED", locked ? "true" : "false")
    report("FRONTMOST", front.isEmpty ? "unknown" : front)
    report("FRONT_IS_TARGET", frontIsTarget ? "true" : "false")
    report("RESPONSIBLE", responsibleExecutable() ?? "unknown")
    return (granted, locked, frontIsTarget)
}

func reportPasteboard() {
    report("PASTEBOARD", String(NSPasteboard.general.changeCount))
}

/**
 * Runs a one-shot mode and never returns, or returns without doing anything when there is no mode to
 * run, which is how the same binary stays the long-running listener.
 *
 * A first argument that is a word rather than a flag is meant as a mode, so one that names no mode is
 * refused: falling through would silently start the listener instead.
 */
func runOneShot(_ arguments: [String]) {
    let options = readOneShot(arguments)
    switch options.mode {
    case let word where !word.isEmpty && !word.hasPrefix("-") && !oneShotModes.contains(word):
        report("PLATFORM", "darwin")
        report("OK", "false")
        report("ERROR", "unknown-mode")
        exit(2)
    case "preflight":
        _ = reportAccess(options)
        reportPasteboard()
        report("OK", "true")
        exit(0)
    case "request":
        // Asking a second time after the grant would show nothing and is worth avoiding anyway:
        // CGRequestPostEventAccess opens System Settings, which takes the user out of Premiere.
        let before = CGPreflightPostEventAccess()
        let granted = before ? true : CGRequestPostEventAccess()
        report("PLATFORM", "darwin")
        report("REQUESTED", before ? "false" : "true")
        report("POST_ACCESS", granted ? "granted" : "denied")
        report("OK", "true")
        exit(0)
    case "pasteboard":
        report("PLATFORM", "darwin")
        reportPasteboard()
        report("OK", "true")
        exit(0)
    case "clipboard":
        report("PLATFORM", "darwin")
        if options.out.isEmpty {
            report("OK", "false")
            report("ERROR", "no-output-path")
            exit(0)
        }
        writeClipboardImage(to: options.out)
    case "keys":
        let access = reportAccess(options)
        guard let combo = parsePostCombo(options.combo) else {
            report("OK", "false")
            report("ERROR", "bad-combo")
            exit(0)
        }
        // Three refusals rather than one, because the panel says something different for each and
        // a keystroke sent into the wrong application is not something to find out about later.
        if !access.granted {
            report("OK", "false")
            report("ERROR", "no-access")
            exit(0)
        }
        if access.locked {
            report("OK", "false")
            report("ERROR", "screen-locked")
            exit(0)
        }
        if !access.frontIsTarget {
            report("OK", "false")
            report("ERROR", "not-frontmost")
            exit(0)
        }
        postCombo(combo, delayMs: options.delayMs, modifierEvents: options.modifierEvents)
        report("POSTED", combo.spec)
        // Read after posting, so the caller can tell a Copy that reached Premiere from one that
        // was swallowed on the way. CGEventPost itself answers nothing.
        reportPasteboard()
        report("OK", "true")
        exit(0)
    default:
        return
    }
}

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

runOneShot(Array(CommandLine.arguments.dropFirst()))

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
