import { App } from "obsidian";
import jetpack from "fs-jetpack";
import { BaseInputModal } from "./utils/BaseInputModal";

export class EpubImporterModal extends BaseInputModal {
	libraries: string[];

	constructor(app: App, libraries: string[], onSubmit: (result: string) => void) {
		super(app, onSubmit, true);
		this.libraries = libraries;
		this.listenForEnter(this.validatePath);
	}

	validatePath(path: string): boolean {
		return jetpack.exists(path) === "file" && path.endsWith(".epub");
	}

	getSuggestions(query: string): string[] | Promise<string[]> {
		const result: string[] = [];
		this.libraries.forEach((lib) => {
			jetpack.find(lib, { matching: "**/*.epub" }).forEach((path) => {
				result.push(jetpack.path(path));
			});
		});
		return result.filter((path) => path.includes(query));
	}

	renderSuggestion(value: string, el: HTMLElement) {
		el.createEl("div", { text: value });
	}

	onChooseSuggestion(item: string) {
		this.trySubmit(item, this.validatePath);
	}
}
