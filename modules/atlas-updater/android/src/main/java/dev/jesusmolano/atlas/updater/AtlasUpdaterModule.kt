package dev.jesusmolano.atlas.updater

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AtlasUpdaterModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AtlasUpdater")

    AsyncFunction("getInstallPermissionStatusAsync") {
      if (context.packageManager.canRequestPackageInstalls()) "granted" else "denied"
    }

    AsyncFunction("openInstallPermissionSettingsAsync") {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}")
      )
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }

    AsyncFunction("downloadAndInstallAsync") Coroutine { apkUrl: String, expectedSha256: String ->
      ApkUpdateInstaller(context).downloadVerifyAndInstall(apkUrl, expectedSha256)
    }

    AsyncFunction("getLastInstallStatusAsync") {
      InstallStatusStore.read(context)
    }

    AsyncFunction("clearLastInstallStatusAsync") {
      InstallStatusStore.clear(context)
    }
  }
}
