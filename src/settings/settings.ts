export interface RegexPattern {
	timestamp: number;
	pattern: string;
	replacement: string;
}

export interface EpubImporterSettings {
	tag: string;
	libraries: string[];
	byDrag: boolean;
	savePath: string;
	assetsPath: string;
	backupPath: string;
	granularity: number;
	mocName: string;
	notePropertysTemplate: string;
	oneNote: boolean;
	oneFolder: boolean;
	mocPropertysTemplate: string;
	imageFormat: string;
	reformatting: boolean;
	autoOpenRightPanel: boolean;
	removeDuplicateFolders: boolean;
	moreLog: boolean;
	leafID: string;
	booknavIntegration: boolean;
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tag: "book",
	libraries: [],
	byDrag: false,
	savePath: "",
	assetsPath: "{{savePath}}/{{bookName}}/images",
	backupPath: "",
	granularity: 4,
	mocName: "{{bookName}}",
	notePropertysTemplate: "",
	oneNote: false,
	oneFolder: true,
	mocPropertysTemplate:
		"title: {{bookName}}\nauthor: {{author}}\npublisher: {{publisher}}\nstatus: false",
	imageFormat: "![](imagePath)",
	reformatting: false,
	autoOpenRightPanel: false,
	removeDuplicateFolders: false,
	moreLog: false,
	leafID: "",
	booknavIntegration: false
};
