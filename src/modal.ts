import { App, Notice, SuggestModal } from "obsidian";

function toValidEpubPath(string: string) {
	try {
		// if there is " char at the beginning ,try to delete the " chat at the beginning and end
		if (string.startsWith('"')) {
			string = string.slice(1, string.length - 1);
		}
		const terms = string.split(".");
		if (terms[terms.length - 1] == "epub") {
			return string;
		} else {
			return false;
		}
	} catch (e) {
		return false;
	}
}

export class EpubModal extends SuggestModal<void> {
	onSubmit: (result: string) => void;

	getSuggestions(query: string): void[] | Promise<void[]> {
		return [];
	}
	renderSuggestion(value: void, el: HTMLElement) {}
	onChooseSuggestion(item: void, evt: MouseEvent | KeyboardEvent) {}

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);

		this.onSubmit = onSubmit;
		this.inputEl.addEventListener("keyup", ({ key }) => {
			if (key === "Enter" && this.inputEl.value) {
				const epubPath = toValidEpubPath(this.inputEl.value);
				if (epubPath) {
					this.onSubmit(epubPath);
					new Notice(`imported: ${epubPath}`);
					this.close();
				} else {
					new Notice("Invalid path.");
				}
			}
		});
		this.modalEl.removeChild(this.modalEl.childNodes[1]);
	}
}
