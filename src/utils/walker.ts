/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

import * as fs from "fs";
import * as path from "path";

// TODO: Change the code below into a for loop for interruption.
// TODO: Can set the type to all, and add type to callback call.
export const walk = (currentDirPath: string, type: string, callback: any) => {
	fs.readdirSync(currentDirPath).forEach(function (name: string) {
		const filePath = path.join(currentDirPath, name);
		const stat = fs.statSync(filePath);

		if (stat.isFile() && type == "file") {
			callback(filePath, stat);
		}
		if (stat.isDirectory() && type == "folder") {
			callback(filePath, stat);
		}
		if (stat.isDirectory()) {
			walk(filePath, type, callback);
		}
	});
};

// TODO: Can set the type to all, and add type to callback call.
export const walkUntil = (
	currentDirpath: string,
	type: string,
	check: any,
	getvalue: any = null
): any => {
	const paths: string[] = [];
	walk(currentDirpath, type, (path: string) => {
		paths.push(path);
	});

	for (const path of paths) {
		const stat = fs.statSync(path);
		if (
			check(path) &&
			((stat.isFile() && type == "file") ||
				(stat.isDirectory() && type == "folder"))
		) {
			return getvalue ? getvalue(path, stat) : path;
		}
	}
};