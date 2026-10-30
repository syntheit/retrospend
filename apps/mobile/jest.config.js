/** @type {import('jest').Config} */
module.exports = {
	preset: "jest-expo",
	roots: ["<rootDir>/src", "<rootDir>/test"],
	setupFiles: ["<rootDir>/jest.setup.js"],
	moduleNameMapper: {
		"^@/(.*)$": "<rootDir>/src/$1",
	},
};
