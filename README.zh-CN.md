# EPUB Importer

[English](README.md)

这是一个可以将 EPUB 文件转换为 Markdown 笔记的 Obsidian 插件，让你能够在 [Obsidian](https://obsidian.md/) 中直接阅读、批注和管理电子书。

如需了解更多信息，请查看 [Wiki](https://github.com/aoout/obsidian-epub-importer/wiki) 或浏览我们的 [Example Vault](https://github.com/aoout/mdReader)。

## 使用方法

你可以通过以下两种方式导入 EPUB 文件：

1. 运行命令 `Epub Importer: Import epub to your vault`，然后输入 EPUB 文件的完整路径。

2. 在插件设置中配置 `libraries` 路径 - 运行导入命令时，这些路径下的所有 EPUB 文件都会显示在选择列表中。

导入完成后，EPUB 文件会被转换成包含 Markdown 笔记的文件夹，你可以：
- 在 Obsidian 中直接阅读电子书
- 添加笔记和标注
- 在笔记之间建立链接
- 管理你的阅读材料

![Plugin Demo](assets/demo.gif)

### 属性模板

所有可用的变量：

```
- {{bookName}}
- {{title}}
- {{author}}
- {{publisher}}
- {{language}}
```

示例：

```
title: {{bookName}}
author: {{author}}
publisher: {{publisher}}
status: false
```

### 资产路径模板

所有可用的变量：

```
- {{savePath}}
- {{bookName}}
```

示例：

```
{{savePath}}/{{bookName}}/images
```
# Platform Support

- **Windows**: 完全测试并支持
- **Linux/Mac**: 有限测试 - 如遇问题请在创建 issue 时添加对应标签
- **Mobile**: 因技术限制，不支持 .epub 文件处理

# 推荐插件

## 文件管理
[obsidian-custom-sort](https://github.com/SebastianMC/obsidian-custom-sort)
- 强大的文件排序功能
- 帮助维护有序的 vault 结构
- 请查看 [wiki/How-to-sort-files](https://github.com/aoout/obsidian-epub-importer/wiki/How-to-sort-files%3F) 和 [Example Vault](https://github.com/aoout/mdReader) 获取配置指南

## 阅读体验
[obsidian-remember-cursor-position](https://github.com/dy-sh/obsidian-remember-cursor-position)
- 记录并恢复 session 间的光标位置
- 注意：目前不支持记录滚动位置

# Community & Support

## 分享体验
欢迎在 [Discussions](https://github.com/aoout/obsidian-epub-importer/discussions) 分享你的使用体验和工作流程！

## Issue 反馈
反馈 bug 时请：
1. 附上出问题的 .epub 文件
2. 如难以上传文件，可发送至：wuz66280@gmail.com
3. Linux/Mac 用户请添加对应平台标签

## Feature Request
请注意，feature request 将根据与插件核心理念的契合度进行评估，不保证全部实现。
