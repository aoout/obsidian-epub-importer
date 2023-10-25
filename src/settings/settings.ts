export interface EpubImporterSettings {
    tag:string,
    libratys:string[],
    savePath:string,
    serialNumber:boolean,
    propertysTemplate:string,
    granularity: number
    autoOpenRightPanel:boolean,
    allbooks:boolean
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tag: "book",
	libratys: [],
	savePath: "",
	serialNumber: false,
	propertysTemplate: "",
	granularity: 4,
	autoOpenRightPanel: false,
	allbooks:false
};