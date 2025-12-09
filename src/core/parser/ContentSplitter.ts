import { Section } from "./types";
import { HtmlFile } from "./HtmlFile";
import { serializeNode } from "./utils";

export class ContentSplitter {
  constructor(private sections: Section[]) {}

  async extractSectionContent() {
    const urlPaths = [...new Set(this.sections.map(s => s.urlPath))];
    await Promise.all(urlPaths.map(async url => {
      const file = new HtmlFile(url, this.sections.filter(s => s.urlPath === url));
      return file.getHrefs().length <= 1 
        ? this.assignHtml(file.url, await file.getHtml())
        : this.splitContentByAnchors(file);
    }));
  }

  private async splitContentByAnchors(file: HtmlFile) {
    const doc = new DOMParser().parseFromString(await file.getHtml(), "text/html");
    const htmls = this.splitHtmlByAnchors(doc.body.childNodes, file.getHrefs());
    this.distributeHtml(file, htmls);
  }

  private splitHtmlByAnchors(nodes: NodeListOf<ChildNode>, hrefs: string[]): string[] {
    const htmls: string[] = [];
    let currentHtml = "";
  
    nodes.forEach(node => {
      if (this.isAnchorNode(node, hrefs) && currentHtml && serializeNode(node) != "\n") {
        htmls.push(currentHtml);
        currentHtml = serializeNode(node);
      } else if(serializeNode(node) != "\n") {
        currentHtml += serializeNode(node);
      }
    });
  
    if (currentHtml) htmls.push(currentHtml);
    return htmls;
  }
  
  private isAnchorNode(node: Node, hrefs: string[]): boolean {
    return node.nodeType === Node.ELEMENT_NODE && 
      Boolean(hrefs.includes((node as Element).getAttribute("id")));
  }
  
  private distributeHtml(file: HtmlFile, htmls: string[]) {
    const hrefs = file.getHrefs().map(h => h ? `#${h}` : "");
    htmls.forEach((html, i) => {
      const section = this.sections.find(s => s.url === file.url + hrefs[i]);
      if (section) section.html = html;
      else console.warn(`No section found for ${file.url}${hrefs[i]}`);
    });

    if (htmls.length !== file.getHrefs().length) {
      file.getHrefs().forEach((href, i) => htmls[i] || console.warn(`Anchor ${href} (index ${i}) not found`));
    }
  }

  private assignHtml(url: string, html: string) {
    const section = this.sections.find(s => s.urlPath === url);
    if (section) section.html = html;
  }
}
