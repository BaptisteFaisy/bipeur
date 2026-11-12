/**
 * One stylesheet for the landing and the docs: dark and sober (#12100e, the
 * pager's own background), system monospace, no webfont, no animation
 * (docs/ART-DIRECTION.md). AA contrast: #f2efe6 on #12100e is ~15:1.
 */
export const siteCss = `
:root {
  --bg: #12100e;
  --panel: #1b1916;
  --line: #2c2822;
  --ink: #f2efe6;
  --muted: #b7b1a4;
  --accent: #9fae8f;
  --green: #58c46a;
  --amber: #e0a33a;
  --red: #d9534f;
  --focus: #7cc4ff;
  --mono: "Courier New", ui-monospace, SFMono-Regular, Menlo, monospace;
}

* { box-sizing: border-box; }

html, body { margin: 0; padding: 0; }

body {
  background: radial-gradient(circle at 50% 0%, #221f1b 0%, var(--bg) 60%);
  color: var(--ink);
  font-family: var(--mono);
  font-variant-ligatures: none;
  letter-spacing: 0.04em;
  line-height: 1.55;
}

.wrap { max-width: 60rem; margin: 0 auto; padding: 0 1.25rem 4rem; }

a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 3px; }
a:hover { color: var(--ink); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

/* ---------- landing ---------- */

.hero { padding: 4.5rem 0 2.5rem; border-bottom: 1px solid var(--line); }
.hero h1 { margin: 0 0 1rem; font-size: clamp(1.6rem, 4vw, 2.4rem); letter-spacing: 0.08em; text-transform: uppercase; }
.hero .pitch { margin: 0; color: var(--muted); font-size: 1.05rem; max-width: 46rem; }
.hero .brandline { margin: 0 0 1.5rem; color: var(--accent); font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }

h2 { margin: 3rem 0 1rem; font-size: 1.15rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }

.grid { display: grid; gap: 0.9rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); padding: 0; margin: 0; list-style: none; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.1rem; }
.card h3 { margin: 0 0 0.4rem; font-size: 1rem; letter-spacing: 0.06em; }
.card p { margin: 0 0 0.6rem; color: var(--muted); font-size: 0.9rem; }
.card .cta { display: inline-block; font-weight: 700; }
.card code { color: var(--ink); }

table { border-collapse: collapse; width: 100%; margin: 0; }
th, td { text-align: left; padding: 0.55rem 0.7rem; border: 1px solid var(--line); font-size: 0.92rem; }
th { color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.8rem; }
.lamp { display: inline-block; width: 0.7rem; height: 0.7rem; margin-right: 0.5rem; }
.lamp-green { background: var(--green); border-radius: 50%; }
.lamp-amber { background: var(--amber); transform: rotate(45deg); }
.lamp-red { background: var(--red); }

pre.line { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.1rem; overflow-x: auto; color: var(--ink); margin: 0; }

.note { background: var(--panel); border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; padding: 0.9rem 1.1rem; color: var(--muted); }
.note strong { color: var(--ink); }

footer { margin-top: 4rem; padding-top: 1.2rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.9rem; }

/* ---------- dashboard (framed Central) ---------- */

.dashboard-main { display: flex; flex-direction: column; height: calc(100vh - 6.5rem); height: calc(100dvh - 6.5rem); }
.dashboard-frame { flex: 1; width: 100%; border: 0; background: var(--bg); }
.dashboard-note { margin: 0.7rem auto 1rem; color: var(--muted); font-size: 0.85rem; }

/* ---------- docs ---------- */

.docs-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1.5rem; padding: 1.2rem 0; border-bottom: 1px solid var(--line); }
.docs-header .home { font-weight: 700; }
.docs-nav { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; list-style: none; margin: 0; padding: 0; font-size: 0.9rem; }
.docs-nav a[aria-current="page"] { color: var(--ink); font-weight: 700; text-decoration: none; }

article.markdown { padding-top: 1.5rem; }
article.markdown h1, article.markdown h2, article.markdown h3 { letter-spacing: 0.06em; line-height: 1.3; }
article.markdown h1 { font-size: 1.5rem; margin: 0 0 1rem; color: var(--ink); text-transform: none; }
article.markdown h2 { margin-top: 2.2rem; }
article.markdown pre { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 0.9rem 1rem; overflow-x: auto; font-size: 0.88rem; }
article.markdown code { font-family: var(--mono); font-size: 0.9em; }
article.markdown :not(pre) > code { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 0.05rem 0.3rem; }
article.markdown blockquote { margin: 0; padding: 0.2rem 1rem; border-left: 3px solid var(--line); color: var(--muted); }
article.markdown img { max-width: 100%; }
`.trimStart();
