package app.retrospend.hardwarekeys

import android.content.Context
import android.hardware.input.InputManager
import android.view.InputDevice
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Whether a physical keyboard is connected, so the composer can drop its
 * on-screen keypad. A real keyboard is an alphabetic, non-virtual input
 * device; the module also tells JavaScript when one is plugged in or removed.
 */
class RetrospendHardwareKeyboardModule : Module() {
  private var listener: InputManager.InputDeviceListener? = null

  private val manager: InputManager?
    get() = appContext.reactContext?.getSystemService(Context.INPUT_SERVICE) as? InputManager

  private fun connected(): Boolean =
    InputDevice.getDeviceIds().any { id ->
      val device = InputDevice.getDevice(id)
      device != null &&
        !device.isVirtual &&
        device.keyboardType == InputDevice.KEYBOARD_TYPE_ALPHABETIC &&
        (device.sources and InputDevice.SOURCE_KEYBOARD) == InputDevice.SOURCE_KEYBOARD
    }

  override fun definition() = ModuleDefinition {
    Name("RetrospendHardwareKeyboard")

    Events("onKeyboardChange")

    Function("keyboardConnected") { connected() }

    OnCreate {
      val changed = object : InputManager.InputDeviceListener {
        override fun onInputDeviceAdded(deviceId: Int) = notify()
        override fun onInputDeviceRemoved(deviceId: Int) = notify()
        override fun onInputDeviceChanged(deviceId: Int) = notify()
        private fun notify() = sendEvent("onKeyboardChange", mapOf("connected" to connected()))
      }
      listener = changed
      manager?.registerInputDeviceListener(changed, null)
    }

    OnDestroy {
      listener?.let { manager?.unregisterInputDeviceListener(it) }
      listener = null
    }
  }
}
