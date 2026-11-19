import AppKit
import Security

let service = "dev.prithvi.hotkey-visualizer"
let account = "export-passphrase"

func query(_ service: String, _ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service,
     kSecAttrAccount as String: account]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

switch CommandLine.arguments.dropFirst().first {
case "get":
    for (s, a) in [(service, account), ("Raycast", "export_passphrase")] {
        var q = query(s, a)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data {
            FileHandle.standardOutput.write(data)
            exit(0)
        }
    }
    fail("No accessible export password in Keychain.")
case "set":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty else { fail("Empty passwords cannot be stored.") }
    let q = query(service, account)
    let status = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
        var item = q
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else { fail("Keychain save failed (\(added)).") }
    } else if status != errSecSuccess { fail("Keychain update failed (\(status)).") }
case "delete":
    let status = SecItemDelete(query(service, account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { fail("Keychain delete failed (\(status)).") }
case "prompt":
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "Raycast Export Password"
    alert.informativeText = "Enter the password used for your .rayconfig export. It stays on this Mac and is saved in Keychain only after successful decryption."
    alert.addButton(withTitle: "Unlock Export")
    alert.addButton(withTitle: "Cancel")
    let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 26))
    alert.accessoryView = field
    alert.window.initialFirstResponder = field
    guard alert.runModal() == .alertFirstButtonReturn else { exit(2) }
    guard !field.stringValue.isEmpty else { fail("Enter the export password.") }
    FileHandle.standardOutput.write(Data(field.stringValue.utf8))
default:
    fail("Usage: keychain-helper get|set|delete|prompt")
}
