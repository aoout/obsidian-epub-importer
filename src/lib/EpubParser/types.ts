export class Section {
    name: string;
    url: string;
    urlPath: string;
    urlHref: string;
    html: string;

    constructor(name: string, url: string) {
        this.name = name;
        this.url = url;
        const [urlPath, urlHref] = url.split("#");
        this.urlPath = urlPath;
        this.urlHref = urlHref ?? "";
        this.html = "";
    }
}

export class Chapter {
    sections: Section[];
    subItems: Chapter[];
    level: number;
    parent: Chapter;

    constructor(
        name: string,
        url: string,
        subItems: Chapter[] = new Array<Chapter>(),
        level = 0,
        parent = null
    ) {
        this.sections = [new Section(name, url)];
        this.subItems = subItems;
        this.level = level;
        this.parent = parent;
    }

    public get name(): string {
        return this.sections[0].name ?? "";
    }
} 