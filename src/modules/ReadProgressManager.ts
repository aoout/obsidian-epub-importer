import { App, MarkdownView } from "obsidian";

interface EphemeralState {
	scroll?: number;
	timestamp?: number;
}

type scrollPositionDB = { [filePath: string]: EphemeralState };

export class ReadProgressManager {
	private app: App;
	private db: scrollPositionDB = {};
	private dbFileName = ".obsidian/plugins/epub-importer/progress.json";
	private delayAfterFileOpening = 30;
	private lastSavedDb: scrollPositionDB = {};

	constructor(app: App) {
		this.app = app;
	}

	async initialize(): Promise<void> {
		await this.loadDatabase();
	}

	getCurrentState(): EphemeralState | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;

		const state: EphemeralState = {};
		const scroll = view.currentMode?.getScroll();
		if (typeof scroll === "number" && !isNaN(scroll)) {
			state.scroll = Number(scroll.toFixed(4));
		}

		return state;
	}

	getNoteState(filePath: string): EphemeralState | null {
		return this.db[filePath] || null;
	}

	setState(filePath: string, state: EphemeralState): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== filePath) return;

		if (state.scroll) {
			view.setEphemeralState(state);
		}
	}

	saveState(filePath: string, state: EphemeralState): void {
		state.timestamp = Date.now();
		this.db[filePath] = state;
	}

	async restoreState(filePath: string): Promise<void> {
		const state = this.db[filePath];
		if (!state) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== filePath) return;

		await this.delay(this.delayAfterFileOpening);
		this.setState(filePath, state);
	}

	renameFile(oldPath: string, newPath: string): void {
		if (this.db[oldPath]) {
			this.db[newPath] = this.db[oldPath];
			delete this.db[oldPath];
		}
	}

	deleteFile(filePath: string): void {
		delete this.db[filePath];
	}

	async loadDatabase(): Promise<void> {
		try {
			if (await this.app.vault.adapter.exists(this.dbFileName)) {
				const data = await this.app.vault.adapter.read(this.dbFileName);
				this.db = JSON.parse(data);
				this.lastSavedDb = JSON.parse(data);
			}
		} catch (e) {
			console.error("Failed to load read progress database:", e);
			this.db = {};
			this.lastSavedDb = {};
		}
	}

	async saveDatabase(): Promise<void> {
		try {
			const parentFolder = this.dbFileName.substring(0, this.dbFileName.lastIndexOf("/"));
			if (!(await this.app.vault.adapter.exists(parentFolder))) {
				await this.app.vault.adapter.mkdir(parentFolder);
			}
			if (JSON.stringify(this.db) !== JSON.stringify(this.lastSavedDb)) {
				await this.app.vault.adapter.write(this.dbFileName, JSON.stringify(this.db));
				this.lastSavedDb = { ...this.db };
			}
		} catch (e) {
			console.error("Failed to save read progress database:", e);
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
