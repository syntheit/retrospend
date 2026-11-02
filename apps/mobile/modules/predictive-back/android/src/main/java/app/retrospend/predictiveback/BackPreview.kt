package app.retrospend.predictiveback

import android.animation.ValueAnimator
import android.app.Activity
import android.graphics.Outline
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.animation.PathInterpolator
import android.window.BackEvent
import android.window.OnBackAnimationCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import com.swmansion.rnscreens.Screen
import com.swmansion.rnscreens.ScreenStack

/**
 * The back preview of a pushed screen: while the person drags from the edge,
 * the screen on top shrinks to 90 percent, rounds its corners and moves
 * toward the way the finger goes, as the system does for an app's window
 * (Material 3 "back to previous"). A sheet shrinks around its bottom edge.
 * Letting go past the threshold pops the stack the usual way; letting go
 * early settles the screen back.
 *
 * The callback is registered at overlay priority so it sees the gesture
 * before the activity's own callbacks. It is registered only while the
 * navigation state has something to pop (see the module), so the app's root
 * keeps the system's back-to-home preview.
 */
@RequiresApi(34)
internal class BackPreview(private val activity: Activity) {
  private val density = activity.resources.displayMetrics.density
  private val handler = Handler(Looper.getMainLooper())
  private val outline = RoundedOutline()
  private var registered = false

  private var view: View? = null
  private var sheet = false
  private var direction = 1f
  private var startY = 0f
  private var progress = 0f
  private var touchY = 0f
  private var settle: ValueAnimator? = null
  private var saved: Saved? = null

  private class Saved(
    val provider: ViewOutlineProvider?,
    val clip: Boolean,
    val elevation: Float,
  )

  private val callback =
    object : OnBackAnimationCallback {
      override fun onBackStarted(backEvent: BackEvent) = start(backEvent)

      override fun onBackProgressed(backEvent: BackEvent) = move(backEvent)

      override fun onBackCancelled() = cancel()

      override fun onBackInvoked() = commit()
    }

  fun register() {
    if (registered) return
    activity.onBackInvokedDispatcher.registerOnBackInvokedCallback(
      OnBackInvokedDispatcher.PRIORITY_OVERLAY,
      callback,
    )
    registered = true
  }

  fun unregister() {
    if (!registered) return
    activity.onBackInvokedDispatcher.unregisterOnBackInvokedCallback(callback)
    registered = false
    restore()
  }

  private fun start(event: BackEvent) {
    restore()
    val found = findTarget() ?: return
    val screen = found
    sheet = screen.stackPresentation == Screen.StackPresentation.FORM_SHEET
    val target = if (sheet) screen else (screen.parent as? View ?: screen)
    view = target
    saved = Saved(target.outlineProvider, target.clipToOutline, target.elevation)
    direction = if (event.swipeEdge == BackEvent.EDGE_LEFT) 1f else -1f
    startY = event.touchY
    touchY = event.touchY
    progress = 0f
    target.pivotX = target.width / 2f
    target.pivotY = if (sheet) target.height.toFloat() else target.height / 2f
    if (!sheet) {
      target.outlineProvider = outline
      target.clipToOutline = true
    }
  }

  private fun move(event: BackEvent) {
    if (view == null) return
    settle?.cancel()
    progress = event.progress.coerceIn(0f, 1f)
    touchY = event.touchY
    apply()
  }

  private fun cancel() {
    animateTo(0f) { restore() }
  }

  private fun commit() {
    val host = activity
    // The stack pops through JavaScript, as for a back key; its own exit
    // animation carries the shrunk screen out.
    @Suppress("DEPRECATION")
    host.onBackPressed()
    handler.postDelayed({ if (progress > 0f) animateTo(0f) { restore() } }, SETTLE_DELAY_MS)
  }

  private fun animateTo(end: Float, done: () -> Unit) {
    settle?.cancel()
    if (view == null) return done()
    settle =
      ValueAnimator.ofFloat(progress, end).apply {
        duration = SETTLE_MS
        interpolator = EASE
        addUpdateListener {
          progress = it.animatedValue as Float
          apply()
        }
        addListener(
          object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
              if (settle === animation) done()
            }
          },
        )
        start()
      }
  }

  private fun apply() {
    val target = view ?: return
    val scale = 1f - SCALE_DELTA * progress
    target.scaleX = scale
    target.scaleY = scale
    if (sheet) {
      target.translationX = 0f
      target.translationY = 0f
      return
    }
    // Slide toward the finger until the window is 8 dp from the far edge.
    val room = (target.width * (1f - scale) / 2f - MARGIN_DP * density).coerceAtLeast(0f)
    target.translationX = direction * room
    val limit = target.height / 20f
    target.translationY = (touchY - startY).coerceIn(-limit, limit) * progress
    target.elevation = ELEVATION_DP * density * progress
    outline.radius = CORNER_DP * density * progress / scale
    target.invalidateOutline()
  }

  private fun restore() {
    settle?.cancel()
    settle = null
    val target = view
    val before = saved
    view = null
    saved = null
    progress = 0f
    if (target == null) return
    target.scaleX = 1f
    target.scaleY = 1f
    target.translationX = 0f
    target.translationY = 0f
    if (before != null) {
      target.elevation = before.elevation
      target.outlineProvider = before.provider
      target.clipToOutline = before.clip
    }
  }

  /** The top screen of the deepest visible stack that has a screen to pop. */
  private fun findTarget(): Screen? {
    var current: ScreenStack = firstStack(activity.window.decorView) ?: return null
    var best: ScreenStack? = null
    while (true) {
      if (current.screenCount > 1) best = current
      val top = current.topScreen ?: break
      current = firstStack(top) ?: break
    }
    return best?.topScreen
  }

  /** The first stack under [root] (outermost first) that is on screen. */
  private fun firstStack(root: View): ScreenStack? {
    if (root.visibility != View.VISIBLE) return null
    if (root is ScreenStack && root.isShown) return root
    if (root is ViewGroup) {
      for (i in 0 until root.childCount) {
        val found = firstStack(root.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }

  /** An outline whose corner radius the gesture updates. */
  private class RoundedOutline : ViewOutlineProvider() {
    var radius = 0f

    override fun getOutline(view: View, outline: Outline) {
      outline.setRoundRect(0, 0, view.width, view.height, radius)
    }
  }

  private companion object {
    const val SCALE_DELTA = 0.1f
    const val MARGIN_DP = 8f
    const val CORNER_DP = 28f
    const val ELEVATION_DP = 8f
    const val SETTLE_MS = 200L
    const val SETTLE_DELAY_MS = 600L
    val EASE = PathInterpolator(0.2f, 0f, 0f, 1f)
  }
}
