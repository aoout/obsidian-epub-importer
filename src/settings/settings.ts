export interface EpubImporterSettings {
	tag: string;
	librarys: string[];
	savePath: string;
	assetsPath: string;
	serialNumber: boolean;
	serialNumberDelta: number;
	propertysTemplate: string;
	granularity: number;
	imageFormat: string;
	autoOpenRightPanel: boolean;
	allbooks: boolean;
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tag: "book",
	librarys: [],
	savePath: "",
	assetsPath: "{{savePath}}/{{bookName}}/images",
	serialNumber: false,
	serialNumberDelta: 0,
	propertysTemplate:
		"title: {{bookName}}\nauthor: {{author}}\npublisher: {{publisher}}\nstatus: false",
	granularity: 4,
	imageFormat: "![](imagePath)",
	autoOpenRightPanel: false,
	allbooks: false,
};
