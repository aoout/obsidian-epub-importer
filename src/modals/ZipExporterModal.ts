import { App } from "obsidian";
import { BaseInputModal } from "../utils/BaseInputModal";
import { getNotesWithTag } from "../utils/obsidianUtils";

export class ZipExporterModal extends BaseInputModal {
	app: App;
	tag: string;
	libraries: string[];

	constructor(app: App, tag: string, onSubmit: (result: string) => void) {
		super(app, onSubmit, true);
		this.app = app;
		this.tag = tag;
		this.listenForEnter(this.validatePath);
	}

	validatePath(path: string): boolean {
		return true;
	}

	getSuggestions(query: string): string[] | Promise<string[]> {
		const bookNotes = getNotesWithTag(this.app, this.tag);
		const result = bookNotes.map((bookNote) => bookNote.basename);
		return result.filter((bookName) => bookName.includes(query));
	}

	renderSuggestion(value: string, el: HTMLElement) {
		el.createEl("div", { text: value });
	}

	onChooseSuggestion(item: string) {
		this.trySubmit(item, this.validatePath);
	}
}
