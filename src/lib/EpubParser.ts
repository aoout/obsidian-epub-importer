/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

import extract from "extract-zip";
import jetpack from "fs-jetpack";
import * as path from "path";
import * as xml2js from "xml2js";

const findProperty = (obj: any, propertyName: string): any => {
	if (obj[propertyName]) return obj[propertyName];
	for (const key in obj) {
		if (typeof obj[key] === 'object' && obj[key] !== null) {
			const result = findProperty(obj[key], propertyName);
			if (result) return result;
		}
	}
	return null;
};

/*
 * Section class represents a content unit in an EPUB book
 * 
 * This class handles individual content sections within chapters, managing both
 * the section's metadata and its actual content.
 * 
 * Properties:
 * - name: Title/name of the section
 * - url: Complete URL including anchor (e.g. "chapter1.html#section2")
 * - urlPath: Base file path without anchor (e.g. "chapter1.html")
 * - urlHref: Anchor portion of URL (e.g. "section2")
 * - html: Actual HTML content of the section
 * 
 * The constructor parses the provided URL to separate the file path from
 * the anchor reference, enabling proper content extraction and linking.
 * 
 * Usage:
 * const section = new Section("Introduction", "content.html#intro");
 */
export class Section {
	name: string;
	url: string;
	urlPath: string;
	urlHref: string;
	html: string;

	constructor(name: string, url: string) {
		this.name = name;
		this.url = url;
		const [urlPath, urlHref] = url.split("#");
		this.urlPath = urlPath;
		this.urlHref = urlHref ?? "";
		this.html = "";
	}
}

/*
 * Chapter class represents a structural unit in an EPUB book
 * 
 * Key features:
 * - Maintains a list of sections containing actual content
 * - Supports hierarchical structure through subItems (child chapters)
 * - Tracks nesting level in the book's structure
 * - Maintains parent-child relationships between chapters
 * - Provides easy access to chapter name through getter
 * 
 * Structure:
 * - sections: Array of Section objects containing content
 * - subItems: Child chapters for nested structure
 * - level: Depth in chapter hierarchy (0 = top level)
 * - parent: Reference to parent chapter
 * 
 * Usage:
 * const chapter = new Chapter("Chapter 1", "content.html");
 * chapter.subItems.push(new Chapter("1.1", "sub.html", [], 1, chapter));
 */
export class Chapter {
	sections: Section[];
	subItems: Chapter[];
	level: number;
	parent: Chapter;

	constructor(
		name: string,
		url: string,
		subItems: Chapter[] = new Array<Chapter>(),
		level = 0,
		parent = null
	) {
		this.sections = [new Section(name, url)];
		this.subItems = subItems;
		this.level = level;
		this.parent = parent;
	}

	public get name(): string {
		return this.sections[0].name ?? "";
	}
}

/*
 * OPF (Open Packaging Format) Parser
 *
 * The .opf file is a crucial component of EPUB format that serves as the package document.
 * It contains essential information about the publication including:
 * - Metadata: Title, author, publisher, language etc.
 * - Manifest: A complete list of all resources (HTML files, images, CSS etc.)
 * - Spine: The reading order of the content documents
 * - Guide: Reference points in the publication (optional)
 *
 * This parser handles:
 * 1. Extracting and processing all HTML content files from the manifest
 * 2. Locating and retrieving the cover image path if present
 * 3. Parsing key metadata like title, author, publisher and language
 * 4. Building proper file paths by resolving relative paths against OPF location
 *
 * The parsed information provides the foundation for:
 * - Content organization and navigation
 * - Book metadata display
 * - Cover image handling
 * - Overall ebook structure understanding
 */
export class OPFParser {
	filePath: string;
	content: any;

	constructor(filePath: string, content: any) {
		this.filePath = filePath;
		this.content = content;
	}

	getHtmlFiles(): string[] {
		const manifest = findProperty(this.content, 'manifest')[0];
		return manifest.item
			.map((item) => item.$.href)
			.filter((href) => [".htm", ".html", ".xhtml"].some((sx) => href.includes(sx)))
			.map((href) => path.posix.join(path.dirname(this.filePath), href));
	}

	getCoverPath(): string {
		const manifest = findProperty(this.content, "manifest")[0].item;
		const coverItem = manifest.find(
			(item) =>
				["cover", "Cover"].some((sx) => item.$.id.includes(sx)) &&
				["png", "jpg", "jpeg"].includes(path.extname(item.$.href).slice(1))
		);
		return coverItem ? path.posix.join(path.dirname(this.filePath), coverItem.$.href) : null;
	}

	getMeta(): object {
		const meta = findProperty(this.content, "metadata")[0];
		const getValue = (key) => meta[key]?.[0] ?? "";

		return {
			title: getValue("dc:title"),
			publisher: getValue("dc:publisher"),
			language: getValue("dc:language"),
			author: meta["dc:creator"]?.[0]?.["_"] ? `"${meta["dc:creator"][0]["_"]}"` : "",
		};
	}
}

/*
 * NCX (Navigation Control file for XML) Parser
 * 
 * The .ncx file is a critical component of EPUB 2.0 that defines the hierarchical 
 * table of contents (TOC) for the ebook. It contains:
 * - Navigation points (navPoint elements) that define the structure
 * - Labels and content references for each navigation point
 * - Hierarchical relationships between sections
 * 
 * This parser:
 * 1. Processes the NCX file's XML structure
 * 2. Extracts navigation points and their metadata
 * 3. Recursively builds a tree of Chapter objects representing the TOC
 * 4. Handles fallback title extraction from HTML when NCX labels are missing
 * 5. Maintains parent-child relationships between chapters
 * 
 * The resulting Chapter tree provides the structural backbone for the ebook,
 * enabling proper navigation and content organization.
 */
export class NCXParser {
	filePath: string;
	content: any;

	constructor(filePath: string, content: any) {
		this.filePath = filePath;
		this.content = content;
	}

	getToc(): Chapter[] {
		const navPoints = this.content.ncx.navMap[0].navPoint;

		const getToc = (navPoint, level) => {
			const title = navPoint.navLabel?.[0]?.text?.[0] || (() => {
				const filePath = path.posix.join(path.dirname(this.filePath), navPoint.content[0].$["src"]);
				const html = jetpack.read(filePath);
				return new DOMParser().parseFromString(html, "text/html").title ||
					path.basename(filePath, path.extname(filePath)) || "";
			})();

			if (!title) return null;

			const filePath = path.posix.join(path.dirname(this.filePath), navPoint.content[0].$["src"]);
			const subItems = navPoint["navPoint"]?.map(pt => getToc(pt, level + 1)) || [];
			const chapter = new Chapter(title, filePath, subItems, level);
			subItems.forEach(sub => sub.parent = chapter);

			return chapter;
		};

		return navPoints.map(pt => getToc(pt, 0)).filter(Boolean);
	}
}

/*
 * Content splitter for epub sections
 * 
 * In EPUB files, a single HTML file may contain multiple chapters or sections, 
 * each marked with an anchor (id attribute). The TOC (table of contents) references
 * these sections using fragment identifiers (e.g., chapter1.html#section2).
 * 
 * This class handles:
 * 1. Reading HTML files and extracting content
 * 2. For files containing multiple sections:
 *    - Identifies section boundaries using anchor IDs from the TOC
 *    - Splits content at these boundaries using regex
 *    - Distributes split content to corresponding Section objects
 * 3. For single-section files:
 *    - Assigns entire file content to the section
 * 
 * The splitting process ensures each Section object contains only its relevant
 * portion of content, enabling proper chapter/section organization and display.
 */
class ContentSplitter {
    private sections: Section[];

    constructor(sections: Section[]) {
        this.sections = sections;
    }

    // Process section content from files
    async extractSectionContent() {
        const urls = [...new Set(this.sections.map((st) => st.urlPath))];
        const files = await this.readHtmlFiles(urls);

        files.forEach((file) => {
            if (!file.hrefs.length || file.hrefs.length === 1) {
                this.sections.find((st) => st.urlPath == file.url).html = file.html;
            } else {
                this.splitContentByAnchors(file);
            }
        });
    }

    // Load content files
    private async readHtmlFiles(urls: string[]) {
        const files = [];
        urls.forEach((url) => {
            const file = this.buildFileMetadata(url);
            try {
                const html = jetpack.read(url);
                if (html) {
                    file.html = html;
                }
                files.push(file);
            } catch (error) {
                this.logFileReadError(url);
            }
        });
        return files;
    }

    // Create file object for processing
    private buildFileMetadata(url: string) {
        const file = {
            url: url,
            names: [],
            hrefs: [],
            html: "",
        };

        this.sections
            .filter((st) => st.urlPath == url)
            .forEach((st) => {
                file.names.push(st.name ? path.basename(st.name) : null);
                file.hrefs.push(st.urlHref);
            });

        return file;
    }

    // Handle file load error
    private logFileReadError(url: string) {
        console.warn(`Error reading file at ${url}`);
        console.warn(
            "The failure to read the file might be due to an invalid file path. If such errors are few in this parsing process, it could be because the epub contains some meaningless navPoints, or even advertisements. If this is the case, it will not cause any damage to the content of the book."
        );
    }

    // Split section content by anchors
    private splitContentByAnchors(file) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(file.html, "text/html");
        const htmls: string[] = [];
        let currentHtml = "";
        let currentNode = doc.body.firstChild;

        while (currentNode) {
            if (currentNode.nodeType === Node.ELEMENT_NODE) {
                const element = currentNode as Element;
                const id = element.getAttribute("id");
                
                if (id && file.hrefs.includes(id)) {
                    if (currentHtml) {
                        htmls.push(currentHtml);
                        currentHtml = "";
                    }
                }
            }
            
            currentHtml += (currentNode as Element).outerHTML || currentNode.textContent;
            currentNode = currentNode.nextSibling;
        }

        if (currentHtml) {
            htmls.push(currentHtml);
        }

        if (file.hrefs[0] != "") {
            htmls.shift();
        }

        const hrefs = file.hrefs.map((href) => (href ? "#" + href : ""));
        this.distributeHtmlToSections(file, htmls, hrefs);
    }

    // Assign split content to sections  
    private distributeHtmlToSections(file, htmls: string[], hrefs: string[]) {
        htmls.forEach((html, i) => {
            try {
                this.sections.find((c) => c.url == file.url + hrefs[i]).html = html;
            } catch (e) {
                console.warn("Error splitting HTML file into sections");
            }
        });
    }
}


/*
 * EPUB Parser
 * 
 * This class handles the complete parsing process of an EPUB file:
 * 
 * 1. Initialization & Extraction
 *    - Creates temp directory and extracts EPUB contents
 *    - Locates and parses OPF/NCX files for structure
 * 
 * 2. Content Organization
 *    - Builds table of contents (TOC) from NCX if available
 *    - Processes HTML content files from OPF manifest
 *    - Organizes content into chapters and sections
 *    - Handles files not mapped in TOC
 * 
 * 3. Metadata & Resources
 *    - Extracts book metadata (title, author etc.)
 *    - Locates cover image
 * 
 * Usage:
 * const parser = new EpubParser("path/to/book.epub", false);
 * await parser.init();
 * 
 * Access parsed content:
 * - parser.toc: Table of contents tree
 * - parser.chapters: Flattened chapter list
 * - parser.sections: All content sections
 * - parser.meta: Book metadata
 * - parser.coverPath: Cover image path
 * 
 * Each chapter contains:
 * - name: Chapter title
 * - sections: Content sections
 * - subItems: Child chapters
 * - level: Nesting level
 * 
 * Each section contains:
 * - name: Section title 
 * - html: Section content
 * - url: Source file URL
 */
export class EpubParser {
    // File paths
    epubPath: string;
    tmpPath: string;
    opfFilePath: string;
    ncxFilePath: string;
    coverPath: string;

    // Content parsers
    opfParser: OPFParser;
    ncxParser: NCXParser;
    meta: object;

    // Book structure
    toc: Chapter[] = [];
    chapters: Chapter[] = [];
    sections: Section[];

    // Options
    moreLog: boolean;

    constructor(path: string, moreLog: boolean) {
        this.epubPath = path;
        this.moreLog = moreLog;
    }

    // Initialize and parse the epub file
    async init() {
        try {
            await this.extractEpub();
            await this.parseOPFandNCX();
            await this.parseContent();
        } catch (e) {
            console.log(e);
            throw new Error("failed to parse the .epub file");
        }
    }

    // Extract epub contents to temp directory
    private async extractEpub() {
        this.tmpPath = jetpack.tmpDir().path();
        if (this.moreLog) console.log("tmp folder path is: ", this.tmpPath);

        if (path.extname(this.epubPath) != "") {
            await extract(this.epubPath, { dir: this.tmpPath });
        } else {
            jetpack.copy(this.epubPath, this.tmpPath, { overwrite: true });
        }
    }

    // Parse OPF and NCX files
    private async parseOPFandNCX() {
        const parser = new xml2js.Parser();

        // Parse OPF file
        const opfFile = jetpack.find(this.tmpPath, { matching: "**/*.opf" })[0];
        const opfData = jetpack.read(opfFile);
        const opfContent = await parser.parseStringPromise(opfData);
        this.opfFilePath = opfFile;
        this.opfParser = new OPFParser(opfFile, opfContent);

        // Parse NCX file if exists
        try {
            const ncxFile = jetpack.find(this.tmpPath, { matching: "**/*.ncx" })[0];
            const ncxData = jetpack.read(ncxFile);
            const ncxContent = await parser.parseStringPromise(ncxData);
            this.ncxFilePath = ncxFile;
            this.ncxParser = new NCXParser(ncxFile, ncxContent);
        } catch (error) {
            console.log(
                "This epub does not have a .ncx file, parsing will be based on the .opf file content."
            );
        }
    }

    // Parse book content and metadata
    private async parseContent() {
        await this.parseToc();
        await this.parseCover();
        await this.parseMeta();
    }

    // Parse table of contents and section content
    private async parseToc() {
        this.initializeToc();
        const urls = [...new Set(this.sections.map((st) => st.urlPath))];
        const contentSplitter = new ContentSplitter(this.sections);
        await contentSplitter.extractSectionContent();
    }

    // Initialize table of contents
    private initializeToc() {
        // Generate from NCX if available
        if (this.ncxParser) {
            this.toc = this.ncxParser.getToc();
            this.updateChaptersByToc();
        }

        // Process HTML files from manifest
        const hrefs = this.opfParser.getHtmlFiles();
        this.processUnmappedFiles(hrefs);

        this.updateChaptersByToc();
        this.sections = this.chapters.flatMap((cpt) => cpt.sections);
    }

    // Update chapters list from table of contents
    private updateChaptersByToc() {
        this.chapters = [];
        const getChapters = (chapter: Chapter) => {
            this.chapters.push(chapter);
            chapter.subItems.forEach(getChapters, chapter);
        };
        this.toc.forEach(getChapters);
    }

    // Get indices of mapped files
    private getMappedFileIndexs(hrefs: string[]): number[] {
        const indexs = [];
        this.chapters.forEach((cpt) => {
            indexs.push(hrefs.indexOf(cpt.sections[0].urlPath));
        });
        return indexs;
    }

    // Process files not mapped in TOC
    private processUnmappedFiles(hrefs: string[]) {
        const indexs = this.getMappedFileIndexs(hrefs);
        let k = 0;

        hrefs.forEach((href, hrefIndex) => {
            if (!indexs.includes(hrefIndex)) {
                this.processOneUnmappedFile(href, indexs, k++);
            }
        });
    }

    // Handle a file not mapped in TOC
    private processOneUnmappedFile(href: string, indexs: number[], k: number) {
        const hrefs = this.opfParser.getHtmlFiles();
        const hrefIndex = hrefs.indexOf(href);
        const parentIndex = indexs.findIndex(idx => idx < hrefIndex);

        if (parentIndex >= 0) {
            // Add as section to existing chapter
            this.chapters[parentIndex].sections.push(new Section(null, href));
        } else {
            // Create new chapter
            const html = jetpack.read(href);
            const title = new DOMParser()
                .parseFromString(html, "text/html")
                .title || path.basename(href, path.extname(href));

            this.toc.splice(k, 0, new Chapter(title, href));
        }
    }

    // Parse book cover
    private async parseCover() {
        this.coverPath = this.opfParser.getCoverPath();
    }

    // Parse book metadata
    private async parseMeta() {
        this.meta = {
            ...this.opfParser.getMeta(),
            bookName: path.basename(this.epubPath, path.extname(this.epubPath)),
        };
    }
}
