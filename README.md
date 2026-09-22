# Data Lineage & Impact Assessment

A data catalog and lineage visualization tool that lets teams register data assets (tables, pipelines, reports, files), map how they depend on each other, and instantly see what breaks downstream before they change something.

Built for the **Cognizant NPN (Nurture Partner Network)** hackathon, AI & Analytics track — by team **EventHorizon**.

## The problem

In most organizations, nobody has a clear picture of how data actually flows — which report depends on which pipeline, which table a dashboard reads from, or what breaks if a source system changes. Impact assessment ends up being tribal knowledge or a Slack thread. This project turns that into a searchable catalog with a real dependency graph, automatic upstream/downstream impact analysis, and plain-English explanations for non-technical stakeholders.

## Core functionality

1. View, search and filter assets (by type, environment, owner, criticality, name)
2. View a single asset's full metadata
3. Register a new asset
4. Delete an asset (cascades to its relationships)
5. View relationships (edges) between assets
6. Add a relationship between two assets
7. View the lineage of a specific asset — upstream + downstream, with optional hop-depth limit (built with `networkx` graph traversal)
8. Run impact analysis — every downstream asset affected by a change, ranked by hop distance, flagged direct vs. indirect
9. Visualize the complete lineage graph for the whole catalog
10. Get an AI-generated, plain-English explanation of any asset (via Gemini)

## Metadata extractor

A standalone Python tool (`metadata-extractor/`) that populates the catalog by actually scanning real artifact files instead of hand-entering assets:

- **CSV** raw files — metadata read from a `METADATA-BEGIN` / `METADATA-END` comment block
- **Python** pipeline scripts — metadata read from a `METADATA` module constant via `ast` (the pipeline is never executed)
- **SQLite** tables — metadata read from a `_asset_metadata` key/value table
- **HTML** reports — metadata read from `<meta>` tags and an embedded JSON block

For each file it generates a deterministic asset id (SHA-256 hash of type + name + relative path), collects every lineage relationship the files declare about each other, resolves cross-file references (by generated hash, legacy id, name, filename or path), merges duplicate edges, and scores each edge's confidence — dropping it to `low` when a pipeline's own declared inputs/outputs don't corroborate it, `medium` for indirect report sources or cross-team pipeline reads, and `high` otherwise. Output is written to `metadata-extractor/output/assets.json` and `edges.json`, in the same shape the backend's `backend/extras/load_data.py` script loads into MongoDB.

Run it with:

```bash
cd metadata-extractor
pip install -r requirements.txt
python app.py
```

## Frontend

- **Home** — landing page introducing the product (Discover & Understand, Trace Dependencies, Assess Change Impact, Plan Modernization) and the Discover → Map → Analyze → Act workflow
- **Dashboard** — the main workspace:
  - Asset catalog with live search/filter (type, environment, owner, criticality) and a "Create Asset" form
  - Relations tab listing all edges with search/filter by source, target, relationship type and confidence
  - Live analytics panels (breakdown by type, environment, criticality, confidence; connectivity stats) rendered as custom SVG donut/bar charts
  - Per-asset modals: **Asset details**, **Impact analysis** (direct/indirect counts, max hops, affected-asset table), **Lineage** (rendered with `@xyflow/react`, upstream nodes above / downstream below, color-coded), and **AI Overview** (Gemini explanation, parsed into "What it is / Risk of changing it / Sensitivity / What's next" cards)
- **Graph** — a full, whole-catalog lineage visualization built from scratch on SVG with a custom force-directed layout (no charting library): assets are grouped into rows by type, nodes repel each other and edges act as springs, with draggable/pinned nodes, pan & zoom, and hover/selection highlighting of direct vs. indirect upstream/downstream chains

## Tech stack

**Backend**
- FastAPI (Python 3.14) served with Uvicorn
- MongoDB via PyMongo (`Data_lineage` database — `assets` and `edges` collections)
- NetworkX for graph traversal (ancestors/descendants, shortest-path hop counts)
- Google Gen AI SDK (Gemini) for AI-generated asset explanations
- Pydantic models for validated, typed asset/edge schemas
- Managed with [`uv`](https://docs.astral.sh/uv/)

**Frontend**
- React 19 + Vite
- Tailwind CSS 4
- [@xyflow/react](https://reactflow.dev/) (React Flow) for the per-asset lineage modal
- A hand-rolled SVG force simulation for the full-catalog Graph page
- React Router

## Project structure

```
.
├── backend/
│   └── src/backend/
│       ├── __init__.py          # FastAPI app, routes, MongoDB lifespan
│       ├── models.py            # Pydantic models & enums (Asset, Edge, ...)
│       ├── utils.py             # NetworkX graph builder + node formatting
│       └── controllers/
│           ├── assets_controller.py
│           ├── edges_controller.py
│           ├── lineage_controller.py
│           └── ai_controller.py
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── api.js               # API client
│       ├── components/Navbar.jsx
│       └── pages/
│           ├── Home.jsx
│           ├── Dashboard.jsx
│           └── Graph.jsx
├── metadata-extractor/
│   ├── app.py                   # scans data/ and writes output/assets.json + edges.json
│   ├── data/                    # sample raw/pipeline/table/report artifacts to scan
│   ├── output/                  # generated assets.json / edges.json
│   └── extra/                   # manifest + reference/validation files
└── data/                        # sample/seed datasets ready to load into MongoDB
```

## API overview

| Method | Endpoint                        | Description                                      |
|--------|----------------------------------|---------------------------------------------------|
| GET    | `/assets`                       | List assets — filter by `type`, `environment`, `owner`, `criticality`, `search` (name) |
| GET    | `/assets/{asset_id}`            | Get a single asset                                |
| POST   | `/asset_create`                 | Create an asset — requires unique `name` + `type` + `environment` + `owner` |
| DELETE | `/assets/{asset_id}`            | Delete an asset (cascades to its edges)           |
| GET    | `/edges`                        | List edges — filter by `source`/`target`          |
| GET    | `/edges/{edge_id}`              | Get a single edge                                 |
| POST   | `/edge_create`                  | Create an edge — requires unique `source` + `target` + `relationship_type` |
| GET    | `/lineage/{asset_id}?depth=N`   | Full upstream + downstream lineage for an asset, optional hop-depth cutoff |
| GET    | `/impact/{asset_id}`            | Downstream impact analysis with hop distance and direct/indirect flag |
| GET    | `/graph`                        | The entire system's lineage graph — all nodes and edges |
| GET    | `/assets/{asset_id}/explain`    | AI-generated plain-English explanation of an asset |

## Data model

**Asset** — `name`, `type` (Table / Pipeline / Report / File), `environment` (prod / staging / dev), `owner`, `criticality` (high / medium / low), `sensitivity` (pii / internal / public), `lifecycle` (active / deprecated / retiring), `modernization_status` (retain / remediate / migrate / redesign / retire)

**Edge** — `source`, `target`, `relationship_type` (reads_from / writes_to / feeds / depends_on), `confidence` (high / medium / low)

## Getting started

### Backend

```bash
cd backend
uv sync
```

Create a `.env` file in `backend/`:

```
MONGO_URI=<your MongoDB connection string>
GEMINI_API_KEY=<your Google Gemini API key>
```

Run the API:

```bash
uv run uvicorn backend:app --reload
```

The API will be available at `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`. Optionally set `VITE_API_URL` (defaults to `http://127.0.0.1:8000`).

## Team

**EventHorizon** — Cognizant Nurture Partner Network (NPN), AI & Analytics track

## License

GNU AFFERO GENERAL PUBLIC LICENSE v3
