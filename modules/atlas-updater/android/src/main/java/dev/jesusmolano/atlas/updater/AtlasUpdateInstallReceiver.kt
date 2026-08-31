package dev.jesusmolano.atlas.updater

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

class AtlasUpdateInstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(
      PackageInstaller.EXTRA_STATUS,
      PackageInstaller.STATUS_FAILURE
    )
    val sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

    InstallStatusStore.save(context, sessionId, status, message)

    if (status != PackageInstaller.STATUS_PENDING_USER_ACTION) {
      return
    }

    val confirmationIntent = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
      ?: return
    confirmationIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(confirmationIntent) }
      .onFailure { error ->
        InstallStatusStore.save(
          context,
          sessionId,
          PackageInstaller.STATUS_FAILURE,
          "No se pudo abrir la confirmación de Android: ${error.message ?: "error desconocido"}."
        )
      }
  }
}
