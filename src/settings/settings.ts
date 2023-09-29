export interface EpubImporterSettings {
    tags:string[],
    libratys:string[]
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
    tags: ["book"],
    libratys: []
}