import { App, Notice, SuggestModal } from "obsidian";

function isValidEpubPath(string: string) {
	const terms = string.split(".");
	return terms[terms.length - 1] == "epub";
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
				if (isValidEpubPath(this.inputEl.value)) {
					this.onSubmit(this.inputEl.value);
					new Notice(`imported: ${this.inputEl.value}`);
					this.close();
				} else {
					new Notice("Invalid path.");
				}
			}
		});
		this.modalEl.removeChild(this.modalEl.childNodes[1]);
	}
}
