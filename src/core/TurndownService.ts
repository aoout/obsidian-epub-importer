/* eslint-disable @typescript-eslint/no-unused-vars */
import TurndownService from "turndown";
import * as path from "path";

export const create = (assetsPath: string, imageFormat: string): TurndownService => {
  const turndown = new TurndownService({ headingStyle: "atx" }).remove("title");

  const rules = {
    img: {
      filter: "img",
      replacement: (_, node) => {
        const alt = node.alt || "";
        const src = node.getAttribute("src") || "";
        if (!src.match(/^https?:\/\//)) {
          const fileName = path.basename(src);
          const newPath = path.posix.join(assetsPath, fileName).replaceAll(" ", "%20");
          return imageFormat === "![](imagePath)" ? `![${alt}](${newPath})` : `![[${newPath}]]`;
        }
        return "";
      }
    },
    footnoteLinks: {
      filter: (node) => node.nodeName === "A" && /^\[?\[?\d+\]?\]?$/.test(node.textContent),
      replacement: (_, node) => `[^${node.textContent.replace(/[[\]]/g, "")}]`
    },
    footnoteReferences: {
      filter: (node) => node.nodeName === "P" && node.getElementsByTagName("a")[0]?.textContent.match(/^\[\d+\]/),
      replacement: (content, node) => content.replace(/^(\[\^\d+\])(.*?)$/gm, "$1: $2\n")
    },
    internalLinks: {
      filter: (node) => node.nodeName === "A" && !node.getAttribute("href")?.startsWith("http") && !/^\[?\[?\d+\]?\]?$/.test(node.textContent),
      replacement: (_, node) => {
        const href = node.getAttribute("href");
        return `[[${href}${href === node.textContent ? "" : `|${node.textContent}`}]]`;
      }
    },
    httpLinks: {
      filter: (node) => node.nodeName === "A" && node.getAttribute("href")?.startsWith("http"),
      replacement: (_, node) => `[${node.textContent}](${node.getAttribute("href")})`
    }
  };

  Object.entries(rules).forEach(([key, rule]) => turndown.addRule(key, rule));
  return turndown;
};