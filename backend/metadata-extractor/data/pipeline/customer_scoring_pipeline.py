"""Sample pipeline artifact. Metadata can be extracted without executing this file."""

METADATA = {
    "name": "customer_scoring_pipeline",
    "type": "Pipeline",
    "environment": "prod",
    "owner": "customer-data-team",
    "criticality": "medium",
    "sensitivity": "internal",
    "lifecycle": "active",
    "modernization_status": "retain",
    "created_at": "2026-08-05T09:00:00Z"
}

INPUTS = [
    "cust_tbl_001"
]
OUTPUTS = [
    "cust_tbl_002"
]
LINEAGE = [
    {
        "target": "cust_tbl_001",
        "relationship_type": "reads_from"
    },
    {
        "target": "cust_tbl_002",
        "relationship_type": "writes_to"
    }
]

def run():
    pass
