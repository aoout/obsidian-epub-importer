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
    const uniqueUrls = [...new Set(this.sections.map(st => st.urlPath))];
    const files = await Promise.all(uniqueUrls.map(url => this.readHtmlFile(url)));

    files.forEach(file => 
      file.hrefs.length <= 1
        ? this.assignHtml(file.url, file.html)
        : this.splitContentByAnchors(file)
    );
  }

  private async readHtmlFile(url: string): Promise<FileMetadata> {
    const file = this.buildFileMetadata(url);
    try {
      const html = await jetpack.readAsync(url);
      return { ...file, html: html ?? "" };
    } catch (error) {
      this.logFileReadError(url);
      return file;
    }
  }

  private buildFileMetadata(url: string): FileMetadata {
    const relevantSections = this.sections.filter(st => st.urlPath === url);
    return {
      url,
      names: relevantSections.map(st => st.name ? path.basename(st.name) : null),
      hrefs: relevantSections.map(st => st.urlHref),
      html: ""
    };
  }

  private logFileReadError(url: string) {
    console.warn(
      `Error reading file at ${url}\n` +
      "This might be due to invalid paths or minor epub navigation issues. " +
      "Such errors typically don't affect the book's content."
    );
  }

  private splitContentByAnchors(file: FileMetadata) {
    const doc = new DOMParser().parseFromString(file.html, "text/html");
    const htmls: string[] = [];
    let currentHtml = "";

    const serializeNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      const attrs = Array.from(el.attributes)
        .map(attr => ` ${attr.name}="${attr.value}"`)
        .join("");
      
      const children = Array.from(node.childNodes)
        .map(serializeNode)
        .join("");
      
      return `<${tag}${attrs}>${children}</${tag}>`;
    };

    Array.from(doc.body.childNodes).reduce((anchorIndex, node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const id = (node as Element).getAttribute("id");
        if (id && file.hrefs.includes(id)) {
          if (currentHtml) htmls.push(currentHtml);
          currentHtml = "";
          anchorIndex = file.hrefs.indexOf(id);
        }
      }
      currentHtml += serializeNode(node);
      return anchorIndex;
    }, -1);

    if (currentHtml) htmls.push(currentHtml);
    this.distributeHtml(file, htmls);
  }

  private distributeHtml(file: FileMetadata, htmls: string[]) {
    const hrefs = file.hrefs.map(href => href ? `#${href}` : "");
    htmls.forEach((html, i) => {
      const section = this.sections.find(s => s.url === file.url + hrefs[i]);
      if (section) section.html = html;
      else console.warn(`No section found for ${file.url}${hrefs[i]}`);
    });

    if (htmls.length !== file.hrefs.length) {
      file.hrefs.forEach((href, i) => {
        if (!htmls[i]) console.warn(`Anchor ${href} (index ${i}) not found`);
      });
    }
  }

  private assignHtml(url: string, html: string) {
    const section = this.sections.find(st => st.urlPath === url);
    if (section) section.html = html;
  }
}