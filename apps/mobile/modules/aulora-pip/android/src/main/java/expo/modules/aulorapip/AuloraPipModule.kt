package expo.modules.aulorapip

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AuloraPipModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AuloraPip")

    Events("onPipChange")

    OnCreate {
      PipBridge.attach(this@AuloraPipModule)
    }

    OnDestroy {
      PipBridge.detach(this@AuloraPipModule)
    }

    Function("isSupported") {
      PipBridge.isSupported(appContext.currentActivity)
    }

    Function("setEnabled") { enabled: Boolean ->
      PipBridge.setEnabled(appContext.currentActivity, enabled)
    }

    Function("enter") {
      PipBridge.enter(appContext.currentActivity)
    }

    Function("expand") {
      PipBridge.expand(appContext.currentActivity)
    }

    Function("isActive") {
      val activity = appContext.currentActivity
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity?.isInPictureInPictureMode == true
    }
  }

  fun notifyChange(active: Boolean) {
    sendEvent("onPipChange", mapOf("active" to active))
  }
}
