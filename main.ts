/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin, htmlToMarkdown } from "obsidian";
import { TocItem, EpubParser } from "src/epubParser";
import { EpubModal } from "src/modal";

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
		this.app.vault.createFolder(epubName);
		let tocContent = "";
		tocContent += `# ${epubName}\n\n`;

		const create = (toc: TocItem, parentPath: string) => {
			this.app.vault.create(
				parentPath + ".md",
				htmlToMarkdown(toc.getChapter())
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
					create(element, path.join(parentPath, element.name));
				});
			}
		};

		for (let i = 0; i < toc.length; i++) {
			create(toc[i], path.join(epubName, toc[i].name));
		}

		this.app.vault.create(epubName + "//" + "toc.md", tocContent);
	}

	onunload() {}
}
