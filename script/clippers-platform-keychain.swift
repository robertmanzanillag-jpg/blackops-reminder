import Foundation
import Security
import Darwin
import CryptoKit
#if !CLIPPERS_KEYCHAIN_TEST
import AppKit
#endif

// Default reader: one fixed item, no writes, unlocks, ACL edits or UI.
// Only explicit user --setup can create one new item with one-app access.
let platformService = "com.blackops.clippers-orchestra.replit-production"
let platformAccount = "clippers-telemetry"
let maximumTokenBytes = 8192

func privateOutputMode(_ mode: mode_t, family: sa_family_t?) -> Bool {
    let kind = mode & mode_t(S_IFMT)
    return kind == mode_t(S_IFIFO) || (kind == mode_t(S_IFSOCK) && family == sa_family_t(AF_UNIX))
}

func privateStandardOutput() -> Bool {
    var info = stat()
    guard fstat(STDOUT_FILENO, &info) == 0 else { return false }
    if info.st_mode & mode_t(S_IFMT) == mode_t(S_IFIFO) { return true }
    guard info.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK) else { return false }
    var address = sockaddr_storage()
    var length = socklen_t(MemoryLayout<sockaddr_storage>.size)
    let status = withUnsafeMutablePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(STDOUT_FILENO, $0, &length) }
    }
    return status == 0 && privateOutputMode(info.st_mode, family: address.ss_family)
}

func platformCredential(
    outputSafe: () -> Bool = privateStandardOutput,
    disableInteraction: () -> OSStatus,
    copyMatching: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>) -> OSStatus
) -> [String: String] {
    guard outputSafe() else { return ["status": "invalid"] }
    guard disableInteraction() == errSecSuccess else { return ["status": "unavailable"] }
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: platformService,
        kSecAttrAccount: platformAccount,
        kSecReturnData: true,
        kSecMatchLimit: kSecMatchLimitOne,
        kSecUseAuthenticationUI: kSecUseAuthenticationUIFail,
    ]
    var item: CFTypeRef?
    let status = copyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return ["status": "missing"] }
    guard status == errSecSuccess else { return ["status": "unavailable"] }
    guard let data = item as? Data, data.count >= 16, data.count <= maximumTokenBytes,
          let token = String(data: data, encoding: .utf8),
          token.range(of: "^[A-Za-z0-9._~+/-]+=*$", options: .regularExpression) != nil,
          !token.contains("\n"), !token.contains("\r") else { return ["status": "invalid"] }
    return ["status": "found", "token": token]
}

// Setup is an explicit user-only action. It never reads an existing item and
// SecItemAdd cannot overwrite one. The injectable core is tested without Security.
func createPlatformCredential(
    token: String,
    validatedReader: () -> String?,
    exactAccess: (String) -> CFTypeRef?,
    addItem: (CFDictionary) -> OSStatus
) -> String {
    let bytes = Data(token.utf8)
    guard bytes.count >= 16 && bytes.count <= maximumTokenBytes,
          token.range(of: "^[A-Za-z0-9._~+/-]+=*$", options: .regularExpression) != nil,
          !token.contains("\n"), !token.contains("\r") else { return "invalid" }
    guard let reader = validatedReader(), let access = exactAccess(reader) else { return "unsafe_reader" }
    let attributes: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword, kSecAttrService: platformService,
        kSecAttrAccount: platformAccount, kSecAttrLabel: "Clippers private Replit telemetry",
        kSecValueData: bytes, kSecAttrAccess: access,
    ]
    let status = addItem(attributes as CFDictionary)
    if status == errSecSuccess { return "stored" }
    if status == errSecDuplicateItem { return "already_exists" }
    return "unavailable"
}

func sameBinaryFile(_ a: stat, _ b: stat) -> Bool {
    a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_uid == b.st_uid &&
    a.st_mode == b.st_mode && a.st_nlink == b.st_nlink && a.st_size == b.st_size &&
    a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
    a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec
}

func privateBinaryDigest(_ path: String) -> String? {
    guard URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path else { return nil }
    let descriptor = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    guard descriptor >= 0 else { return nil }
    defer { close(descriptor) }
    var before = stat()
    let maximum = 25 * 1024 * 1024
    guard fstat(descriptor, &before) == 0, before.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
          before.st_mode & 0o777 == 0o700, before.st_uid == getuid(), before.st_nlink == 1,
          before.st_size >= 0, before.st_size <= maximum else { return nil }
    var bytes = Data(), buffer = [UInt8](repeating: 0, count: 65536)
    while bytes.count <= maximum {
        let count = read(descriptor, &buffer, min(buffer.count, maximum + 1 - bytes.count))
        if count < 0 { return nil }
        if count == 0 { break }
        bytes.append(contentsOf: buffer.prefix(count))
    }
    guard bytes.count <= maximum else { return nil }
    var after = stat(), current = stat()
    guard fstat(descriptor, &after) == 0, lstat(path, &current) == 0,
          sameBinaryFile(before, after), sameBinaryFile(before, current) else { return nil }
    return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
}

#if !CLIPPERS_KEYCHAIN_TEST
func setupReaderIdentity() -> (String, String)? {
    let expected = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".local/share/blackops/clippers-runtime/script/clippers-platform-keychain").path
    var size: UInt32 = 0
    _ = _NSGetExecutablePath(nil, &size)
    var buffer = [CChar](repeating: 0, count: Int(size))
    guard _NSGetExecutablePath(&buffer, &size) == 0 else { return nil }
    let running = URL(fileURLWithPath: String(cString: buffer)).resolvingSymlinksInPath().path
    let file = URL(fileURLWithPath: expected)
    guard running == expected, file.resolvingSymlinksInPath().path == expected,
          let digest = privateBinaryDigest(expected) else { return nil }
    return (expected, digest)
}

func exactReaderAccess(_ path: String) -> CFTypeRef? {
    var trusted: SecTrustedApplication?
    guard setupReaderIdentity()?.0 == path,
          SecTrustedApplicationCreateFromPath(nil, &trusted) == errSecSuccess,
          let application = trusted else { return nil }
    var access: SecAccess?
    // Explicit single application; never nil/all-apps or an interpreter.
    guard SecAccessCreate("Clippers private Replit telemetry" as CFString, [application] as CFArray, &access) == errSecSuccess,
          let result = access else { return nil }
    return result
}

final class PlatformSetup: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let secure = NSSecureTextField(frame: NSRect(x: 24, y: 130, width: 552, height: 28))
    let status = NSTextField(wrappingLabelWithString: "")
    let save = NSButton(title: "Guardar", target: nil, action: nil)
    var window: NSWindow?
    let identity = setupReaderIdentity()
    var saved = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 300),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window = panel; panel.delegate = self; panel.title = "Acceso privado de Replit para Clippers"
        let label = NSTextField(wrappingLabelWithString:
            "Pega solo el token Production que aprobaste crear. Se guarda en Keychain para este lector; no cambia Replit ni reemplaza un token existente.")
        label.frame = NSRect(x: 24, y: 232, width: 552, height: 48)
        let reader = NSTextField(wrappingLabelWithString: identity.map { "Lector: \($0.0)\nSHA256: \($0.1)" } ?? "Lector no instalado o no verificado. No se puede guardar.")
        reader.frame = NSRect(x: 24, y: 170, width: 552, height: 54)
        reader.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
        secure.placeholderString = "Token de acceso Production"
        secure.setAccessibilityLabel("Token de acceso de producción de Replit")
        status.frame = NSRect(x: 24, y: 72, width: 552, height: 48)
        status.stringValue = "Solo el usuario debe pegar el valor. Cancelar no guarda nada."
        save.frame = NSRect(x: 464, y: 20, width: 112, height: 32); save.target = self; save.action = #selector(PlatformSetup.store)
        save.isEnabled = identity != nil
        let cancel = NSButton(title: "Cancelar", target: self, action: #selector(PlatformSetup.cancel))
        cancel.frame = NSRect(x: 340, y: 20, width: 112, height: 32)
        for view in [label, reader, secure, status, save, cancel] { panel.contentView?.addSubview(view) }
        panel.center(); panel.makeKeyAndOrderFront(nil); panel.makeFirstResponder(secure)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func store() {
        guard !saved, let expected = identity else { return }
        let value = secure.stringValue; secure.stringValue = ""
        let result = createPlatformCredential(token: value, validatedReader: {
            guard let current = setupReaderIdentity(), current.0 == expected.0, current.1 == expected.1 else { return nil }
            return current.0
        }, exactAccess: exactReaderAccess, addItem: { SecItemAdd($0, nil) })
        let messages = ["stored": "Guardado para el lector mostrado. macOS puede pedir aprobación normal. Ya puedes cerrar.",
            "already_exists": "Ya existe este elemento. No se sobrescribió ni modificó nada.",
            "unsafe_reader": "El lector cambió o no está verificado. No se guardó.",
            "invalid": "El valor no tiene el formato esperado. No se guardó.",
            "unavailable": "Keychain no confirmó el guardado. No se reintentó ni se cambió otro elemento."]
        status.stringValue = messages[result] ?? "No se confirmó el guardado."
        saved = result == "stored"; save.isEnabled = !saved
    }
    @objc func cancel() { secure.stringValue = ""; NSApp.terminate(nil) }
    func windowWillClose(_ notification: Notification) { secure.stringValue = ""; NSApp.terminate(nil) }
}

func userSetup() {
    let application = NSApplication.shared
    application.setActivationPolicy(.regular)
    let controller = PlatformSetup()
    application.delegate = controller
    withExtendedLifetime(controller) { application.run() }
}
#endif

#if CLIPPERS_KEYCHAIN_TEST
// This separately compiled binary cannot query the real Keychain. Both OS
// operations are injected fakes, and the production entry point is compiled out.
func runSyntheticTests() {
    let synthetic = "synthetic-platform-token-only-123456789"
    var queryCalls = 0
    precondition(privateOutputMode(mode_t(S_IFIFO), family: nil))
    precondition(privateOutputMode(mode_t(S_IFSOCK), family: sa_family_t(AF_UNIX)))
    precondition(!privateOutputMode(mode_t(S_IFSOCK), family: sa_family_t(AF_INET)))
    precondition(!privateOutputMode(mode_t(S_IFREG), family: nil))
    precondition(!privateOutputMode(mode_t(S_IFCHR), family: nil))
    let noOutput = platformCredential(outputSafe: { false }, disableInteraction: {
        preconditionFailure("Security must not run for a terminal or regular output file")
    }, copyMatching: { _, _ in preconditionFailure("lookup must not run without a private pipe") })
    precondition(noOutput == ["status": "invalid"])
    let found = platformCredential(disableInteraction: { errSecSuccess }, copyMatching: { query, item in
        queryCalls += 1
        let q = query as NSDictionary
        precondition(q[kSecClass] as? String == kSecClassGenericPassword as String)
        precondition(q[kSecAttrService] as? String == platformService)
        precondition(q[kSecAttrAccount] as? String == platformAccount)
        precondition(q[kSecUseAuthenticationUI] as? String == kSecUseAuthenticationUIFail as String)
        precondition(q[kSecMatchLimit] as? String == kSecMatchLimitOne as String)
        precondition(q[kSecReturnData] as? Bool == true)
        item.pointee = Data(synthetic.utf8) as CFData
        return errSecSuccess
    })
    precondition(found == ["status": "found", "token": synthetic] && queryCalls == 1)
    let noUI = platformCredential(disableInteraction: { errSecInteractionNotAllowed }, copyMatching: { _, _ in
        preconditionFailure("lookup must not run if interaction cannot be disabled")
    })
    precondition(noUI == ["status": "unavailable"])
    for (code, expected) in [(errSecItemNotFound, "missing"), (errSecInteractionNotAllowed, "unavailable"), (errSecAuthFailed, "unavailable")] {
        precondition(platformCredential(disableInteraction: { errSecSuccess }, copyMatching: { _, _ in code }) == ["status": expected])
    }
    for data in [Data(), Data([0xff, 0xfe]), Data("synthetic-token\ninjected".utf8), Data(repeating: 97, count: 8193)] {
        let reply = platformCredential(disableInteraction: { errSecSuccess }, copyMatching: { _, item in item.pointee = data as CFData; return errSecSuccess })
        precondition(reply == ["status": "invalid"])
    }
    precondition(platformCredential(disableInteraction: { errSecSuccess }, copyMatching: { _, _ in errSecSuccess }) == ["status": "invalid"])
    var additions = 0
    let stored = createPlatformCredential(token: synthetic, validatedReader: { "/synthetic/reviewed-reader" }, exactAccess: { path in
        precondition(path == "/synthetic/reviewed-reader"); return "single-exact-application" as CFString
    }, addItem: { query in
        additions += 1; let q = query as NSDictionary
        precondition(q[kSecAttrService] as? String == platformService && q[kSecAttrAccount] as? String == platformAccount)
        precondition(q[kSecClass] as? String == kSecClassGenericPassword as String)
        precondition(q[kSecAttrAccess] as? String == "single-exact-application")
        precondition(q[kSecValueData] as? Data == Data(synthetic.utf8))
        return errSecSuccess
    })
    precondition(stored == "stored" && additions == 1)
    let duplicate = createPlatformCredential(token: synthetic, validatedReader: { "/synthetic/reviewed-reader" }, exactAccess: { _ in "one-app" as CFString }, addItem: { _ in additions += 1; return errSecDuplicateItem })
    precondition(duplicate == "already_exists" && additions == 2)
    precondition(createPlatformCredential(token: "bad", validatedReader: { preconditionFailure("invalid input must not authorize access") }, exactAccess: { _ in nil }, addItem: { _ in preconditionFailure("invalid input must not write") }) == "invalid")
    precondition(createPlatformCredential(token: synthetic, validatedReader: { nil }, exactAccess: { _ in nil }, addItem: { _ in preconditionFailure("unsafe reader must not write") }) == "unsafe_reader")
    precondition(createPlatformCredential(token: synthetic, validatedReader: { "/synthetic/reviewed-reader" }, exactAccess: { _ in nil }, addItem: { _ in preconditionFailure("missing exact ACL must not write") }) == "unsafe_reader")
    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
    try! FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporary) }
    let file = temporary.appendingPathComponent("synthetic-reader").path
    FileManager.default.createFile(atPath: file, contents: Data("public-code-only".utf8), attributes: [.posixPermissions: 0o700])
    precondition(privateBinaryDigest(file) != nil)
    chmod(file, 0o644); precondition(privateBinaryDigest(file) == nil); chmod(file, 0o700)
    let alias = temporary.appendingPathComponent("alias").path
    precondition(symlink(file, alias) == 0 && privateBinaryDigest(alias) == nil)
    let fifo = temporary.appendingPathComponent("fifo").path
    precondition(mkfifo(fifo, 0o700) == 0 && privateBinaryDigest(fifo) == nil)
    let linked = temporary.appendingPathComponent("linked").path
    precondition(link(file, linked) == 0 && privateBinaryDigest(file) == nil); unlink(linked)
    let descriptor = open(file, O_WRONLY)
    precondition(descriptor >= 0 && ftruncate(descriptor, 25 * 1024 * 1024 + 1) == 0); close(descriptor)
    precondition(privateBinaryDigest(file) == nil)
    print("{\"syntheticTestsPassed\":30,\"realKeychainQueries\":0,\"realKeychainWrites\":0}")
}
runSyntheticTests()
#else
if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--setup" {
    // Explicit user-only UI. No agent or scheduled sender invokes this mode.
    userSetup()
} else {
    let reply = CommandLine.arguments.count == 1 ? platformCredential(
        disableInteraction: { SecKeychainSetUserInteractionAllowed(false) },
        copyMatching: { query, result in SecItemCopyMatching(query, result) }
    ) : ["status": "invalid"]
    if let encoded = try? JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(encoded)
        FileHandle.standardOutput.write(Data([10]))
    }
}
#endif
