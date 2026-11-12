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
 * Android 12 (API 31) added the communication-device API. Older releases keep
 * the existing expo-audio SCO behavior; JavaScript treats their route as
 * unverified instead of inventing an active device.
 */
class AudioRouteModule : Module() {
  private val audioManager: AudioManager
    get() {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      return context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }

  private fun supportsCommunicationDevice() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

  private fun mapDevice(device: AudioDeviceInfo): Bundle {
    val map = Bundle()
    val type = when (device.type) {
      AudioDeviceInfo.TYPE_BUILTIN_MIC -> "MicrophoneBuiltIn"
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "BluetoothSCO"
      AudioDeviceInfo.TYPE_WIRED_HEADSET -> "MicrophoneWired"
      else -> "Unknown device type"
    }
    map.putString("name", device.productName.toString())
    map.putString("type", type)
    map.putString("uid", device.id.toString())
    return map
  }

  private fun inputDevice(uid: String): AudioDeviceInfo? {
    val id = uid.toIntOrNull() ?: return null
    return audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.id == id }
  }

  override fun definition() = ModuleDefinition {
    Name("AuloraAudioRoute")

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
        val device = inputDevice(uid)
        if (device == null) false else audioManager.setCommunicationDevice(device)
      }
    }

    Function("clearCommunicationDevice") {
      if (!supportsCommunicationDevice()) {
        false
      } else {
        audioManager.clearCommunicationDevice()
      }
    }
  }
}
