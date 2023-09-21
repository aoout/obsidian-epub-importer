# Obsidian Epub Importer

Import .epub file into Obsidian as markdown notes.

> [!WARNING]
> Please be sure to back up your library first. In principle, this plugin will not destroy your library, but accidents may occur.

> [!IMPORTANT]
> This plugin is still in a very early stage and will probably only work with some specific formats of .epub files. If you find any incompatibilities, please let me know.

## Usage

get the plugin from obsidian BRAT plugin.

run `Epub Importer: Import epub to your vault` command, 
and input the absolute path to .epub file you want to import it into your obsidian vault.

[![Watch the video](https://img.youtube.com/vi/SH3OuDLdMQw/hqdefault.jpg)](https://www.youtube.com/embed/SH3OuDLdMQw)

## RoudMap

- [x] convert name of char to a vaild windows file path, delete invalid characters.
- [x] image support.
- [x] toc support.
- [ ] inline link support.
- [x] fix conflicting images bug.
- [x] fix note duplication caused by href.
- [x] inline fontnote support.
- [ ] escape characters in the original text that are mistaken for markdown format tags.
- [ ] settings tab page can specify the default path for searching e-book files.
- [x] cover parser for obsidian projects plugin.
- [ ] Parse more metadata.

## Working on Compatibility...

The internal structure of the epub file is very confusing and I don't expect that I can only identify a vert small part of it.
