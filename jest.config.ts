/* eslint-disable linebreak-style */
module.exports = {
	transform: {"^.+\\.ts?$": "ts-jest"},
	testEnvironment: "node",
	testRegex: "/test/.*\\.(test|spec)?\\.(ts|tsx)$",
	moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"]
};