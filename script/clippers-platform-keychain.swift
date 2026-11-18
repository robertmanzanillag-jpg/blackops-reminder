import Foundation
import Security
import Darwin

// One fixed per-consumer item. No writes, unlocks, ACL edits, arguments or UI.
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
    print("{\"syntheticTestsPassed\":16,\"realKeychainQueries\":0}")
}
runSyntheticTests()
#else
let reply: [String: String]
if CommandLine.arguments.count != 1 {
    reply = ["status": "invalid"]
} else {
    reply = platformCredential(
        disableInteraction: { SecKeychainSetUserInteractionAllowed(false) },
        copyMatching: { query, result in SecItemCopyMatching(query, result) }
    )
}
if let encoded = try? JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys]) {
    FileHandle.standardOutput.write(encoded)
    FileHandle.standardOutput.write(Data([10]))
}
#endif
