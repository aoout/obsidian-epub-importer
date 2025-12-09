import path from "path";
import { Section } from "./types";
import jetpack from "fs-jetpack";

export class HtmlFile {
  constructor(public url: string, public sections: Section[]) {
    this.url = url;
    this.sections = sections;
  }

  public getNames (): (string | null)[]  {
    return this.sections.map(s => s.name && path.basename(s.name));
  }

  public getHrefs (): string[]  {
    return this.sections.map(s => s.urlHref);
  }

  public async getHtml (): Promise<string>  {
    try{
        return (await jetpack.readAsync(this.url)) ?? ""
    }catch(error){
        console.warn(`Error reading file at ${this.url}\nThis might be due to invalid paths or minor epub navigation issues. Such errors typically don't affect the book's content.`);
        return ""
    }
  }
}