/* eslint-disable linebreak-style */
// Jest config for the self-built EPUB kernel in src/ (parser/transform/writer/cli).
// The linkedom ESM dependency chain (css-select -> boolbase/nth-check/domhandler/
// domutils) fails to load under the default config. Here we (a) allow those ESM
// packages through transformIgnorePatterns and (b) let ts-jest also downlevel .js
// files (isolatedModules) so import/export becomes require().
module.exports = {
	transform: {
		"^.+\\.(t|j)sx?$": [
			"ts-jest",
			{
				isolatedModules: true,
				tsconfig: {
					module: "commonjs",
					target: "es2021",
					esModuleInterop: true,
					allowJs: true,
					jsx: "react"
				}
			}
		]
	},
	testEnvironment: "node",
	testRegex: "/test/.*\\.(test|spec)?\\.(ts|tsx)$",
	moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
	roots: ["<rootDir>/src"],
	transformIgnorePatterns: [
		"/node_modules/(?!(linkedom|css-select|css-what|boolbase|nth-check|domhandler|domutils|dom-serializer|entities|domelementtype)/)"
	]
};
