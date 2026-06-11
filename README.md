# Orbiter Cut Planner

A sleek, calm blueprint-to-foam cut planner. Upload a blueprint photo (e.g. a NASA
Space Shuttle orbiter underside), scale it to your real foam-board size, trace it into
clean editable lines, and read off exact lengths (in feet & inches) and angles for
cutting and drawing.

## Features

- **Projects** saved to browser `localStorage` — open → saves gallery → workspace.
- **Foam board** sized in feet/inches with fractions (`3ft 4in`, `3' 4 1/2"`, `40in`).
- **Place & transform** the image to scale on the board: move, **Maximize & center**,
  size slider, **Fit inside**, **Rotate 90°** / free rotate, **Flip**, opacity, and **Crop**.
- **Vectorize** (edge-detect + tracing) turns the photo into editable lines/curves and
  **auto-filters text/numbers** by size. Adjustable sensitivity, detail, noise filter, invert.
- **Smooth & straighten** — Douglas–Peucker simplification, snap-straight-to-axis, and
  optional **mirror symmetry** (great for symmetric shapes like a shuttle).
- **Inspect** — hover any traced line to see its **length (ft/in) and angle**, plus Δh/Δv
  and the drawing's center. **Measure** tool to draw your own reference lines.
- **AI identify (optional)** — when an AI service is configured server-side, identifies the
  shape and tunes the cleanup automatically; otherwise falls back to local refinement.

## Run locally

```bash
npm install
npm start            # http://localhost:8080  (PORT env overrides)
```

## Deploy to Cloud Foundry

```bash
cf push              # uses manifest.yml (Node.js buildpack)
```

### Optional AI shape identification

Set an Anthropic API key so the **Identify shape with AI** button uses Claude vision:

```bash
cf set-env orbiter-cut-planner ANTHROPIC_API_KEY <your-key>
cf restage orbiter-cut-planner
```

The endpoint reports `{available:false}` and the app falls back to local cleanup when no
key is present, so it always works either way.

## Stack

Vanilla JS + Canvas/SVG, [ImageTracer.js](https://github.com/jankovicsandras/imagetracerjs)
(vendored, public domain), Express static server. No build step.
