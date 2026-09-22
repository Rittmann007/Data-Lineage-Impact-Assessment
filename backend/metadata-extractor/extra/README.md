# Extractable metadata sample assets

This package contains 15 heterogeneous artifacts for a metadata/lineage scanner.

## Scanner input
Scan the actual artifact files:
- CSV — raw files
- Python — pipeline files
- SQLite — table files
- HTML — BI report files

## Reference only
`reference_assets_schema.json` and `reference_edges.json` are validation/reference data.
They must not be used by the scanner as the metadata source.

## Where metadata lives
- CSV: `METADATA-BEGIN/END` comment block
- Python: `METADATA` module constant
- SQLite: `_asset_metadata` table
- HTML: `<meta>` elements and JSON metadata block

The scanner derives `_id`, `file_name`, `file_format`, and `last_scanned`.
Lineage is discovered from the embedded dependency declarations.

The metadata values are therefore in the artifacts, not hardcoded into the scanner.
