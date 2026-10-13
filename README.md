# mods.fanaticdev.xyz

Source for https://mods.fanaticdev.xyz, the download site for 11fanatic11's Minecraft mods.

It is a plain static site on GitHub Pages (no build step). Every mod gets a page at `/<slug>/` with a loader and Minecraft version picker, a download button, update history, and download and view counters.

## How it works

| Piece | Where it lives |
|---|---|
| Mod list and details | `data/mods.json` (ordered list of slugs) and `data/<slug>.json` (one file per mod) |
| Per-mod pages | `<slug>/index.html`, generated from `_template/index.html` by `scripts/mods.py sync`. Don't edit by hand. |
| The mod jars | **GitHub Releases** of this repo, one release per mod version, tagged `<slug>-v<version>` |
| Download counts | GitHub reports each release asset's `download_count`. A mod that is also on Modrinth can set `"modrinth": "<project id>"` to add Modrinth's total. |
| View counts | Public counter at `abacus.jasoncameron.dev` (namespace `fanaticdev-mods`). One view per browser per mod per 6 hours. Never counted from localhost. If that service ever disappears, only `viewCount()` in `app.js` and `views` in `config.js` need replacing. |

## Adding or updating a mod

Everything goes through `scripts/mods.py` (Python 3, standard library only; on Windows use `py -3` if `python` isn't found). It needs the GitHub CLI `gh` logged in with access to this repo.

1. **Name the jars** `<slug>-<version>-<loader>-<minecraft version>.jar` and put them in one folder, for example `cool-mod-1.2.0-fabric-1.21.11.jar` and `cool-mod-1.2.0-neoforge-26.1.2.jar`. Loaders are `fabric`, `neoforge`, `forge` or `quilt`. The file name is exactly what visitors download.
2. **New mod only:**
   ```
   python scripts/mods.py new cool-mod --name "Cool Mod" --tagline "One sentence about it." --side Client --icon path/to/icon.png
   ```
   (`--side` is `Client`, `Server` or `Both`. Add `--license`, `--modrinth <id>` if relevant.) Then edit `data/cool-mod.json`: `categories`, `links`, `description` and `gallery` (copy screenshots into `assets/` and use `/assets/name.png`).
3. **Add the version** (new mod or update):
   ```
   python scripts/mods.py add-version cool-mod 1.2.0 --dir path/to/jars --changelog "Fixed a crash" --changelog "Added X" --channel release
   ```
   This creates the GitHub release, uploads the jars, adds the version to `data/cool-mod.json`, regenerates the pages and validates everything. `--channel` is `release` (default), `beta` or `alpha`.
4. **Publish:** `git add -A`, commit, `git push`. The site updates about a minute later. Check `https://mods.fanaticdev.xyz/cool-mod/`.

Other things you may need:

- Add more jars to a version that already exists: run `add-version` again with the same version number. Files are added, and the changelog is replaced only if you pass a new one.
- Jars with unusual names: `--file loader:mc[,mc2]:path/to.jar` (repeatable). The uploaded file name is the local file name.
- Change text only (description, links, tagline): edit the JSON, then `python scripts/mods.py sync`.
- `python scripts/mods.py validate` checks everything. Run it before pushing.
- Preview locally: `python -m http.server 8000` in the repo root, then open http://localhost:8000.

## Data format

`data/<slug>.json`:

```json
{
  "slug": "cool-mod",
  "name": "Cool Mod",
  "tagline": "One sentence about it.",
  "icon": "/assets/cool-mod.png",
  "side": "Client",
  "categories": ["Utility"],
  "license": "MIT",
  "modrinth": "optional Modrinth project id",
  "links": { "Modrinth": "https://modrinth.com/mod/cool-mod" },
  "description": [
    "A paragraph. Supports **bold**, `code` and [links](https://example.com).",
    { "heading": "Features" },
    { "list": ["First feature", "Second feature"] }
  ],
  "gallery": [{ "src": "/assets/cool-mod-1.png", "caption": "Optional caption" }],
  "versions": [
    {
      "version": "1.2.0",
      "date": "2026-10-13",
      "channel": "release",
      "changelog": ["Fixed a crash", "Added X"],
      "files": [
        { "loader": "fabric", "mc": ["1.21.11"], "name": "cool-mod-1.2.0-fabric-1.21.11.jar", "release": "cool-mod-v1.2.0", "size": 123456 }
      ]
    }
  ]
}
```

Each file has `loader`, `mc` (a list of Minecraft versions that jar works on), `name`, and exactly one of `release` (a tag in this repo's Releases, the normal case) or `url` (a direct link, for files hosted elsewhere). The newest version containing a matching loader and Minecraft version is what the download picker offers.

## Rules

- This repository is **public**. Only commit finished, public jars (as release assets), never source code with secrets, `.env` files, keys or passwords.
- Don't hand-edit `<slug>/index.html`, `sitemap.xml` or `robots.txt`; `sync` regenerates them.
- Slugs are lowercase letters, digits and dashes. `assets`, `data`, `scripts` and `_template` are reserved.
