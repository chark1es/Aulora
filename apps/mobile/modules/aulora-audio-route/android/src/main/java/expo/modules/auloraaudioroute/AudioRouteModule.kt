package expo.modules.auloraaudioroute

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads and switches the Android communication route directly.
 *
 * `expo-audio` exposes a recorder's inputs, but its `getCurrentInput` reports a
 * *recorder* fallback (and even writes the built-in microphone as its preferred
 * device) when no recorder is prepared. During a WebRTC call the capture route
 * is the `AudioManager` communication device, which that API never reads. The
 * SDK also discards `setCommunicationDevice`'s Boolean result, so a no-throw
 * switch is not confirmation. This module bridges the actual system route and
 * returns the accepted/rejected result so JavaScript can verify before claiming
 * that a route is current.
 *
 * `AudioManager.setCommunicationDevice` only accepts a *sink* from
 * `getAvailableCommunicationDevices()`; it does not accept a capture/source
 * `AudioDeviceInfo` from `GET_DEVICES_INPUTS`. Those are different endpoints
 * with different ids even for one headset, so this module enumerates and
 * selects in the communication-sink domain and reports the current device from
 * that same domain.
 *
 * Android 12 (API 31) added the communication-device API. Older releases keep
 * the existing expo-audio SCO behavior; JavaScript dispatches on the reported
 * capability rather than mere module presence and treats their route as
 * unverified instead of inventing an active device.
 */
class AudioRouteModule : Module() {
  private val audioManager: AudioManager
    get() {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      return context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }

  private fun supportsCommunicationDevice() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

  /** Maps a communication sink onto the bundle shape JavaScript reads. */
  private fun mapDevice(device: AudioDeviceInfo): Bundle {
    val map = Bundle()
    val type = when (device.type) {
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth"
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "Wired headset"
      AudioDeviceInfo.TYPE_USB_HEADSET,
      AudioDeviceInfo.TYPE_USB_DEVICE -> "USB headset"
      AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Built-in speaker"
      AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Built-in earpiece"
      AudioDeviceInfo.TYPE_BUILTIN_MIC -> "Built-in microphone"
      else -> "Unknown device type"
    }
    map.putString("name", device.productName.toString())
    map.putString("type", type)
    map.putString("uid", device.id.toString())
    return map
  }

  /** Resolves a selectable communication *sink* by its native id. */
  private fun communicationDevice(uid: String): AudioDeviceInfo? {
    val id = uid.toIntOrNull() ?: return null
    return audioManager.availableCommunicationDevices.firstOrNull { it.id == id }
  }

  override fun definition() = ModuleDefinition {
    Name("AuloraAudioRoute")

    /** Whether the platform exposes the communication-device API at all. */
    Function("isSupported") {
      supportsCommunicationDevice()
    }

    /** The selectable communication sinks, each with its own native id. */
    Function("getAvailableCommunicationDevices") {
      if (!supportsCommunicationDevice()) {
        emptyList<Bundle>()
      } else {
        audioManager.availableCommunicationDevices.map { mapDevice(it) }
      }
    }

    Function("getCommunicationDevice") {
      if (!supportsCommunicationDevice()) {
        null
      } else {
        audioManager.communicationDevice?.let { mapDevice(it) }
      }
    }

    Function("setCommunicationDevice") { uid: String ->
      if (!supportsCommunicationDevice()) {
        false
      } else {
        val device = communicationDevice(uid)
        if (device == null) false else audioManager.setCommunicationDevice(device)
      }
    }

    Function("clearCommunicationDevice") {
      if (!supportsCommunicationDevice()) {
        false
      } else {
        // `AudioManager.clearCommunicationDevice()` returns void. Return an
        // explicit Boolean so the JS `=== true` success check can pass.
        audioManager.clearCommunicationDevice()
        true
      }
    }
  }
}
