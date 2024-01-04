/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

import * as xml2js from "xml2js";
import * as path from "path";
import * as unzipper from "unzipper";
import jetpack from "fs-jetpack";
import { Path, convertToValidFilename } from "../utils/path";

export class Chapter {
	parent: Chapter;
	name: string;
	url: string;
	urlHref: string;
	urlPath: string;
	subItems: Chapter[];
	html: string;

	constructor(name: string, url: string, subItems: Chapter[] = new Array<Chapter>()) {
		this.name = name;
		this.url = url;
		const [urlPath, urlHref] = url.split("#");
		this.urlHref = urlHref ?? "";
		this.urlPath = urlPath;
		this.subItems = subItems;
	}
}

export class EpubParser {
	epubPath: string;
	tmpPath: string;
	toc: Chapter[];
	chapters: Chapter[];
	opfFilePath: string;
	opfContent: any;
	ncxFilePath: string;
	ncxContent: any;
	coverPath: string;
	meta: Map<string, string>;

	constructor(path: string) {
		this.epubPath = path;
	}

	async init() {
		this.tmpPath = jetpack.tmpDir().path();
		if (new Path(this.epubPath).suffix != "") {
			await jetpack
				.createReadStream(this.epubPath)
				.pipe(unzipper.Extract({ path: this.tmpPath }))
				.promise();
		} else {
			jetpack.copy(this.epubPath, this.tmpPath);
		}
		[this.opfFilePath, this.opfContent] = await this.parseBySuffix("opf");
		[this.ncxFilePath, this.ncxContent] = await this.parseBySuffix("ncx");
		await this.parseToc();
		await this.parseCover();
		await this.parseMeta();
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

		const getToc = (navPoint) =>
			new Chapter(
				navPoint.navLabel[0].text[0],
				new Path(this.ncxFilePath).parent.join(navPoint.content[0].$["src"]).string,
				navPoint["navPoint"]?.map(getToc) ?? []
			);

		this.toc = navPoints.map(getToc);
		const getChapters = (chapter: Chapter) => {
			this.chapters.push(chapter);
			chapter.subItems.forEach(getChapters, chapter);
		};
		this.chapters = [];
		this.toc.forEach(getChapters);

		const hrefs: string[] = this.opfContent.package.manifest[0].item
			.map((item) => item.$.href)
			.filter((href) => [".html", ".xhtml"].some((sx) => href.includes(sx)))
			.map((href) => new Path(this.opfFilePath).parent.join(href).string);

		// create a mapping from chapters index to hrefs index.
		const indexs = [];
		this.chapters.forEach((cpt) => {
			indexs.push(hrefs.indexOf(cpt.url));
		});

		let k = 0;
		hrefs.forEach((href, hrefIndex) => {
			if (!indexs.includes(hrefIndex)) {
				// find the largest index among indexes smaller than its index.
				const parent = indexs.indexOf(
					[...indexs].sort((a, b) => b - a).find((v) => v < hrefIndex)
				);
				if (parent > 0) {
					this.chapters[parent].subItems.push(new Chapter("", href));
				} else {
					this.toc.splice(k++, 0, new Chapter("", href));
				}
			}
		});

		this.chapters = [];
		this.toc.forEach(getChapters);
	}

	async parseToc() {
		this.generateToc();
		const urls = [...new Set(this.chapters.map((cpt) => cpt.urlPath))];
		const files = [];
		urls.forEach((url) => {
			const file = {
				url: url,
				names: [],
				hrefs: [],
				html: "",
			};
			this.chapters
				.filter((cpt) => cpt.urlPath == url)
				.forEach((cpt) => {
					file.names.push(convertToValidFilename(cpt.name));
					file.hrefs.push(cpt.urlHref);
				});
			const html = jetpack.read(url);
			if (html) file.html = html;
			files.push(file);
		});
		files.forEach((file) => {
			if (!file.hrefs.length) {
				this.chapters.find((c) => c.urlPath == file.url).html = file.html;
			} else {
				// example: <h2 class="title2" id="CHP5-2">抹香鲸和福卡恰面包</h2>
				const reg = new RegExp(
					`(?=<[^>]*id=['"](?:${file.hrefs.join("|")})['"][^>]*>[\\s\\S]*?<\\/[^>]*>)`,
					"g"
				);
				const htmls = file.html.split(reg);
				const hrefs = file.hrefs.map((href) => (href ? "#" + href : ""));
				htmls.forEach((html, i) => {
					this.chapters.find((c) => c.url == file.url + hrefs[i]).html = html;
				});
			}
		});
	}

	async parseCover() {
		const coverItem = this.opfContent.package.manifest[0].item.find((item) =>
			["cover", "Cover"].some((sx) => item.$.id.includes(sx))
		);
		if (coverItem)
			this.coverPath = new Path(this.opfFilePath).parent.join(coverItem.$.href).string;
	}

	async parseMeta() {
		const meta = this.opfContent.package.metadata[0];

		this.meta = new Map<string, string>();
		this.meta.set("title", meta["dc:title"]?.[0] ?? "");
		this.meta.set("author", meta["dc:creator"]?.[0]?.["_"] ?? "");
		this.meta.set("publisher", meta["dc:publisher"]?.[0] ?? "");
		this.meta.set("language", meta["dc:language"]?.[0] ?? "");

		this.meta.set("bookName", new Path(this.epubPath).stem);
	}
}
