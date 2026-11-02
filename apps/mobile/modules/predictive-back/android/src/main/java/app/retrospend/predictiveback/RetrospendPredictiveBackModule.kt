package app.retrospend.predictiveback

import android.app.Activity
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Predictive back for pushed screens (Android 16 and up).
 *
 * react-native-screens pops a screen from JavaScript, so the system gets a plain
 * callback and shows only the arrow while the person drags from the edge. When
 * the navigation state has a screen to pop, JavaScript turns this module on; it
 * then owns the back gesture at overlay priority, moves the top screen with the
 * finger (see [BackPreview]) and, once the gesture commits, hands the back
 * press to the activity as before so the stack pops through JavaScript. When
 * there is nothing to pop it is off and the system's own back-to-home preview
 * runs. Below API 36 it does nothing, so back is exactly what it was.
 */
class RetrospendPredictiveBackModule : Module() {
  private var wanted = false
  private var preview: BackPreview? = null

  private val activity: Activity?
    get() = appContext.currentActivity

  override fun definition() = ModuleDefinition {
    Name("RetrospendPredictiveBack")

    Function("setEnabled") { enabled: Boolean ->
      wanted = enabled
      apply()
    }

    OnActivityEntersForeground { apply() }
    OnActivityEntersBackground { release() }
    OnActivityDestroys { release() }
  }

  private fun apply() {
    val host = activity ?: return
    if (Build.VERSION.SDK_INT < 36) return
    host.runOnUiThread {
      if (wanted) {
        val current = preview ?: BackPreview(host).also { preview = it }
        current.register()
      } else {
        preview?.unregister()
      }
    }
  }

  private fun release() {
    val host = activity
    if (host == null) {
      preview = null
      return
    }
    host.runOnUiThread {
      preview?.unregister()
      preview = null
    }
  }
}
