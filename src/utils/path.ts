export function convertToValidFilename(string) {
	return string.replace(/[/|\\:*?"<>]/g, "");
}

export class Path {
	// the robustness of this class is very low, use it with caution.
	data: string[];
	sep: string;

	constructor(...paths: string[]) {
		// sep will be determined by the first parameter.
		// example: const p = new Path("/", path1, path2);
		if (paths.length > 1) {
			const result = new Path(Path.join(...paths));
			this.data = result.data;
			this.sep = result.sep;
		} else {
			const path = paths[0];
			let sep = "/";
			if (path.includes("\\")) sep = "\\";
			if (path.includes("/")) sep = "/";
			if (path === sep || path === "") {
				this.data = [];
			} else {
				this.data = path.split(sep).filter((d) => d != "");
			}
			this.sep = sep;
		}
	}
	getParent(level = 1): Path {
		return new Path(this.data.slice(0, -level).join(this.sep));
	}
	join(...paths: string[]) {
		const result = new Path(this.data.join(this.sep));
		paths.forEach((path) => {
			result.data.push(...new Path(path).data);
		});
		return result;
	}
	static join(...paths: string[]): string {
		const result = new Path(paths[0]);
		return result.join(...paths.slice(1)).string;
	}
	withName(name: string) {
		return this.getParent().join(name);
	}
	withStem(stem: string) {
		// example1: usihso.epub -> newname.epub
		// example2: usihso.epub.text.zip -> newname.zip
		// example3: usihso -> newname

		return this.getParent().join(stem + "." + this.suffix);
	}
	withSuffix(suffix: string, includeingDot = false) {
		// If you are sure that filename has no suffix, please do not use this method, but directly + ".ext".
		if (!includeingDot) {
			return this.getParent().join(this.stem + "." + suffix);
		} else {
			return this.getParent().join(this.name + "." + suffix);
		}
	}
	get length(): number {
		return this.data.length;
	}
	get parent(): Path {
		return this.getParent();
	}
	get name(): string {
		return this.data[this.data.length - 1];
	}
	get stem(): string {
		// example1: usihso.epub -> usihso
		// example2: usihso.epub.text.zip -> usihso.epub.text
		// example3: usihso -> usihso
		const result = this.name.split(".");
		if (result.length > 1) {
			result.pop();
		}
		return result.join(".");
	}
	get suffix(): string {
		// example1: usihso.epub -> epub
		// example2: usihso.epub.text.zip -> zip
		// example3: usihso -> ""

		const result = this.name.split(".");
		if (result.length > 1) {
			return result.pop();
		}
		return "";
	}
	get string(): string {
		const firstOne = this.data[0];
		const result = this.data.map(convertToValidFilename);
		if (firstOne.length == 2 && firstOne[1] == ":") {
			result[0] = result[0] + ":";
		}
		return result.join(this.sep);
	}
}
