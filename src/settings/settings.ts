export interface EpubImporterSettings {
	tag: string;
	libraries: string[];
	byDrag: boolean;
	syncImportConcurrency: number;
	savePath: string;
	assetsPath: string;
	backupPath: string;
	granularity: number;
	mocName: string;
	noteTemplate: string;
	mocPropertysTemplate: string;
	imageFormat: string;
	reformatting: boolean;
	autoOpenRightPanel: boolean;
	removeDuplicateFolders: boolean;
	moreLog: boolean;
	leafID: string;
	enableReadProgressManager: boolean;
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tag: "book",
	libraries: [],
	byDrag: false,
	syncImportConcurrency: 3,
	savePath: "",
	assetsPath: "{{savePath}}/{{bookName}}/images",
	backupPath: "",
	granularity: 4,
	mocName: "{{bookName}}",
	noteTemplate: "{{content}}",
	mocPropertysTemplate:
		"title: {{bookName}}\nauthor: {{author}}\npublisher: {{publisher}}\nstatus: false",
	imageFormat: "![](imagePath)",
	reformatting: false,
	autoOpenRightPanel: false,
	removeDuplicateFolders: false,
	moreLog: false,
	leafID: "",
	enableReadProgressManager: false
};
