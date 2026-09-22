"""Sample pipeline artifact. Metadata can be extracted without executing this file."""

METADATA = {
    "name": "orders_aggregation_pipeline",
    "type": "Pipeline",
    "environment": "prod",
    "owner": "orders-team",
    "criticality": "high",
    "sensitivity": "internal",
    "lifecycle": "active",
    "modernization_status": "remediate",
    "created_at": "2026-08-01T09:10:00Z"
}

INPUTS = [
    "ord_file_001",
    "shd_tbl_001"
]
OUTPUTS = [
    "ord_tbl_001"
]
LINEAGE = [
    {
        "target": "ord_tbl_001",
        "relationship_type": "writes_to"
    },
    {
        "target": "shd_tbl_001",
        "relationship_type": "reads_from"
    }
]

def run():
    pass
