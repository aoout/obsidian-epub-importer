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
    },// 新增规则：处理ruby标签
    ruby: {
      filter: "ruby",
      replacement: (content, node) => {
        // 获取基础文本（不包括rt标签）
        const baseText = Array.from(node.childNodes)
          .filter(child => 
            child.nodeType === Node.TEXT_NODE || 
            (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() !== "rt")
          )
          .map(child => {
            if (child.nodeType === Node.TEXT_NODE) {
              return child.textContent || "";
            } else {
              // 对于非rt元素节点，递归获取其文本内容
              return (child as Element).textContent || "";
            }
          })
          .join("");
        
        // 获取注音文本
        const rtElement = node.querySelector("rt");
        const rubyText = rtElement ? rtElement.textContent || "" : "";
        
        // 转换为 {漢字|かんじ} 格式
        return `{${baseText}|${rubyText}}`;
      }
    },
    // 新增规则：处理rt标签（使其不产生任何输出）
    rt: {
      filter: "rt",
      replacement: () => ""
    }
  };

  Object.entries(rules).forEach(([key, rule]) => turndown.addRule(key, rule));
  return turndown;
};