from fastapi import Request, Query
from typing import Optional
from backend.models import Asset, AssetType, Environment, Criticality

def get_assets(
    request:Request,
    type: Optional[AssetType] = Query(None, description="Filter by asset type"),
    environment: Optional[Environment] = Query(None, description="Filter by environment"),
    owner: Optional[str] = Query(None, description="Filter by owner"),
    criticality: Optional[Criticality] = Query(None, description="Filter by criticality"),
    search: Optional[str] = Query(None, description="Search by name (case-insensitive)")
):
    """
    get all assets or can filter by "type , environment , owner , criticality , name"
    """
    client = request.app.state.mongo_client
    assets_collection = client["Data_lineage"]["assets"]
    query = {}

    if type:
        query["type"] = type.value # search by type
    if environment:
        query["environment"] = environment.value # search by environment
    if owner:
        query["owner"] = owner # search by owner
    if criticality:
        query["criticality"] = criticality.value # search by criticality
    if search:
        query["name"] = {"$regex": search, "$options": "i"} # search by name

    cursor = assets_collection.find(query)
    return [Asset(**doc) for doc in cursor]