import * as path from "path";
import jetpack from "fs-jetpack";
import { Chapter } from "./types";
import { findProperty } from "./utils";

export class NCXParser {
    constructor(private filePath: string, private content: unknown) {}

    getToc(): Chapter[] {
        const navPoints = findProperty(this.content, ["navPoint", "navpoint"]);
        return navPoints
            // @ts-ignore
            .map((pt) => this.parseNavPoint(pt, 0))
            .filter(Boolean) as Chapter[];
    }

    private parseNavPoint(navPoint: Record<string, unknown>, level: number): Chapter | null {
        const title = this.getTitle(navPoint);
        if (!title) return null;

        const filePath = this.resolveFilePath(navPoint);
        const subItems = (Array.isArray(navPoint.navPoint) ? navPoint.navPoint : []).map((pt: Record<string, unknown>) =>
            this.parseNavPoint(pt, level + 1)
        ).filter(Boolean) as Chapter[];

        const chapter = new Chapter(title, filePath, subItems, level);
        subItems.forEach(sub => sub.parent = chapter);
        return chapter;
    }

    private getTitle(navPoint: Record<string, unknown>): string {
        return navPoint.navLabel?.[0]?.text?.[0] || (() => {
            const filePath = this.resolveFilePath(navPoint);
            const html = jetpack.read(filePath);
            return new DOMParser()
                .parseFromString(html, "text/html")
                .title || path.basename(filePath, path.extname(filePath)) || "";
        })();
    }

    private resolveFilePath(navPoint: Record<string, unknown>): string {
        const src = findProperty(navPoint, "content")[0].$["src"].replace(/%20/g, " ");
        return path.posix.join(path.dirname(this.filePath), src);
    }
}