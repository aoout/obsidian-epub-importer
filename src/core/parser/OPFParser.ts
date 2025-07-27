import * as path from "path";
import { findProperty } from "./utils";

export class OPFParser {
  constructor(private filePath: string, private content: any) {}

  private getBasePath = (href: string) => path.posix.join(path.dirname(this.filePath), href);

  getHtmlFiles(): string[] {
    const items = findProperty(this.content, "manifest")?.[0]?.item ?? [];
    return items
      .filter((item: any) => /\.(htm|html|xhtml)$/i.test(item.$.href))
      .map((item: any) => this.getBasePath(item.$.href));
  }

  getCoverPath(): string | null {
    const items = findProperty(this.content, "manifest")?.[0]?.item ?? [];
    const cover = items.find((item: any) => 
      /cover/i.test(item.$.id) && 
      /\.(png|jpe?g)$/i.test(item.$.href)
    );
    return cover ? this.getBasePath(cover.$.href) : null;
  }

  getMeta(): Record<string, string> {
    const meta = findProperty(this.content, "metadata")?.[0] ?? {};

    return {
      title: meta["dc:title"]?.[0] ?? "",
      publisher: meta["dc:publisher"]?.[0] ?? "",
      language: meta["dc:language"]?.[0] ?? "",
      author: meta["dc:creator"]?.[0]?.["_"] ?? ""
    };
  }
}