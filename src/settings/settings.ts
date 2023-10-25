export interface EpubImporterSettings {
    tag:string,
    libratys:string[],
    savePath:string,
    serialNumber:boolean,
    propertysTemplate:string,
    autoOpenRightPanel:boolean,
    allbooks:boolean
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tag: "book",
	libratys: [],
	savePath: "",
	serialNumber: false,
	propertysTemplate: "",
	autoOpenRightPanel: false,
	allbooks:false
};