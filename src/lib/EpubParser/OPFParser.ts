/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from "path";
import { findProperty } from "./utils";

export class OPFParser {
    filePath: string;
    content: any;

    constructor(filePath: string, content: any) {
        this.filePath = filePath;
        this.content = content;
    }

    getHtmlFiles(): string[] {
        const manifest = findProperty(this.content, 'manifest')[0];
        return manifest.item
            .map((item) => item.$.href)
            .filter((href) => [".htm", ".html", ".xhtml"].some((sx) => href.includes(sx)))
            .map((href) => path.posix.join(path.dirname(this.filePath), href));
    }

    getCoverPath(): string {
        const manifest = findProperty(this.content, "manifest")[0].item;
        const coverItem = manifest.find(
            (item) =>
                ["cover", "Cover"].some((sx) => item.$.id.includes(sx)) &&
                ["png", "jpg", "jpeg"].includes(path.extname(item.$.href).slice(1))
        );
        return coverItem ? path.posix.join(path.dirname(this.filePath), coverItem.$.href) : null;
    }

    getMeta(): object {
        const meta = findProperty(this.content, "metadata")[0];
        const getValue = (key) => meta[key]?.[0] ?? "";

        return {
            title: getValue("dc:title"),
            publisher: getValue("dc:publisher"),
            language: getValue("dc:language"),
            author: meta["dc:creator"]?.[0]?.["_"] ? `"${meta["dc:creator"][0]["_"]}"` : "",
        };
    }
} 