
import { EpubImporterSettings } from "../settings/settings";
import EpubParser, { Chapter } from "./EpubParser";
import * as path from "path";
import { normalize } from "../utils/utils";
import { Notice, parseYaml } from "obsidian";
import jetpack from "fs-jetpack";
import beautify from "js-beautify";
import { create } from "./TurndownService";
import { templateWithVariables, tFrontmatter } from "../utils/obsidianUtils";

export default class EpubProcessor {
    private app: any;
    private settings: EpubImporterSettings;
    private vaultPath: string;
    private parser: EpubParser;
    private BookNote: string = "";
    private assetsPath: string;
    private properties: any;

    constructor(app: any, settings: EpubImporterSettings, vaultPath: string) {
        this.app = app;
        this.settings = settings;
        this.vaultPath = vaultPath;
    }

    async importEpub(epubPath: string) {
        const epubName = normalize(path.basename(epubPath, path.extname(epubPath)).trim());
        const folderPath = this.setupFolderPath(epubName);
        if (!folderPath) return;

        await this.initializeParser(epubPath, epubName);
        await this.createBookFolder(folderPath);

        this.copyImages();

        if (this.settings.granularity === 0) {
            await this.createSingleNote(epubName, folderPath);
        } else {
            await this.createChapterNotes(folderPath, epubName);
        }

        jetpack.remove(this.parser.tmpPath);
        this.showSuccessNotice(epubName);
    }

    private setupFolderPath(epubName: string): string | null {
        const folderPath = path.posix.join(this.settings.savePath, normalize(epubName));

        if (jetpack.exists(path.posix.join(this.vaultPath, folderPath))) {
            if (this.settings.removeDuplicateFolders) {
                jetpack.remove(path.posix.join(this.vaultPath, folderPath));
            } else {
                new Notice("Duplicate folder already exists.");
                return null;
            }
        }
        return folderPath;
    }

    private async createBookFolder(folderPath: string) {
        await this.app.vault.createFolder(folderPath);
    }

    private async initializeParser(epubPath: string, epubName: string) {
        this.assetsPath = templateWithVariables(this.settings.assetsPath, {
            bookName: epubName,
            savePath: this.settings.savePath,
        });

        this.parser = new EpubParser(epubPath, this.settings.moreLog);
        await this.parser.init();
        if (this.settings.moreLog) console.log("toc is: ", this.parser.toc);

        this.properties = parseYaml(templateWithVariables(this.settings.mocPropertysTemplate, this.parser.meta));
        this.properties.tags = (this.properties.tags ?? []).concat([this.settings.tag]);
        this.BookNote = "";
    }

    private async createSingleNote(epubName: string, folderPath: string) {
        this.mergeChapters();
        const content = this.generateSingleNoteContent();

        const notePath = path.posix.join(folderPath, epubName);

        await this.app.vault.create(
            notePath + ".md",
            tFrontmatter(this.properties) + "\n" + content
        );
    }

    private mergeChapters() {
        [...this.parser.chapters]
            .filter(cpt => cpt.level != 0)
            .sort((a, b) => b.level - a.level)
            .forEach(cpt => cpt.parent.sections.push(...cpt.sections));
    }

    private generateSingleNoteContent(): string {
        return this.parser.chapters
            .filter(cpt => cpt.level == 0)
            .map(cpt => cpt.sections.map(st => this.htmlToMD(st.html)).join("\n\n"))
            .join("\n\n");
    }

    private async createChapterNotes(folderPath: string, epubName: string) {
        this.mergeChaptersByGranularity();
        const filteredChapters = this.parser.chapters.filter(cpt => cpt.level <= this.settings.granularity);

        for (const [index, chapter] of filteredChapters.entries()) {
            const notePath = await this.createChapterNote(chapter, folderPath, index, filteredChapters);
            this.BookNote += `${"\t".repeat(chapter.level)}- [[${notePath}|${chapter.name}]]\n`;
        }

        await this.createMocFile(folderPath, epubName);
    }

    private mergeChaptersByGranularity() {
        [...this.parser.chapters]
            .filter(cpt => cpt.level > this.settings.granularity)
            .sort((a, b) => b.level - a.level)
            .forEach(cpt => cpt.parent.sections.push(...cpt.sections));
    }

    private async createChapterNote(chapter: Chapter, folderPath: string, index: number, allChapters: Chapter[]): Promise<string> {
        if (chapter.name.startsWith("... ")) {
            chapter.sections[0].name = chapter.name.replace("... ", "");
        }

        const paths = this.getChapterPaths(chapter);
        const notePath = path.posix.join(folderPath, ...paths.map(normalize));

        await this.app.vault.createFolder(path.dirname(notePath)).catch(() => {/**/ });

        const content = this.generateChapterContent(chapter, index, allChapters);

        try {
            await this.app.vault.create(notePath + ".md", content);
        } catch (error) {
            console.warn(`Failed to create file at ${notePath}.md: ${error}`);
            console.warn(
                "If such errors are few in this parsing process, it could be because the epub contains some repeated or wrong navPoints. If this is the case, it will not cause any damage to the content of the book."
            );
        }

        return notePath;
    }

    private getChapterPaths(chapter: Chapter): string[] {
        const paths = [chapter.name];
        const getPaths = (cpt: Chapter) => {
            if (cpt.parent) {
                paths.unshift(cpt.parent.name);
                getPaths(cpt.parent);
            }
        };
        getPaths(chapter);

        if (chapter.level < this.settings.granularity && chapter.subItems.length != 0) {
            paths.push(normalize(chapter.name));
        }
        return paths;
    }

    private generateChapterContent(chapter: Chapter, index: number, allChapters: Chapter[]): string {
        let content = "";

        if (this.settings.noteTemplate) {
            const chapterContent = chapter.sections.map(st => this.htmlToMD(st.html)).join("\n\n");
            content = templateWithVariables(this.settings.noteTemplate, {
                created_time: Date.now().toString(),
                content: chapterContent,
                prev: index > 0 ? allChapters[index - 1].name : "",
                next: index < allChapters.length - 1 ? allChapters[index + 1].name : "",
                chapter_name: chapter.name,
                chapter_level: chapter.level.toString(),
                chapter_index: (index + 1).toString(),
                book_name: this.parser.meta["title"] || "",
                book_author: this.parser.meta["author"] || "",
                book_publisher: this.parser.meta["publisher"] || "",
                book_language: this.parser.meta["language"] || "",
                book_rights: this.parser.meta["rights"] || "",
                book_description: this.parser.meta["description"] || "",
                total_chars: chapterContent.length.toString()
            });
        }

        return content;
    }

    private async createMocFile(folderPath: string, epubName: string) {
        const mocPath = path.posix.join(
            folderPath,
            templateWithVariables(this.settings.mocName, { bookName: epubName })
        ) + ".md";

        await this.app.vault.create(
            mocPath,
            tFrontmatter(this.properties) + "\n" + this.BookNote
        );
    }

    private showSuccessNotice(epubName: string) {
        console.log(`Successfully imported ${epubName}`);
        new Notice(`Successfully imported ${epubName}`);
    }

    copyImages() {
        const imagesPath = path.posix.join(this.vaultPath, this.assetsPath);
        const imageFiles = jetpack.find(this.parser.tmpPath, {
            matching: ["*.jpg", "*.jpeg", "*.png"]
        });

        imageFiles.forEach(file => {
            const destPath = path.posix.join(imagesPath, path.basename(file));
            jetpack.copy(file, destPath, { overwrite: true });
        });

        if (this.parser.coverPath) {
            this.properties.cover = path.posix.join(
                this.assetsPath,
                path.basename(this.parser.coverPath)
            );
        }
    }

    htmlToMD(htmlString: string): string {
        if (this.settings.reformatting) {
            htmlString = beautify.html(htmlString, { indent_size: 0 });
        }

        // Remove empty tables
        const doc = new DOMParser().parseFromString(htmlString, "text/html");
        doc.querySelectorAll("table").forEach(table => {
            const isEmpty = !Array.from(table.children).some(child => child.childElementCount > 0);
            if (isEmpty) table.remove();
        });

        // Convert to markdown
        const turndownService = create(this.assetsPath, this.settings.imageFormat);
        let markdown = turndownService.turndown(htmlString) || htmlString.replace(/<[^>]+>/g, "");

        // Normalize heading levels
        const hasH1 = /^# [^\n]+/m.test(markdown);
        if (!hasH1) {
            const headingMatch = markdown.match(/^(#{1,6}) [^\n]+/m);
            if (headingMatch) {
                const levelDiff = headingMatch[1].length - 1;
                markdown = markdown.replace(
                    /^(#{1,6}) /gm,
                    (_, hashes) => '#'.repeat(Math.max(1, hashes.length - levelDiff)) + ' '
                );
            }
        }

        return markdown;
    }
}