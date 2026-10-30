# DataVision AI — Smart Data Analytics Platform

A complete, working data-analytics web application built as a **BCA college project / data-analyst portfolio piece**.

Upload an Excel or CSV file → profile and clean it → explore adaptive KPIs, interactive charts and statistics → ask questions in plain English → download CSV / Excel / PDF reports. **Every number shown is genuinely calculated from the uploaded dataset** — nothing is hardcoded or invented.

---

## 1. Technology stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | Simple, beginner-friendly, no build step |
| Database | SQLite (better-sqlite3) | Zero-configuration persistent storage |
| File parsing | SheetJS (`xlsx`) | Reads .xlsx, .xls and .csv reliably |
| Auth | JWT (httpOnly cookie) + bcryptjs | Industry-standard password hashing; tokens unreadable by page JS |
| Frontend | Vanilla JS SPA (ES modules) | No framework/build complexity; easy to explain in a viva |
| Charts | Chart.js | Interactive bar/line/pie/doughnut/area/histogram/scatter |
| PDF | jsPDF | Client-side PDF report generation |

## 2. Project structure

```
datavision-ai/
├── server/
│   ├── index.js            # Express entry point
│   ├── db.js               # SQLite schema + dataset file storage
│   ├── routes/
│   │   ├── auth.js         # register/login/logout/profile + middleware
│   │   ├── projects.js     # upload, profile, clean, analyse, ask, export
│   │   ├── admin.js        # admin-only stats & user management
│   │   └── demo.js         # public read-only sample-data endpoints
│   └── lib/
│       ├── parse.js        # workbook parsing + type inference
│       ├── profile.js      # data-quality profiling
│       ├── clean.js        # cleaning operations (pure functions)
│       ├── stats.js        # KPIs, group-bys, trends, correlations, outliers
│       └── insights.js     # rule-based/AI insights + NL question answering
├── public/                 # frontend SPA (HTML/CSS/JS, no build step)
│   ├── index.html
│   ├── css/styles.css
│   └── js/ (app.js router + pages/)
├── sample-data/sample_sales_data.csv   # 427 demo records (labelled sample)
├── data/                   # created at runtime: SQLite DB + dataset JSON files
├── .env.example            # example configuration (no real secrets)
└── package.json
```

**Metadata vs source data:** project names/configs live in SQLite (`data/datavision.db`); the uploaded rows are stored as per-project JSON files in `data/datasets/` (`project_<id>_original.json` and, after cleaning, `project_<id>_cleaned.json`). The original is never overwritten.

## 2.5 No-server option: DataVision-Lite.html

**`DataVision-Lite.html`** is a single-file version that runs by **double-clicking it — no Node.js, no server**. Upload a CSV/Excel file (it never leaves your computer), and get KPIs, data quality, quick clean (with undo), charts, statistics, rule-based insights, plain-English Q&A, and CSV/Excel/PDF downloads — all computed in the browser.

- Needs internet on first load (chart libraries come from a CDN).
- What it does NOT have (server features): login/accounts, saved projects, admin panel, advanced per-column cleaning strategies. For those, run the full app below.
- Rebuild it after changing the sample data: `node tools/build-lite.js`.

## 3. Setup & run (beginner-friendly)

> ⚠️ **Important:** do NOT open `public/index.html` by double-clicking it — this is a full-stack app and needs its server running. Always start the server first, then open **http://localhost:3000** in the browser.

### Windows — easiest way
1. Install Node.js (LTS) from https://nodejs.org (one time only).
2. Double-click **`start-windows.bat`** in the `datavision-ai` folder.
3. It installs dependencies on the first run, starts the server, and opens http://localhost:3000 automatically.

### Mac / Linux
Run `./start-mac-linux.sh` (or use the manual commands below).

### Manual commands (any OS)

Requirements: **Node.js 18+** (tested on Node 20).

```bash
cd datavision-ai
npm install            # installs all dependencies
cp .env.example .env   # optional but recommended; edit the secrets
npm start              # starts http://localhost:3000
```

Open http://localhost:3000 in your browser.

**Default admin account** (seeded on first start, change in `.env`):
- Email: `admin@datavision.local`
- Password: `Admin@1234`

## 4. Feature guide

- **Landing page** – product overview with a live preview computed from the sample dataset.
- **Try Demo Dashboard** – explores the full workbench read-only on the bundled, clearly-labelled sample sales dataset. No account required.
- **Auth** – register/login/logout, profile editing, password change. Validation client- and server-side; bcrypt hashing; JWT in httpOnly cookie; private routes protected on both ends.
- **Upload** – drag-and-drop or file picker; .csv/.xlsx/.xls; 15 MB limit; 50,000-row processing cap; schema/type detection; preview; clear errors for bad files.
- **Dashboard** – adaptive KPIs (revenue, profit, orders, customers, AOV, trend) detected from column names; graceful fallbacks when those columns don't exist.
- **Data & Cleaning** – quality score, duplicates, missing values, empty columns, whitespace, mixed date formats, type problems, rule-based suspicious values; cleaning with *preview before apply*, before/after comparison, and undo (revert to original).
- **Visualizations** – chart builder (bar, line, area, pie, doughnut, histogram, scatter) with date and category filters; refuses to draw meaningless charts and explains why.
- **Insights & Ask** – plain-English findings with the supporting numbers attached; natural-language questions translated into safe, predefined calculations (never executes user text).
- **Reports** – CSV download, Excel workbook with a computed Summary sheet, PDF report (KPIs, charts, statistics, findings), and a text summary.
- **Projects** – save/rename/delete/reopen analyses; per-user ownership enforced by the API.
- **Admin area** – usage stats, activity log, role management, user deletion. Server-side role checks.

## 5. AI configuration (optional)

Out of the box the Insights page uses a **rule-based engine** and is labelled as such. To enable AI-phrased insights, set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL` / `OPENAI_BASE_URL`) in `.env` and restart. The key stays on the server; only computed summary statistics are sent to the API, and the output is labelled “AI-generated (from verified statistics)”.

## 6. Testing locally

1. `npm start`, then visit http://localhost:3000.
2. Click **Try Demo Dashboard** — everything should render from sample data.
3. Register a user, then **Upload Data → Import sample as a project**.
4. In **Data & Cleaning** you should see ~7 duplicates, ~30 missing cells, whitespace in `Region`, and mixed date formats in `Order Date`. Preview and apply cleaning, verify the before/after table, then try **Undo cleaning**.
5. Build charts with filters in **Visualizations**; ask questions in **Insights & Ask**.
6. Download the CSV, Excel and PDF from **Reports** and check the numbers match the dashboard.
7. Log in as the admin account to view the **Admin Area**; verify a normal user gets “Admin access required”.

A scripted API smoke test is in `tests/api-test.sh` (requires the server running).

## 7. Deployment options & limitations

> 📘 **Step-by-step GitHub + free hosting guide (Hinglish): see [DEPLOY.md](DEPLOY.md)** — covers GitHub upload, a free GitHub Pages link for the Lite version (`docs/index.html`), and free full-server deployment on Render.com via the included `render.yaml`.

- **Any Node host / VPS** (Render, Railway, a college server, etc.): `npm install && npm start`. SQLite + file storage need a **persistent disk** — on free tiers with ephemeral filesystems, uploaded data disappears on redeploys.
- **Not suitable for serverless** (Vercel/Netlify functions) without replacing SQLite + local file storage with a hosted DB (e.g. Postgres/Supabase) and object storage.
- Set strong values for `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` in production, and serve behind HTTPS.

## 8. Known limitations (honest notes for the viva)

- Only the **first sheet** of an Excel workbook is analysed.
- Files are capped at 15 MB / 50,000 rows to keep processing responsive.
- Natural-language Q&A supports a defined set of question patterns (top/bottom, trends, totals, averages, duplicates, missing values) — it is a safe translator, not a general chatbot.
- The demo dashboard is read-only; cleaning/export-to-Excel require an account.
- Email verification / password reset emails are not implemented (no mail server).
