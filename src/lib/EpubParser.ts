/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

import * as xml2js from "xml2js";
import * as path from "path";
import * as unzipper from "unzipper";
import { htmlToMarkdown } from "obsidian";
import jetpack from "fs-jetpack";

export class Chapter {
	name: string;
	url: string;
	subItems: Chapter[];

	constructor(
		name: string,
		url: string,
		subItems: Chapter[] = new Array<Chapter>()
	) {
		this.name = name;
		this.url = url;
		this.subItems = subItems;
	}

	getHtml(): string {
		return jetpack.read(this.url.split("#")[0]);
	}

	getMarkdown():string{
		return htmlToMarkdown(this.getHtml());
	}

	getFileName(): string {
		return path.basename(this.url).split("#")[0];
	}
}

export class EpubParser {
	epubPath: string;
	tmpPath: string;
	toc: Chapter[];
	coverPath: string;

	constructor(path: string) {
		this.epubPath = path;
	}

	async init() {
		this.tmpPath = jetpack.tmpDir().path();
		await jetpack
			.createReadStream(this.epubPath)
			.pipe(unzipper.Extract({ path: this.tmpPath }))
			.promise();
		await this.parseToc();
		await this.parseCover();
	}

	async parseToc() {
		const parser = new xml2js.Parser();
		const tocFile = path.join( this.tmpPath,jetpack.cwd(this.tmpPath).find({matching:"**/toc.ncx"})[0]);
		const data = jetpack.read(tocFile);

		const result = await parser.parseStringPromise(data);
		console.log(result);
		const navPoints = result.ncx.navMap[0].navPoint;

		const parseNavPoint = (navPoint: any) => {
			const tocParentPath = path.dirname(tocFile);

			const item = new Chapter(
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
		const opfFile = path.join( this.tmpPath,jetpack.cwd(this.tmpPath).find({matching:"**/content.opf"})[0]);
		const data = jetpack.read(opfFile);

		const result = await parser.parseStringPromise(data);
		console.log(result);

		for (let i = 0; i < result.package.manifest[0].item.length; i++) {
			const item = result.package.manifest[0].item[i];
			if (item.$.id.indexOf("cover") !== -1) {
				const opfParentPath = path.dirname(opfFile);
				this.coverPath = path.join(opfParentPath , item.$.href);
				break;
			}
		}
	}
}