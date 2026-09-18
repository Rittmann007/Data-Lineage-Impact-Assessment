from fastapi import Request, Query, HTTPException
from typing import Optional
from backend.models import Edge, EdgeCreate
import uuid

def get_edges(
    request: Request,
    source: Optional[str] = Query(None, description="Filter by source asset id"),
    target: Optional[str] = Query(None, description="Filter by target asset id"),
):
    client = request.app.state.mongo_client
    edges_collection = client["Data_lineage"]["edges"]
    query = {}

    if source:
        query["source"] = source
    if target:
        query["target"] = target

    cursor = edges_collection.find(query)
    return [Edge(**doc) for doc in cursor]

def get_edge_by_id(request: Request, edge_id: str):
    client = request.app.state.mongo_client
    edges_collection = client["Data_lineage"]["edges"]
    doc = edges_collection.find_one({"_id": edge_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Edge not found")
    return Edge(**doc)

def create_edge(request: Request, edge: EdgeCreate):
    client = request.app.state.mongo_client
    assets_collection = client["Data_lineage"]["assets"]
    edges_collection = client["Data_lineage"]["edges"]

    if not assets_collection.find_one({"_id": edge.source}):
        raise HTTPException(status_code=404, detail=f"Source asset '{edge.source}' not found")
    if not assets_collection.find_one({"_id": edge.target}):
        raise HTTPException(status_code=404, detail=f"Target asset '{edge.target}' not found")

    duplicate = edges_collection.find_one({
        "source": edge.source,
        "target": edge.target,
        "relationship_type": edge.relationship_type.value
    })
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="Edge with this source, target, and relationship_type already exists"
        )

    edge_id = f"edge_{uuid.uuid4().hex[:8]}"
    doc = edge.model_dump()
    doc["_id"] = edge_id

    edges_collection.insert_one(doc)
    return Edge(**doc)