import TurndownService from "turndown";
import * as path from "path";

export function create(assetsPath: string, imageFormat: string): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: 'atx'
  });

  turndownService.remove("title")

  turndownService.addRule("img", {
    filter: 'img',
    replacement: function (content, node) {
      const alt = node.alt || '';
      const src = node.getAttribute('src') || '';
      if(!src.startsWith("http://") && !src.startsWith("https://")){
        const fileName = path.basename(src);
        const newPath = path.posix.join(assetsPath, fileName);
        if(imageFormat === "![](imagePath)"){
          return `![${alt}](${newPath.replaceAll(" ", "%20")})`;
        }else if(imageFormat === "![[imagePath]]"){
          return `![[${newPath}]]`;
        }
      }
      return content;  
    }
  });

  turndownService.addRule('footnoteLinks', {
    filter: (node) => {
      if (node.nodeName === 'A') {
        const text = node.textContent;
        return /^\[?\[?\d+\]?\]?$/.test(text);
      }
      return false;
    },
    replacement: (content, node) => {
      const number = node.textContent.replace(/[\[\]]/g, '');
      return `[^${number}]`;
    }
  });

  turndownService.addRule('footnoteReferences', {
    filter: (node) => {
      if (node.nodeName === 'P') {
        const aElements = node.getElementsByTagName('a');
        if (aElements.length > 0) {
          const text = aElements[0].textContent;
          console.log(text);
          return /^\[\d+\]/.test(text);
        }
      }
      return false;
    },
    replacement: (content, node) => {
      return content.replace(/^(\[\^\d+\])(.*?)$/gm, '$1: $2\n');
    }
  });

  turndownService.addRule('internalLinks', {
    filter: (node, options) => {
      return (
        node.nodeName === 'A' && 
        !node.getAttribute('href')?.startsWith('http') &&
        !/^\[?\[?\d+\]?\]?$/.test(node.textContent)
      );
    },
    replacement: (content, node) => {
      const href = node.getAttribute('href');
      const text = node.textContent;
      if (href === text) {
        return `[[${href}]]`;
      }
      return `[[${href}|${text}]]`;
    }
  });

  turndownService.addRule('httpLinks', {
    filter: (node, options) => {
      return (
        node.nodeName === 'A' &&
        node.getAttribute('href')?.startsWith('http')
      );
    },
    replacement: (content, node) => {
      const href = node.getAttribute('href');
      const text = node.textContent;
      return `[${text}](${href})`;
    }
  });

  return turndownService;
}