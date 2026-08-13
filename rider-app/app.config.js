const appJson = require('./app.json');

const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
  process.env.GOOGLE_MAPS_API_KEY?.trim() ||
  '';

const googleMapsMapId =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() ||
  process.env.GOOGLE_MAPS_MAP_ID?.trim() ||
  '';

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL?.trim() ||
  '';

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  ...appJson.expo,
  ios: {
    ...appJson.expo.ios,
    config: {
      ...(appJson.expo.ios?.config || {}),
      googleMapsApiKey: googleMapsApiKey || undefined,
    },
  },
  android: {
    ...appJson.expo.android,
    config: {
      ...(appJson.expo.android?.config || {}),
      googleMaps: {
        apiKey: googleMapsApiKey || undefined,
      },
    },
  },
  extra: {
    ...(appJson.expo.extra || {}),
    googleMapsApiKey,
    googleMapsMapId,
    apiUrl,
  },
};
