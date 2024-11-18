/* eslint-disable @typescript-eslint/no-unused-vars */

import { RegexPattern } from "../settings/settings";

export class NoteParser {
	content: string;
	static parse(originNote: string, assetsPath: string, imageFormat: string, userRegexes: RegexPattern[]) {
		const parser = new NoteParser(originNote);
		parser.parseImagePath(assetsPath, imageFormat);
		parser.parseFontNote();
		parser.parseInnerLink();
		parser.parseHttpLink();
		parser.applyUserRegexes(userRegexes);
		return parser.content;
	}

	constructor(originNote: string) {
		this.content = originNote;
	}

parseImagePath(assetsPath: string, imageFormat: string) {
    // First, convert image paths to use the 'images' directory and remove unnecessary path parts
    this.content = this.content.replaceAll(
        /!\[More work needed\]\(.*\/(.*?)\.(jpg|jpeg|png)\)/g, 
        (match, p1, p2) => {
            return `![More work needed](${assetsPath}/${p1}.${p2})`;
        }
    );

    // Handle URL encoding of spaces in standard Markdown format
    if (imageFormat === "![](imagePath)") {
        this.content = this.content.replaceAll(
            /!\[More work needed\]\(${assetsPath}\/images\/(.*?)\.(jpg|jpeg|png)\)/g,
            (match, p1, p2) => {
                const cleanedPath = p1.replace(/.*\/\.\.\//, '');
                return `![More work needed](${assetsPath.replaceAll(" ", "%20")}/${cleanedPath}.${p2})`;
            }
        );
    }

    // Convert to Obsidian's wikilink format and replace paths
    if (imageFormat === "![[imagePath]]") {
        this.content = this.content.replaceAll(
            /!\[More work needed\]\(${assetsPath}\/images\/(.*?)\.(jpg|jpeg|png)\)/g,
            (match, p1, p2) => {
                const cleanedPath = p1.replace(/.*\/\.\.\//, '');
                return `![[${assetsPath}/${cleanedPath}.${p2}]]`;
            }
        );
    }
}

	parseFontNote() {
		// example: [[2]](ab0c_defg.html#hi_j0kl) -> [^2]
		this.content = this.content.replace(/([^!])\[\[(\d+)\]\]\(.*?\)/g, "$1[^$2]");

		// example: [2](ab0c_defg.html#hi_j0kl) -> [^2]
		this.content = this.content.replace(/([^!])\[(\d+)\]\(.*?\)/g, "$1[^$2]");

		// example: [^2]something is good.00264qed你说对吧 -> [^2]: something is good.00264qed你说对吧
		// and, the string is from the begging of the line
		this.content = this.content.replace(/^(\[\^\d+\])(.*?)$/gm, "$1: $2");
	}

	parseInnerLink() {
		this.content = this.content.replaceAll(
			/([^!])\[\s*([^\]]*?)\s*\]\(\s*([^)]*?)\s*\)/g,
			"$1[[$3\\|$2]]"
		);
	}

	parseHttpLink() {
		this.content = this.content.replaceAll(
			/\[\[(https:\/\/[^\]|]*?)(?:\|([^\]]*?))?]]/g,
			"[$2]($1)"
		);
	}

	applyUserRegexes(userRegexes: RegexPattern[]) {
		for (const userRegex of userRegexes) {
			this.content = this.content.replaceAll(new RegExp(userRegex.pattern, "g"), userRegex.replacement);
		}
	}
}
