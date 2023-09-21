/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin, htmlToMarkdown } from "obsidian";
import { TocItem, EpubParser } from "src/epubParser";
import { EpubModal } from "src/modal";
import { NoteParser } from "src/noteParser";

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
		const toValidWindowsPath = require("./src/utils").toValidWindowsPath;
		const create = (toc: TocItem, parentPath: string) => {
			

			const filename = parentPath.split("\\").pop();
			const level = parentPath.split("\\").length - 2;
			let content = NoteParser.getParseredNote(htmlToMarkdown(toc.getChapter()),epubName);
			tocContent += `${"\t".repeat(level)}- [[${parentPath.replace(
				/\\/g,
				"/"
			)}|${filename}]]\n`;

			if (toc.subItems.length >= 1) {
				
				const filesName: string[] = [];
				const elements: TocItem[]= [];

				
				toc.subItems.forEach((element: TocItem) => {
					if(! filesName.includes(element.getFileName()) && ! (element.getFileName() == toc.getFileName())){
						filesName.push(element.getFileName());
						elements.push(element);
					}
				});
				if(filesName.length == 1 && toc.subItems.length > 1){
					content =content+"\n"+ NoteParser.getParseredNote(htmlToMarkdown(elements[0].getChapter()),epubName);
				}else if(filesName.length != 0){
					this.app.vault.createFolder(parentPath);
					for (let i = 0; i < elements.length; i++) {
						create(elements[i], path.join(parentPath, toValidWindowsPath(elements[i].name)));
					}
				}
				
			}
			this.app.vault.create(
				parentPath + ".md",
				content
			);
		};

		for (let i = 0; i < toc.length; i++) {
			create(toc[i], path.join(epubName, toValidWindowsPath(toc[i].name)));
		}

		

		const fs = require("fs");

		// find a folder named "images" under the this.parser.tmpobj.name\
		let imageFolderPath = "";
		const walkSync = require("./src/utils").walkSync;

		walkSync(this.parser.tmpobj.name, "folder",(filePath: string, stat: any) => {
			if (filePath.indexOf("images") !== -1 || filePath.indexOf("Images") !== -1) {
				imageFolderPath = filePath;
				console.log("image folder path: ", imageFolderPath);
			}
		});
		console.log("image folder path: ", imageFolderPath);
		if (imageFolderPath){
			fs.cpSync(
				imageFolderPath,
				path.join(
					//@ts-ignore
					this.app.vault.adapter.basePath,
					path.join(epubName, "images")
				),
				{ recursive: true }
			);
		}
		// copy cover from tmpobj to vault, 保留原来的扩展名
		const cover = this.parser.coverPath;
		if (cover) {
			fs.cpSync(
				cover,
				path.join(
					//@ts-ignore
					this.app.vault.adapter.basePath,
					path.join(epubName, path.basename(cover))
				)
			);
		}
		// 在tocContent前面加上cover属性
		if (cover) {
			tocContent = "---\n"+`cover: ${epubName}/${path.basename(cover)}\n`+"tags: book\n"+"---\n" + tocContent;
		}
		this.app.vault.create(epubName + "//" + `${epubName}.md`, tocContent);
		
	}

	onunload() {}
}
