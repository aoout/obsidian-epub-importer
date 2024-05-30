import { EventEmitter } from "events";
import * as path from "path";

export default class Path extends EventEmitter {
	private path: string;
	private replacement: string;

	constructor(pathStr: string, replacement = "") {
		super();
		this.path = this.normalizePath(pathStr);
		this.replacement = replacement;
	}
  
	private normalizePath(pathStr: string): string {
		const normalizedPath = pathStr
			.replace(new RegExp("[\\/]", "g"), path.sep)
			.replace(/(?<!^[a-zA-Z]):|[|*?"<>]/g, (match) => {
				this.emit("normalized", `Replacing "${match}" with "${this.replacement}"`);
				return this.replacement;
			});
		return normalizedPath;
	}
	
	join(...subPaths: string[]): Path {
		subPaths = subPaths.map(subPath => this.normalizePath(subPath));
		this.path = path.join(this.path, ...subPaths);
		return this;
	}
  
	parent(): Path {
		const parts = this.path.split(path.sep);
		parts.pop();
		this.path = parts.join(path.sep);
		return this;
	}
  
	name(): string {
		return path.basename(this.path);
	}
  
	ext(): string {
		return path.extname(this.path).slice(1);
	}
  
	stem(): string {
		const name = this.name();
		const ext = this.ext();
		return name.slice(0, name.length - (ext.length + 1));
	}
  
	static getName(pathStr: string) {
		return new Path(pathStr).name();
	}
  
	static getExt(pathStr: string) {
		return new Path(pathStr).ext();
	}
  
	static getStem(pathStr: string) {
		return new Path(pathStr).stem();
	}
  
	static hasSlash(pathStr: string): boolean {
		return pathStr.includes(path.posix.sep) || pathStr.includes(path.win32.sep);
	}
  
	withname(name: string): Path {
		if (Path.hasSlash(name)) {
			name = Path.getName(name);
		}
		const ext = this.ext();
		this.path = path.join(this.parent().toString(), `${name}.${ext}`);
		return this;
	}
  
	withext(ext: string): Path {
		if (Path.hasSlash(ext)) {
			ext = Path.getExt(ext);
		}
		const stem = this.stem();
		this.path = path.join(this.parent().toString(), `${stem}.${ext}`);
		return this;
	}
  
	withstem(stem: string): Path {
		if (Path.hasSlash(stem)) {
			stem = Path.getStem(stem);
		}
		const ext = this.ext();
		this.path = path.join(this.parent().toString(), `${stem}.${ext}`);
		return this;
	}
  
	static fromList(...pathList: string[]): Path {
		return new Path(pathList.join(path.sep));
	}

	static join(...pathList: string[]): string {
		return path.join(...pathList);
	}

	clone(): Path {
		const newPath = new Path(this.path);
		return newPath;
	}
  
	toString(): string {
		return this.path;
	}
}