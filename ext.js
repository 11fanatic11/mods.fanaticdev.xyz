// Site-wide extras (loaded on every page).
(() => {
  const CLICKS = 7;      // clicks needed on the footer logo
  const WINDOW_MS = 2000; // max gap between clicks

  const css = `
.pop-root{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,3,10,.78);animation:pop-fade .2s ease-out}
.pop-box{position:relative;display:flex;align-items:center;gap:20px;max-width:560px;padding:20px;background:var(--surface,#160f22);border:1px solid var(--purple,#8b5cf6);border-radius:var(--radius,14px);box-shadow:0 30px 80px -20px rgba(139,92,246,.55);animation:pop-in .25s cubic-bezier(.2,1.3,.4,1)}
.pop-box img{width:min(240px,42vw);height:auto;border-radius:10px;border:1px solid var(--border,#2c1f44);flex-shrink:0}
.pop-say{position:relative;padding:14px 18px;background:var(--bg,#0a0710);border:1px solid var(--purple-deep,#5b21b6);border-radius:12px;font-family:var(--sans,system-ui,sans-serif);font-weight:600;font-size:20px;line-height:1.35;color:var(--text,#ece6f7)}
.pop-say::before{content:"";position:absolute;left:-8px;top:50%;width:14px;height:14px;background:var(--bg,#0a0710);border-left:1px solid var(--purple-deep,#5b21b6);border-bottom:1px solid var(--purple-deep,#5b21b6);transform:translateY(-50%) rotate(45deg)}
.pop-x{position:absolute;top:6px;right:8px;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--muted,#9d90b5);font-size:22px;line-height:1;cursor:pointer}
.pop-x:hover,.pop-x:focus-visible{color:#fff;background:var(--surface-2,#1d142d)}
.pop-x:focus-visible{outline:2px solid var(--purple-2,#a78bfa)}
@keyframes pop-fade{from{opacity:0}to{opacity:1}}
@keyframes pop-in{from{opacity:0;transform:scale(.85) translateY(10px)}to{opacity:1;transform:none}}
@media (max-width:560px){.pop-box{flex-direction:column;text-align:center;padding-top:30px}.pop-box img{width:min(220px,60vw)}.pop-say::before{left:50%;top:-8px;transform:translateX(-50%) rotate(135deg)}}
@media (prefers-reduced-motion:reduce){.pop-root,.pop-box{animation:none}}
`;

  let root = null;
  let returnTo = null;

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    document.removeEventListener("keydown", onKey, true);
    if (returnTo && document.contains(returnTo)) returnTo.focus();
    returnTo = null;
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault(); // the close button is the only focusable element
      root.querySelector(".pop-x").focus();
    }
  }

  function open() {
    if (root) return;
    if (!document.getElementById("pop-css")) {
      const style = document.createElement("style");
      style.id = "pop-css";
      style.textContent = css;
      document.head.appendChild(style);
    }
    returnTo = document.activeElement;
    root = document.createElement("div");
    root.className = "pop-root";
    root.innerHTML =
      '<div class="pop-box" role="dialog" aria-modal="true" aria-label="Gerald">' +
      '<button type="button" class="pop-x" aria-label="Close">×</button>' +
      '<img src="/assets/gerald.png" alt="Gerald the cat" width="286" height="278">' +
      "<p class=\"pop-say\">hi, I'm Gerald :D</p></div>";
    root.addEventListener("click", (e) => {
      if (e.target === root || e.target.closest(".pop-x")) close();
    });
    document.body.appendChild(root);
    document.addEventListener("keydown", onKey, true);
    root.querySelector(".pop-x").focus();
  }

  let count = 0;
  let timer;
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".footer img")) return;
    clearTimeout(timer);
    count += 1;
    if (count >= CLICKS) {
      count = 0;
      open();
      return;
    }
    timer = setTimeout(() => (count = 0), WINDOW_MS);
  });
})();
