"""Keep the Electron widget in Explorer's desktop layer, above wallpaper.

The helper owns no window. It exits with the widget and reattaches after Explorer
recreates its desktop. All coordinates passed to SetWindowPos are client pixels.
"""
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import sys
import time

user = ctypes.WinDLL('user32', use_last_error=True)
HWND = wintypes.HWND
LONG_PTR = ctypes.c_ssize_t
user.IsWindow.argtypes = [HWND]
user.IsWindowVisible.argtypes = [HWND]
user.GetParent.argtypes = [HWND]
user.GetParent.restype = HWND
user.SetParent.argtypes = [HWND, HWND]
user.SetParent.restype = HWND
user.GetWindowLongPtrW.argtypes = [HWND, ctypes.c_int]
user.GetWindowLongPtrW.restype = LONG_PTR
user.SetWindowLongPtrW.argtypes = [HWND, ctypes.c_int, LONG_PTR]
user.SetWindowLongPtrW.restype = LONG_PTR
user.GetWindowRect.argtypes = [HWND, ctypes.POINTER(wintypes.RECT)]
user.ScreenToClient.argtypes = [HWND, ctypes.POINTER(wintypes.POINT)]
user.FindWindowExW.argtypes = [HWND, HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
user.FindWindowExW.restype = HWND
user.SetWindowPos.argtypes = [HWND, HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
user.GetClassNameW.argtypes = [HWND, wintypes.LPWSTR, ctypes.c_int]
ENUM = ctypes.WINFUNCTYPE(wintypes.BOOL, HWND, wintypes.LPARAM)
user.EnumWindows.argtypes = [ENUM, wintypes.LPARAM]
user.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
try:
    user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except Exception:
    pass

widget = int(sys.argv[1])
report = Path(sys.argv[2])

def class_name(hwnd):
    text = ctypes.create_unicode_buffer(256)
    user.GetClassNameW(hwnd, text, 256)
    return text.value

def desktop_parent():
    found = []
    @ENUM
    def visit(hwnd, _):
        if user.FindWindowExW(hwnd, None, 'SHELLDLL_DefView', None):
            found.append(hwnd)
        return True
    user.EnumWindows(visit, 0)
    return found[0] if found else None

def save(status, **extra):
    rect = wintypes.RECT()
    user.GetWindowRect(widget, ctypes.byref(rect))
    payload = {'status': status, 'hwnd': widget, 'bounds': {'x':rect.left,'y':rect.top,'width':rect.right-rect.left,'height':rect.bottom-rect.top}, **extra}
    temporary = report.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, indent=2), encoding='utf-8')
    temporary.replace(report)

try:
    command_file = report.with_name('desktop-command.json')
    last_command = None
    ticks = 0
    while user.IsWindow(widget):
        parent = desktop_parent()
        if parent and user.GetParent(widget) != parent:
            rect = wintypes.RECT()
            user.GetWindowRect(widget, ctypes.byref(rect))
            point = wintypes.POINT(rect.left, rect.top)
            user.ScreenToClient(parent, ctypes.byref(point))
            # Keep the layered/transparent extended style provided by Electron.
            style = user.GetWindowLongPtrW(widget, -16)
            user.SetWindowLongPtrW(widget, -16, (style | 0x40000000) & ~0x80000000)
            ctypes.set_last_error(0)
            user.SetParent(widget, parent)
            error = ctypes.get_last_error()
            if user.GetParent(widget) != parent:
                save('error', error=error)
            else:
                user.SetWindowPos(widget, HWND(0), point.x, point.y, rect.right-rect.left, rect.bottom-rect.top, 0x0010 | 0x0020 | 0x0040)
                save('attached', parent=int(parent), parentClass=class_name(parent), childStyle=bool(user.GetWindowLongPtrW(widget,-16)&0x40000000))
        if parent and user.GetParent(widget) == parent:
            try:
                command = json.loads(command_file.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                command = None
            if command and command.get('id') != last_command:
                box = command['bounds']
                point = wintypes.POINT(int(box['x']), int(box['y']))
                user.ScreenToClient(parent, ctypes.byref(point))
                user.SetWindowPos(widget, HWND(0), point.x, point.y, int(box['width']), int(box['height']), 0x0010 | 0x0040)
                last_command = command['id']
            if ticks % 4 == 0 or command and command.get('id') == last_command:
                save('attached', parent=int(parent), parentClass=class_name(parent), childStyle=True, commandId=last_command)
        ticks += 1
        time.sleep(.05)
except Exception as error:
    save('error', error=str(error))
