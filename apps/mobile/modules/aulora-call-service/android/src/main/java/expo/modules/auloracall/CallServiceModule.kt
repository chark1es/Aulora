package expo.modules.auloracall

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Starts, updates and stops {@link CallService} for the JavaScript call engine. */
class CallServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AuloraCallService")

    // Starting again while the service runs replaces the types it declares,
    // which is how turning the camera on or off during a call is reflected.
    Function("update") { microphone: Boolean, camera: Boolean ->
      val intent = Intent(context, CallService::class.java)
        .putExtra(CallService.EXTRA_MICROPHONE, microphone)
        .putExtra(CallService.EXTRA_CAMERA, camera)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (_: RuntimeException) {
        // Not allowed to start a service from the background; capture simply
        // stops with the app.
      }
    }

    Function("stop") {
      context.stopService(Intent(context, CallService::class.java))
    }
  }
}
