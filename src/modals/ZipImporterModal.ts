import jetpack from "fs-jetpack";
import { App } from "obsidian";
import { BaseInputModal } from "../utils/BaseInputModal";

export class ZipImporterModal extends BaseInputModal {
	backupPath: string;

	constructor(app: App, backupPath: string, onSubmit: (result: string) => void) {
		super(app, onSubmit, true);
		this.backupPath = backupPath;
		this.listenForEnter(this.validatePath);
	}

	validatePath(path: string): boolean {
		return true;
	}

	getSuggestions(query: string): string[] | Promise<string[]> {
		console.log(this.backupPath);
		const result = jetpack.find(this.backupPath, { matching: "**/*.zip" });
		return result.filter((path) => path.includes(query));
	}

	renderSuggestion(value: string, el: HTMLElement) {
		el.createEl("div", { text: value });
	}

	onChooseSuggestion(item: string) {
		this.trySubmit(item, this.validatePath);
	}
}
