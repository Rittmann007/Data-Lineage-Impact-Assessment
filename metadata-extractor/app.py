import ast
import csv  # noqa: F401  (kept for future use; CSV metadata lives in comments)
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

RAW_DIR = BASE_DIR / "data" / "raw"
PIPELINE_DIR = BASE_DIR / "data" / "pipeline"
TABLE_DIR = BASE_DIR / "data" / "table"
REPORT_DIR = BASE_DIR / "data" / "report"

OUTPUT_DIR = BASE_DIR / "output"

ASSETS_FILE = OUTPUT_DIR / "assets.json"
EDGES_FILE = OUTPUT_DIR / "edges.json"

# The artifacts refer to each other with legacy ids (e.g. "cust_tbl_001")
# but never declare their own legacy id. The package manifest is the only
# place that maps legacy id -> file name, so it is used ONLY as an alias
# table for resolving those references. No metadata is read from it, and
# the reference_*.json validation files are never read.
MANIFEST_FILE = BASE_DIR / "extra" / "manifest.json"


# Fields written to assets.json, in this order.
ASSET_FIELDS = [
    "_id",
    "name",
    "type",
    "environment",
    "owner",
    "criticality",
    "sensitivity",
    "lifecycle",
    "modernization_status",
    "created_at",
    "last_scanned",
    "file_name",
    "file_format",
]

CONFIDENCE_RANK = {"low": 1, "medium": 2, "high": 3}


# ============================================================
# GLOBAL REGISTRIES
# ============================================================

# Legacy reference (from manifest / embedded ids) -> generated hash.
reference_to_hash = {}

# Other lookup mechanisms.
name_to_hash = {}
filename_to_hash = {}
path_to_hash = {}

# generated hash -> asset dict
hash_to_asset = {}

# Relationships as declared, before resolution / scoring.
pending_edges = []

# pipeline hash -> {"inputs": [...], "outputs": [...]} (raw references).
# Used only to corroborate the pipeline's lineage declarations.
pipeline_io = {}

LAST_SCANNED = None


# ============================================================
# GENERAL HELPERS
# ============================================================

def now_utc():
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def normalize(value):
    if value is None:
        return None

    return str(value).strip()


def normalize_reference(value):
    if value is None:
        return None

    value = str(value).strip()

    return value or None


def generate_asset_id(asset_type, name, path):
    """
    Deterministic 8-character SHA-256 id from type, name and the file's
    path RELATIVE to the project, so ids are identical on every machine
    and no matter where the project folder lives.
    """
    relative_path = Path(path).resolve().relative_to(BASE_DIR).as_posix()

    raw = f"{asset_type}|{name}|{relative_path}"

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]


def generate_edge_id(source, target, relationship_type):
    raw = f"{source}|{target}|{relationship_type}"

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]


def safe_json_loads(value, default=None):
    if value is None:
        return default

    if isinstance(value, (list, dict)):
        return value

    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return default


# ============================================================
# METADATA NORMALIZATION
# ============================================================

def normalize_metadata(metadata):
    if not metadata:
        return {}

    result = {}

    for key, value in metadata.items():
        if value is None:
            continue

        key = str(key).strip()

        if isinstance(value, str):
            value = value.strip()

        result[key] = value

    # An id declared inside an artifact is only ever an alias.
    if "_id" not in result:
        if "source_id" in result:
            result["_id"] = result["source_id"]
        elif "id" in result:
            result["_id"] = result["id"]

    return result


# ============================================================
# ASSET REGISTRATION
# ============================================================

def register_asset(metadata, file_path):
    """
    Register an asset and generate its hash id. Legacy ids are used only
    as lookup aliases and are never written to the output.
    """
    metadata = normalize_metadata(metadata)

    asset_type = normalize(metadata.get("type")) or "Unknown"
    name = normalize(metadata.get("name")) or Path(file_path).stem

    generated_id = generate_asset_id(asset_type, name, file_path)

    if generated_id in hash_to_asset:
        raise ValueError(
            f"Asset id collision on {generated_id} for {file_path}"
        )

    asset = {
        "_id": generated_id,
        "name": name,
        "type": asset_type,
        "environment": normalize(metadata.get("environment")) or "unknown",
        "owner": normalize(metadata.get("owner")) or "unknown",
        "criticality": normalize(metadata.get("criticality")) or "unknown",
        "sensitivity": normalize(metadata.get("sensitivity")) or "unknown",
        "lifecycle": normalize(metadata.get("lifecycle")) or "unknown",
        "modernization_status": (
            normalize(metadata.get("modernization_status")) or "unknown"
        ),
        "created_at": normalize(metadata.get("created_at")),
        "last_scanned": LAST_SCANNED,
        "file_name": Path(file_path).name,
        "file_format": Path(file_path).suffix.lstrip(".").lower(),
    }

    hash_to_asset[generated_id] = asset

    source_id = normalize_reference(metadata.get("_id"))

    if source_id:
        reference_to_hash[source_id] = generated_id

    name_to_hash[name] = generated_id
    filename_to_hash[Path(file_path).name] = generated_id
    path_to_hash[str(Path(file_path).resolve())] = generated_id

    return generated_id


# ============================================================
# CSV SCANNER
# ============================================================

def parse_csv_file(file_path):
    """
    Read the comment block between METADATA-BEGIN and METADATA-END:

        # METADATA-BEGIN
        # name: customer_raw
        # type: File
        # LINEAGE: [{"target": "...", "relationship_type": "feeds"}]
        # METADATA-END
    """
    metadata = {}
    inside_block = False

    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()

            if stripped == "# METADATA-BEGIN":
                inside_block = True
                continue

            if stripped == "# METADATA-END":
                break

            if not inside_block or not stripped.startswith("#"):
                continue

            content = stripped[1:].strip()

            if ":" not in content:
                continue

            key, value = content.split(":", 1)

            # Keys are case-insensitive (LINEAGE == lineage).
            metadata[key.strip().lower()] = value.strip()

    metadata.setdefault("name", file_path.stem)
    metadata.setdefault("type", "File")

    return metadata


# ============================================================
# SQLITE SCANNER
# ============================================================

def parse_sqlite_file(file_path):
    """Read the _asset_metadata (key, value) table, read-only."""
    metadata = {}

    connection = sqlite3.connect(f"{file_path.as_uri()}?mode=ro", uri=True)

    try:
        for key, value in connection.execute(
            "SELECT key, value FROM _asset_metadata"
        ):
            metadata[str(key).strip()] = value
    finally:
        connection.close()

    metadata.setdefault("name", file_path.stem)
    metadata.setdefault("type", "Table")

    return metadata


# ============================================================
# HTML SCANNER
# ============================================================

class MetaParser(HTMLParser):
    """Collects <meta name=... content=...> and the JSON metadata block."""

    def __init__(self):
        super().__init__()

        self.metadata = {}
        self.json_block = ""
        self._in_json_block = False

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)

        if tag == "meta":
            name = attributes.get("name")
            content = attributes.get("content")

            if name and content is not None:
                self.metadata[name.strip()] = content.strip()

        elif tag == "script" and attributes.get("id") == "asset-metadata":
            self._in_json_block = True

    def handle_endtag(self, tag):
        if tag == "script":
            self._in_json_block = False

    def handle_data(self, data):
        if self._in_json_block:
            self.json_block += data


def parse_html_file(file_path):
    """
    Metadata comes from <meta> tags; the embedded JSON block
    (<script id="asset-metadata">) fills in anything the tags lack.
    """
    parser = MetaParser()

    with open(file_path, "r", encoding="utf-8") as f:
        parser.feed(f.read())

    metadata = dict(parser.metadata)

    block = safe_json_loads(parser.json_block.strip(), {}) or {}

    for key, value in (block.get("metadata") or {}).items():
        metadata.setdefault(key, value)

    # Fallback lineage: datasets listed in the JSON block feed this report.
    if "lineage" not in metadata and block.get("datasets"):
        metadata["lineage"] = [
            {"source": dataset, "relationship_type": "feeds"}
            for dataset in block["datasets"]
        ]

    metadata.setdefault("name", file_path.stem)
    metadata.setdefault("type", "Report")

    return metadata


# ============================================================
# PYTHON PIPELINE SCANNER
# ============================================================

def parse_python_pipeline(file_path):
    """
    Read METADATA / INPUTS / OUTPUTS / LINEAGE module constants with the
    AST. The pipeline is never executed.
    """
    with open(file_path, "r", encoding="utf-8") as f:
        tree = ast.parse(f.read())

    metadata = {}
    inputs = None
    outputs = None
    lineage = []

    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue

        target = node.targets[0]

        if not isinstance(target, ast.Name):
            continue

        try:
            value = ast.literal_eval(node.value)
        except (ValueError, SyntaxError):
            continue

        if target.id == "METADATA" and isinstance(value, dict):
            metadata = value
        elif target.id == "INPUTS" and isinstance(value, list):
            inputs = value
        elif target.id == "OUTPUTS" and isinstance(value, list):
            outputs = value
        elif target.id == "LINEAGE" and isinstance(value, list):
            lineage = value

    metadata.setdefault("name", file_path.stem)
    metadata.setdefault("type", "Pipeline")

    return metadata, inputs, outputs, lineage


# ============================================================
# LINEAGE DECLARATIONS
# ============================================================

def add_declared_links(asset_hash, lineage):
    """
    Record every lineage item an asset declares.

    An item may omit "source" or "target"; the omitted end is the
    declaring asset itself. So a table's
        {"target": "rpt", "relationship_type": "feeds"}
    means table -> rpt, and a pipeline's
        {"target": "tbl", "relationship_type": "reads_from"}
    means pipeline -> tbl.
    """
    if not isinstance(lineage, list):
        return

    for item in lineage:
        if not isinstance(item, dict):
            continue

        source = normalize_reference(item.get("source")) or asset_hash
        target = normalize_reference(item.get("target")) or asset_hash

        if source == target:
            continue

        relationship_type = (
            item.get("relationship_type") or item.get("type") or "feeds"
        )

        confidence = item.get("confidence")

        if confidence not in CONFIDENCE_RANK:
            confidence = None

        pending_edges.append(
            {
                "source_reference": source,
                "target_reference": target,
                "relationship_type": relationship_type,
                "declared_confidence": confidence,
            }
        )


# ============================================================
# DIRECTORY SCANNING
# ============================================================

def scan_assets():
    """
    Pass 1: read every artifact, register it, collect its lineage.
    Edges are resolved and scored afterwards, once every asset exists.
    """

    if RAW_DIR.exists():
        for file_path in sorted(RAW_DIR.glob("*.csv")):
            metadata = parse_csv_file(file_path)
            asset_hash = register_asset(metadata, file_path)
            add_declared_links(
                asset_hash, safe_json_loads(metadata.get("lineage"), [])
            )

    if TABLE_DIR.exists():
        for file_path in sorted(TABLE_DIR.glob("*.sqlite")):
            metadata = parse_sqlite_file(file_path)
            asset_hash = register_asset(metadata, file_path)
            add_declared_links(
                asset_hash, safe_json_loads(metadata.get("lineage"), [])
            )

    if PIPELINE_DIR.exists():
        for file_path in sorted(PIPELINE_DIR.glob("*.py")):
            metadata, inputs, outputs, lineage = parse_python_pipeline(
                file_path
            )
            asset_hash = register_asset(metadata, file_path)
            pipeline_io[asset_hash] = {"inputs": inputs, "outputs": outputs}
            add_declared_links(asset_hash, lineage)

    if REPORT_DIR.exists():
        for file_path in sorted(REPORT_DIR.glob("*.html")):
            metadata = parse_html_file(file_path)
            asset_hash = register_asset(metadata, file_path)
            add_declared_links(
                asset_hash, safe_json_loads(metadata.get("lineage"), [])
            )


# ============================================================
# REFERENCE RESOLUTION
# ============================================================

def load_manifest_aliases():
    """
    Map legacy ids to generated hashes using the manifest's
    id -> file name table (aliases only, no metadata is taken).
    """
    if not MANIFEST_FILE.exists():
        print(
            f"WARNING: {MANIFEST_FILE} not found - legacy ids used in "
            "lineage declarations cannot be resolved."
        )
        return

    with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    for entry in manifest.get("artifacts", []):
        legacy_id = normalize_reference(entry.get("_id"))
        file_name = normalize_reference(entry.get("file"))

        asset_hash = filename_to_hash.get(file_name)

        if legacy_id and asset_hash:
            reference_to_hash.setdefault(legacy_id, asset_hash)
        else:
            print(f"WARNING: manifest entry not matched to a scanned file: {entry}")


def resolve_reference(reference):
    """
    Resolve a lineage reference to a generated hash.

    Order: generated hash, legacy id, asset name, file name, path.
    """
    reference = normalize_reference(reference)

    if not reference:
        return None

    if reference in hash_to_asset:
        return reference

    for lookup in (
        reference_to_hash,
        name_to_hash,
        filename_to_hash,
        path_to_hash,
    ):
        if reference in lookup:
            return lookup[reference]

    return None


# ============================================================
# EDGE RESOLUTION AND CONFIDENCE
# ============================================================

def resolve_edges():
    """
    Turn declared links into edges between generated hashes.

    The same relationship declared by more than one artifact (e.g. a
    table and the report it feeds) is merged into one edge.
    """
    resolved = {}
    unresolved = []

    for edge in pending_edges:
        source_hash = resolve_reference(edge["source_reference"])
        target_hash = resolve_reference(edge["target_reference"])

        if source_hash is None or target_hash is None:
            unresolved.append(
                {
                    **edge,
                    "resolved_source": source_hash,
                    "resolved_target": target_hash,
                }
            )
            continue

        key = (source_hash, target_hash, edge["relationship_type"])

        existing = resolved.setdefault(
            key,
            {
                "source": source_hash,
                "target": target_hash,
                "relationship_type": edge["relationship_type"],
                "declared_confidence": None,
            },
        )

        # Keep the strongest explicitly declared confidence, if any.
        declared = edge["declared_confidence"]

        if declared and CONFIDENCE_RANK[declared] > CONFIDENCE_RANK.get(
            existing["declared_confidence"], 0
        ):
            existing["declared_confidence"] = declared

    return list(resolved.values()), unresolved


def build_flow_graph(edges):
    """
    Direction-of-data graph: node -> set of nodes the data flows into.

        feeds / writes_to : source -> target
        reads_from        : target -> source   (data flows out of target)
    """
    flow = {}

    for edge in edges:
        if edge["relationship_type"] == "reads_from":
            upstream, downstream = edge["target"], edge["source"]
        else:
            upstream, downstream = edge["source"], edge["target"]

        flow.setdefault(upstream, set()).add(downstream)

    return flow


def reaches(flow, start, goal):
    """True if data flows from start to goal (directly or transitively)."""
    seen = set()
    stack = [start]

    while stack:
        node = stack.pop()

        for nxt in flow.get(node, ()):
            if nxt == goal:
                return True

            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)

    return False


def resolved_pipeline_io(pipeline_hash, key):
    """Resolved set of a pipeline's declared INPUTS/OUTPUTS, or None."""
    declared = pipeline_io.get(pipeline_hash, {}).get(key)

    if declared is None:
        return None

    return {
        resolve_reference(ref)
        for ref in declared
        if isinstance(ref, str)
    }


def score_edges(edges):
    """
    Assign confidence to every edge that doesn't declare its own.

    Rules, in order:

      1. LOW    - a pipeline edge that the pipeline's own INPUTS/OUTPUTS
                  do not confirm (declared only by the other side, e.g. a
                  file claiming to feed a pipeline that doesn't list it).
      2. MEDIUM - a source feeding a report that is also upstream of
                  another source feeding the same report (the indirect
                  source; the downstream table is the direct one).
      3. MEDIUM - a pipeline reading a table owned by a different team
                  (cross-ownership dependency).
      4. HIGH   - everything else.
    """
    flow = build_flow_graph(edges)

    report_sources = {}

    for edge in edges:
        target = hash_to_asset[edge["target"]]

        if edge["relationship_type"] == "feeds" and target["type"] == "Report":
            report_sources.setdefault(edge["target"], set()).add(edge["source"])

    for edge in edges:
        if edge["declared_confidence"]:
            edge["confidence"] = edge["declared_confidence"]
            continue

        source = edge["source"]
        target = edge["target"]
        kind = edge["relationship_type"]

        source_asset = hash_to_asset[source]
        target_asset = hash_to_asset[target]

        # ---- rule 1: pipeline corroboration -------------------------
        confirmed = True

        if kind == "feeds" and target_asset["type"] == "Pipeline":
            inputs = resolved_pipeline_io(target, "inputs")
            confirmed = inputs is None or source in inputs

        elif kind == "reads_from" and source_asset["type"] == "Pipeline":
            inputs = resolved_pipeline_io(source, "inputs")
            confirmed = inputs is None or target in inputs

        elif kind == "writes_to" and source_asset["type"] == "Pipeline":
            outputs = resolved_pipeline_io(source, "outputs")
            confirmed = outputs is None or target in outputs

        if not confirmed:
            edge["confidence"] = "low"
            continue

        # ---- rule 2: indirect report source -------------------------
        if kind == "feeds" and target_asset["type"] == "Report":
            siblings = report_sources[target] - {source}

            if any(reaches(flow, source, other) for other in siblings):
                edge["confidence"] = "medium"
                continue

        # ---- rule 3: cross-team pipeline read -----------------------
        if (
            kind == "reads_from"
            and source_asset["type"] == "Pipeline"
            and source_asset["owner"] != target_asset["owner"]
        ):
            edge["confidence"] = "medium"
            continue

        edge["confidence"] = "high"


# ============================================================
# OUTPUT
# ============================================================

def write_output():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ---- assets ---------------------------------------------------
    assets = [
        {key: asset.get(key) for key in ASSET_FIELDS}
        for asset in hash_to_asset.values()
    ]

    assets.sort(key=lambda a: (a["type"], a["name"]))

    with open(ASSETS_FILE, "w", encoding="utf-8") as f:
        json.dump(assets, f, indent=2)
        f.write("\n")

    # ---- edges ----------------------------------------------------
    edges, unresolved = resolve_edges()

    score_edges(edges)

    output_edges = [
        {
            "_id": generate_edge_id(
                e["source"], e["target"], e["relationship_type"]
            ),
            "source": e["source"],
            "target": e["target"],
            "relationship_type": e["relationship_type"],
            "confidence": e["confidence"],
        }
        for e in edges
    ]

    output_edges.sort(
        key=lambda e: (
            hash_to_asset[e["source"]]["name"],
            e["relationship_type"],
            hash_to_asset[e["target"]]["name"],
        )
    )

    with open(EDGES_FILE, "w", encoding="utf-8") as f:
        json.dump(output_edges, f, indent=2)
        f.write("\n")

    # ---- summary --------------------------------------------------
    print()
    print("=" * 60)
    print("SCAN COMPLETE")
    print("=" * 60)
    print(f"Assets        : {len(assets)}")
    print(f"Relationships : {len(output_edges)}")
    print(f"Unresolved    : {len(unresolved)}")
    print()
    print(f"Assets JSON : {ASSETS_FILE}")
    print(f"Edges JSON  : {EDGES_FILE}")

    if unresolved:
        print()
        print("-" * 60)
        print("UNRESOLVED REFERENCES")
        print("-" * 60)

        seen = set()

        for edge in unresolved:
            key = (edge["source_reference"], edge["target_reference"])

            if key in seen:
                continue

            seen.add(key)

            print(
                f"{edge['source_reference']} -> {edge['target_reference']} "
                f"| source={edge['resolved_source'] or 'NOT FOUND'} "
                f"| target={edge['resolved_target'] or 'NOT FOUND'}"
            )


# ============================================================
# DEBUG LOOKUP
# ============================================================

def print_lookup():
    print()
    print("=" * 60)
    print("REFERENCE LOOKUP (legacy id -> new id)")
    print("=" * 60)

    for reference, generated_id in sorted(reference_to_hash.items()):
        asset = hash_to_asset.get(generated_id)

        if asset:
            print(
                f"{reference:16} -> {generated_id} "
                f"({asset['type']}: {asset['name']})"
            )


# ============================================================
# MAIN
# ============================================================

def main():
    global LAST_SCANNED

    LAST_SCANNED = now_utc()

    print("=" * 60)
    print("PROJECTXTRACT METADATA / LINEAGE SCANNER")
    print("=" * 60)

    scan_assets()
    load_manifest_aliases()
    print_lookup()
    write_output()


if __name__ == "__main__":
    main()
