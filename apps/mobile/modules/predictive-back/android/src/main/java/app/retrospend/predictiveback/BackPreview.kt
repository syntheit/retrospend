package app.retrospend.predictiveback

import android.animation.ValueAnimator
import android.app.Activity
import android.graphics.Outline
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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
  private var exit = 0f
  private var attached: androidx.fragment.app.Fragment? = null
  private var attachedIn: androidx.fragment.app.FragmentManager? = null
  private var gesture = 0
  private var poppedScreen: Screen? = null
  private var saved: Saved? = null

  /** The color the shrinking screen reveals around itself; set from JavaScript. */
  var backdrop: Int? = null

  private class Saved(
    val provider: ViewOutlineProvider?,
    val clip: Boolean,
    val elevation: Float,
    val container: View?,
    val containerBackground: android.graphics.drawable.Drawable?,
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
    // The pop that a commit started turns the callback off while the screen
    // is still on its way out; the watcher puts it back afterwards.
    if (exit == 0f) restore()
  }

  private fun start(event: BackEvent) {
    gesture++
    restore()
    val found = findTarget()
    if (found == null) return
    val screen = found
    poppedScreen = screen
    sheet = screen.stackPresentation == Screen.StackPresentation.FORM_SHEET
    val target = if (sheet) screen else (screen.parent as? View ?: screen)
    view = target
    // Behind a pushed screen there is only its stack; give it the backdrop
    // color so the shrunk screen reads against something.
    val container = if (sheet) null else target.parent as? View
    saved =
      Saved(
        target.outlineProvider,
        target.clipToOutline,
        target.elevation,
        container,
        container?.background,
      )
    // The screen being returned to is detached while another is on top;
    // attach it under the top one so it shows as the top one shrinks. Without
    // it (nothing to attach) the backdrop color fills in.
    val color = backdrop
    if (container != null && !(attachPrevious(screen, target)) && color != null) {
      container.setBackgroundColor(color)
    }
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

  /**
   * Adds the fragment of the screen under [top] to the stack, below [topView],
   * the way the stack itself adds it when the pop happens (it skips a
   * fragment that is already added, so the pop then shows no blank frame).
   * Returns whether there is a screen under it now.
   */
  private fun attachPrevious(top: Screen, topView: View): Boolean {
    val stack = top.container as? ScreenStack ?: return false
    var index = -1
    for (i in 0 until stack.screenCount) if (stack.getScreenAt(i) === top) index = i
    if (index < 1) return false
    val previous = stack.getScreenFragmentWrapperAt(index - 1).fragment
    if (previous.isAdded) return true
    val manager = stack.getScreenFragmentWrapperAt(index).fragment.parentFragmentManager
    return try {
      manager.beginTransaction().add(stack.id, previous).commitNowAllowingStateLoss()
      topView.bringToFront()
      attached = previous
      attachedIn = manager
      true
    } catch (_: Exception) {
      false
    }
  }

  /** Takes the previous screen away again when the gesture was cancelled. */
  private fun detachPrevious() {
    val previous = attached ?: return
    val manager = attachedIn
    attached = null
    attachedIn = null
    if (manager == null || !previous.isAdded) return
    try {
      manager.beginTransaction().remove(previous).commitNowAllowingStateLoss()
    } catch (_: Exception) {
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
    animateTo(0f) {
      restore()
      detachPrevious()
    }
  }

  private fun commit() {
    val host = activity
    // The stack pops through JavaScript, as for a back key. The stack's own
    // exit animation would start from the full-size screen, so this carries
    // the shrunk screen out itself (it keeps setting the screen's properties
    // every frame, so nothing jumps) while the previous screen comes in.
    @Suppress("DEPRECATION")
    host.onBackPressed()
    // The stack now shows it as its top screen; it is no longer ours to remove.
    val addedPrevious = attached
    val addedIn = attachedIn
    attached = null
    attachedIn = null
    if (view == null) return
    settle?.cancel()
    settle =
      ValueAnimator.ofFloat(0f, 1f).apply {
        duration = EXIT_MS
        interpolator = EASE
        addUpdateListener {
          exit = it.animatedValue as Float
          apply()
        }
        start()
      }
    // The screen is put back once the pop is over (its view is gone). A pop
    // that did not happen (a screen that blocks back) settles it back instead.
    val popped = poppedScreen
    val started = SystemClock.uptimeMillis()
    val mine = gesture
    val watch =
      object : Runnable {
        override fun run() {
          if (mine != gesture) return
          val elapsed = SystemClock.uptimeMillis() - started
          val stuck =
            popped != null && (popped.container as? ScreenStack)?.topScreen === popped
          when {
            elapsed > WATCH_MS -> restore()
            stuck && elapsed > SETTLE_DELAY_MS -> {
              exit = 0f
              // The pop did not happen: the previous screen goes away again.
              attached = addedPrevious
              attachedIn = addedIn
              animateTo(0f) {
                restore()
                detachPrevious()
              }
            }
            else -> handler.postDelayed(this, 50)
          }
        }
      }
    handler.postDelayed(watch, 50)
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
    target.alpha = 1f - exit * exit * exit
    if (sheet) {
      target.translationX = 0f
      target.translationY = exit * target.height * EXIT_SHIFT
      return
    }
    // Slide toward the finger until the window is 8 dp from the far edge.
    val room = (target.width * (1f - scale) / 2f - MARGIN_DP * density).coerceAtLeast(0f)
    target.translationX = direction * (room + exit * target.width * EXIT_SHIFT)
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
    exit = 0f
    target.alpha = 1f
    target.scaleX = 1f
    target.scaleY = 1f
    target.translationX = 0f
    target.translationY = 0f
    if (before != null) {
      target.elevation = before.elevation
      target.outlineProvider = before.provider
      target.clipToOutline = before.clip
      before.container?.background = before.containerBackground
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
    const val EXIT_MS = 300L
    const val EXIT_SHIFT = 0.1f
    const val SETTLE_DELAY_MS = 500L
    // The stack's own exit animation (450 ms) has ended by then.
    const val WATCH_MS = 1200L
    val EASE = PathInterpolator(0.2f, 0f, 0f, 1f)
  }
}
