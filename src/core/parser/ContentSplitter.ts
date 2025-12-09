import jetpack from "fs-jetpack";
import * as path from "path";
import { Section } from "./types";

interface FileMetadata {
  url: string;
  names: (string | null)[];
  hrefs: string[];
  html: string;
}

export class ContentSplitter {
  constructor(private sections: Section[]) {}

  async extractSectionContent() {
    const uniqueUrls = [...new Set(this.sections.map(s => s.urlPath))];
    await Promise.all(uniqueUrls.map(async url => {
      const file = await this.readHtmlFile(url);
      return file.hrefs.length <= 1 
        ? this.assignHtml(file.url, file.html)
        : this.splitContentByAnchors(file);
    }));
  }

  private async readHtmlFile(url: string): Promise<FileMetadata> {
    const file = this.buildFileMetadata(url);
    try {
      return { ...file, html: (await jetpack.readAsync(url)) ?? "" };
    } catch (error) {
      this.logFileReadError(url);
      return file;
    }
  }

  private buildFileMetadata(url: string): FileMetadata {
    const relevantSections = this.sections.filter(s => s.urlPath === url);
    return {
      url,
      names: relevantSections.map(s => s.name && path.basename(s.name)),
      hrefs: relevantSections.map(s => s.urlHref),
      html: ""
    };
  }

  private logFileReadError(url: string) {
    console.warn(`Error reading file at ${url}\nThis might be due to invalid paths or minor epub navigation issues. Such errors typically don't affect the book's content.`);
  }

  private splitContentByAnchors(file: FileMetadata) {
    const doc = new DOMParser().parseFromString(file.html, "text/html");
    const htmls = this.splitHtmlByAnchors(doc.body.childNodes, file.hrefs);
    this.distributeHtml(file, htmls);
  }

  private splitHtmlByAnchors(nodes: NodeListOf<ChildNode>, hrefs: string[]): string[] {
    const htmls: string[] = [];
    let currentHtml = "";
  
    nodes.forEach(node => {
      if (this.isAnchorNode(node, hrefs) && currentHtml && this.serializeNode(node) != "\n") {
        htmls.push(currentHtml);
        currentHtml = this.serializeNode(node);
      } else if(this.serializeNode(node) != "\n") {
        currentHtml += this.serializeNode(node);
      }
    });
  
    if (currentHtml) htmls.push(currentHtml);
    return htmls;
  }
  
  private isAnchorNode(node: Node, hrefs: string[]): boolean {
    return node.nodeType === Node.ELEMENT_NODE && 
      Boolean(hrefs.includes((node as Element).getAttribute("id")));
  }
  
  private serializeNode(node: Node): string {
    return node.nodeType === Node.TEXT_NODE 
      ? node.textContent || ""
      : node.nodeType === Node.ELEMENT_NODE
        ? `<${node.nodeName.toLowerCase()}${this.getAttributes(node as Element)}>${Array.from(node.childNodes).map(n => this.serializeNode(n)).join("")}</${node.nodeName.toLowerCase()}>`
        : "";
  }

  private getAttributes(el: Element): string {
    return Array.from(el.attributes)
      .map(attr => ` ${attr.name}="${attr.value}"`)
      .join("");
  }

  private distributeHtml(file: FileMetadata, htmls: string[]) {
    const hrefs = file.hrefs.map(h => h ? `#${h}` : "");
    htmls.forEach((html, i) => {
      const section = this.sections.find(s => s.url === file.url + hrefs[i]);
      if (section) section.html = html;
      else console.warn(`No section found for ${file.url}${hrefs[i]}`);
    });

    if (htmls.length !== file.hrefs.length) {
      file.hrefs.forEach((href, i) => htmls[i] || console.warn(`Anchor ${href} (index ${i}) not found`));
    }
  }

  private assignHtml(url: string, html: string) {
    const section = this.sections.find(s => s.urlPath === url);
    if (section) section.html = html;
  }
}
