package dev.jesusmolano.atlas.updater

import android.content.Context
import android.content.pm.PackageInstaller

internal object InstallStatusStore {
  private const val PREFERENCES_NAME = "atlas_updater"
  private const val KEY_HAS_STATUS = "has_status"
  private const val KEY_SESSION_ID = "session_id"
  private const val KEY_STATUS = "status"
  private const val KEY_MESSAGE = "message"
  private const val KEY_UPDATED_AT = "updated_at"

  fun save(context: Context, sessionId: Int, status: Int, message: String?) {
    preferences(context).edit()
      .putBoolean(KEY_HAS_STATUS, true)
      .putInt(KEY_SESSION_ID, sessionId)
      .putInt(KEY_STATUS, status)
      .putString(KEY_MESSAGE, message)
      .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
      .apply()
  }

  fun read(context: Context): Map<String, Any?>? {
    val preferences = preferences(context)
    if (!preferences.getBoolean(KEY_HAS_STATUS, false)) {
      return null
    }

    val status = preferences.getInt(KEY_STATUS, PackageInstaller.STATUS_FAILURE)
    return mapOf(
      "sessionId" to preferences.getInt(KEY_SESSION_ID, -1),
      "status" to statusName(status),
      "statusCode" to status,
      "message" to preferences.getString(KEY_MESSAGE, null),
      "updatedAt" to preferences.getLong(KEY_UPDATED_AT, 0L).toDouble()
    )
  }

  fun clear(context: Context) {
    preferences(context).edit().clear().apply()
  }

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  private fun statusName(status: Int): String = when (status) {
    PackageInstaller.STATUS_PENDING_USER_ACTION -> "awaiting_user_confirmation"
    PackageInstaller.STATUS_SUCCESS -> "success"
    PackageInstaller.STATUS_FAILURE_ABORTED -> "cancelled"
    PackageInstaller.STATUS_FAILURE_BLOCKED -> "blocked"
    PackageInstaller.STATUS_FAILURE_CONFLICT -> "conflict"
    PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "incompatible"
    PackageInstaller.STATUS_FAILURE_INVALID -> "invalid"
    PackageInstaller.STATUS_FAILURE_STORAGE -> "storage_error"
    PackageInstaller.STATUS_FAILURE_TIMEOUT -> "timeout"
    else -> "failed"
  }
}
