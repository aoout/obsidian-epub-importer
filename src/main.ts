/* eslint-disable no-mixed-spaces-and-tabs */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Notice, Plugin, TFile, WorkspaceLeaf, htmlToMarkdown, parseYaml } from "obsidian";
import { Chapter, EpubParser } from "./lib/EpubParser";
import { EpubImporterModal } from "./modal";
import { NoteParser } from "./lib/NoteParser";
import { DEFAULT_SETTINGS, EpubImporterSettings } from "./settings/settings";
import { EpubImporterSettingsTab } from "./settings/settingsTab";

import jetpack from "fs-jetpack";
import { getNotesWithTag, tFrontmatter, templateWithVariables } from "./utils/obsidianUtils";
import * as path from "path";
import i18next from "i18next";
import { resources, translationLanguage } from "./i18n/i18next";
import { normalize } from "./utils/utils";
import beautify from "js-beautify";


export default class EpubImporterPlugin extends Plugin {
	vaultPath: string;
	settings: EpubImporterSettings;
	parser: EpubParser;
	BookNote: string;
	assetsPath: string;
	properties: any;
	activeBook: string;
	activeLeaf: WorkspaceLeaf;
	detachLeaf = false;
	async onload() {
		i18next.init({
			lng: translationLanguage,
			fallbackLng: "en",
			resources: resources,
			returnNull: false,
		});

		//@ts-expect-error
		this.vaultPath = this.app.vault.adapter.basePath;
		await this.loadSettings();
		this.addSettingTab(new EpubImporterSettingsTab(this.app, this));
		this.addCommand({
			id: "import-epub",
			name: i18next.t("import-epub"),
			callback: () => {
				new EpubImporterModal(this.app, this.settings.libraries, async (result) => {
					await this.importEpub(result);
				}).open();
			},
		});
		this.addCommand({
			id: "sync-libraries",
			name: i18next.t("sync-libraries"),
			callback: async () => {
				const { libraries } = this.settings;
				if (!libraries.length) {
					new Notice(i18next.t("no libraries"));
					return;
				}
		
				const results = libraries
					.map(library => jetpack.find(library, { matching: "**/**.epub" }))
					.flat();
		
				const bookCount = results.length;
				for (const result of results) {
					await this.importEpub(jetpack.path(result));
				}
		
				if (bookCount === 0) {
					new Notice(i18next.t("no book in libraries"));
					console.log(i18next.t("no book in libraries"));
				} else {
					const message = i18next.t("translation:sync-libraries_r").replace("${n}", bookCount.toString());
					new Notice(message);
					console.log(message);
				}
			}
		});		
		
		this.registerDomEvent(document, "drop", async (e) => {
			if (
				this.settings.byDrag &&
				//@ts-expect-error
				e.toElement.className == "nav-files-container node-insert-event"
			) {
				const files = e.dataTransfer.files;
				if (files.length == 1 && path.extname(files[0].name) == ".epub") {
					//@ts-expect-error
					await this.importEpub(files[0].path);
					jetpack
						.find(this.vaultPath, {
							matching: "**/**.epub",
						})
						.forEach(jetpack.remove);
				}
			}
		});
		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				if (this.settings.leafID && !this.detachLeaf) {
					this.detachLeaf = true;
					this.activeLeaf = this.app.workspace.getLeafById(this.settings.leafID);
					return;
				}
				if (!this.settings.autoOpenRightPanel) return;
				if (!this.app.workspace.getActiveFile()) return;
				const mocPath = this.getMocPath(file);
				if (!mocPath && file.basename != "highlights") {
					this.activeBook = "";
					return this.activeLeaf.detach();
				}
				const bookName = this.app.vault.getAbstractFileByPath(mocPath).parent.name;
				if (this.activeBook == bookName) return;
				if (this.activeLeaf) this.activeLeaf.detach();
				this.activeBook = bookName;
				this.activeLeaf = this.app.workspace.getRightLeaf(false);
				//@ts-expect-error
				this.settings.leafID = this.activeLeaf.id;
				await this.saveSettings();
				this.activeLeaf.setViewState({
					type: "markdown",
					state: {
						file: mocPath,
						mode: "preview",
						backlinks: false,
						source: false,
					},
				});
				this.activeLeaf.setPinned(true);
				this.app.workspace.revealLeaf(this.activeLeaf);
			})
		);

	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async importEpub(epubPath: string) {

		const epubName =  normalize(path.basename(epubPath, path.extname(epubPath)).trim());

		const {
			assetsPath,
			mocPropertysTemplate: propertysTemplate,
			savePath,
			tag,
			granularity,
		} = this.settings;
		const folderPath = path.posix.join(savePath, epubName);

		if (jetpack.exists(path.posix.join(this.vaultPath, folderPath))) {
			if (this.settings.removeDuplicateFolders) {
				jetpack.remove(path.posix.join(this.vaultPath, folderPath));
			} else {
				new Notice("Duplicate folder already exists.");
				return;
			}
		}
		this.assetsPath = templateWithVariables(assetsPath, {
			bookName: epubName,
			savePath: savePath,
		});

		this.parser = new EpubParser(epubPath, this.settings.moreLog);
		await this.parser.init();
		if (this.settings.moreLog) console.log("toc is: ", this.parser.toc);

		this.properties = parseYaml(templateWithVariables(propertysTemplate, this.parser.meta));

		this.properties.tags = (this.properties.tags ?? []).concat([tag]);

		this.BookNote = "";
		await this.app.vault.createFolder(folderPath);

		this.copyImages();

		if (this.settings.oneNote) {
			[...this.parser.chapters]
				.filter((cpt) => cpt.level != 0)
				.sort((a, b) => b.level - a.level)
				.forEach((cpt) => cpt.parent.sections.push(...cpt.sections));
			let content = "";
			for (const cpt of this.parser.chapters.filter((cpt) => cpt.level == 0)) {
				content += cpt.sections.map((st) => this.htmlToMD(st.html)).join("\n\n");
			}
			let notePath = folderPath;
			if (this.settings.oneFolder) {
				notePath = path.posix.join(folderPath, epubName);
			}
			await this.app.vault.create(
				notePath + ".md",
				tFrontmatter(this.properties) + "\n" + content
			);
			return 0;
		}

		[...this.parser.chapters]
			.filter((cpt) => cpt.level > granularity)
			.sort((a, b) => b.level - a.level)
			.forEach((cpt) => cpt.parent.sections.push(...cpt.sections));

		for (const cpt of this.parser.chapters.filter((cpt) => cpt.level <= granularity)) {
			if (cpt.name.startsWith("... ")) cpt.sections[0].name = cpt.name.replace("... ", "");

			const paths = [normalize(cpt.name)];
			const getPaths = (cpt2: Chapter) => {
				if (cpt2.parent) {
					paths.unshift(cpt2.parent.name);
					getPaths(cpt2.parent);
				}
			};
			getPaths(cpt);
			if (cpt.level < granularity && cpt.subItems.length != 0) paths.push(normalize(cpt.name));
			const notePath = path.posix.join(folderPath, ...paths);
			await this.app.vault.createFolder(path.dirname(notePath)).catch(() => {/**/});

			let content = "";
			if (this.settings.notePropertysTemplate) {
				const template = templateWithVariables(this.settings.notePropertysTemplate, {
					created_time: Date.now().toString(),
				});
				const yaml = parseYaml(template);
				content += tFrontmatter(yaml) + "\n";
			}
			content += cpt.sections.map((st) => this.htmlToMD(st.html)).join("\n\n");
			try {
				await this.app.vault.create(notePath + ".md", content);
			} catch (error) {
				console.warn(`Failed to create file at ${notePath}.md: ${error}`);
				console.warn(
					"If such errors are few in this parsing process, it could be because the epub contains some repeated or wrong navPoints. If this is the case, it will not cause any damage to the content of the book."
				);
			}
			this.BookNote += `${"\t".repeat(cpt.level)}- [[${notePath}|${cpt.name}]]\n`;
		}

		this.BookNote = tFrontmatter(this.properties) + "\n" + this.BookNote;
		await this.app.vault.create(
			path.posix.join(
				folderPath,
				templateWithVariables(this.settings.mocName, { bookName: epubName })
			) + ".md",
			this.BookNote
		);
		jetpack.remove(this.parser.tmpPath);
		console.log(`Successfully imported ${epubName}`);
		new Notice(`Successfully imported ${epubName}`);
	}

	copyImages() {
		const imagesPath = path.posix.join(this.vaultPath, this.assetsPath);
		jetpack
			.find(this.parser.tmpPath, { matching: ["*.jpg", "*.jpeg", "*.png"] })
			.forEach((file) =>
				jetpack.copy(file, path.posix.join(imagesPath, path.basename(file)), {
					overwrite: true,
				})
			);
		if (this.parser.coverPath) {
			this.properties.cover = path.posix.join(this.assetsPath, path.basename(this.parser.coverPath));
		}
	}

	htmlToMD(htmlString: string): string {
		if(this.settings.reformatting){
			htmlString = beautify.html(htmlString,{"indent_size":0});
		}
		
		// Remove empty tables to prevent errors in the htmlToMarkdown function
		const domParser = new DOMParser();
		const htmlDocument = domParser.parseFromString(htmlString, "text/html");
		const tables = htmlDocument.querySelectorAll("table");

		function isTableEmpty(tableElement) {
			const childCount = tableElement.childElementCount;
			if (childCount == 0) {
				return true;
			} else {
				let totalChildCount = 0;
				for (let i = 0; i < childCount; i++) {
					totalChildCount += tableElement.children[i].childElementCount;
				}
				return totalChildCount == 0;
			}
		}

		tables.forEach((tableElement) => {
			if (isTableEmpty(tableElement)) {
				tableElement.remove();
			}
		});

		let markdownContent = htmlToMarkdown(htmlDocument ? htmlString : "");
		if (htmlString && !markdownContent) {
			markdownContent = htmlString.replace(/<[^>]+>/g, "");
		}
		return NoteParser.parse(markdownContent, this.assetsPath, this.settings.imageFormat);
	}

	getMocPath(note: TFile): string {
		const mocFiles = getNotesWithTag(this.app, this.settings.tag);
		if (mocFiles.includes(note)) return note.path;
		else
			return mocFiles.find((n) => {
				return this.app.metadataCache
					.getCache(n.path)
					.links.some((link) => link.link + ".md" == note.path);
			})?.path;
	}
} 
