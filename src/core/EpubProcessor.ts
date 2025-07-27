import { EpubImporterSettings } from "../settings/settings";
import EpubParser, { Chapter } from "./parser";
import { App, Notice, parseYaml } from "obsidian";
import jetpack from "fs-jetpack";
import beautify from "js-beautify";
import { create } from "./TurndownService";
import * as path from "path";
import { normalize } from "../utils/utils";
import { templateWithVariables, tFrontmatter } from "../utils/obsidianUtils"

export default class EpubProcessor {
  private parser?: EpubParser;
  private properties: Record<string, any> = {};
  private bookNote: string;
  private assetsPath: string;

  constructor(
    private readonly app: App,
    private readonly settings: EpubImporterSettings,
    private readonly vaultPath: string
  ) {}

  async importEpub(epubPath: string) {
    this.bookNote = "";
    this.assetsPath = "";
    const epubName = normalize(path.basename(epubPath, path.extname(epubPath)));
    const folderPath = await this.initImport(epubPath, epubName);
    if (!folderPath) return;

    this.copyImages(folderPath);
    await this.processNotes(epubName, folderPath);
    jetpack.remove(this.parser!.tmpPath);
    this.showSuccessNotice(epubName);
  }

  private async initImport(epubPath: string, epubName: string): Promise<string | null> {
    const folderPath = this.resolveFolderPath(epubName);
    if (!folderPath) return null;

    await this.app.vault.createFolder(folderPath);
    this.parser = new EpubParser(epubPath, this.settings.moreLog);
    await this.parser.init();
    this.properties = this.parseProperties(epubName);
    if (this.settings.moreLog) console.log("toc:", this.parser.toc);
    return folderPath;
  }

  private async processNotes(epubName: string, folderPath: string) {
    this.mergeChapters(this.settings.granularity);
    const chapters = this.parser!.chapters.filter(c => c.level <= this.settings.granularity);

    this.settings.granularity === 0
      ? await this.createFile(`${folderPath}/${epubName}.md`, this.generateContent(chapters))
      : await this.processChapters(epubName, folderPath, chapters);
  }

  private async processChapters(epubName: string, folderPath: string, chapters: Chapter[]) {
    for (const [i, chapter] of chapters.entries()) {
      const notePath = await this.createChapterNote(chapter, folderPath, i, chapters);
      this.bookNote += `${"\t".repeat(chapter.level)}- [[${notePath}|${chapter.originalName}]]\n`;
    }
    await this.createFile(
      `${folderPath}/${templateWithVariables(this.settings.mocName, { bookName: epubName })}.md`,
      this.bookNote
    );
  }

  private async createChapterNote(chapter: Chapter, folderPath: string, index: number, chapters: Chapter[]) {
    const notePath = path.posix.join(folderPath, ...this.getChapterPaths(chapter));
    await this.ensureFolder(path.dirname(notePath));

    let content = this.settings.noteTemplate
        ? templateWithVariables(this.settings.noteTemplate, this.getChapterMetadata(chapter, index, chapters))
        : this.generateContent([chapter]);

    content = this.processObsidianLinks(content, chapters);

    await this.app.vault.create(`${notePath}.md`, content);
    return notePath;
}

private processObsidianLinks(content: string, chapters: Chapter[]): string {
  const linkPattern = /\[\[(.*?)\]\]/g;
  
  return content.replace(linkPattern, (match, linkText) => {
      const [linkPart, displayText] = linkText.split('|');
      const [baseLink, href] = linkPart.split('#');
      
      if ((!baseLink.includes('.html') && !baseLink.includes('.xhtml'))|| !href) {
          return match;
      }

      const targetChapter = this.findChapterByHref(chapters, href);
      
      if (targetChapter) {
          const display = displayText || targetChapter.originalName;
          return `[[${targetChapter.name}|${display}]]`;
      }
      
      return match;
  });
}

private findChapterByHref(chapters: Chapter[], href: string): Chapter | null {
  for (const chapter of chapters) {
      for (const section of chapter.sections) {
          if (section.urlHref === href && (section.urlPath.endsWith('.html') || section.urlPath.endsWith('.xhtml'))) {
              return chapter;
          }
      }
      
      for (const section of chapter.sections) {
          if (this.hasHtmlElementWithId(section.html, href)) {
              return chapter;
          }
      }
      
      if (chapter.subItems.length > 0) {
          const found = this.findChapterByHref(chapter.subItems, href);
          if (found) return found;
      }
  }
  return null;
}

private hasHtmlElementWithId(html: string, id: string): boolean {
  const idPattern = new RegExp(`id=["']${id}["']`, 'i');
  return idPattern.test(html);
}

  private async createFile(filePath: string, content: string) {
    await this.app.vault.create(filePath, `${tFrontmatter(this.properties)}\n${content}`).catch(error => 
      console.warn(`Failed to create ${filePath}: ${error}`));
  }

  private generateContent(chapters: Chapter[]): string {
    return chapters
      .flatMap(c => c.sections.map(s => this.htmlToMD(s.html)))
      .join("\n\n");
  }

  private mergeChapters(maxLevel = 0) {
    this.parser!.chapters
      .filter(c => c.level > maxLevel)
      .sort((a, b) => b.level - a.level)
      .forEach(c => c.parent?.sections.push(...c.sections));
  }

  private getChapterPaths(chapter: Chapter): string[] {
    const paths = this.buildPathArray(chapter);
    return chapter.level < this.settings.granularity && chapter.subItems.length
      ? [...paths, chapter.name]
      : paths;
  }

  private buildPathArray(chapter: Chapter): string[] {
    const paths: string[] = [];
    let current: Chapter | undefined = chapter;
    while (current) {
      paths.unshift(current.name);
      current = current.parent;
    }
    return paths;
  }

  private getChapterMetadata(chapter: Chapter, index: number, chapters: Chapter[]): Record<string, string> {
    const content = this.generateContent([chapter]);
    return {
      created_time: Date.now().toString(),
      content,
      prev: index > 0 ? chapters[index - 1].name : "",
      next: index < chapters.length - 1 ? chapters[index + 1].name : "",
      chapter_name: chapter.originalName,
      chapter_level: chapter.level.toString(),
      chapter_index: (index + 1).toString(),
      ...this.parser!.meta,
      total_chars: content.length.toString(),
    };
  }

  private parseProperties(epubName: string): Record<string, any> {
    const props = parseYaml(templateWithVariables(this.settings.mocPropertysTemplate, this.parser!.meta));
    props.tags = [...(props.tags ?? []), this.settings.tag];
    return props;
  }

  private copyImages(folderPath: string) {
    this.assetsPath = templateWithVariables(this.settings.assetsPath, {
      bookName: path.basename(folderPath),
      savePath: this.settings.savePath,
    });

    jetpack.find(this.parser!.tmpPath, { matching: ["*.{jpg,jpeg,png}"] })
      .forEach(file => jetpack.copy(file, path.posix.join(this.vaultPath, this.assetsPath, path.basename(file)), { overwrite: true }));

    if (this.parser!.coverPath) {
      this.properties.cover = path.posix.join(this.assetsPath, path.basename(this.parser!.coverPath));
    }
  }

  private htmlToMD(html: string): string {
    if (this.settings.reformatting) html = beautify.html(html, { indent_size: 0 });
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("table:empty").forEach(table => table.remove());

    return this.normalizeHeadings(
      create(this.assetsPath, this.settings.imageFormat).turndown(html) || html.replace(/<[^>]+>/g, "")
    );
  }

  private normalizeHeadings(markdown: string): string {
    if (!/^# /m.test(markdown) && /^(#{1,6}) /m.test(markdown)) {
      const levelDiff = markdown.match(/^(#{1,6}) /m)![1].length - 1;
      return markdown.replace(/^(#{1,6}) /gm, (_, h) => "#".repeat(Math.max(1, h.length - levelDiff)) + " ");
    }
    return markdown;
  }

  private resolveFolderPath(epubName: string): string | null {
    const folderPath = path.posix.join(this.settings.savePath, epubName);
    const fullPath = path.posix.join(this.vaultPath, folderPath);
    return jetpack.exists(fullPath)
      ? this.settings.removeDuplicateFolders
        ? (jetpack.remove(fullPath), folderPath)
        : (new Notice("Duplicate folder exists"), null)
      : folderPath;
  }

  private async ensureFolder(folderPath: string) {
    await this.app.vault.createFolder(folderPath).catch(() => {});
  }

  private showSuccessNotice(epubName: string) {
    const message = `Successfully imported ${epubName}`;
    console.log(message);
    new Notice(message);
  }
}