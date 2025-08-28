# Desert Caravan Tycoon (WebGL2)

[![Play on GitHub Pages](https://img.shields.io/badge/Play%20Now-GitHub%20Pages-brightgreen?logo=github)](https://vavius.github.io/Tycoon3D/)

Live demo: https://vavius.github.io/Tycoon3D/  (откройте и играйте сразу в браузере)

Procedural low‑poly desert trading game in the browser. Manage caravans, survive heat and thirst, find oases, avoid bandits, and watch the sun, stars and dynamic fog paint the dunes through a full day/night cycle — all in pure JavaScript + raw WebGL2 (no engines, no bundlers).

## ⚙️ Tech Highlights
* Pure WebGL2 shader pipeline (no Three.js)
* Procedural terrain (deterministic height function) with background ring & far plane illusion of infinite desert
* Dynamic sky: animated sun arc, twilight glow, rotating starfield that only appears at night
* Time‑of‑day driven lighting + color grading + dynamic fog (color & density shift over day/night)
* Hydration & camel mortality system; oases and inns restore water
* Caravan entities, bandit event system, random world events & log feed
* Seamless low‑poly style (single mesh + background chunks)
* Zero build step — deploy as static files (ideal for GitHub Pages)

## 🎮 Gameplay & Mechanics
### Controls
* Mouse drag: rotate camera (orbit)
* Mouse wheel / pinch: zoom (distance capped for performance & style)
* WASD / Arrow keys: move camera focus point across desert (pan)
* (Game actions like sending caravans / trading can be expanded; current focus is exploration & survival loop)

### Day / Night Cycle
* Full 24h loop (accelerated) drives sun elevation and ambient light
* Stars fade in only when sun below horizon
* Warm atmospheric tint at sunrise / sunset

### Hydration & Camels
* Caravans lose hydration; faster when traveling
* Near an oasis: regain water (faster with an inn)
* At zero hydration a timer counts — camels may die; all lost => caravan stranded

### Oases & Inns
* Oases spaced with a minimum distance to avoid clustering
* Inns (when present) boost refill efficiency and can become future gameplay hubs

### Events & Bandits
* Periodic random events affect resources or trigger encounters (simplified placeholders now)

## 📂 Project Structure
```
index.html          # Entry HTML (loads ES module)
styles.css          # HUD / overlay styles
src/
  main.js           # Game bootstrap, loop, world generation, rendering
  engine/gl.js      # WebGL helper utilities
  core/loop.js      # Minimal RAF-based game loop
  core/input.js     # Keyboard state tracker
assets/             # Placeholder for future art/audio
.nojekyll           # Required so GitHub Pages serves module paths unchanged
.gitignore          # Housekeeping
LICENSE             # MIT
```

## 🧪 Run Locally
Any static server (modules need http://):
```bash
# Python
python -m http.server 8000

# OR Node (if installed)
npx serve .
```
Open http://localhost:8000 (add `?v=123` to bypass cache after edits).

## 🚀 Deploy on GitHub Pages
1. Create a new GitHub repository (public or private with Pages enabled).
2. Ensure this project root contains: `index.html`, `src/`, `.nojekyll` (already here).
3. Initialize & push (first time):
   ```bash
   git init
   git add .
   git commit -m "Initial game version"
   git branch -M main
   git remote add origin https://github.com/<USER>/<REPO>.git
   git push -u origin main
   ```
4. In GitHub repo Settings → Pages: Source = Deploy from Branch, Branch = `main` / root.
5. Wait for Pages to build (~30s). Visit https://<USER>.github.io/<REPO>/
6. If you update often, append a cache buster: `...?v=timestamp`.

### Optional: Automatic Cache Busting Badge / Version
Add a manual version in `index.html` query when loading `src/main.js?v=1` and increment to invalidate CDN.

### Custom Domain (Optional)
Add `CNAME` file with your domain and configure DNS (A records → GitHub Pages IPs or CNAME → <USER>.github.io).

## 🛣️ Roadmap (Ideas)
* Trading & resource economy UI
* Caravan management panel (assign routes, buy camels)
* Procedural towns & inn gameplay bonuses
* Simple shadow blobs under entities
* Dynamic sandstorms reducing visibility & hydration
* Save / load state (localStorage)
* Accessibility & mobile touch improvements

## 🔧 Contributing
PRs / issues welcome. Keep code style minimal & dependency‑free.

## 📝 License
MIT

---
Enjoy the dunes! Share a screenshot once your caravans survive the night. 🌌🐪
