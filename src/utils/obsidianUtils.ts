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

export function tFrontmatter(propertys: unknown) {
	return "---\n" + stringifyYaml(propertys) + "\n---";
}

export function templateWithVariables(template: string, variables: object) {
	return Object.keys(variables).reduce(
		(template, key) => template.replaceAll(`{{${key}}}`, variables[key]),
		template
	);
}