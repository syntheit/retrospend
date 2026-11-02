package app.retrospend.predictiveback

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.view.View
import android.view.ViewGroup
import com.swmansion.rnscreens.Screen
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
  private var color: Int? = null
  private var preview: BackPreview? = null

  private val activity: Activity?
    get() = appContext.currentActivity

  override fun definition() = ModuleDefinition {
    Name("RetrospendPredictiveBack")

    // `backdrop` is the color (#rrggbb) the shrinking screen reveals around
    // itself, from the theme tokens.
    Function("setEnabled") { enabled: Boolean, backdrop: String? ->
      wanted = enabled
      color = backdrop?.let { runCatching { Color.parseColor(it) }.getOrNull() }
      apply()
    }

    // A modal bottom sheet (the account sheet) closes on a downward drag of
    // its body when the list inside is at the top: nested scrolling, which the
    // sheet's behavior wires up at layout time. The stack inside the sheet
    // adds its screens after that layout, so the sheet has none to hand the
    // drag to until it is laid out again. JavaScript calls this when a page of
    // the sheet appears; it works on every Android version.
    Function("refreshSheetScroll") {
      val host = activity
      if (host != null) {
        val root = host.window.decorView
        host.runOnUiThread { relayoutSheets(root) }
        // The page's fragment is attached a little after the call.
        root.postDelayed({ relayoutSheets(root) }, 450)
      }
      null
    }

    OnActivityEntersForeground { apply() }
    OnActivityEntersBackground { release() }
    OnActivityDestroys { release() }
  }

  /** Asks the layout of every form sheet's container to run again. */
  private fun relayoutSheets(view: View) {
    if (view is Screen && view.stackPresentation == Screen.StackPresentation.FORM_SHEET) {
      (view.parent as? View)?.requestLayout()
      return
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) relayoutSheets(view.getChildAt(i))
    }
  }

  private fun apply() {
    val host = activity ?: return
    if (Build.VERSION.SDK_INT < 36) return
    host.runOnUiThread {
      if (wanted) {
        val current = preview ?: BackPreview(host).also { preview = it }
        current.backdrop = color
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
