/* eslint-disable no-mixed-spaces-and-tabs */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin, TFile, WorkspaceLeaf, normalizePath} from "obsidian";
import { Chapter, EpubParser } from "./epubParser";
import { modal } from "./modal";
import { NoteParser } from "./noteParser";
import { DEFAULT_SETTINGS, EpubImporterSettings } from "./settings/settings";
import { EpubImporterSettingsTab } from "./settings/settingsTab";

import * as fs from "fs";
import * as path from "path";
import { toValidWindowsPath, walk, walkUntil} from "./utils/myPath";
import { Propertys } from "./utils/propertys";

export default class EpubImporterPlugin extends Plugin {
	vaultPath: string;
	settings: EpubImporterSettings;
	parser: EpubParser;
	BookNote: string;
	propertys: Propertys;
	activeBook: string;
	activeLeaf: WorkspaceLeaf;
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

		this.app.workspace.on("file-open", (file) => {
			if(!this.settings.autoOpenRightPanel) return;
			if (!file) return;
			const bookNotePath = this.findBookNote(file.path);

			if (!bookNotePath) return;
			const bookName = bookNotePath.split("/")[0];
			if (this.activeBook == bookName) return;
			if (this.activeLeaf) this.activeLeaf.detach();
			this.activeBook = bookName;
			this.activeLeaf = this.app.workspace.getRightLeaf(false);
			this.activeLeaf.setViewState({
				type: "markdown",
				state: {
					file: bookNotePath,
					mode: "preview",
					backlinks: false,
					source: false,
				},
			});
			this.app.workspace.revealLeaf(this.activeLeaf);
		});

		this.app.workspace.on("file-open",(file)=>{
			const files = this.app.vault.getMarkdownFiles();
			const files_with_tag = [] as TFile [];
			files.forEach( (file) => {
				const tags = this.app.metadataCache.getFileCache(file)?.frontmatter?.tags;
				if(!tags) return;
				if (tags.includes(this.settings.tags[0])) {
					files_with_tag.push(file);
				}
			});
			const allBooks = this.app.vault.getAbstractFileByPath("AllBooks.md");
			if(allBooks && allBooks instanceof TFile){
				this.app.vault.modify(allBooks,files_with_tag.map(file => `- [[${file.path}|${file.parent?.name}]]`).join("\n"));
			}
			else{
				this.app.vault.create("AllBooks.md",files_with_tag.map(file => `[[${file.path}|${file.parent?.name}]]`).join("\n"));
			}

		});
	}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	onunload() {}

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
		this.BookNote = `# ${epubName}\n\n`;
		this.propertys = new Propertys();

		const toc = this.parser.toc;
	 	await this.app.vault.createFolder(epubName);
		const bookPath = path.join(this.vaultPath, epubName);

		toc.forEach((element) => {
			this.createChapter(
				epubName,
				element,
				path.join(epubName, toValidWindowsPath(element.name))
			);
		});

		this.copyImages(epubName, bookPath);
		this.propertys.add("tags", this.settings.tags);

		this.BookNote = this.propertys.toString() + this.BookNote;
		this.app.vault.create(
			epubName + "//" + `${epubName}.md`,
			this.BookNote
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
		}else{
			const imagePath = walkUntil(
				this.parser.tmpobj.name,
				"file",
				(filePath:string) => filePath.includes("image") || filePath.includes("Image")
			);
			if(imagePath){
				fs.mkdirSync(path.join(bookPath,"images"));
				walk(
					this.parser.tmpobj.name,
					"file",
					(filePath:string,stat:any) => {
						if(filePath.includes("image") || filePath.includes("Image")){
							fs.copyFileSync(
								filePath,
								bookPath+"\\"+"images"+"\\"+filePath.split(path.sep).slice(-1)[0]
							);
						}
					}
				);
			}
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
		this.BookNote += `${"\t".repeat(level)}- [[${notePath.replace(
			/\\/g,
			"/"
		)}|${noteName}]]\n`;
	}

	findBookNote(notePath: string) {
		const firstLevel = notePath.split("/")[0];
		const bookNotePath = firstLevel + "/" + firstLevel + ".md";

		const bookNote = this.app.vault.getAbstractFileByPath(bookNotePath);
		if (!bookNote) return;
		return bookNotePath;
	}
}