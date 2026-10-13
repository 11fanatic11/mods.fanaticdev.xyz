#!/usr/bin/env python3
"""Manage mods.fanaticdev.xyz. Python 3 standard library only.

  python scripts/mods.py new <slug> --name "Name" --tagline "One line" [--side Client|Server|Both] [--icon path.png]
  python scripts/mods.py add-version <slug> <version> --dir <folder-of-jars> --changelog "Fixed X" [--channel release|beta|alpha]
  python scripts/mods.py sync        # rebuild per-mod pages, sitemap; also runs validate
  python scripts/mods.py validate

Run from anywhere; paths are relative to the repo root. Uploading jars needs the GitHub CLI (`gh`) logged in.
"""
import argparse, datetime, html, json, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITE = "https://mods.fanaticdev.xyz"
REPO = "11fanatic11/mods.fanaticdev.xyz"
RESERVED = {"assets", "data", "scripts", "_template", "404", "index"}
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
JAR_RE = re.compile(r"^(?P<slug>.+?)-(?P<version>\d[^-]*)-(?P<loader>[a-z]+)-(?P<mc>\d[\w.]*)\.jar$")


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def vkey(v):
    return tuple(int(p) if p.isdigit() else 0 for p in v.split("."))


def index():
    return read_json(DATA / "mods.json")


def load(slug):
    p = DATA / f"{slug}.json"
    if not p.exists():
        die(f"no data file for '{slug}' (run `new` first)")
    return read_json(p)


def save(slug, mod):
    mod["versions"].sort(key=lambda v: (v["date"], vkey(v["version"])), reverse=True)
    write_json(DATA / f"{slug}.json", mod)


# ---------- sync (per-mod pages + sitemap) ----------
def render_page(mod):
    tpl = (ROOT / "_template" / "index.html").read_text(encoding="utf-8")
    title = f"{mod['name']} | FanaticDev Mods"
    icon = mod.get("icon") or "/assets/logo-512.png"
    image = icon if icon.startswith("http") else SITE + icon
    subs = {
        "{{TITLE}}": html.escape(title, quote=True),
        "{{DESC}}": html.escape(mod.get("tagline", ""), quote=True),
        "{{SLUG}}": mod["slug"],
        "{{IMAGE}}": image,
        "{{URL}}": f"{SITE}/{mod['slug']}/",
    }
    for k, v in subs.items():
        tpl = tpl.replace(k, v)
    return tpl


def cmd_sync(_args=None):
    slugs = index()["mods"]
    for slug in slugs:
        mod = load(slug)
        out = ROOT / slug / "index.html"
        out.parent.mkdir(exist_ok=True)
        out.write_text(render_page(mod), encoding="utf-8")
    urls = [f"{SITE}/"] + [f"{SITE}/{s}/" for s in slugs]
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls) + "</urlset>\n", encoding="utf-8")
    (ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n", encoding="utf-8")
    print(f"synced {len(slugs)} mod page(s)")
    return cmd_validate(None)


# ---------- validate ----------
def cmd_validate(_args):
    errors = []
    idx = index()
    if len(set(idx["mods"])) != len(idx["mods"]):
        errors.append("data/mods.json has duplicate slugs")
    for slug in idx["mods"]:
        p = DATA / f"{slug}.json"
        if not SLUG_RE.match(slug) or slug in RESERVED:
            errors.append(f"{slug}: invalid or reserved slug")
        if not p.exists():
            errors.append(f"{slug}: data/{slug}.json is missing")
            continue
        m = read_json(p)
        for k in ("slug", "name", "tagline", "versions"):
            if not m.get(k):
                errors.append(f"{slug}: missing '{k}'")
        if m.get("slug") != slug:
            errors.append(f"{slug}: 'slug' field is '{m.get('slug')}'")
        icon = m.get("icon", "")
        if icon.startswith("/") and not (ROOT / icon.lstrip("/")).exists():
            errors.append(f"{slug}: icon file {icon} not found")
        for g in m.get("gallery", []):
            if g["src"].startswith("/") and not (ROOT / g["src"].lstrip("/")).exists():
                errors.append(f"{slug}: gallery image {g['src']} not found")
        seen = set()
        for v in m.get("versions", []):
            tag = f"{slug} v{v.get('version')}"
            if v.get("version") in seen:
                errors.append(f"{tag}: duplicate version")
            seen.add(v.get("version"))
            if not re.match(r"^\d+(\.\d+)*$", str(v.get("version", ""))):
                errors.append(f"{tag}: version must look like 1.2.3")
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(v.get("date", ""))):
                errors.append(f"{tag}: date must be YYYY-MM-DD")
            if v.get("channel", "release") not in ("release", "beta", "alpha"):
                errors.append(f"{tag}: channel must be release, beta or alpha")
            if not v.get("files"):
                errors.append(f"{tag}: no files")
            for f in v.get("files", []):
                if not f.get("loader") or not f.get("mc") or not f.get("name"):
                    errors.append(f"{tag}: file needs loader, mc (list) and name: {f}")
                elif not isinstance(f["mc"], list):
                    errors.append(f"{tag}: {f['name']}: 'mc' must be a list")
                if bool(f.get("url")) == bool(f.get("release")):
                    errors.append(f"{tag}: {f.get('name')}: set exactly one of 'url' or 'release'")
        page = ROOT / slug / "index.html"
        if not page.exists():
            errors.append(f"{slug}: page missing, run `sync`")
        elif page.read_text(encoding="utf-8") != render_page(m):
            errors.append(f"{slug}: page is out of date, run `sync`")
    for e in errors:
        print("  -", e)
    print("validate: OK" if not errors else f"validate: {len(errors)} problem(s)")
    return 1 if errors else 0


# ---------- new ----------
def cmd_new(a):
    slug = a.slug
    if not SLUG_RE.match(slug) or slug in RESERVED:
        die("slug must be lowercase letters, digits and dashes (e.g. 'my-mod') and not a reserved name")
    if (DATA / f"{slug}.json").exists():
        die(f"'{slug}' already exists")
    icon = ""
    if a.icon:
        src = Path(a.icon)
        if not src.exists():
            die(f"icon not found: {src}")
        dest = ROOT / "assets" / f"{slug}{src.suffix.lower()}"
        shutil.copyfile(src, dest)
        icon = f"/assets/{dest.name}"
    mod = {
        "slug": slug, "name": a.name, "tagline": a.tagline,
        "icon": icon or "/assets/logo-512.png",
        "side": a.side, "categories": [], "license": a.license or "",
        "links": {}, "description": [a.tagline], "gallery": [], "versions": [],
    }
    if a.modrinth:
        mod["modrinth"] = a.modrinth
    write_json(DATA / f"{slug}.json", mod)
    idx = index()
    idx["mods"].append(slug)
    write_json(DATA / "mods.json", idx)
    print(f"created data/{slug}.json. Edit description/categories/links, then add a version.")
    # a mod with no versions is invalid until add-version runs; page is generated then.


# ---------- add-version ----------
def gh(*args, check=True):
    try:
        return subprocess.run(["gh", *args], check=check, capture_output=True, text=True)
    except FileNotFoundError:
        die("GitHub CLI `gh` not found (needed to upload jars). Install it and run `gh auth login`.")
    except subprocess.CalledProcessError as e:
        die(f"gh {' '.join(args[:3])} failed:\n{e.stderr or e.stdout}")


def cmd_add_version(a):
    mod = load(a.slug)
    version = a.version.lstrip("v")
    if not re.match(r"^\d+(\.\d+)*$", version):
        die("version must look like 1.2.3")
    tag = f"{a.slug}-v{version}"
    files = []  # (loader, [mc], Path)
    for spec in a.file or []:
        try:
            loader, mcs, path = spec.split(":", 2)
        except ValueError:
            die(f"--file must be loader:mc[,mc2]:path, got '{spec}'")
        files.append((loader.lower(), mcs.split(","), Path(path)))
    if a.dir:
        for jar in sorted(Path(a.dir).glob("*.jar")):
            m = JAR_RE.match(jar.name)
            if not m or m["slug"] != a.slug or m["version"] != version:
                print(f"  skipping {jar.name} (doesn't match {a.slug}-{version}-<loader>-<mc>.jar)")
                continue
            files.append((m["loader"], [m["mc"]], jar))
    if not files:
        die("no jars found. Name them <slug>-<version>-<loader>-<mc>.jar and pass --dir, or use --file loader:mc:path")
    for _, _, p in files:
        if not p.exists():
            die(f"missing file: {p}")
    names = [p.name for _, _, p in files]
    if len(set(names)) != len(names):
        die("two files share the same file name")

    entries = [{"loader": l, "mc": mcs, "name": p.name, "release": tag, "size": p.stat().st_size} for l, mcs, p in files]
    existing = next((v for v in mod["versions"] if v["version"] == version), None)
    changelog = list(a.changelog or [])
    if a.changelog_file:
        changelog += [ln.strip().lstrip("-* ").strip() for ln in Path(a.changelog_file).read_text(encoding="utf-8").splitlines() if ln.strip()]
    if existing:
        by_name = {f["name"]: f for f in existing["files"]}
        for e in entries:
            by_name[e["name"]] = e
        existing["files"] = sorted(by_name.values(), key=lambda f: (f["loader"], f["name"]))
        if changelog:
            existing["changelog"] = changelog
        if a.channel:
            existing["channel"] = a.channel
        if a.date:
            existing["date"] = a.date
    else:
        if not changelog:
            die("give --changelog 'what changed' (repeat for several lines) or --changelog-file")
        mod["versions"].append({
            "version": version, "date": a.date or datetime.date.today().isoformat(),
            "channel": a.channel or "release", "changelog": changelog,
            "files": sorted(entries, key=lambda f: (f["loader"], f["name"])),
        })

    print(f"{'updating' if existing else 'adding'} {a.slug} v{version}: {len(entries)} file(s), release tag {tag}")
    if a.dry_run:
        print("dry run: nothing uploaded or written")
        return 0
    if gh("release", "view", tag, "--repo", REPO, check=False).returncode != 0:
        gh("release", "create", tag, "--repo", REPO, "--title", f"{mod['name']} {version}",
           "--notes", "\n".join(f"- {c}" for c in changelog) or f"{mod['name']} {version}")
    paths = [str(p) for _, _, p in files]
    for i in range(0, len(paths), 15):  # chunks keep the command short enough for Windows
        gh("release", "upload", tag, *paths[i:i + 15], "--repo", REPO, "--clobber")
        print(f"  uploaded {min(i + 15, len(paths))}/{len(paths)}")
    save(a.slug, mod)
    return cmd_sync()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new"); n.add_argument("slug"); n.add_argument("--name", required=True); n.add_argument("--tagline", required=True)
    n.add_argument("--side", default="Both", choices=["Client", "Server", "Both"]); n.add_argument("--icon"); n.add_argument("--license"); n.add_argument("--modrinth")
    v = sub.add_parser("add-version"); v.add_argument("slug"); v.add_argument("version")
    v.add_argument("--dir"); v.add_argument("--file", action="append", help="loader:mc[,mc2]:path/to.jar (repeatable)")
    v.add_argument("--changelog", action="append"); v.add_argument("--changelog-file"); v.add_argument("--channel", choices=["release", "beta", "alpha"])
    v.add_argument("--date", help="YYYY-MM-DD (default today)"); v.add_argument("--dry-run", action="store_true")
    sub.add_parser("sync"); sub.add_parser("validate")
    a = ap.parse_args()
    rc = {"new": cmd_new, "add-version": cmd_add_version, "sync": cmd_sync, "validate": cmd_validate}[a.cmd](a)
    sys.exit(rc or 0)


if __name__ == "__main__":
    main()
