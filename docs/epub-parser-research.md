# EPUB 解析层重写 · 源码调研与方案设计

> 目的：为 `obsidian-epub-importer` 的解析层彻底重写，先把市面上「与阅读器无关的独立 EPUB parser」源码读一遍，提炼可复用的正确姿势与必须避开的反模式，再据此设计我们自己的、零 EPUB 依赖的解析层。
>
> 调研时间：2026-09-06
> 调研样本（均通过 npmmirror 安装到本地 `node_modules` 后逐文件阅读源码）：
> - `epub`（julien-c）v2.1.1
> - `@gxl/epub-parser` v2.0.4
> - `@denstepa/epub-parser` v2.2.2
> - `booqs-epub` v1.1.3

---

## 0. 重要更正：四家其实是「三家」

`@denstepa/epub-parser` 的 `src/parseEpub.ts` 源码里直接带有 `github.com/gaoxiaoliangz/epub-parser` 的原仓库链接——它本身是 `@gxl/epub-parser` 的**重新发布（fork）**，底层完全一致：`jsdom + node-zip + lodash + turndown + xml2js`。因此真实的 codebase 只有 **3 个**：

| 解析器 | 解压 | XML | DOM | HTML→MD | EPUB 版本 | 维护状态 | 关键缺陷 |
|---|---|---|---|---|---|---|---|
| **julien-c/`epub`** | jszip | fast-xml-parser | 无（正则改 HTML） | 无（只吐 raw HTML） | EPUB2/3 | 活跃（2026-02） | 仅 UTF-8；一错就 throw |
| **`@gxl` / `@denstepa`** | node-zip（死库） | xml2js | jsdom | Turndown | EPUB2/3 | 基本停更 | 重；图片硬编码 `image/png`；吞错误 |
| **`booqs-epub`** | 由调用方注入（FileProvider） | fast-xml-parser | 无（XML 树遍历） | 无 | EPUB2/3 | 小众、较新 | 社区极小，长期风险 |

**结论：没有一个是「成熟到能当底座」的。** 三家要么只保 UTF-8，要么拖死库/重依赖，要么社区太小。所以正确策略是：**不依赖任何一个，把它们的正确姿势吸进我们自己可控的解析层。**

---

## 1. 逐家剖析与可借鉴点

### 1.1 julien-c/`epub`（最老牌、最稳，贡献最多底层健壮性）
源码：`epub.ts`

- **XML 解析用 `fast-xml-parser`**（`parseXml`），并配 `XMLValidator.validate` 先校验再解析——畸形 XML 不会静默崩。
- **命名空间无关键名访问**：`_parseMetadata` 里 `key = fullKey.split(":").pop().toLowerCase()`，把 `dc:title`→`title`、`opf:file-as`→`file-as`。经验：**EPUB 元素带 `dc:`/`opf:` 命名空间，无关键名访问能扛住各路怪异 OPF**（这正是 @gxl 硬编码 `dc:title` 容易翻车的地方）。
- **MIME 入口校验**：`_checkMimeType` 读 `mimetype` 入口，断言 `application/epub+zip`，确认真是 EPUB。
- **container.xml 定位 OPF**：`_getRootFiles` 大小写不敏感查找 `meta-inf/container.xml`，按 `media-type=="application/oebps-package+xml"` 取 `full-path`。
- **manifest href 归一化到 zip 根**：`_parseManifest` 用 OPF 路径 `path.pop()` 算出 base，href 不以 base 开头就拼接——比 @gxl 用正则推导 OPS root 稳。
- **多作者 / `file-as` / subjects 数组 / UUID**：`_parseMetadata` 处理 `creator`、`opf:file-as`、`subject`（数组）、`identifier`（`urn:uuid:` 提取）。直接对应本仓库 issue #171（多作者支持）。
- **TOC 递归层级封顶**：`walkNavMap` 中 `if (level > 7) return []`——防畸形 TOC 爆栈。
- **DRM 检测**：`hasDRM()` 检查 `META-INF/encryption.xml` 是否存在。本仓库当前未优雅处理加密书。
- **反模式**：`getChapter` 用正则改写 `<body>`、剥 `<script>`/`<style>`、重命名 `on*` 事件、改写 `src`/`href`——脆弱，应在 AST 上做（见 §3）。

### 1.2 @gxl / @denstepa（贡献「按锚点切分章节」这一关键思路）
源码：`@gxl/epub-parser/src/parseEpub.ts`、`parseSection.ts`

- **按锚点切章节（修 issue #170 的正解）**：`getHTMLNodesBetweenNodes` 用 `document.getElementById(nodeId)` → 沿 `nextSibling` 走到 `nextNode`，收集 `nodeType===1` 的元素并 `join(outerHTML)`。这比本仓库 `ContentSplitter` 的字符串锚点切分靠谱一个量级（字符串切分对不齐就静默丢内容）。
- **`_resolveIdFromLink`：TOC 链接按「文件名」匹配 manifest item**（而非全路径比字符串）——解决 TOC 写 `ch1.xhtml#s2`、manifest 写 `ch1.xhtml` 对不上的问题。
- **`_getTOCPath` 规范正确**：有 `spine` 的 `toc` 属性→按 id 找 manifest；否则找 `properties === 'nav'` 的 manifest item（EPUB3）。
- **EPUB3 nav 解析**：`_genStructureForHTML_v3` 用 JSDOM 查 `nav[epub:type="toc"] ol` 递归 `ol/li/a`。注意：它还有另一个 `_genStructureForHTML` 是直接从 xml2js 对象取 `html.body[0].nav[0]['ol'][0].li`，**那个很脆**（假定固定嵌套），应优先用 DOM 版。
- **反模式**：
  - `node-zip`（2016 死库）→ 用 jszip/extract-zip。
  - `jsdom` 当 DOM（重、拖慢、不利单测）→ 用 linkedom。
  - `parseSection.ts` 的 `resolveSrc` 把图片 base64 **硬编码 `image/png`**，无视真实类型（jpg/gif/svg 全错）→ 按 manifest `media-type` 取真实 mime。
  - `parse` 里 `try/catch + console.error` 静默吞掉 TOC 解析错误（见 `epub.ts` 行 509 同类）→ 应改成可上报的诊断。

### 1.3 booqs-epub（架构最干净，贡献工程化范式）
源码：`dist/open.js`、`toc.js`、`xml.js`、`manifest.js`

- **`FileProvider` 接口（只暴露 `readText`/`readBinary`）**：`openEpub(fileProvider, diags)` 的 parser 完全不碰 zip 实现，调用方注入 jszip/StreamZip；也方便单测（直接喂内存对象）。这正是我们要的 `ArchiveReader` 抽象。
- **惰性加载**：`openEpub` 返回的 `metadata()`/`spine()`/`toc()`/`manifest()` 都是 lazy thunk（`utils.lazy`），用到才读——大书省内存、可流式。
- **`diags` 错误分级数组（最值得抄）**：每个抽取步骤缺字段就 `diags.push({message, data, severity?})` 并 `continue`，**而非 @gxl 的 console.error 静默吞、也非 julien-c 的一错就 throw**。`toc.js` 里 `navPointsIterator` 对缺 `label`/`src` 的 `navPoint` 直接 `continue` 并记 diag。
- **`extractCoverItem` 双策略**：先试 EPUB3 `properties 含 'cover-image'`，再退 EPUB2 `meta name='cover'`→解析 idref。cover 检测一步到位。
- **`extractUniqueIdentifier` 双策略**：EPUB3 用 `@unique-identifier` 找对应 `identifier`；EPUB2 用 `meta name='dtb:id'`。
- **`xml.js` 的 fast-xml-parser 配置**值得直接复用：
  - XML：`removeNSPrefix:true`、`ignoreDeclaration:true`、`attributeNamePrefix:'@'`、`alwaysCreateTextNode:true`、`isArray` 返回 `!isAttribute`（强制数组，遍历一致）。
  - HTML（章节）：`preserveOrder:true`、`attributesGroupName:'attrs'`、`unpairedTags:['hr','br','link','meta']`、`stopNodes:['*.pre','*.script']`、`htmlEntities:true`。`removeNSPrefix` 是关键——免去手动 `.split(":").pop()`。

---

## 2. 该抄的正确姿势（汇总）

| 来源 | 抄什么 |
|---|---|
| julien-c | fast-xml-parser + `XMLValidator` 校验；命名空间无关键名；MIME 入口校验；container 大小写不敏感定位；manifest href 归一化到 zip 根；多作者/`file-as`/subjects/UUID；TOC 递归层级封顶；`hasDRM` |
| @gxl | 按锚点 DOM 切分章节；TOC 链接按文件名匹配 manifest id；`_getTOCPath` 的 nav 属性优先策略 |
| booqs | `FileProvider` 接口（解耦 zip）；惰性加载；`diags` 错误分级；cover 双策略（EPUB3 `cover-image` / EPUB2 `meta cover`）；`extractUniqueIdentifier` 双策略；fast-xml-parser 的 `removeNSPrefix` 配置 |

---

## 3. 三家共同的反模式（避开清单）

| 反模式 | 出自 | 我们的做法 |
|---|---|---|
| `node-zip`（2016 死库） | @gxl | jszip / extract-zip |
| 用 `jsdom` 当 DOM | @gxl | **linkedom**（轻、Node 友好、可单测、解锁纯函数单测） |
| 图片 base64 硬编码 `image/png` | @gxl | 按 manifest `media-type` 取真实 mime |
| 正则改写 HTML 内 `src`/`href` | julien-c | 在 AST 上做（unified / linkedom） |
| TOC 出错 `console.error` 静默吞 | @gxl | `diags` 分级 + 上报 |
| 一错就 `throw` 中断整本书 | julien-c | `diags` 警告继续，致命才停 |

---

## 4. 三家共同的盲区（我们的差异化机会）

**三家全默认 UTF-8**——julien-c 的 `data.toString('utf-8')`、@gxl 同样、booqs 经 `FileProvider` 读也从不转码。而本插件要导入的中文/日语小说里，存在大量 Shift-JIS / GBK 编码的脏书（正是 issue #169 日语小说、#170 内容缺失的高发区）。**没有任何现成 parser 替你做编码嗅探**。

→ 我们的 `ArchiveReader` 必须加 `iconv-lite` 按 `charset` 声明 / BOM / 字节特征嗅探并转码。这是它们都留给我们的、且对本用户群性命攸关的一块，也是「自建」相对「依赖现成包」最大的价值点。

---

## 5. 我们的自建方案

**原则：不依赖任何 EPUB parser 包，只引入通用、成熟、可替换、非 EPUB 专用的包**：
- `fast-xml-parser`——去命名空间 / 校验
- `linkedom`——锚点切分 + HTML→MD 转换，替代 jsdom / DOMParser
- `jszip`——解压（替代 @gxl 的死库 node-zip）
- `iconv-lite`——编码嗅探（三家都默认 UTF-8，这是我们的差异化点）

> **§5 修订（实现阶段）：放弃 unified。**
> 原计划用 `unified` + `rehype-remark` + `remark-stringify` 做 HTML→MD，但实测
> `unified@10` 与 `unified@11` 的 package.json 均为 `"type": "module"`（纯 ESM）。
> 引入会把整个 `src-next` 拖入 ESM 模式，需改 tsconfig module + 让 jest 跑在
> `--experimental-vm-modules` 下——重演并放大 §5.4 已踩过的 linkedom ESM 坑，
> 收益（AST 层精确处理）抵不上成本。
> 改为**用已有的 linkedom 自建转换器**：零新增依赖、完全可控，
> 且能把「不静默丢内容」原则一直贯彻到转换层。

### 5.1 架构分层

```
ArchiveReader  解压 + 编码嗅探（实现 FileProvider 接口）
   ↓
OpfParser      OPF 解析：去命名空间 / 路径归一 / 多作者 / cover 双策略
   ↓
NavParser      TOC 解析：NCX + nav 双支持 / 层级封顶 / href→id 匹配
   ↓
BookAssembler  归一化成 Book 模型 + diags 错误分级（隔离包数据结构泄漏）
   ↓
Slicer        linkedom 按锚点切分（抄 @gxl 思路，换 linkedom）——修 issue #170
   ↓
Transformer   linkedom 自建 HTML→MD（ruby/图片/脚注/内链 可配置规则）——替代 Turndown
   ↓
Writer        WriteTarget 抽象：笔记规划 / 模板 / frontmatter / 资源落盘 / 进度与中断
```

### 5.1.1 转换层相对旧实现（src/core/TurndownService.ts）的修正

沿用其规则（ruby / 图片路径重写 / 脚注 / 内链转 wikilink），但修掉三类问题：

| 旧实现行为 | 问题 | 新实现 |
|---|---|---|
| ruby 硬编码 `{漢字|かんじ}` | 绑死 obsidian-ruby 插件 | `rubyFormat` 可配：paren / brace / html / strip |
| 远程图片 `return ""` | **静默丢内容** | 丢弃但记 `warning`（`image-remote-dropped`），可 `keepRemoteImages` 保留 |
| 源码换行折叠成空格 | 中文字与字之间被塞入空格 | CJK 之间的空白直接删除（`collapseText`） |
| 无 diags | 转换期问题全不可见 | 转换层与解析层共用同一 diags 数组 |

### 5.1.2 Writer 层相对旧实现（src/core/EpubProcessor.ts）的修正

| 旧实现行为 | 问题 | 新实现 |
|---|---|---|
| 用 fs-jetpack 直接写盘 | 绕过 Obsidian Vault，移动端不可用、不进索引 | `WriteTarget` 抽象，可注入 Obsidian / 内存实现 |
| `copyImages` 只匹配 `*.{jpg,jpeg,png}` | 漏掉 gif / webp / svg 等 | 扩展名白名单可配（`assetExtensions`） |
| `copyImages` 同步 forEach，无 await | 大书卡死 UI，且无法中断 | 逐资源 await + `onProgress` + `shouldCancel` 中断点 |
| `normalize()` 正则混乱 | 无长度限制 / 保留名 / 空名 / 控制字符处理 | `sanitizeFileName()` 全覆盖 |
| 写入失败 `console.warn` 后吞掉 | 问题对上层完全不可见 | 记 diags（`note-write-failed` / `asset-write-failed` …） |
| 图片链接写相对 `assetsPath` | 笔记在嵌套目录时 Obsidian 解析不到图 | 正文里写 **vault 根相对的完整路径**（`Books/书名/assets/x.png`） |
| `granularity===0` 特判散落在调用处 | 语义隐晦 | 明确为「全书一篇」，且此时不生成 MOC |

### 5.2 文件骨架（落地位置 `src-next/`）

```
src-next/
  index.ts                   // epubToMarkdown(input) —— 解析→切分→转换 一条龙（对外唯一入口）
  parser/
    ArchiveReader.ts         // FileProvider 实现；jszip + iconv-lite 嗅探编码
    xml.ts                   // fast-xml-parser 封装：removeNSPrefix + 校验 + 去根
    OpfParser.ts             // 命名空间无关键名 / 路径归一 / 多作者 / cover 双策略
    NavParser.ts             // NCX + nav 双支持；递归层级封顶；href→id 匹配
    Slicer.ts                // linkedom 按锚点切分（抄 @gxl 思路，换 linkedom）
    BookAssembler.ts         // 归一化成 Book 模型 + diags 错误分级
    types.ts                 // 与版本无关的 Book / ManifestItem / NavPoint
    index.ts                 // parseEpub / parseEpubFromProvider(provider) → Book
  transform/
    types.ts                 // TransformOptions：rubyFormat / imageFormat / linkFormat ...
    HtmlToMarkdown.ts        // linkedom 自建转换器（块级 + 行内 + 表格 + escape）
    index.ts                 // transformHtml / transformChapters → Markdown
  writer/
    types.ts                 // WriteTarget 抽象 + WriterOptions（granularity/模板/进度/中断）
    targets.ts               // MemoryTarget（单测） + createObsidianTarget（生产）
    template.ts              // {{var}} 渲染 + 手写 YAML frontmatter（零新增依赖）
    path.ts                  // sanitizeFileName / joinPath / uniquePath（重名加 (1)）
    planner.ts               // 粒度合并 + 嵌套目录 + 内链重写表
    Writer.ts                // 写入执行：笔记 / MOC / 资源落盘 / 进度与中断
    index.ts                 // importEpubToMarkdown(input, target, opts) —— 一条龙
  test/                      // 端到端：pipeline / import
```

> **衔接要点**：`parseEpub` 内部会 new 一个 reader 且不外泄，导致切分拿不到 FileProvider。
> 因此拆出 `parseEpubFromProvider(provider)`，让 `epubToMarkdown` 复用同一个 reader
> 走完全程（只解压一次），并让解析层与转换层共用同一个 diags 数组。

### 5.3 `diags` 错误分级（粒度待定，默认提案）

- `fatal`：无法继续（如不是合法 EPUB、OPF 缺失、加密书）→ 中止并提示用户
- `warning`：局部缺失但不影响整体（如某 navPoint 无 label、某 manifest item 找不到）→ 记日志继续
- `info`：可优化的提示（如未声明 cover、检测到非 UTF-8 已转码）
- `debug`：排查用摘要（解析/转换/写入各阶段摘要），**仅当开启 `verbose` 时输出**，默认静默

> 分级最终决定（2026-09-05）：
> - 新增 `debug` 级，由顶层 `ImportOptions.verbose`（或各子选项 `parse/transform/write.verbose`）门控，
>   等价于旧实现的 `moreLog`。优先级：子选项显式 `verbose` > 顶层 `verbose` > 默认关闭。
> - `code` 一律保持**稳定的机器可读 key**（如 `parse-summary` / `transform-summary` / `write-summary` /
>   `anchor-missing-fallback`），**不做国际化**——国际化/展示文案留给上层按 `code` 映射，保证 key 长期稳定、可程序化处理。

---

## 6. 进度

- [x] 骨架落到 `src-next/`
- [x] `ArchiveReader` 接 `FileProvider` + `iconv-lite` 编码嗅探
- [x] `BookAssembler` 用 `diags` 分级做错误模型
- [x] fixture 单测：内存构造含日语 Ruby 的 EPUB，断言 (a) `Book` 的 spine/nav/meta 正确；
      (b) 锚点切分不再静默丢内容（回归 issue #170）；
      (c) 锚点缺失时回退整文件并记 warning —— **已被 2026-09-09 的 Slicer 重写取代**（见下方里程碑：
          阶梯对齐 + 全域覆盖后不再「整文件回退」，缺失锚点走 L2/L3 恢复，恢复不了才显式上报）
- [x] 转换层（替代原计划 unified，见 §5 修订）：ruby / 图片 / 脚注 / 内链 / 表格 / 列表 可配置
- [x] 端到端流水线 `epubToMarkdown`：解析 → 切分 → 转换，共用一次解压与一个 diags
- [x] Writer 层：WriteTarget 抽象 + 粒度合并 + 嵌套目录 + 模板 + frontmatter
- [x] 资源落盘（图片等，扩展名白名单可配）
- [x] 端到端 `importEpubToVault`：解析 → 切分 → 转换 → 写入 → 资源落盘
      （一次解压、一个 diags、支持进度回调与中断）
- [x] 接插件：`src/nextIntegration.ts` 的 `runImportNext` 用 `createObsidianTarget(app.vault)` 接到命令与设置项；
      新增命令 `import-epub-next`（旧 `import-epub` 保持原样，便于 A/B 对比）；旧设置经 `mapSettings` 映射，
      `assetsPath` 取相对书目录的最后一段（如 `{{savePath}}/{{bookName}}/images` → `images`）
- [x] 导入进度 UI：`runImportNext` 消费 `onProgress`（阶段/进度写入 Notice），并在 Notice 上挂「取消」按钮；
      点击后通过 `shouldCancel` 在写资源 / 笔记阶段安全中止（已写入内容保留，`result.cancelled` 标记已取消）
- [x] 真实 EPUB 端到端校验（`src-next/test/realworld.test.ts`）：用 `MemoryTarget` 跑通
      `自控力`(CJK) / `TheEconomist`(期刊) / `资治通鉴全译本`(大书) 三本真实书籍；
      确认内链 `[[...]]`、vault 绝对路径图片链接、锚点缺失回退均正常
- [x] 资源兜底：正文 `<img>` 引用但 OPF `manifest` 未声明的图片（常见于封面）也会落盘，
      避免正文图片链接悬空（`Writer.writeBook` 增加内容扫描兜底，文件名规则与转换层一致）
- [x] 锚点缺失回退告警去重：同一本书多个文件锚点缺失时聚合为一条 warning（不再逐文件刷屏）；
      回退本身是正确的「内容不丢」行为（如 资治通鉴 290 卷，每卷 TOC 锚点本就不存在）
- [x] `diags` 分级粒度最终确认：新增 `debug` 级（由 `verbose` 门控，等价旧实现 `moreLog`），
      `code` 保持稳定机器 key 不做国际化；`parse/transform/write` 三阶段各补 `*-summary` 摘要，
      集成层 `mapSettings` 把 `settings.moreLog` 映射到顶层 `verbose`，并在 `moreLog` 时把 debug 诊断打到控制台
- [x] 行内块级元素保真（`HtmlToMarkdown.inline()`）：块级元素误出现在行内位置时
      （畸形 HTML 常见，如行内容器里嵌 `<blockquote>`），由「压平成纯文本」改为**提升为块级渲染**，
      并用空行包裹确保渲染为独立块。实测 自控力：45 处引用恢复 `>` 格式，
      含正确引用的笔记 32 → 41 / 56（同步修掉 diag 文案：已提升为块级渲染）
- [x] MOC 同名笔记消歧：多个章节同名（如「本章总结」×9）时，MOC 链接加别名带上所在章节名
      （`[[书/01…/本章总结|01… / 本章总结]]`，父名超 16 字截断），不重名的仍保持简洁链接
- [x] 元信息日期规整：`normalizeDate()` 把 `2013-04-08T23:00:00+00:00` 规整为 `2013-04-08`
      （纯日期/年份/空值原样返回），供 `{{date}}` 模板与 frontmatter 使用
- [x] **命令行版 CLI（`src-next/cli/`）**：与 Obsidian 插件复用同一内核（见 §7），
      新增文件系统 `WriteTarget` + 参数解析 + 入口；支持批量目录、`--dry-run`、`--json`、
      `--verbose`、SIGINT 优雅取消；可用 `npm run cli`（ts-node）或 `npm run build:cli`
      打包成 `bin/epub-importer.js`（`package.json` 的 `bin` 字段，`npm link` 后可全局调用）
- [x] **Slicer 重写为全域覆盖（2026-09-09，见 docs/parser-first-principles.html）**：
      `src-next/parser/Covering.ts` 的 `createCovering` 是**唯一构造入口** —— 每个原子必须有归宿，
      漏一个就构造失败，把「静默丢内容」从运行期行为变为**不可表达**（原「回退整文件」描述已被取代）：
      - 对齐阶梯：L0 精确 id → L1 归一化 id → L2 标题文本 → L3 保序；每区域带置信度（公理 4）
      - 单条目文件整文件产出（资治通鉴 290 卷 1:1 不误拆；锚点声明缺失仍显式上报）
      - 混合条目（无锚点 + 锚点）不再丢弃文件开头：《自控力》实测 68 目录条目全部有归宿、
        开头导语守恒（回归测试含阴性对照：去掉归属逻辑该测试即失败）
      - 无主开头导语并入首章并以 `head-preamble`(info) 溯源（TheEconomist 版块眉题实测）
      - 纯空壳元素（无文本/无子元素/非 void）不再是原子 —— 不产出空笔记
      - 定位不到的目录条目聚合上报 `entry-unassigned`(warning)，绝不静默
      - 新增 `covering.test.ts`（全域律 / 双投影 / 置信度 / 空壳规则）+ Slicer 混合条目回归用例
      - MOC 链接统一 `[[完整路径|短名]]`：目标保留完整路径（Obsidian 从库根解析，绝无歧义），
        展示别名用短名 —— 用户感知不到路径；同书重名（如多个「本章总结」）时别名再加父目录名区分
      - 整文件兜底不再用「(文件开头)」占位标题，改用该文件首个目录条目名（实测《自控力》书名页）
- [x] **框架边界修正：守恒的「域」从 nav 文件集扩到 spine 全集（2026-09-09）** ——
      反思：文件级原子覆盖只保证「被处理的文件内部」守恒；若以 nav 划界，未被目录引用的
      spine 文档会整体逸出守恒域、静默丢失（实测《自控力》：9 章开篇导语 + 整篇结语约 8 千字，
      诊断数 0）。spine 是阅读本体，nav 只是标注层且可能残缺/写坏：
      - 切片主循环改为**按 spine 阅读序**迭代（不再是 nav 出现序）
      - spine 中未入目录的文档（孤儿）：**卷首孤儿**（书名页/版权页/目录页…）→ 独立顶层笔记
        （按内容线索推断标题）；**中/后部孤儿** → 按阅读序并入前一章节内容，顺序保持
      - 显式诊断：`spine-orphan-merged` / `spine-orphan-front` / `spine-orphan-empty`（均 info）
      - 实测回归：上述 10 处孤儿正文全部找回且落在正确的章节笔记（10/10 逐条核对），
        另新增 fixture 单测（标题页+孤儿正文页结构）
      - 已知同类域边界待办：manifest 中既不在 spine 也不在 nav 的文档、孤儿文档内图片的资源兜底
- [x] **目录层级归一化（退化根提升，2026-09-09）** —— nav 的层级和锚点一样只是「作者的声明」，
      实测某版《自控力》navPoint 深度 D0=1/D1=13/D2=51：65 条目录仅 1 个顶层「导言」，
      01~10 章、结语、鸣谢全部被降级嵌在其下。处理：`tocNormalize`（`tocNormalize.ts`）
      - 证据触发：仅「顶层恰有 1 项」时介入，正常书零影响
      - 保守 reparent：把「首个带子树的 D1」起的连续后缀提升为顶层（引言节无子树 → 留在根下；
        结语/鸣谢虽无子树但在兄弟带内 → 一并提升），不做内容移动、不删条目
      - 不静默：提升以 `toc-normalized`(info) 上报 before/after 形状与名单；`normalizeToc:false` 可关
      - 实测：该书笔记树从「全部嵌在导言/下」恢复为 导言（含其引语节）+ 01~10 章 + 结语 + 鸣谢 + 卷首页平级；
        卷首无文本页按载体命名（`<svg>`→书名页 / `<img>`→封面），不再出现「未收录页」
      - 单测：退化根提升（层级/诊断/名单）+ 正常目录零影响 + 显式关闭
- [x] **标题注入（`ensureNoteHeading`，2026-09-09）** —— 修复「书内标题不是 `<h1..h6>`」
      的解析质量问题（实测《自控力》：67/67 篇正文首行是裸段落标题，Obsidian 无大纲）。
      - 规则：正文**已有** `#` 标题 → 原样返回（资治通鉴/Economist/规整书零影响）；
        完全无标题 → 把首段与笔记标题**归一化全等**（含「01\n我要做…」换行、全角空格）匹配才剥离
        （只用全等不用包含，避免误删「这是第一章的开头…」这类正常首段），再注入 `# {{title}}`
      - 实测：该书 67/67 笔记获得标题，标题段不重复、正文直连；+4 单测
- [x] **表壳去物质化：单列表格不再当数据表渲染（2026-09-09，第 3 轮质量扫描）** ——
      质量扫描发现全书 213 处字面 `<br>` 残留，全部来自 9 处 Kindle「本章总结」边框卡片：
      源是**单列排版表**（每行 1 个 `<td>`，单元格装的是 `<p>`/粗体伪标题/`<br>` 分隔行，
      `bjcolor2` 底色等纯装饰 class），却因 `<table>` 标签被无条件当数据表，
      单元格内换行只能回退成字面 `<br>`（块结构塌缩为行内残留，违反「不表达才丢、块不回退」原则）。
      - 本体论区分：`<table>` 可能是**数据表**（单元格=原子值，多列承载关系）也可能是
        **排版壳**（单元格装流内容，表格只是视觉容器）。epub2 排版表泛滥，不能只认标签。
      - 规则：**单列表（每行恰好 1 个有效列）无法表达任何横向数据关系 → 视为排版壳**，
        去壳后内容按阅读顺序原样上浮为块（`table-layout-denatured` info 上报行列形状）；
        多列数据表维持 GFM。两条路径都守恒——壳不是内容本体，去掉壳零损失。
      - 附带收获：**图片链接目的地括号编码**——真实书名含括号（如 `自控力(elib.cc)`）
        会截断 `![](path)` 解析导致整条图片链接断裂（MemoryTarget 悬空门禁抓到 5 处）：
        存储侧保持真实文件名，Markdown 目的地编码 `()`→`%28`/`%29`（空格沿用 `%20`），
        wikilink 格式不编码；`![]()` 悬空门禁先解码再比对存储键。
      - 质量门禁入测试：realworld 三本书断言最终 Markdown **零裸 HTML 标签**（rawHtmlTags=0，
        曾为 213；含 `<pre>` 保留原文通道的显式例外说明）、**零悬空图片**
      - 实测回归：《自控力》`<br>` 213→0、残留实体 0、其它裸标签 0；本章总结笔记从
        「`<br>` 泥潭表格」变为干净段落流（标题去重、粗体伪标题、`<br>` 软换行、脚注俱在）；
        +6 单测（排版壳去壳/内嵌 p+br 形态/colspan 仍走数据表/括号编码 ×2 格式）
- [x] **旧内核删除、新内核转正 + 设置系统语义化（2026-09-09）** ——
      反思：设置系统存在「用户契约 / 存储契约 / 内核契约」三层断裂（展示文本当值、
      字符串手术、正则猜枚举、mocPropertysTemplate 静默丢弃、默认值多点漂移），
      根因是旧内核与 data.json 共生导致存储无法语义化。用户拍板：**旧内核直接删除**。
      - 删除：`src/core/`（EpubProcessor / TurndownService / 旧 parser 全目录）、
        `src/test/importer.test.ts`；`import-epub-next` 命令移除，`import-epub` 即新内核
        （id 不变，用户热键不失效）；sync-libraries 批量与拖拽改走 `runImportNext`（批量走 silent）
      - 设置模型 v2：`imageFormat` 存枚举 markdown/wikilink（不再存 `![](imagePath)` 展示文本）、
        `assetsPath` **保留 vault 相对路径模板语义**（{{savePath}}/{{bookName}} 可展开、可含 ../，
        默认 {{savePath}}/{{bookName}}/assets 放书内；**可指向书根之外/跨书共享**——曾一度错误
        收窄为「书内目录名」，用户指出后已恢复，模板即自由度）、
        `removeDuplicateFolders` 升格为 `onExisting` 三态（abort/overwrite/merge）、
        删除 reformatting/mocPropertysTemplate；`schemaVersion:2` + `migrateSettings` 一次性迁移
        （旧值归一化后回写；assetsPath 模板原样保留不重写，空值回退默认模板）
      - 内核新增 `WriterOptions.assetsVaultPath`：vault 相对路径模板，经 `resolveAssetsDir()`
        单一权威解析（落盘位置 == 正文图片链接位置），由 importEpubToVault 与 writeBook 共用；
        未设置时退回 `assetsPath`（书内相对名，默认 assets，CLI/既有调用不变）
      - Writer frontmatter 域语义：笔记 = 书元数据 ∪ frontmatter；MOC = 笔记属性 ∪ mocFrontmatter
        （**叠加而非替换**）——tag 是书级标记，经 mocFrontmatter 只落 MOC，修复了
        「tag 打进每篇笔记 → open-book 把每篇笔记当书列出」的回归（+1 单测）
      - 旧 jest 配置删除，`npm test` 指向 jest.src-next.config.ts；插件构建产物同步 test-vault；
        CLI 冒烟 自控力 69 md、br=0、裸标签=0
      - 已知遗留：leafID 仍以内部状态形式留在设置表（设置页不展示）；导入弹窗暂无 per-run 覆盖
        （granularity/onExisting 目前是全局默认）；模板变量契约（旧 templateWithVariables vs 新
        renderTemplate）已随旧内核消失，统一为新 renderTemplate

### 6.1 测试与类型检查

`src-next` 独立一套配置，与既有 `src/` 互不干扰：

```
npm run test:next       # jest --config jest.src-next.config.ts --runInBand
npm run typecheck:next  # tsc -p tsconfig.src-next.json
```

- `jest.src-next.config.ts` 的存在理由：linkedom 的 CJS 构建会 require 纯 ESM 的
  `css-select`，而 jest 默认不转换 node_modules。故需
  `transformIgnorePatterns` 放行 `linkedom|css-select|css-what|boolbase|nth-check|
  domhandler|domutils|dom-serializer|entities|domelementtype`，
  并让 ts-jest 也转换 `.js`（`isolatedModules` 把 ESM 降级为 CJS）。
- 因 `isolatedModules` 跳过类型检查，**必须**另跑 `typecheck:next`。
- 用 `--runInBand`：并行模式下 jest worker 退出时会报无关的 teardown 警告
  （已用 `--detectOpenHandles` 确认非资源泄漏），且串行反而更快。

---

## 7. 命令行版 CLI（复用同一内核）

`src-next` 的三层抽象让「换个宿主」只需要换两端的适配器：

| 宿主 | 输入（ArchiveInput） | 输出（WriteTarget） |
|---|---|---|
| Obsidian 插件 | 文件路径（`fs/promises`） | `createObsidianTarget(vault)` |
| 单元测试 | Buffer / 内存 zip | `MemoryTarget` |
| **CLI** | 文件路径（含目录批量） | **`createFilesystemTarget(outDir)`** |

因此 CLI **不复制任何解析/转换/写入逻辑**，只做三件事：解析参数 → 选 target → 调
`importEpubToVault`。插件与 CLI 行为天然一致，不存在两套实现漂移的风险。

### 7.1 用法

```bash
npm run cli -- import book.epub --out ./out --granularity 3   # 开发态（ts-node）
npm run build:cli                                             # 打包成 bin/epub-importer.js
node bin/epub-importer.js import ./books --dry-run --verbose  # 批量 + 只校验不落盘
node bin/epub-importer.js import book.epub --json             # 结构化输出，便于脚本化
```

- 主要选项：`--out` `--granularity` `--assets` `--save-path` `--template`
  `--on-existing(abort|overwrite|merge)` `--no-moc` `--no-assets`
  `--verbose` `--dry-run` `--json` `--quiet`
- 退出码：`0` 成功 / `1` 出现 fatal / `2` 用法错误 / `130` 被 Ctrl-C 中断
- `--dry-run` 复用 `MemoryTarget`：完整跑完流水线但不写盘，适合批量校验一批书
- Ctrl-C 通过 `shouldCancel` 让内核在检查点优雅中止，已写入内容保留

### 7.2 打包与隔离

- `build-cli.js` 用 esbuild 的 **JS API**（而非命令行）打包：npm script 里
  `--banner='#!/usr/bin/env node'` 这种带空格的参数在 Windows cmd.exe 下会被拆成多个参数。
- CLI 代码放在 `src-next/cli/`，且 **不** 从 `writer/index.ts` 导出；插件入口
  `src/main.ts` 不会引入它。已验证：
  `createFilesystemTarget` / `normalizeWinPath` / `collectEpubs` 只出现在 CLI 产物，
  `createObsidianTarget` 只出现在插件产物——两侧零污染。
- esbuild 0.8.57 的两个老坑（沿用既有约定）：不能写 `node:` 前缀的内置模块、
  不能写内联 `type` 导入修饰符。

### 7.3 Windows 注意

Node 不认 Git Bash 风格的 `/d/foo`（会解析成当前盘符下的 `/d/foo`），
CLI 内置 `normalizeWinPath()` 把 `/d/foo` 还原为 `D:/foo`。

---

## 附：源码阅读索引（便于回查）

- 命名空间无关键名 + MIME 校验 + 多作者 + DRM：`epub.ts` → `parseXml` / `_checkMimeType` / `_parseMetadata` / `walkNavMap`(level>7) / `hasDRM`
- 按锚点 DOM 切分 + href→id 匹配：`@gxl/epub-parser/src/parseEpub.ts` → `getHTMLNodesBetweenNodes` / `_resolveIdFromLink` / `_getTOCPath`
- FileProvider + 惰性加载 + diags + cover 双策略：`booqs-epub/dist/open.js` → `openEpub` / `extractCoverItem` / `extractUniqueIdentifier`
- NCX/nav 递归迭代器：`booqs-epub/dist/toc.js` → `navPointsIterator` / `extractTocNavigationFromNav`
- fast-xml-parser 推荐配置：`booqs-epub/dist/xml.js` → `parseXml` / `parseHtml`
