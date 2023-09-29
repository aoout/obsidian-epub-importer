/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin, htmlToMarkdown } from "obsidian";
import { TocItem, EpubParser } from "src/epubParser";
import { EpubModal } from "src/ePubModal";
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
				new EpubModal(this.app, this, async (result) => {
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
			this.createTocItem(
				epubName,
				element,
				path.join(epubName, toValidWindowsPath(element.name))
			);
		});

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

	createTocItem(epubName: string, toc: TocItem, thePath: string) {
		const filename = thePath.split("\\").pop();
		const level = thePath.split("\\").length - 2;
		let content = NoteParser.getParseredNote(
			htmlToMarkdown(toc.getChapter()),
			epubName
		);
		this.folderNoteContent += `${"\t".repeat(level)}- [[${thePath.replace(
			/\\/g,
			"/"
		)}|${filename}]]\n`;

		if (toc.subItems.length) {
			const vaildSubItems = toc.subItems.filter((element: TocItem) => {
				return element.getFileName() != toc.getFileName();
			});
			if (vaildSubItems.length == 1 && toc.subItems.length > 1) {
				content =
					content +
					"\n" +
					NoteParser.getParseredNote(
						htmlToMarkdown(vaildSubItems[0].getChapter()),
						epubName
					);
			} else if (vaildSubItems.length != 0) {
				this.app.vault.createFolder(thePath);
				vaildSubItems.forEach((element: TocItem) => {
					this.createTocItem(
						epubName,
						element,
						path.join(thePath, toValidWindowsPath(element.name))
					);
				});
			}
		}
		this.app.vault.create(thePath + ".md", content);
	}

	injectBartenderData() {
		//TODO: Insert folder sorting data into the data.json of the bartender plugin.
	}

	onunload() {}
}
