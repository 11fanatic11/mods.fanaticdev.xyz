// Renders the mod list (/) and each mod page (/<slug>/) from /data/*.json.
(() => {
  const CFG = window.MODS_CONFIG;
  const $ = (sel, el = document) => el.querySelector(sel);
  const LOADERS = { fabric: "Fabric", neoforge: "NeoForge", forge: "Forge", quilt: "Quilt" };
  const isLocal = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^(https?:\/\/|\/)/i.test(u) ? u : "#");
  const fmt = (n) => (n == null ? "–" : Number(n).toLocaleString("en"));
  const loaderName = (l) => LOADERS[l] || l.charAt(0).toUpperCase() + l.slice(1);
  const parts = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
  function cmp(a, b) { // >0 when a is newer than b
    const pa = parts(a), pb = parts(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  const byNewest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : cmp(b.version, a.version));
  const fmtDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const fmtSize = (b) => (!b ? "" : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
  const fileUrl = (f) => f.url || (f.release ? `https://github.com/${CFG.repo}/releases/download/${encodeURIComponent(f.release)}/${encodeURIComponent(f.name)}` : null);

  function inline(text) { // tiny markdown: **bold**, `code`, [text](url)
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((.+?)\)/g, (_, t, u) => `<a href="${safeUrl(u.replace(/&amp;/g, "&"))}" target="_blank" rel="noopener">${t}</a>`);
  }

  async function json(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  }

  const cache = {
    get(key, ttl) {
      try { const v = JSON.parse(sessionStorage.getItem(key)); if (v && Date.now() - v.t < ttl) return v.d; } catch {}
      return undefined;
    },
    set(key, d) { try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch {} },
  };

  // ---------- counters ----------
  // Downloads: GitHub Release assets report their own download_count; a Modrinth project id adds Modrinth's total.
  let ghPromise;
  function githubCounts() {
    ghPromise ||= (async () => {
      const hit = cache.get("mods:gh", 10 * 60 * 1000);
      if (hit !== undefined) return hit;
      try {
        const r = await fetch(`https://api.github.com/repos/${CFG.repo}/releases?per_page=100`);
        if (!r.ok) return null;
        const map = {};
        for (const rel of await r.json()) for (const a of rel.assets) map[`${rel.tag_name}/${a.name}`] = a.download_count;
        cache.set("mods:gh", map);
        return map;
      } catch { return null; }
    })();
    return ghPromise;
  }
  async function modrinthCount(id) {
    const hit = cache.get(`mods:mr:${id}`, 10 * 60 * 1000);
    if (hit !== undefined) return hit;
    try {
      const r = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`);
      if (!r.ok) return null;
      const n = (await r.json()).downloads;
      cache.set(`mods:mr:${id}`, n);
      return n;
    } catch { return null; }
  }
  async function downloadCount(mod) {
    const files = mod.versions.flatMap((v) => v.files);
    const hosted = files.filter((f) => f.release);
    let total = 0;
    if (mod.modrinth) {
      const n = await modrinthCount(mod.modrinth);
      if (n == null) return null;
      total += n;
    }
    if (hosted.length) {
      const map = await githubCounts();
      if (!map) return null;
      for (const f of hosted) total += map[`${f.release}/${f.name}`] || 0;
    }
    return total;
  }

  // Views: counted once per browser per mod every 6 hours. Never counted from localhost.
  async function viewCount(slug, hit) {
    const seenKey = `mods:viewed:${slug}`;
    let count = hit && !isLocal;
    if (count) {
      try { const t = Number(localStorage.getItem(seenKey)); if (t && Date.now() - t < 6 * 3600 * 1000) count = false; } catch {}
    }
    try {
      const r = await fetch(`${CFG.views.base}/${count ? "hit" : "get"}/${CFG.views.namespace}/view-${encodeURIComponent(slug)}`);
      if (r.status === 404) return 0;
      if (!r.ok) return null;
      const v = (await r.json()).value;
      if (count) { try { localStorage.setItem(seenKey, String(Date.now())); } catch {} }
      return v;
    } catch { return null; }
  }

  // ---------- data helpers ----------
  async function loadAll() {
    const index = await json("/data/mods.json");
    const mods = await Promise.all(index.mods.map((s) => json(`/data/${s}.json`).catch(() => null)));
    return mods.filter((m) => m && m.versions && m.versions.length).map(prep);
  }
  function prep(mod) {
    mod.versions = [...mod.versions].sort(byNewest);
    return mod;
  }
  const allFiles = (mod) => mod.versions.flatMap((v) => v.files.map((f) => ({ ...f, _v: v })));
  const loadersOf = (mod) => [...new Set(allFiles(mod).map((f) => f.loader))];
  const mcOf = (mod, loader) => [...new Set(allFiles(mod).filter((f) => !loader || f.loader === loader).flatMap((f) => f.mc))].sort((a, b) => cmp(b, a));
  const badge = (c) => `<span class="badge badge-${esc(c || "release")}">${esc(c || "release")}</span>`;

  // ---------- list page ----------
  async function listPage() {
    const grid = $("#mod-grid");
    let mods = [];
    try { mods = await loadAll(); } catch { /* shows empty state */ }
    mods.sort((a, b) => byNewest(a.versions[0] || { date: "", version: "0" }, b.versions[0] || { date: "", version: "0" }));
    $("#fact-mods").textContent = mods.length;
    $("#toolbar").hidden = !mods.length;

    if (!mods.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Nothing here yet</h3><p>No mods have been published to this site yet. Check back soon.</p></div>`;
      $("#fact-downloads").textContent = "0";
      return;
    }

    const draw = (list) => {
      grid.innerHTML = list.map((m) => {
        const v = m.versions[0];
        const mcs = mcOf(m);
        const range = mcs.length ? (mcs.length > 1 ? `${mcs[mcs.length - 1]} – ${mcs[0]}` : mcs[0]) : "";
        return `<a class="mod-card" href="/${esc(m.slug)}/" data-slug="${esc(m.slug)}">
          <div class="mod-card-top">
            <img class="mod-icon" src="${esc(safeUrl(m.icon || "/assets/favicon.png"))}" alt="" width="64" height="64" loading="lazy">
            <div><h3>${esc(m.name)}</h3><span class="ver">${v ? `v${esc(v.version)} · ` : ""}${esc(m.side || "")}</span></div>
          </div>
          <p>${esc(m.tagline || "")}</p>
          <div class="chips">${loadersOf(m).map((l) => `<span class="chip">${esc(loaderName(l))}</span>`).join("")}${range ? `<span class="chip chip-plain">${esc(range)}</span>` : ""}</div>
          <div class="mod-card-foot"><span><b data-dl>–</b> downloads</span><span><b data-views>–</b> views</span></div>
        </a>`;
      }).join("") || `<div class="empty" style="grid-column:1/-1"><p>No mods match your search.</p></div>`;
      // fill live numbers
      for (const card of grid.querySelectorAll(".mod-card")) {
        const m = mods.find((x) => x.slug === card.dataset.slug);
        downloadCount(m).then((n) => (card.querySelector("[data-dl]").textContent = fmt(n)));
        viewCount(m.slug, false).then((n) => (card.querySelector("[data-views]").textContent = fmt(n)));
      }
    };
    draw(mods);
    $("#search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      draw(mods.filter((m) => [m.name, m.tagline, ...(m.categories || [])].join(" ").toLowerCase().includes(q)));
    });
    Promise.all(mods.map(downloadCount)).then((ns) => {
      $("#fact-downloads").textContent = fmt(ns.every((n) => n == null) ? null : ns.reduce((a, n) => a + (n || 0), 0));
    });
  }

  // ---------- mod page ----------
  function renderBlocks(blocks) {
    return (blocks || []).map((b) => {
      if (typeof b === "string") return `<p>${inline(b)}</p>`;
      if (b.heading) return `<h3>${esc(b.heading)}</h3>`;
      if (b.list) return `<ul>${b.list.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
      return "";
    }).join("");
  }

  function notFound(msg) {
    $("#app").innerHTML = `<div class="notfound"><h1>Mod not found</h1><p class="muted">${esc(msg)}</p><p><a class="btn btn-primary" href="/">Back to all mods</a></p></div>`;
  }

  async function modPage() {
    const slug = $('meta[name="mod-slug"]').content;
    let mod;
    try { mod = prep(await json(`/data/${slug}.json`)); } catch { return notFound("That mod doesn't exist (yet)."); }
    const latest = mod.versions[0];
    if (!latest) return notFound("This mod has no published versions yet.");

    document.title = `${mod.name} | FanaticDev Mods`;
    const loaders = loadersOf(mod);
    const side = mod.side || "";
    const links = Object.entries(mod.links || {}).map(([k, u]) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(k)} ↗</a>`).join("");

    $("#app").innerHTML = `
      <p class="crumbs"><a href="/">All mods</a> / ${esc(mod.name)}</p>
      <header class="mod-head">
        <img class="mod-icon" src="${esc(safeUrl(mod.icon || "/assets/favicon.png"))}" alt="" width="96" height="96">
        <div>
          <h1>${esc(mod.name)}</h1>
          <p class="tagline">${esc(mod.tagline || "")}</p>
          <div class="chips">${(mod.categories || []).map((c) => `<span class="chip">${esc(c)}</span>`).join("")}${side ? `<span class="chip chip-plain">${esc(side)}</span>` : ""}</div>
        </div>
      </header>
      <ul class="stat-row">
        <li><span>Latest version</span><b>v${esc(latest.version)}</b></li>
        <li><span>Downloads</span><b id="st-dl">–</b></li>
        <li><span>Views</span><b id="st-views">–</b></li>
        <li><span>Updated</span><b style="font-size:16px;padding-top:4px">${esc(fmtDate(latest.date))}</b></li>
      </ul>
      <div class="mod-layout">
        <div class="mod-main">
          <section class="panel dl-panel" id="download">
            <h2>Download</h2>
            <div class="dl-controls">
              <label>Mod loader<select class="select" id="dl-loader"></select></label>
              <label>Minecraft version<select class="select" id="dl-mc"></select></label>
            </div>
            <div class="dl-result" id="dl-result"></div>
          </section>
          <section class="panel" id="about"><h2>About</h2>${renderBlocks(mod.description)}
            ${(mod.gallery || []).length ? `<div class="gallery">${mod.gallery.map((g) => `<figure><a href="${esc(safeUrl(g.src))}" target="_blank" rel="noopener"><img src="${esc(safeUrl(g.src))}" alt="${esc(g.caption || "Screenshot")}" loading="lazy"></a>${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}
          </section>
          <section class="panel" id="history"><h2>Update history</h2>${mod.versions.map(versionItem).join("")}</section>
        </div>
        <aside class="mod-side">
          <div class="panel"><h2>Details</h2>
            <dl class="kv">
              <div><dt>Version</dt><dd>v${esc(latest.version)}</dd></div>
              <div><dt>Released</dt><dd>${esc(fmtDate(mod.versions[mod.versions.length - 1].date))}</dd></div>
              ${side ? `<div><dt>Side</dt><dd>${esc(side)}</dd></div>` : ""}
              ${mod.license ? `<div><dt>License</dt><dd>${esc(mod.license)}</dd></div>` : ""}
            </dl>
            ${links ? `<div class="link-list">${links}</div>` : ""}
          </div>
          <div class="panel"><h2>Supported</h2>
            ${loaders.map((l) => `<div class="loader-block"><b>${esc(loaderName(l))}</b><div class="chips">${mcOf(mod, l).map((v) => `<span class="chip chip-plain">${esc(v)}</span>`).join("")}</div></div>`).join("")}
          </div>
        </aside>
      </div>`;

    setupPicker(mod, loaders);
    downloadCount(mod).then((n) => ($("#st-dl").textContent = fmt(n)));
    viewCount(slug, true).then((n) => ($("#st-views").textContent = fmt(n)));
  }

  function versionItem(v) {
    const byLoader = {};
    for (const f of v.files) (byLoader[f.loader] ||= []).push(f);
    const changes = (v.changelog || []).length
      ? `<ul>${v.changelog.map((c) => `<li>${inline(c)}</li>`).join("")}</ul>`
      : `<p class="none">No changelog was published for this version.</p>`;
    const files = Object.entries(byLoader).map(([l, fs]) => `<div class="file-group"><b>${esc(loaderName(l))}</b><div class="chips">${
      fs.map((f) => `<a href="${esc(safeUrl(fileUrl(f) || "#"))}" rel="noopener" title="${esc(f.name)}">${esc(f.mc.join(", "))}</a>`).join("")}</div></div>`).join("");
    return `<article class="ver-item">
      <div class="ver-head"><h3>v${esc(v.version)}</h3>${badge(v.channel)}<time datetime="${esc(v.date)}">${esc(fmtDate(v.date))}</time></div>
      ${changes}
      <details><summary>Files (${v.files.length})</summary>${files}</details>
    </article>`;
  }

  function setupPicker(mod, loaders) {
    const selL = $("#dl-loader"), selM = $("#dl-mc"), out = $("#dl-result");
    const q = new URLSearchParams(location.search);
    const newestFile = allFiles(mod)[0];
    selL.innerHTML = loaders.map((l) => `<option value="${esc(l)}">${esc(loaderName(l))}</option>`).join("");
    selL.value = loaders.includes(q.get("loader")) ? q.get("loader") : newestFile.loader;

    function fillMc(keep) {
      const list = mcOf(mod, selL.value);
      selM.innerHTML = list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
      selM.value = list.includes(keep) ? keep : list[0];
    }
    function show() {
      let found = null;
      for (const v of mod.versions) {
        const f = v.files.find((x) => x.loader === selL.value && x.mc.includes(selM.value));
        if (f) { found = { v, f }; break; }
      }
      if (!found) { out.innerHTML = `<span class="muted">No download for that combination.</span>`; return; }
      const url = fileUrl(found.f);
      out.innerHTML = `<div>
          <div class="line"><b>v${esc(found.v.version)}</b>${badge(found.v.channel)}<span class="muted">${esc(loaderName(found.f.loader))} · Minecraft ${esc(selM.value)}${found.f.size ? ` · ${esc(fmtSize(found.f.size))}` : ""}</span></div>
          <div class="file">${esc(found.f.name)}</div>
        </div>
        <a class="btn btn-primary" href="${esc(safeUrl(url || "#"))}" rel="noopener" ${url ? "" : 'aria-disabled="true"'}>Download</a>`;
    }
    fillMc(q.get("mc"));
    show();
    selL.addEventListener("change", () => { fillMc(selM.value); show(); });
    selM.addEventListener("change", show);
  }

  document.getElementById("year").textContent = new Date().getFullYear();
  (document.body.dataset.page === "mod" ? modPage : listPage)();
})();
