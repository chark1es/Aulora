package expo.modules.aulorapip

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import java.lang.ref.WeakReference

/**
 * Picture-in-picture for an ongoing video call.
 *
 * The call UI keeps running in the same activity; this only tells Android when
 * that activity may shrink into the floating window and reports when it does.
 * On Android 12+ the system enters picture-in-picture by itself when the user
 * leaves the app, once `autoEnter` is set. Earlier versions need the activity to
 * ask from `onUserLeaveHint`, which `MainActivity` forwards here.
 */
object PipBridge {
  /** Tall and narrow, like the portrait call screen it is shrinking. */
  private val ASPECT_RATIO = Rational(9, 16)

  @Volatile
  private var enabled = false

  private var listener: WeakReference<AuloraPipModule>? = null

  fun attach(module: AuloraPipModule) {
    listener = WeakReference(module)
  }

  fun detach(module: AuloraPipModule) {
    if (listener?.get() === module) {
      listener = null
    }
  }

  fun isSupported(activity: Activity?): Boolean =
    activity != null &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  /** Allows (or forbids) entering picture-in-picture when the user leaves the app. */
  fun setEnabled(activity: Activity?, value: Boolean) {
    enabled = value
    if (!isSupported(activity)) {
      return
    }
    activity?.setPictureInPictureParams(params(value))
  }

  /** Enters picture-in-picture now. Returns whether the system accepted. */
  fun enter(activity: Activity?): Boolean {
    if (!isSupported(activity) || activity == null) {
      return false
    }
    return try {
      activity.enterPictureInPictureMode(params(enabled))
    } catch (error: IllegalStateException) {
      // The activity is not in a state that can float (for example finishing).
      false
    }
  }

  /**
   * Brings the app back to full screen. Android has no call for leaving
   * picture-in-picture; relaunching the activity on top of itself is the way
   * the system's own expand button does it.
   */
  fun expand(activity: Activity?) {
    if (activity == null) {
      return
    }
    val intent = Intent(activity, activity.javaClass)
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    activity.startActivity(intent)
  }

  /** Called by `MainActivity.onUserLeaveHint`; only needed before Android 12. */
  fun onUserLeaveHint(activity: Activity) {
    if (enabled && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      enter(activity)
    }
  }

  fun onModeChanged(active: Boolean) {
    listener?.get()?.notifyChange(active)
  }

  private fun params(autoEnter: Boolean): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder().setAspectRatio(ASPECT_RATIO)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled(autoEnter)
      builder.setSeamlessResizeEnabled(false)
    }
    return builder.build()
  }
}
