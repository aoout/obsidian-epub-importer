/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */


// convert a string to a vaild windows path
export function toValidWindowsPath(path: string) {
	let newString = path.replace('?', '？');
	newString = newString.replace(/[/|\\:*?"<>]/g, " ");
	if (path != newString){
		console.log("path",path);
		console.log("-->");
		console.log("newString",newString);
	}
	return newString;
}

export const walkSync = (currentDirPath: string, callback: any) => {
	const fs = require("fs");
	const path = require("path");
	fs.readdirSync(currentDirPath).forEach(function (name: string) {
		const filePath = path.join(currentDirPath, name);
		const stat = fs.statSync(filePath);
		if (stat.isFile()) {
			callback(filePath, stat);
		} else if (stat.isDirectory()) {
			walkSync(filePath, callback);
		}
	});
};
