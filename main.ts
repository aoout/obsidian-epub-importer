/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin, htmlToMarkdown } from "obsidian";
import { Chapter, EpubParser } from "src/epubParser";
import { modal } from "src/modal";
import { NoteParser } from "src/noteParser";
import { DEFAULT_SETTINGS, EpubImporterSettings } from "src/settings/settings";
import { EpubImporterSettingsTab } from "src/settings/settingsTab";

import * as fs from "fs";
import * as path from "path";
import { toValidWindowsPath, walkUntil } from "src/utils/myPath";
import { Propertys } from "src/utils/propertys";

export default class EpubImporterPlugin extends Plugin {
	vaultPath: string;
	settings: EpubImporterSettings;
	parser: EpubParser;
	folderNoteContent: string;
	propertys: Propertys;
	async onload() {
		//@ts-ignore
		this.vaultPath = this.app.vault.adapter.basePath;
		await this.loadSettings();
		this.addSettingTab(new EpubImporterSettingsTab(this.app, this));
		this.addCommand({
			id: "import-epub",
			name: "Import epub to your vault",
			callback: () => {
				new modal(this.app, this, async (result) => {
					await this.import(result);
				}).open();
			},
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async import(epubPath: string) {
		this.parser = await EpubParser.getParser(epubPath);

		const epubName = path.basename(epubPath, path.extname(epubPath));
		this.folderNoteContent = `# ${epubName}\n\n`;
		this.propertys = new Propertys();

		const toc = this.parser.toc;
		this.app.vault.createFolder(epubName);
		const bookPath = path.join(this.vaultPath, epubName);

		toc.forEach((element) => {
			this.createChapter(
				epubName,
				element,
				path.join(epubName, toValidWindowsPath(element.name))
			);
		});
		this.injectBartenderData(
			epubName,
			toc.map((element) => toValidWindowsPath(element.name))
		);

		this.copyImages(epubName, bookPath);
		this.propertys.add("tags", this.settings.tags);

		this.folderNoteContent =
			this.propertys.toString() + this.folderNoteContent;
		this.app.vault.create(
			epubName + "//" + `${epubName}.md`,
			this.folderNoteContent
		);
	}

	copyImages(epubName: string, bookPath: string) {
		const imageFolderPath = walkUntil(
			this.parser.tmpobj.name,
			"folder",
			(filePath: string) =>
				filePath.includes("images") || filePath.includes("Images")
		);

		if (imageFolderPath) {
			fs.cpSync(imageFolderPath, path.join(bookPath, "images"), {
				recursive: true,
			});
		}
		const cover = this.parser.coverPath;
		if (cover) {
			fs.cpSync(cover, path.join(bookPath, path.basename(cover)));
			this.propertys.add("cover", `${epubName}/${path.basename(cover)}`);
		}
	}

	createChapter(epubName: string, cpt: Chapter, notePath: string) {
		const noteName = path.basename(notePath);
		const level = notePath.split(path.sep).length - 2;
		let content = NoteParser.getParseredNote(cpt.getMarkdown(), epubName);

		if (cpt.subItems.length) {
			const vaildSubItems = cpt.subItems.filter((element: Chapter) => {
				return element.getFileName() != cpt.getFileName();
			});
			if (vaildSubItems.length == 1 && cpt.subItems.length > 1) {
				content +=
					"\n" +
					NoteParser.getParseredNote(
						vaildSubItems[0].getMarkdown(),
						epubName
					);
			} else if (vaildSubItems.length != 0) {
				this.app.vault.createFolder(notePath);

				vaildSubItems.forEach((element: Chapter) => {
					this.createChapter(
						epubName,
						element,
						path.join(notePath, toValidWindowsPath(element.name))
					);
				});
				notePath = path.join(notePath, noteName);
			}
		}
		this.app.vault.create(notePath + ".md", content);
		this.folderNoteContent += `${"\t".repeat(level)}- [[${notePath.replace(
			/\\/g,
			"/"
		)}|${noteName}]]\n`;
	}

	onunload() {}
}
