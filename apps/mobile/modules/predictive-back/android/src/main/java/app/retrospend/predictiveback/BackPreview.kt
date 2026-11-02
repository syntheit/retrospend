package app.retrospend.predictiveback

import android.animation.ValueAnimator
import android.app.Activity
import android.graphics.Outline
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
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
 * toward the way it will leave (Material 3 "back to previous"). A pushed
 * screen entered from the trailing side, so it follows the trailing edge
 * (right in LTR, left in RTL) whichever edge the swipe starts from, and on
 * commit slides out that way. A sheet, the account sheet included, moves
 * down: it shrinks around its bottom edge, sinks, and leaves downward.
 * Nothing overshoots. Letting go past the threshold pops the stack the usual
 * way; letting go early settles the screen back.
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
  /** Toward the trailing edge: 1 in LTR, -1 in RTL. */
  private var trailing = 1f
  /** The popped screen's own stack animation, put back after the gesture. */
  private var savedAnimation: Screen.StackAnimation? = null
  private var startY = 0f
  private var progress = 0f
  private var touchY = 0f
  private var settle: ValueAnimator? = null
  private var exit = 0f
  /** A commit started the pop; the screen is on its way out until the watcher ends it. */
  private var committing = false
  /** The previous screen this gesture added under the top one. */
  private var added: Added? = null
  /** The same, after a commit and until it is clear whether the pop happened. */
  private var pendingAdded: Added? = null
  /** The keyboard was up when the gesture began: Back hides it, nothing pops. */
  private var keyboardGesture = false
  private var gesture = 0
  private var poppedScreen: Screen? = null
  private var saved: Saved? = null

  /** The color the shrinking screen reveals around itself; set from JavaScript. */
  var backdrop: Int? = null

  private class Added(
    val fragment: androidx.fragment.app.Fragment,
    val screen: Screen,
    val stack: ScreenStack,
    val manager: androidx.fragment.app.FragmentManager,
  )

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
    if (!committing) {
      restore()
      removeIfUnused(added)
      added = null
    }
  }

  private fun start(event: BackEvent) {
    gesture++
    // Whatever the last gesture left: put the screen back, and take away a
    // previous screen it added that is not the top one now.
    restore()
    removeIfUnused(added)
    removeIfUnused(pendingAdded)
    added = null
    pendingAdded = null
    keyboardGesture = keyboardUp()
    if (keyboardGesture) return
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
    trailing =
      if (activity.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL) -1f
      else 1f
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
    // The stack may have changed since the gesture began: add only under
    // the screen that is still on top.
    if (stack.topScreen !== top) return false
    var index = -1
    for (i in 0 until stack.screenCount) if (stack.getScreenAt(i) === top) index = i
    if (index < 1) return false
    val previousWrapper = stack.getScreenFragmentWrapperAt(index - 1)
    val previous = previousWrapper.fragment
    if (previous.isAdded) return true
    val manager = stack.getScreenFragmentWrapperAt(index).fragment.parentFragmentManager
    return try {
      manager.beginTransaction().add(stack.id, previous).commitNowAllowingStateLoss()
      topView.bringToFront()
      added = Added(previous, previousWrapper.screen, stack, manager)
      true
    } catch (_: Exception) {
      false
    }
  }

  /**
   * Takes a previous screen this file added away again, unless it is the
   * stack's top screen now (the pop happened) or is already gone.
   */
  private fun removeIfUnused(item: Added?) {
    if (item == null || !item.fragment.isAdded) return
    if (item.stack.topScreen === item.screen) return
    try {
      item.manager.beginTransaction().remove(item.fragment).commitNowAllowingStateLoss()
    } catch (_: Exception) {
    }
  }

  /** True while the soft keyboard is showing. */
  private fun keyboardUp(): Boolean =
    activity.window.decorView.rootWindowInsets?.isVisible(WindowInsets.Type.ime()) == true

  private fun hideKeyboard() {
    val manager = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    manager?.hideSoftInputFromWindow(activity.window.decorView.windowToken, 0)
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
      removeIfUnused(added)
      added = null
    }
  }

  private fun commit() {
    if (keyboardGesture) {
      // Back with the keyboard up hides it, as the system does.
      keyboardGesture = false
      hideKeyboard()
      return
    }
    committing = true
    val host = activity
    // A pushed screen leaves the way it was dragged: the stack's own slide
    // toward the trailing edge, run from the shrunk state the screen is in
    // (the animation sits outside the view's scale and corners, so they stay
    // and nothing jumps). Without this the default exit fades it out.
    val leaving = poppedScreen
    if (leaving != null && !sheet) {
      savedAnimation = leaving.stackAnimation
      leaving.stackAnimation =
        if (trailing > 0f) Screen.StackAnimation.SLIDE_FROM_RIGHT
        else Screen.StackAnimation.SLIDE_FROM_LEFT
    }
    // The stack pops through JavaScript, as for a back key.
    @Suppress("DEPRECATION")
    host.onBackPressed()
    // The stack now shows it as its top screen; it is no longer ours to remove.
    pendingAdded = added
    added = null
    if (view == null) return
    settle?.cancel()
    // A sheet carries itself down (the pushed screen's slide is the stack's).
    if (sheet) {
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
            elapsed > WATCH_MS -> {
              restore()
              pendingAdded = null
            }
            stuck && elapsed > SETTLE_DELAY_MS -> {
              exit = 0f
              // The pop did not happen: the previous screen goes away again
              // (unless it became the top meanwhile).
              animateTo(0f) {
                restore()
                removeIfUnused(pendingAdded)
                pendingAdded = null
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
    if (sheet) {
      // Down: sinks with the drag, then leaves through the bottom.
      target.translationX = 0f
      target.translationY = (progress * SHEET_SINK + exit * (1f - progress * SHEET_SINK)) * target.height
      return
    }
    // Toward the trailing edge, where the screen leaves to.
    target.translationX = trailing * progress * target.width * PUSH_SHIFT
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
    val popped = poppedScreen
    view = null
    saved = null
    progress = 0f
    committing = false
    if (target == null) return
    exit = 0f
    target.alpha = 1f
    popped?.let { if (savedAnimation != null) it.stackAnimation = savedAnimation!! }
    savedAnimation = null
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
    const val PUSH_SHIFT = 0.1f
    const val SHEET_SINK = 0.08f
    const val CORNER_DP = 28f
    const val ELEVATION_DP = 8f
    const val SETTLE_MS = 200L
    const val EXIT_MS = 300L
    const val SETTLE_DELAY_MS = 500L
    // The stack's own exit animation (450 ms) has ended by then.
    const val WATCH_MS = 1200L
    val EASE = PathInterpolator(0.2f, 0f, 0f, 1f)
  }
}
