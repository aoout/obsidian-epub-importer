/* eslint-disable @typescript-eslint/no-unused-vars */
export class NoteParser {
	content: string;
	epubName: string;
	static getParseredNote(originNote: string, epubName: string,assetsPath:string) {
		const parser = new NoteParser(originNote, epubName);
		parser.parseImagePath(assetsPath);
		parser.parseFontNote();
		return parser.content;
	}

	constructor(originNote: string, epubName: string) {
		this.content = originNote;
		this.epubName = epubName;
	}

	parseImagePath(assetsPath:string) {
		// TODO: Avoid accidentally damaging the text content
		this.content = this.content
			.replace(/Images/g, "images")
			.replace(/\.\.\/images/g, "images")
			.replace(/Image/g, "images/Image")
			.replace(/images/g, assetsPath);

	}

	parseFontNote() {
		// example: [[2]](ab0c_defg.html#hi_j0kl) -> [^2]
		this.content = this.content.replace(/\[\[(\d+)\]\]\(.*\)/g, "[^$1]");

		// example: [2](ab0c_defg.html#hi_j0kl) -> [^2]
		this.content = this.content.replace(/\[(\d+)\]\(.*\)/g, "[^$1]");

		// example: [^2]something is good.00264qed你说对吧 -> [^2]: something is good.00264qed你说对吧
		// and, the string is from the begging of the line
		this.content = this.content.replace(/^(\[\^\d+\])(.*)$/gm, "$1: $2");
	}
}