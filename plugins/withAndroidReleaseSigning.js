const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @atlas-release-signing';

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error(
        'Atlas release signing requires a Groovy app/build.gradle',
      );
    }

    let source = gradleConfig.modResults.contents;
    if (source.includes(MARKER)) {
      return gradleConfig;
    }

    const androidBlock = 'android {\n';
    const signingBlock = '    signingConfigs {\n';
    const releaseSigning = '            signingConfig signingConfigs.debug\n';

    if (
      !source.includes(androidBlock) ||
      !source.includes(signingBlock) ||
      !source.includes(releaseSigning)
    ) {
      throw new Error(
        'Expo Android Gradle template changed; update the Atlas signing plugin',
      );
    }

    source = source.replace(
      androidBlock,
      `${MARKER}\n` +
        `def atlasReleaseStoreFile = System.getenv('ATLAS_RELEASE_STORE_FILE')\n` +
        `def atlasReleaseStorePassword = System.getenv('ATLAS_RELEASE_STORE_PASSWORD')\n` +
        `def atlasReleaseKeyAlias = System.getenv('ATLAS_RELEASE_KEY_ALIAS')\n` +
        `def atlasReleaseKeyPassword = System.getenv('ATLAS_RELEASE_KEY_PASSWORD')\n` +
        `def atlasHasReleaseSigning = atlasReleaseStoreFile && atlasReleaseStorePassword && atlasReleaseKeyAlias && atlasReleaseKeyPassword\n` +
        `def atlasReleaseTaskRequested = gradle.startParameter.taskNames.any { it.toLowerCase(java.util.Locale.ROOT).contains('release') }\n` +
        `if (atlasReleaseTaskRequested && !atlasHasReleaseSigning) {\n` +
        `    throw new GradleException('Atlas release builds require all ATLAS_RELEASE_* signing variables')\n` +
        `}\n\n` +
        androidBlock,
    );

    source = source.replace(
      signingBlock,
      `${signingBlock}` +
        `        release {\n` +
        `            if (atlasHasReleaseSigning) {\n` +
        `                storeFile file(atlasReleaseStoreFile)\n` +
        `                storePassword atlasReleaseStorePassword\n` +
        `                keyAlias atlasReleaseKeyAlias\n` +
        `                keyPassword atlasReleaseKeyPassword\n` +
        `            }\n` +
        `        }\n`,
    );

    const releaseBlockStart = '        release {\n';
    const releaseIndex = source.indexOf(
      releaseBlockStart,
      source.indexOf('buildTypes {'),
    );
    const signingIndex = source.indexOf(releaseSigning, releaseIndex);

    if (releaseIndex < 0 || signingIndex < 0) {
      throw new Error('Could not find the generated release build type');
    }

    source =
      source.slice(0, signingIndex) +
      `            signingConfig atlasHasReleaseSigning ? signingConfigs.release : signingConfigs.debug\n` +
      source.slice(signingIndex + releaseSigning.length);

    gradleConfig.modResults.contents = source;
    return gradleConfig;
  });
};
