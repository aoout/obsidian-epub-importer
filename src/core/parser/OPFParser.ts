import * as path from "path";
import { findProperty } from "./utils";

export class OPFParser {
  constructor(private filePath: string, private content: unknown) {}

  private getBasePath = (href: string) => path.posix.join(path.dirname(this.filePath), href);

  getHtmlFiles(): string[] {
    const items = findProperty(this.content, "manifest")?.[0]?.item ?? [];
    return items
      .filter((item: Record<string, unknown>) => {
        const href = (item.$ as { href: string })?.href;
        return href && /\.(htm|html|xhtml)$/i.test(href);
      })
      .map((item: Record<string, unknown>) => {
        const itemProps = item.$ as { href: string };
        return this.getBasePath(itemProps.href);
      });
  }

  getCoverPath(): string | null {
    const items = findProperty(this.content, "manifest")?.[0]?.item ?? [];
    const cover = items.find((item: Record<string, { id: string; href: string }>) =>
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
      author: (meta["dc:creator"] || [])
        .map((c: { _: string }) => c?._)
        .filter(Boolean)
        .join(", ")
    };
  }
}
