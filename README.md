# Epub Importer

Import .epub file into your vault as markdown notes.

> [!IMPORTANT]
> This plugin is still in a very early stage and will probably only work with some specific formats of .epub files. If you find any incompatibilities, please let me know.

> [!NOTE]
> the plugin need to access files outside of Obsidian vaults, becasue .epub file is outside of Obsidian vaults. 

## Installation

Using BRAT with `https://github.com//epub-importer`.

## Usage

Run `Epub Importer: Import epub to your vault` command, 
and input the absolute path to .epub file you want to import it into your obsidian vault.

Then, .epub file will be converted to a folder and some notes, 
so you can read the book directly in obsidian, and make some marks, make some links and notes.

https://github.com/aoout/obsidian-epub-importer/assets/60838705/9fb8d43a-ad4e-4873-9b79-aa45549733f2

### Propertys template

all available variables:

```
- {{bookName}}
- {{title}}
- {{author}}
- {{publisher}}
- {{language}}
```

example:

```
title: {{bookName}}
author: {{author}}
publisher: {{publisher}}
status: false
```

### AssetsPath template

all available variables:

```
- {{savePath}}
- {{bookName}}
```

example:

```
{{savePath}}/{{bookName}}/images
```
