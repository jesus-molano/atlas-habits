package dev.jesusmolano.atlas.updater

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

internal data class VerifiedApk(
  val file: File,
  val sha256: String,
  val versionCode: Long,
  val versionName: String?
)

internal class ApkUpdateInstaller(private val context: Context) {
  private val packageManager = context.packageManager

  suspend fun downloadVerifyAndInstall(
    apkUrl: String,
    expectedSha256: String
  ): Map<String, Any?> = withContext(Dispatchers.IO) {
    assertInstallPermission()
    assertExpectedPackage()

    val normalizedSha256 = normalizeExpectedSha256(expectedSha256)
    val remoteUrl = parseTrustedHttpsUrl(apkUrl)
    val downloadedApk = downloadApk(remoteUrl)

    try {
      val verifiedApk = verifyApk(downloadedApk.first, downloadedApk.second, normalizedSha256)
      val sessionId = commitInstallSession(verifiedApk, remoteUrl)

      mapOf(
        "sessionId" to sessionId,
        "status" to "session_committed",
        "sha256" to verifiedApk.sha256,
        "versionCode" to verifiedApk.versionCode.toDouble(),
        "versionName" to verifiedApk.versionName
      )
    } finally {
      downloadedApk.first.delete()
    }
  }

  private fun assertInstallPermission() {
    if (!packageManager.canRequestPackageInstalls()) {
      throw InstallPermissionRequiredException()
    }
  }

  private fun assertExpectedPackage() {
    if (context.packageName != EXPECTED_PACKAGE_NAME) {
      throw UpdateInstallException(
        "The updater is configured for $EXPECTED_PACKAGE_NAME, but this app uses ${context.packageName}."
      )
    }
  }

  private fun normalizeExpectedSha256(expectedSha256: String): String {
    val normalized = expectedSha256.trim().lowercase()
    if (!SHA256_PATTERN.matches(normalized)) {
      throw InvalidSha256Exception()
    }
    return normalized
  }

  private fun parseTrustedHttpsUrl(value: String): URL {
    val uri = try {
      URI(value)
    } catch (error: Exception) {
      throw InvalidUpdateUrlException("The APK URL is invalid.")
    }

    if (
      uri.scheme != "https" ||
      uri.userInfo != null ||
      uri.host == null ||
      (uri.port != -1 && uri.port != 443)
    ) {
      throw InvalidUpdateUrlException("The APK URL must be an HTTPS URL without credentials.")
    }
    if (!isTrustedGithubHost(uri.host)) {
      throw InvalidUpdateUrlException("Atlas updates can only be downloaded from GitHub Releases.")
    }

    return try {
      uri.toURL()
    } catch (error: Exception) {
      throw InvalidUpdateUrlException("The APK URL is invalid.")
    }
  }

  private fun downloadApk(initialUrl: URL): Pair<File, String> {
    val updateDirectory = File(context.cacheDir, UPDATE_CACHE_DIRECTORY)
    if (!updateDirectory.exists() && !updateDirectory.mkdirs()) {
      throw UpdateDownloadException("Could not create the private update cache directory.")
    }

    val destination = File(updateDirectory, "atlas-${UUID.randomUUID()}.apk")
    var currentUrl = initialUrl

    try {
      repeat(MAX_REDIRECTS + 1) { redirectCount ->
        val connection = currentUrl.openConnection() as? HttpURLConnection
          ?: throw UpdateDownloadException("The update URL did not open an HTTPS connection.")
        try {
          connection.instanceFollowRedirects = false
          connection.connectTimeout = CONNECT_TIMEOUT_MS
          connection.readTimeout = READ_TIMEOUT_MS
          connection.setRequestProperty("Accept", "application/vnd.android.package-archive")
          connection.setRequestProperty("User-Agent", "Atlas-Android-Updater")

          val responseCode = connection.responseCode
          if (responseCode in REDIRECT_STATUS_CODES) {
            if (redirectCount == MAX_REDIRECTS) {
              throw UpdateDownloadException("The APK download used too many redirects.")
            }
            val location = connection.getHeaderField("Location")
              ?: throw UpdateDownloadException("The APK download returned an invalid redirect.")
            currentUrl = parseTrustedHttpsUrl(URL(currentUrl, location).toString())
            return@repeat
          }

          if (responseCode !in 200..299) {
            throw UpdateDownloadException("GitHub returned HTTP $responseCode for the APK download.")
          }

          val declaredLength = connection.contentLengthLong
          if (declaredLength > MAX_APK_SIZE_BYTES) {
            throw UpdateDownloadException("The APK is larger than the allowed update size.")
          }

          val digest = MessageDigest.getInstance("SHA-256")
          var bytesWritten = 0L
          connection.inputStream.use { input ->
            destination.outputStream().buffered().use { output ->
              val buffer = ByteArray(DOWNLOAD_BUFFER_SIZE)
              while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                bytesWritten += count
                if (bytesWritten > MAX_APK_SIZE_BYTES) {
                  throw UpdateDownloadException("The APK is larger than the allowed update size.")
                }
                digest.update(buffer, 0, count)
                output.write(buffer, 0, count)
              }
            }
          }

          if (bytesWritten == 0L) {
            throw UpdateDownloadException("GitHub returned an empty APK file.")
          }

          return destination to digest.digest().toHexString()
        } finally {
          connection.disconnect()
        }
      }
    } catch (error: UpdateDownloadException) {
      destination.delete()
      throw error
    } catch (error: IOException) {
      destination.delete()
      throw UpdateDownloadException("The APK download failed: ${error.message ?: "network error"}.", error)
    }

    destination.delete()
    throw UpdateDownloadException("The APK download could not be completed.")
  }

  private fun verifyApk(
    apkFile: File,
    actualSha256: String,
    expectedSha256: String
  ): VerifiedApk {
    if (!MessageDigest.isEqual(actualSha256.hexToBytes(), expectedSha256.hexToBytes())) {
      throw ApkHashMismatchException()
    }

    val archiveInfo = packageManager.getPackageArchiveInfo(
      apkFile.absolutePath,
      PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
    ) ?: throw ApkMetadataException("Android could not read the downloaded APK metadata.")

    if (archiveInfo.packageName != EXPECTED_PACKAGE_NAME) {
      throw ApkPackageMismatchException(archiveInfo.packageName)
    }

    val installedInfo = try {
      packageManager.getPackageInfo(
        EXPECTED_PACKAGE_NAME,
        PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
      )
    } catch (error: PackageManager.NameNotFoundException) {
      throw ApkMetadataException("Android could not inspect the installed Atlas app.")
    }

    if (archiveInfo.longVersionCode <= installedInfo.longVersionCode) {
      throw ApkVersionNotNewerException(installedInfo.longVersionCode, archiveInfo.longVersionCode)
    }

    val installedSigners = signerDigests(installedInfo)
    val archiveSigners = signerDigests(archiveInfo)
    if (installedSigners != archiveSigners) {
      throw ApkSignerMismatchException()
    }

    return VerifiedApk(
      file = apkFile,
      sha256 = actualSha256,
      versionCode = archiveInfo.longVersionCode,
      versionName = archiveInfo.versionName
    )
  }

  private fun signerDigests(packageInfo: PackageInfo): Set<String> {
    val signingInfo = packageInfo.signingInfo
      ?: throw ApkMetadataException("The APK does not contain signing information.")
    val signers = signingInfo.apkContentsSigners
    if (signers.isEmpty()) {
      throw ApkMetadataException("The APK does not contain a signing certificate.")
    }

    return signers.mapTo(mutableSetOf()) { signature ->
      MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).toHexString()
    }
  }

  private fun commitInstallSession(verifiedApk: VerifiedApk, originatingUrl: URL): Int {
    val packageInstaller = packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(EXPECTED_PACKAGE_NAME)
      setSize(verifiedApk.file.length())
      setOriginatingUri(Uri.parse(originatingUrl.toString()))
      setInstallReason(PackageManager.INSTALL_REASON_USER)
      setInstallScenario(PackageManager.INSTALL_SCENARIO_FAST)
      setPackageSource(PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE)
      setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
    }

    val sessionId = try {
      packageInstaller.createSession(params)
    } catch (error: Exception) {
      throw UpdateInstallException("Android could not create the update installation session.", error)
    }

    try {
      packageInstaller.openSession(sessionId).use { session ->
        session.openWrite("base.apk", 0L, verifiedApk.file.length()).use { output ->
          verifiedApk.file.inputStream().buffered().use { input -> input.copyTo(output) }
          session.fsync(output)
        }

        val statusIntent = Intent(context, AtlasUpdateInstallReceiver::class.java).apply {
          action = INSTALL_STATUS_ACTION
          setPackage(context.packageName)
        }
        val statusPendingIntent = PendingIntent.getBroadcast(
          context,
          sessionId,
          statusIntent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        session.commit(statusPendingIntent.intentSender)
      }
    } catch (error: Exception) {
      runCatching { packageInstaller.abandonSession(sessionId) }
      throw UpdateInstallException("Android could not stage the verified Atlas update.", error)
    }

    return sessionId
  }

  private fun isTrustedGithubHost(host: String): Boolean {
    val normalized = host.lowercase()
    return normalized == "github.com" || normalized.endsWith(".githubusercontent.com")
  }

  private fun ByteArray.toHexString(): String = joinToString(separator = "") { byte ->
    "%02x".format(byte.toInt() and 0xff)
  }

  private fun String.hexToBytes(): ByteArray = chunked(2).map { byte ->
    byte.toInt(16).toByte()
  }.toByteArray()

  companion object {
    const val EXPECTED_PACKAGE_NAME = "atlas_habits.com"
    private const val INSTALL_STATUS_ACTION = "$EXPECTED_PACKAGE_NAME.updater.INSTALL_STATUS"
    private const val UPDATE_CACHE_DIRECTORY = "atlas-updates"
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val MAX_REDIRECTS = 5
    private const val MAX_APK_SIZE_BYTES = 512L * 1024L * 1024L
    private const val DOWNLOAD_BUFFER_SIZE = 64 * 1024
    private val SHA256_PATTERN = Regex("^[0-9a-f]{64}$")
    private val REDIRECT_STATUS_CODES = setOf(301, 302, 303, 307, 308)
  }
}
