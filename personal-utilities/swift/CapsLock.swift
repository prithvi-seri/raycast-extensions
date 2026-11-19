import AppKit
import IOKit
import IOKit.hid

let isOn = NSEvent.modifierFlags.contains(.capsLock)

guard let matching = IOServiceMatching(kIOHIDSystemClass) else {
    fatalError("Cannot find HID system")
}

let service = IOServiceGetMatchingService(kIOMainPortDefault, matching)
guard service != 0 else {
    fatalError("HID service not found")
}

var connection: io_connect_t = 0
let result = IOServiceOpen(service, mach_task_self_, UInt32(kIOHIDParamConnectType), &connection)
IOObjectRelease(service)

guard result == KERN_SUCCESS else {
    fatalError("HID connection failed: \(result)")
}

let status = IOHIDSetModifierLockState(connection, Int32(kIOHIDCapsLockState), !isOn)
IOServiceClose(connection)

guard status == KERN_SUCCESS else {
    fatalError("Caps Lock toggle failed: \(status)")
}