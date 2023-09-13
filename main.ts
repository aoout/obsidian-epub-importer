/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin, htmlToMarkdown } from "obsidian";
import EpubParser from "src/epubParser";
import { EpubModal } from "src/modal";

export default class MyPlugin extends Plugin {
	parser: EpubParser;
	async onload() {
		console.log("Helloworld!!");
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
		this.parser = new EpubParser(epubPath);
		await this.parser.init();
		this.parser.findOpfFile();
		this.parser.parse();
		await new Promise((resolve) => setTimeout(resolve, 2000));
		const toc = this.parser.toc;
		const path = require("path");
		const epubName = path.basename(epubPath, path.extname(epubPath));
		this.app.vault.createFolder(epubName);
		// create folder recursively according to toc
		const create = (toc: any, parentPath: string) => {
			// read file from path
			const fs = require("fs");
			if (toc.children.length >= 2) {
				this.app.vault.createFolder(parentPath);
				toc.children.forEach((element: any) => {
					create(element, path.join(parentPath, element.label));
				});
				const contentPath= toc.content.split('#')[0];
				const content = fs.readFileSync(contentPath,'utf-8');
				const markdown = htmlToMarkdown(content);
				this.app.vault.create(
					parentPath + ".md",
					markdown
				);
			}else if(toc.children.length == 1){

				const contentPath= toc.content.split('#')[0];
				const content = fs.readFileSync(contentPath,'utf-8');
				const markdown = htmlToMarkdown(content);
				const contentPath2 = toc.children[0].content.split('#')[0];
				const content2 = fs.readFileSync(contentPath2,'utf-8');
				const markdown2 = htmlToMarkdown(content2);

				this.app.vault.create(
					parentPath + ".md",
					markdown + markdown2
				);
			}else{
				const contentPath= toc.content.split('#')[0];
				const content = fs.readFileSync(contentPath,'utf-8');
				const markdown = htmlToMarkdown(content);
				this.app.vault.create(
					parentPath + ".md",
					markdown
				);
			}
			

			
		};

		for (let i = 0; i < toc.length; i++) {
			create(toc[i], path.join(epubName, toc[i].label));
		}
	}

	onunload() {}
}
