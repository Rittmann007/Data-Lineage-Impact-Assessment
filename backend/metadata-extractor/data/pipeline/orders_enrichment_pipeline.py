"""Sample pipeline artifact. Metadata can be extracted without executing this file."""

METADATA = {
    "name": "orders_enrichment_pipeline",
    "type": "Pipeline",
    "environment": "staging",
    "owner": "orders-team",
    "criticality": "medium",
    "sensitivity": "internal",
    "lifecycle": "active",
    "modernization_status": "retain",
    "created_at": "2026-08-05T09:00:00Z"
}

INPUTS = [
    "ord_tbl_001"
]
OUTPUTS = [
    "ord_tbl_002"
]
LINEAGE = [
    {
        "target": "ord_tbl_001",
        "relationship_type": "reads_from"
    },
    {
        "target": "ord_tbl_002",
        "relationship_type": "writes_to"
    }
]

def run():
    pass
