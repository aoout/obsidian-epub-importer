/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

import * as xml2js from "xml2js";
import * as path from "path";
import extract from "extract-zip";
import jetpack from "fs-jetpack";

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

export class EpubParser {
	epubPath: string;
	moreLog: boolean;
	tmpPath: string;
	toc: Chapter[];
	chapters: Chapter[];
	sections: Section[];
	opfFilePath: string;
	opfContent: any;
	ncxFilePath: string;
	ncxContent: any;
	coverPath: string;
	meta: object;

	constructor(path: string, moreLog: boolean) {
		this.epubPath = path;
		this.moreLog = moreLog;
	}

	async init() {
		try {
			this.tmpPath = jetpack.tmpDir().path();
			if (this.moreLog) console.log("tmp folder path is: ", this.tmpPath);
			if (path.extname(this.epubPath) != "") {
				await extract(this.epubPath, { dir: this.tmpPath });
			} else {
				jetpack.copy(this.epubPath, this.tmpPath, { overwrite: true });
			}
			[this.opfFilePath, this.opfContent] = await this.parseBySuffix("opf");
			[this.ncxFilePath, this.ncxContent] = await this.parseBySuffix("ncx");
			await this.parseToc();
			await this.parseCover();
			await this.parseMeta();
		} catch (e) {
			console.log(e);
			throw new Error("failed to parse the .epub file");
		}
	}

	async parseBySuffix(suffix: string): Promise<[string, any]> {
		const parser = new xml2js.Parser();
		const file = path.join(
			this.tmpPath,
			jetpack.cwd(this.tmpPath).find({ matching: `**/**.${suffix}` })[0]
		);
		const data = jetpack.read(file);

		return [file, await parser.parseStringPromise(data)] as const;
	}

	generateToc() {
		const navPoints = this.ncxContent.ncx.navMap[0].navPoint;

		const getToc = (navPoint, level) => {
			const cpt = new Chapter(
				navPoint.navLabel[0].text[0],
				path.join(path.dirname(this.ncxFilePath), navPoint.content[0].$["src"]),
				navPoint["navPoint"]?.map((pt) => getToc(pt, level + 1)) ?? [],
				level
			);
			cpt.subItems.forEach((sub) => (sub.parent = cpt));
			return cpt;
		};
		this.toc = navPoints.map((pt) => getToc(pt, 0));
		const getChapters = (chapter: Chapter) => {
			this.chapters.push(chapter);
			chapter.subItems.forEach(getChapters, chapter);
		};
		this.chapters = [];
		this.toc.forEach(getChapters);

		const hrefs: string[] = this.opfContent.package.manifest[0].item
			.map((item) => item.$.href)
			.filter((href) => [".html", ".xhtml"].some((sx) => href.includes(sx)))
			.map((href) => path.join(path.dirname(this.opfFilePath), href));

		// create a mapping from chapters index to hrefs index.
		const indexs = [];
		this.chapters.forEach((cpt) => {
			indexs.push(hrefs.indexOf(cpt.sections[0].urlPath));
		});

		let k = 0;
		hrefs.forEach((href, hrefIndex) => {
			if (!indexs.includes(hrefIndex)) {
				// find the largest index among indexes smaller than its index.
				const parent = indexs.indexOf(
					[...indexs].sort((a, b) => b - a).find((v) => v < hrefIndex)
				);
				if (parent > 0) this.chapters[parent].sections.push(new Section(null, href));
				else
					this.toc.splice(
						k++,
						0,
						new Chapter(path.basename(href, path.extname(href)), href)
					);
			}
		});

		this.chapters = [];
		this.toc.forEach(getChapters);
		this.sections = this.chapters.flatMap((cpt) => cpt.sections);
	}

	async parseToc() {
		this.generateToc();
		const urls = [...new Set(this.sections.map((st) => st.urlPath))];
		const files = [];
		urls.forEach((url) => {
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
			try {
				const html = jetpack.read(url);
				if (html) file.html = html;
				files.push(file);
			} catch (error) {
				console.error(`Error reading file at ${url}:`, error);
			}
		});
		files.forEach((file) => {
			if (!file.hrefs.length || (file.hrefs.length === 1 && file.hrefs[0] === "")) {
				this.sections.find((st) => st.urlPath == file.url).html = file.html;
			} else {
				// example: <h2 class="title2" id="CHP5-2">抹香鲸和福卡恰面包</h2>
				const reg = new RegExp(`<.*?id=['"](?:${file.hrefs.join("|")})['"].*?>`, "g");
				const split = (string, delimiter, n) => {
					const parts = string.split(delimiter);
					if (n > parts.length) n = parts.length;
					return parts.slice(0, n - 1).concat([parts.slice(n - 1).join(delimiter)]);
				};
				const htmls = split(file.html, reg, file.hrefs.length + 1);
				if (file.hrefs[0] != "") htmls.shift();
				const hrefs = file.hrefs.map((href) => (href ? "#" + href : ""));
				htmls.forEach((html, i) => {
					try {
						this.sections.find((c) => c.url == file.url + hrefs[i]).html = html;
					} catch (e) {
						console.warn(
							"Some errors occurred when we split a .html/.xhtml file to sections"
						);
					}
				});
			}
		});
	}

	async parseCover() {
		const coverItem = this.opfContent.package.manifest[0].item.find(
			(item) =>
				["cover", "Cover"].some((sx) => item.$.id.includes(sx)) &&
				["png", "jpg", "jpeg"].includes(path.extname(item.$.href).slice(1))
		);
		if (coverItem) this.coverPath = path.join(path.dirname(this.opfFilePath), coverItem.$.href);
	}

	async parseMeta() {
		const meta = this.opfContent.package.metadata[0];

		this.meta = {
			title: meta["dc:title"]?.[0] ? `"${meta["dc:title"]?.[0]}"` : "",
			author: meta["dc:creator"]?.[0]?.["_"] ? `"${meta["dc:creator"]?.[0]?.["_"]}"` : "",
			publisher: meta["dc:publisher"]?.[0] ? `"${meta["dc:publisher"]?.[0]}"` : "",
			language: meta["dc:language"]?.[0] ? `"${meta["dc:language"]?.[0]}"` : "",
			bookName: path.basename(this.epubPath, path.extname(this.epubPath))
				? `"${path.basename(this.epubPath, path.extname(this.epubPath))}"`
				: "",
		};
	}
}
