from fastapi import Request, Query, HTTPException
from typing import Optional
from backend.models import Asset, AssetType, Environment, Criticality, AssetCreate
from datetime import datetime
import uuid

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

def get_asset_by_id(request: Request, asset_id: str):
    """
    gets the asset by given id in params
    """
    client = request.app.state.mongo_client
    assets_collection = client["Data_lineage"]["assets"]

    doc = assets_collection.find_one({"_id": asset_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Asset not found")

    return Asset(**doc)

def create_asset(request: Request, asset: AssetCreate):
    """
    create an asset by giving info
    """
    client = request.app.state.mongo_client
    assets_collection = client["Data_lineage"]["assets"]

    # imposing name + type + environment + owner  uniqueness in data
    duplicate = assets_collection.find_one({
        "name": asset.name,
        "type": asset.type.value,
        "environment": asset.environment.value,
        "owner": asset.owner
    })
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="Asset with this name, type, environment, and owner already exists"
        )
    # {type}_{random} (report_ce2a663d), while your seed data uses {domain}_{type}_{number} (cust_rpt_001). Two different naming schemes.
    asset_id = f"{asset.type.value.lower()}_{uuid.uuid4().hex[:8]}"
    now = datetime.now()
    doc = asset.model_dump()
    doc["_id"] = asset_id
    doc["created_at"] = now
    doc["last_scanned"] = now

    assets_collection.insert_one(doc)
    return Asset(**doc)

def delete_asset(request: Request, asset_id: str):
    """
    delete an asset by id and any edges referencing it (as source or target) will be
    also deleted
    """
    client = request.app.state.mongo_client
    assets_collection = client["Data_lineage"]["assets"]
    edges_collection = client["Data_lineage"]["edges"]

    result = assets_collection.delete_one({"_id": asset_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")

    edges_collection.delete_many({# cascade delete related assets
        "$or": [{"source": asset_id}, {"target": asset_id}]
    })

    return {"detail": f"Asset '{asset_id}' and its edges deleted"}