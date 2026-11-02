/** @type {import('jest').Config} */
module.exports = {
	preset: "jest-expo",
	roots: ["<rootDir>/src", "<rootDir>/test"],
	setupFiles: ["<rootDir>/jest.setup.js"],
	moduleNameMapper: {
		"^@/(.*)$": "<rootDir>/src/$1",
	},
	// The preset's list, plus use-intl and its ES-module dependencies, so the
	// test harness can run the real translator over the real catalog.
	transformIgnorePatterns: [
		"/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|use-intl|intl-messageformat|@formatjs))",
		"/node_modules/react-native-reanimated/plugin/",
		"/node_modules/@react-native/babel-preset/",
	],
};
