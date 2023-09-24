/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

import * as xml2js from "xml2js";
import * as fs from "fs";
import * as path from "path";
import * as tmp from "tmp";
import * as unzipper from "unzipper";
import { walkSync } from "./utils";

export class TocItem {
	name: string;
	url: string;
	subItems: TocItem[];

	constructor(
		name: string,
		url: string,
		subItems: TocItem[] = new Array<TocItem>()
	) {
		this.name = name;
		this.url = url;
		this.subItems = subItems;
	}

	getChapter(): string {
		const chapter = fs.readFileSync(this.url.split("#")[0], "utf-8");
		return chapter;
	}

	getFileName(): string {
		return path.basename(this.url).split("#")[0];
	}
}

export class EpubParser {
	epubPath: string;
	tmpobj: any;
	tocFile: string;
	toc: TocItem[];
	opfFile: string;
	coverPath: string;

	constructor(path: string) {
		this.epubPath = path;
	}

	async init() {
		this.tmpobj = tmp.dirSync({ unsafeCleanup: true });
		await fs
			.createReadStream(this.epubPath)
			.pipe(unzipper.Extract({ path: this.tmpobj.name }))
			.promise();
	}

	findTocFile() {
		walkSync(this.tmpobj.name, "file", (filePath: string, stat: any) => {
			if (filePath.indexOf("toc.ncx") !== -1) {
				this.tocFile = filePath;
			}
		});
		console.log("toc file path: ", this.tocFile);
	}

	findOpfFile() {
		walkSync(this.tmpobj.name, "file", (filePath: string, stat: any) => {
			if (filePath.indexOf("content.opf") !== -1) {
				this.opfFile = filePath;
			}
		});
		console.log("opf file path: ", this.opfFile);
	}

	async parseToc() {
		const parser = new xml2js.Parser();
		const data = fs.readFileSync(this.tocFile, "utf-8");

		let result: any;
		await parser.parseStringPromise(data).then((result2: any) => {
			result = result2;
		});
		console.log(result);
		const navPoints = result.ncx.navMap[0].navPoint;

		const parseNavPoint = (navPoint: any) => {
			const tocParentPath = path.dirname(this.tocFile);

			const item = new TocItem(
				navPoint.navLabel[0].text[0],
				tocParentPath + "/" + navPoint.content[0].$["src"]
			);

			const subNavPoints = navPoint["navPoint"];
			if (subNavPoints) {
				for (let i = 0; i < subNavPoints.length; i++) {
					const child = subNavPoints[i];
					item.subItems.push(parseNavPoint(child));
				}
			}
			return item;
		};
		const toc = [];
		for (let i = 0; i < navPoints.length; i++) {
			const item = navPoints[i];
			toc.push(parseNavPoint(item));
		}
		this.toc = toc;
		console.log(toc);
	}

	async parseCover() {
		const parser = new xml2js.Parser();
		const data = fs.readFileSync(this.opfFile, "utf-8");

		let result: any;
		await parser.parseStringPromise(data).then((result2: any) => {
			result = result2;
		});
		console.log(result);

		for (let i = 0; i < result.package.manifest[0].item.length; i++) {
			const item = result.package.manifest[0].item[i];
			if (item.$.id.indexOf("cover") !== -1) {
				const opfParentPath = path.dirname(this.opfFile);
				this.coverPath = opfParentPath + "/" + item.$.href;
				break;
			}
		}

		console.log(this.coverPath);
	}

	static async getParser(path: string) {
		const parser = new EpubParser(path);
		await parser.init();
		parser.findTocFile();
		await parser.parseToc();
		parser.findOpfFile();
		await parser.parseCover();
		return parser;
	}
}
