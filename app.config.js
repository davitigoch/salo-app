const appJson = require('./app.json');

module.exports = () => {
  const baseConfig = appJson.expo || {};
  const defaultProjectId = 'daf0b1b4-e50a-4bc5-859c-2c4fd378576e';
  const rawProjectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    || defaultProjectId
    || (baseConfig.extra && baseConfig.extra.eas && baseConfig.extra.eas.projectId)
    || '';

  const projectId = typeof rawProjectId === 'string'
    ? rawProjectId.trim()
    : String(rawProjectId || '');

  return {
    ...baseConfig,
    extra: {
      ...(baseConfig.extra || {}),
      eas: {
        ...((baseConfig.extra && baseConfig.extra.eas) || {}),
        projectId,
      },
    },
  };
};
