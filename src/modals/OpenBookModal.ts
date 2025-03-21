import { App, SuggestModal, TFile } from "obsidian";

export class OpenBookModal extends SuggestModal<TFile> {
	books: TFile[];
	onSubmit: (result: TFile) => void;
	constructor(app: App, books: TFile[], onSubmit: (result: TFile) => void) {
		super(app);
		this.books = books;
		this.onSubmit = onSubmit;
	}
	getSuggestions(query: string): TFile[] {
		return this.books.filter((book) => book.name.includes(query));
	}
	onChooseSuggestion(item: TFile): void {
		this.onSubmit(item);
	}
	renderSuggestion(value: TFile, el: HTMLElement): void {
		const title = this.app.metadataCache.getFileCache(value)?.frontmatter?.title;
		el.createEl("div", { text: title });
	}
}
