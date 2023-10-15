export interface EpubImporterSettings {
    tags:string[],
    libratys:string[]
    autoOpenRightPanel:boolean
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tags: ["book"],
	libratys: [],
	autoOpenRightPanel: false
};