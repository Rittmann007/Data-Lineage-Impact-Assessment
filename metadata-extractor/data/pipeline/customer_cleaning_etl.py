"""Sample pipeline artifact. Metadata can be extracted without executing this file."""

METADATA = {
    "name": "customer_cleaning_etl",
    "type": "Pipeline",
    "environment": "prod",
    "owner": "customer-data-team",
    "criticality": "high",
    "sensitivity": "pii",
    "lifecycle": "active",
    "modernization_status": "remediate",
    "created_at": "2026-08-01T09:10:00Z"
}

INPUTS = [
    "cust_file_001",
    "shd_tbl_001"
]
OUTPUTS = [
    "cust_tbl_001"
]
LINEAGE = [
    {
        "target": "cust_tbl_001",
        "relationship_type": "writes_to"
    },
    {
        "target": "shd_tbl_001",
        "relationship_type": "reads_from"
    }
]

def run():
    pass
