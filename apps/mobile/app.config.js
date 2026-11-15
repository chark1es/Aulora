const { nativeRuntime, updateConfig } = require("../../scripts/ci/mobile-ota.cjs");

module.exports = ({ config }) => {
  // Local/debug builds remain usable without an Expo account. Release jobs
  // explicitly validate this variable before compiling or publishing.
  if (!process.env.EAS_PROJECT_ID) return { ...config, updates: { enabled: false } };
  const { projectId, ...ota } = updateConfig(process.env.EAS_PROJECT_ID, nativeRuntime());
  return { ...config, ...ota, extra: { ...config.extra, eas: { projectId } } };
};
