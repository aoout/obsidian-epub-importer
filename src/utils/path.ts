export class Path{
	data: string[];
	sep: string;

	constructor(...paths:string[]){
		if(paths.length>1){
			const result = new Path(Path.join(...paths));
			this.data = result.data;
			this.sep = result.sep;
		}else{
			const path = paths[0];
			let sep = "/";
			if (path.includes("\\")) sep = "\\";
			if (path.includes("/")) sep = "/";
			this.data = path == sep?[]: path.split(sep);
			this.sep = sep;
		}
	}
	getParent(level=1):Path{
		return new Path(this.data.slice(0,-level).join(this.sep));
	}
	join(...paths:string[]){
		const result = new Path(this.data.join(this.sep));
		paths.forEach((path)=>{
			result.data.push(...new Path(path).data);
		});
		return result;
	}
	static join(...paths:string[]):string{
		const result = new Path(paths[0]);
		return result.join(...paths.slice(1)).string;
	}
	withName(name:string){
		return this.getParent().join(name);
	}
	withStem(stem:string){
		return this.getParent().join(stem+"."+this.suffix);
	}
	withSuffix(suffix:string){
		return this.getParent().join(this.stem+"."+suffix);
	}
	get length():number{
		return this.data.length;
	}
	get parent():Path{
		return this.getParent();
	}
	get name():string{
		return this.data[this.data.length-1];
	}
	get stem():string{
		return this.name.split(".")[0];
	}
	get suffix():string{
		return this.name.split(".").slice(-1)[0];
	}
	get string():string{
		return this.data.join(this.sep);
	}
}