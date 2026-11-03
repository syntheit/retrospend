package app.retrospend.hardwarekeys

import android.content.Context
import android.content.res.Configuration
import android.hardware.input.InputManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Whether a physical keyboard is connected, so the composer can drop its
 * on-screen keypad, from the system's own configuration. The module also
 * tells JavaScript when a keyboard is plugged in or removed.
 */
class RetrospendHardwareKeyboardModule : Module() {
  private var listener: InputManager.InputDeviceListener? = null

  private val manager: InputManager?
    get() = appContext.reactContext?.getSystemService(Context.INPUT_SERVICE) as? InputManager

  // The system's own view of it: the configuration reports a keyboard only
  // while a physical one is attached and in use. (The device list is not
  // enough: the emulator always lists a PS/2 keyboard, even with none set.)
  private fun connected(): Boolean {
    val config = appContext.reactContext?.resources?.configuration ?: return false
    return config.keyboard != Configuration.KEYBOARD_NOKEYS &&
      config.hardKeyboardHidden != Configuration.HARDKEYBOARDHIDDEN_YES
  }

  override fun definition() = ModuleDefinition {
    Name("RetrospendHardwareKeyboard")

    Events("onKeyboardChange")

    Function("keyboardConnected") { connected() }

    OnCreate {
      val watcher = object : InputManager.InputDeviceListener {
        override fun onInputDeviceAdded(deviceId: Int) = report()
        override fun onInputDeviceRemoved(deviceId: Int) = report()
        override fun onInputDeviceChanged(deviceId: Int) = report()
        private fun report() = sendEvent("onKeyboardChange", mapOf("connected" to connected()))
      }
      listener = watcher
      manager?.registerInputDeviceListener(watcher, null)
    }

    OnDestroy {
      listener?.let { manager?.unregisterInputDeviceListener(it) }
      listener = null
    }
  }
}
