import { App, TFile, stringifyYaml } from "obsidian";

export function getNotesWithTag(app: App, tag: string): TFile[] {
	const files = app.vault.getMarkdownFiles();
	const files_with_tag = [] as TFile[];
	files.forEach((file) => {
		const tags = app.metadataCache.getFileCache(file)?.frontmatter?.tags;
		if (!tags) return;
		if (tags.includes(tag)) {
			files_with_tag.push(file);
		}
	});
	return files_with_tag;
}

export function tFrontmatter(propertys: any) {
	return "---\n" + stringifyYaml(propertys) + "\n---";
}
