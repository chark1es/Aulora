package expo.modules.auloracall

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps the microphone and camera an Aulora call is capturing available after
 * the user leaves the app. Android stops background capture unless a foreground
 * service of the matching type is running, so a call would go silent and black
 * as soon as the user switched apps or locked the phone.
 *
 * The service holds no media itself. It exists while the call engine is
 * capturing and shows an ongoing notification that opens the app.
 */
class CallService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val microphone = intent?.getBooleanExtra(EXTRA_MICROPHONE, false) ?: false
    val camera = intent?.getBooleanExtra(EXTRA_CAMERA, false) ?: false
    if (!microphone && !camera) {
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      promote(microphone, camera)
    } catch (_: RuntimeException) {
      // Android refuses the promotion when the capture permission was withdrawn
      // or the app is no longer allowed to start a service. The call keeps
      // running in the foreground; it just cannot continue in the background.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun promote(microphone: Boolean, camera: Boolean) {
    val notification = buildNotification(microphone, camera)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      var type = 0
      if (microphone) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (camera) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      startForeground(NOTIFICATION_ID, notification, type)
    } else {
      @Suppress("DEPRECATION")
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun buildNotification(microphone: Boolean, camera: Boolean): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val text = when {
      camera && microphone -> "Your camera and microphone are on. Tap to return to the call."
      camera -> "Your camera is on. Tap to return to the call."
      else -> "Your microphone is on. Tap to return to the call."
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Ongoing call", NotificationManager.IMPORTANCE_LOW)
      )
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    builder
      .setSmallIcon(android.R.drawable.stat_sys_phone_call)
      .setContentTitle("Aulora call in progress")
      .setContentText(text)
      .setCategory(Notification.CATEGORY_CALL)
      .setOngoing(true)
    // A build without a launch activity would otherwise crash on the null intent.
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setContentIntent(
        PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE)
      )
    }
    return builder.build()
  }

  companion object {
    const val EXTRA_MICROPHONE = "microphone"
    const val EXTRA_CAMERA = "camera"
    private const val CHANNEL_ID = "aulora-ongoing-call"
    private const val NOTIFICATION_ID = 4201
  }
}
