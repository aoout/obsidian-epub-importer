/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from "path";
import jetpack from "fs-jetpack";
import { Chapter } from "./types";
import { findProperty } from "./utils";

export class NCXParser {
    filePath: string;
    content: any;

    constructor(filePath: string, content: any) {
        this.filePath = filePath;
        this.content = content;
    }

    getToc(): Chapter[] {
        const navPoints = findProperty(this.content, ["navPoint", "navpoint"]);

        const getToc = (navPoint, level) => {
            const title = navPoint.navLabel?.[0]?.text?.[0] || (() => {
                const filePath = path.posix.join(path.dirname(this.filePath), navPoint.content[0].$["src"]);
                const html = jetpack.read(filePath);
                return new DOMParser().parseFromString(html, "text/html").title ||
                    path.basename(filePath, path.extname(filePath)) || "";
            })();

            if (!title) return null;

            const filePath = path.posix.join(path.dirname(this.filePath), navPoint.content[0].$["src"]);
            const subItems = navPoint["navPoint"]?.map(pt => getToc(pt, level + 1)) || [];
            const chapter = new Chapter(title, filePath, subItems, level);
            subItems.forEach(sub => sub.parent = chapter);

            return chapter;
        };

        return navPoints.map(pt => getToc(pt, 0)).filter(Boolean);
    }
} 