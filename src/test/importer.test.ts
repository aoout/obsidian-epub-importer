import jetpack from "fs-jetpack";
import * as path from "path";
import { EpubParser } from "../lib/EpubParser";

describe("testing EpubImporter", () => {
	test("parsing for .epub should be successful", async () => {
		const epubsDir = path.join(__dirname, "epubs");

		const files = jetpack.find(epubsDir);
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (path.extname(file) === ".epub") {
				const parser = new EpubParser(file, false);
				await parser.init();
			}
		}
	});
});
