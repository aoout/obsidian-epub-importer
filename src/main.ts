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
import { getNotesWithTag, tFrontmatter } from "./utils/obsidianUtils";
import { Path } from "./utils/path";
import i18next from "i18next";
import { resources, translationLanguage } from "./i18n/i18next";

export default class EpubImporterPlugin extends Plugin {
	vaultPath: string;
	settings: EpubImporterSettings;
	parser: EpubParser;
	BookNote: string;
	assetsPath: string;
	propertys: any;
	activeBook: string;
	activeLeaf: WorkspaceLeaf;
	async onload() {
		i18next.init({
			lng: translationLanguage,
			fallbackLng: "en",
			resources: resources,
			returnNull: false,
		});

		//@ts-ignore
		this.vaultPath = this.app.vault.adapter.basePath;
		await this.loadSettings();
		this.addSettingTab(new EpubImporterSettingsTab(this.app, this));
		this.addCommand({
			id: "import-epub",
			name: i18next.t("import-epub"),
			callback: () => {
				new EpubImporterModal(this.app, this, async (result) => {
					await this.importEpub(result);
				}).open();
			},
		});
		this.addCommand({
			id: "sync-libraries",
			name: i18next.t("sync-libraries"),
			callback: async () => {
				if (this.settings.libraries.length == 0) {
					new Notice(i18next.t("no libraries"));
					return;
				}
				let n = 0;
				for (let i = 0; i < this.settings.libraries.length; i++) {
					const results = jetpack.find(this.settings.libraries[i], {
						matching: "**/**.epub",
					});
					for (let j = 0; j < results.length; j++) {
						await this.importEpub(jetpack.path(results[j]));
						n++;
					}
				}
				if (n == 0) {
					new Notice(i18next.t("no book in libraries"));
					console.log(i18next.t("no book in libraries"));
				} else {
					new Notice(
						i18next.t("translation:sync-libraries_r").replace("${n}", n.toString())
					);
					console.log(
						i18next.t("translation:sync-libraries_r").replace("${n}", n.toString())
					);
				}
			},
		});
		this.registerDomEvent(document, "drop", async (e) => {
			if (
				this.settings.byDrag &&
				//@ts-ignore
				e.toElement.className == "nav-files-container node-insert-event"
			) {
				const files = e.dataTransfer.files;
				//@ts-ignore
				if (files.length == 1 && new Path(files[0].name).suffix == "epub") {
					//@ts-ignore
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
			this.app.workspace.on("file-open", (file) => {
				if (!this.settings.autoOpenRightPanel) return;
				const mocPath = this.getMocPath(file);
				if (!mocPath) return this.activeLeaf.detach();
				const bookName = this.app.vault.getAbstractFileByPath(mocPath).parent.name;
				if (this.activeBook == bookName) return;
				if (this.activeLeaf) this.activeLeaf.detach();
				this.activeBook = bookName;
				this.activeLeaf = this.app.workspace.getRightLeaf(false);
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

		this.registerEvent(
			this.app.workspace.on("quit", () => {
				this.activeLeaf.detach();
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				if (!this.settings.allbooks) return;
				const files_with_tag = getNotesWithTag(this.app, this.settings.tag);
				const allBooks = this.app.vault.getAbstractFileByPath("AllBooks.md");
				if (allBooks && allBooks instanceof TFile) {
					this.app.vault.modify(
						allBooks,
						files_with_tag
							.map((file) => `- [[${file.path}|${file.parent?.name}]]`)
							.join("\n")
					);
				} else {
					this.app.vault.create(
						"AllBooks.md",
						files_with_tag
							.map((file) => `[[${file.path}|${file.parent?.name}]]`)
							.join("\n")
					);
				}
			})
		);
	}
	onunload() {
		try {
			this.activeLeaf.detach();
		} catch (err) {
			/* empty */
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async importEpub(epubPath: string) {
		const epubName = new Path(epubPath).stem;
		const {
			assetsPath,
			mocPropertysTemplate: propertysTemplate,
			savePath,
			tag,
			granularity,
		} = this.settings;
		const savePathP = new Path(savePath);
		const folder = savePathP.join(epubName);
		const folderA = new Path(this.vaultPath, folder.string).string;
		if (jetpack.exists(folderA)) {
			if (this.settings.removeDuplicateFolders) {
				jetpack.remove(folderA);
			} else {
				new Notice("Duplicate folder already exists.");
				return;
			}
		}
		this.assetsPath = assetsPath
			.replaceAll("{{bookName}}", epubName)
			.replaceAll("{{savePath}}", savePath);

		this.parser = new EpubParser(epubPath,this.settings.moreLog);
		await this.parser.init();
		if(this.settings.moreLog) console.log("toc is: ",this.parser.toc);

		this.propertys = parseYaml(
			Array.from(this.parser.meta).reduce(
				(template, [key, value]) => template.replaceAll(`{{${key}}}`, value).replaceAll("[","【").replaceAll("]","】"),
				propertysTemplate
			)
		);
		this.propertys.tags = (this.propertys.tags ?? []).concat([tag]);

		this.BookNote = "";
		await this.app.vault.createFolder(folder.string);

		this.copyImages();

		if(this.settings.oneNote){
			[...this.parser.chapters]
				.filter((cpt)=>cpt.level!=0)
				.sort((a, b) => b.level - a.level)
				.forEach((cpt) => cpt.parent.sections.push(...cpt.sections));
			let content = "";
			for(const cpt of this.parser.chapters.filter((cpt)=>cpt.level==0)){
				content += cpt.sections.map((st) => this.htmlToMD(st.html)).join("\n\n");
			}
			let notePath = folder;
			if(this.settings.oneFolder){
				notePath = folder.join(epubName);
			}
			await this.app.vault.create(
				notePath.withSuffix("md").string,
				tFrontmatter(this.propertys) + "\n" + content
			);
			return 0;
		}

		[...this.parser.chapters]
			.filter((cpt) => cpt.level > granularity)
			.sort((a, b) => b.level - a.level)
			.forEach((cpt) => cpt.parent.sections.push(...cpt.sections));

		for (const cpt of this.parser.chapters.filter((cpt) => cpt.level <= granularity)) {
			if(cpt.name.startsWith("... ")) cpt.sections[0].name = cpt.name.replace("... ","");
			const paths = [cpt.name];
			const getPaths = (cpt2: Chapter) => {
				if (cpt2.parent) {
					paths.unshift(cpt2.parent.name);
					getPaths(cpt2.parent);
				}
			};
			getPaths(cpt);
			if (cpt.level < granularity && cpt.subItems.length != 0) paths.push(cpt.name);
			const notePath = folder.join(...paths);
			if (!this.app.vault.getAbstractFileByPath(notePath.parent.string)) {
				await this.app.vault.createFolder(notePath.parent.string);
			}
			await this.app.vault.create(
				notePath.string + ".md",
				(this.settings.notePropertysTemplate
					? tFrontmatter(
						parseYaml(
							this.settings.notePropertysTemplate.replace(
								"{{created_time}}",
								Date.now().toString()
							)
						)
					  ) + "\n"
					: "") + cpt.sections.map((st) => this.htmlToMD(st.html)).join("\n\n")
			);
			this.BookNote += `${"\t".repeat(cpt.level)}- [[${notePath.string}|${cpt.name}]]\n`;
		}

		this.BookNote = tFrontmatter(this.propertys) + "\n" + this.BookNote;
		await this.app.vault.create(
			folder.join(this.settings.mocName.replace("{{bookName}}", epubName)).string + ".md",
			this.BookNote
		);
		console.log(`Successfully imported ${epubName}`);
		new Notice(`Successfully imported ${epubName}`);
	}

	copyImages() {
		const imagesPath = new Path(this.vaultPath, this.assetsPath);
		jetpack
			.find(this.parser.tmpPath, { matching: ["*.jpg", "*.jpeg", "*.png"] })
			.forEach((file) =>
				jetpack.copy(file, imagesPath.join(new Path(file).name).string, {
					overwrite: true,
				})
			);
		if (this.parser.coverPath) {
			this.propertys.cover = new Path(
				this.assetsPath,
				new Path(this.parser.coverPath).name
			).string;
		}
	}

	htmlToMD(html: string): string {
		let content = htmlToMarkdown(html ? html : "");
		if (html && !content) {
			content = html.replace(/<[^>]+>/g, "");
		}
		return NoteParser.parse(content, this.assetsPath, this.settings.imageFormat);
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
