package dev.jesusmolano.atlas.updater

import expo.modules.kotlin.exception.CodedException

internal class InvalidUpdateUrlException(message: String) : CodedException(message)

internal class InvalidSha256Exception :
  CodedException("The expected SHA-256 must contain exactly 64 hexadecimal characters.")

internal class InstallPermissionRequiredException :
  CodedException("Atlas is not allowed to install apps from this source.")

internal class UpdateDownloadException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

internal class ApkMetadataException(message: String) : CodedException(message)

internal class ApkHashMismatchException :
  CodedException("The downloaded APK does not match the published SHA-256 checksum.")

internal class ApkPackageMismatchException(actualPackageName: String?) :
  CodedException("The downloaded APK belongs to '${actualPackageName ?: "an unknown package"}', not Atlas.")

internal class ApkVersionNotNewerException(currentVersionCode: Long, candidateVersionCode: Long) :
  CodedException(
    "The downloaded APK versionCode ($candidateVersionCode) is not newer than the installed versionCode ($currentVersionCode)."
  )

internal class ApkSignerMismatchException :
  CodedException("The downloaded APK was not signed by the certificate that signed the installed Atlas app.")

internal class UpdateInstallException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)
