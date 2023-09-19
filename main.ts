/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin, htmlToMarkdown } from "obsidian";
import { TocItem, EpubParser } from "src/epubParser";
import { EpubModal } from "src/modal";

// convert a string to a vaild windows path
function toValidWindowsPath(path: string) {
	let newString = path.replace('?', '？');
	newString = newString.replace(/[/|\\:*?"<>]/g, " ");
	if (path != newString){
		console.log("path",path);
		console.log("-->");
		console.log("newString",newString);
	}
	return newString;
}


export default class MyPlugin extends Plugin {
	parser: EpubParser;
	async onload() {
		this.addCommand({
			id: "import-epub",
			name: "Import epub to your vault",
			callback: () => {
				new EpubModal(this.app, async (result) => {
					await this.import(result);
				}).open();
			},
		});
	}

	async import(epubPath: string) {
		this.parser = await EpubParser.getParser(epubPath);

		const toc = this.parser.toc;
		const path = require("path");
		const epubName = path.basename(epubPath, path.extname(epubPath));
		// this.app.vault.createFolder(epubName);
		let tocContent = "";
		tocContent += `# ${epubName}\n\n`;

		const create = (toc: TocItem, parentPath: string) => {
			this.app.vault.create(
				parentPath + ".md",
				htmlToMarkdown(toc.getChapter()).replace(
					/\.\.\/images/g,
					"images"
				)
			);

			const filename = parentPath.split("\\").pop();
			const level = parentPath.split("\\").length - 2;
			tocContent += `${"\t".repeat(level)}- [[${parentPath.replace(
				/\\/g,
				"/"
			)}|${filename}]]\n`;

			if (toc.subItems.length >= 1) {
				this.app.vault.createFolder(parentPath);

				toc.subItems.forEach((element: TocItem) => {
					create(element, path.join(parentPath, toValidWindowsPath(element.name)));
				});
			}
		};

		for (let i = 0; i < toc.length; i++) {
			create(toc[i], path.join(epubName, toValidWindowsPath(toc[i].name)));
		}

		this.app.vault.create(epubName + "//" + "toc.md", tocContent);

		const fs = require("fs");

		fs.cpSync(
			path.join(path.dirname(this.parser.tocFile), "images"),
			path.join(
				//@ts-ignore
				this.app.vault.adapter.basePath,
				path.join(epubName, "images")
			),
			{ recursive: true }
		);
	}

	onunload() {}
}
