# Epub Importer

Import .epub file into Obsidian as markdown notes.

> [!IMPORTANT]
> This plugin is still in a very early stage and will probably only work with some specific formats of .epub files. If you find any incompatibilities, please let me know.

> [!NOTE]
> the plugin need to access files outside of Obsidian vaults, becasue .epub file is outside of Obsidian vaults. 

## ⚙️ Usage

Get the plugin from obsidian BRAT plugin.

Run `Epub Importer: Import epub to your vault` command, 
and input the absolute path to .epub file you want to import it into your obsidian vault.
Then, .epub file will be converted to a folder and some notes, 
so you can read the book directly in obsidian, and make some marks, make some links and notes.

![](https://github.com/aoout/obsidian-epub-importer/assets/60838705/9fb8d43a-ad4e-4873-9b79-aa45549733f2)

## 📥 Installation

- [ ] From Obsidian's community plugins
- [x] Using BRAT with `https://github.com//epub-importer`
- [x] From the release page:
- Download the latest release
- Unzip `epub-importer.zip` in `.obsidian/plugins/` path
- In Obsidian settings, reload the plugin
- Enable the plugin

## 🤖 Developing

To make changes to this plugin, first ensure you have the dependencies installed.

```
npm install
```

To start building the plugin with what mode enabled run the following command:

```
npm run dev
```

> **Note**
> If you haven't already installed the hot-reload-plugin you'll be prompted to. You need to enable that plugin in your obsidian vault before hot-reloading will start. You might need to refresh your plugin list for it to show up.
> To start a release build run the following command:

```
npm run build
```

> **Note**
> You can use the `.env` file with adding the key `VAULT_DEV` to specify the path to your Obsidian (development) vault. This will allow you to test your plugin without specify each times the path to the vault.

### 📤 Export

You can use the `npm run export` command to export your plugin to your Obsidian Main Vault. To do that, you need the `.env` file with the following content:

```env
VAULT="path/to/your/obsidian/vault"
VAULT_DEV="path/to/your/dev/vault"
```