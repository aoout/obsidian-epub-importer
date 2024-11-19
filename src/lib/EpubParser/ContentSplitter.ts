import jetpack from "fs-jetpack";
import * as path from "path";
import { Section } from "./types";

export class ContentSplitter {
    private sections: Section[];

    constructor(sections: Section[]) {
        this.sections = sections;
    }

    async extractSectionContent() {
        const urls = [...new Set(this.sections.map((st) => st.urlPath))];
        const files = await this.readHtmlFiles(urls);

        files.forEach((file) => {
            if (!file.hrefs.length || file.hrefs.length === 1) {
                this.sections.find((st) => st.urlPath == file.url).html = file.html;
            } else {
                this.splitContentByAnchors(file);
            }
        });
    }

    private async readHtmlFiles(urls: string[]) {
        const files = [];
        urls.forEach((url) => {
            const file = this.buildFileMetadata(url);
            try {
                const html = jetpack.read(url);
                if (html) {
                    file.html = html;
                }
                files.push(file);
            } catch (error) {
                this.logFileReadError(url);
            }
        });
        return files;
    }

    private buildFileMetadata(url: string) {
        const file = {
            url: url,
            names: [],
            hrefs: [],
            html: "",
        };

        this.sections
            .filter((st) => st.urlPath == url)
            .forEach((st) => {
                file.names.push(st.name ? path.basename(st.name) : null);
                file.hrefs.push(st.urlHref);
            });

        return file;
    }

    private logFileReadError(url: string) {
        console.warn(`Error reading file at ${url}`);
        console.warn(
            "The failure to read the file might be due to an invalid file path. If such errors are few in this parsing process, it could be because the epub contains some meaningless navPoints, or even advertisements. If this is the case, it will not cause any damage to the content of the book."
        );
    }

    private splitContentByAnchors(file) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(file.html, "text/html");
        const htmls: string[] = [];
        let currentHtml = "";
        let currentNode = doc.body.firstChild;

        while (currentNode) {
            if (currentNode.nodeType === Node.ELEMENT_NODE) {
                const element = currentNode as Element;
                const id = element.getAttribute("id");
                
                if (id && file.hrefs.includes(id)) {
                    if (currentHtml) {
                        htmls.push(currentHtml);
                        currentHtml = "";
                    }
                }
            }
            
            currentHtml += (currentNode as Element).outerHTML || currentNode.textContent;
            currentNode = currentNode.nextSibling;
        }

        if (currentHtml) {
            htmls.push(currentHtml);
        }

        if (file.hrefs[0] != "") {
            htmls.shift();
        }

        const hrefs = file.hrefs.map((href) => (href ? "#" + href : ""));
        this.distributeHtmlToSections(file, htmls, hrefs);
    }

    private distributeHtmlToSections(file, htmls: string[], hrefs: string[]) {
        htmls.forEach((html, i) => {
            try {
                this.sections.find((c) => c.url == file.url + hrefs[i]).html = html;
            } catch (e) {
                console.warn("Error splitting HTML file into sections");
            }
        });
    }
} 