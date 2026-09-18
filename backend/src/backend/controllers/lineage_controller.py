from fastapi import Request, HTTPException
import networkx as nx
from backend.utils import build_graph,_to_node

def get_lineage(request: Request, asset_id: str, depth: int | None = None):
    """
    gives lineage flow result in node,edge format so that reactflow can build lineage graph out of them
    """
    client = request.app.state.mongo_client
    db = client["Data_lineage"]
    assets_collection = db["assets"]
    edges_collection = db["edges"]

    asset = assets_collection.find_one({"_id": asset_id})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    graph = build_graph(edges_collection)

    if asset_id not in graph:
        return {"asset_id": asset_id, "nodes": [_to_node(asset)], "edges": []}

    if depth is not None:
        # limit to N hops using cutoff
        downstream_hops = nx.single_source_shortest_path_length(graph, asset_id, cutoff=depth)
        upstream_hops = nx.single_source_shortest_path_length(graph.reverse(), asset_id, cutoff=depth)
        downstream_ids = set(downstream_hops.keys()) - {asset_id}
        upstream_ids = set(upstream_hops.keys()) - {asset_id}
    else:
        upstream_ids = nx.ancestors(graph, asset_id)
        downstream_ids = nx.descendants(graph, asset_id)

    involved_ids = upstream_ids | downstream_ids | {asset_id}

    asset_docs = list(assets_collection.find({"_id": {"$in": list(involved_ids)}}))
    nodes = [_to_node(doc) for doc in asset_docs]

    edges = []
    for source, target, data in graph.edges(data=True):
        if source in involved_ids and target in involved_ids:
            edges.append({
                "id": f"{source}-{target}",
                "source": source,
                "target": target,
                "label": data.get("type", "")
            })

    return {"asset_id": asset_id, "nodes": nodes, "edges": edges}


def get_impact(request: Request, asset_id: str):
    """
    gives downstream impact assets with specifying directly impacted nodes and their hops
    """
    client = request.app.state.mongo_client
    db = client["Data_lineage"]
    assets_collection = db["assets"]
    edges_collection = db["edges"]

    asset = assets_collection.find_one({"_id": asset_id})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    graph = build_graph(edges_collection)

    if asset_id not in graph:
        return {
            "asset_id": asset_id,
            "asset_name": asset.get("name"),
            "affected_count": 0,
            "affected": []
        }

    direct_ids = set(graph.successors(asset_id))
    all_downstream_ids = nx.descendants(graph, asset_id)

    hops = nx.single_source_shortest_path_length(graph, asset_id)
    hops.pop(asset_id, None)

    affected_docs = list(assets_collection.find({"_id": {"$in": list(all_downstream_ids)}}))

    affected = []
    for doc in affected_docs:
        affected.append({
            "_id": doc["_id"],
            "name": doc.get("name"),
            "type": doc.get("type"),
            "criticality": doc.get("criticality"),
            "owner": doc.get("owner"),
            "hops": hops.get(doc["_id"]),
            "directly_affected": doc["_id"] in direct_ids
        })

    affected.sort(key=lambda x: x["hops"])

    return {
        "asset_id": asset_id,
        "asset_name": asset.get("name"),
        "affected_count": len(affected),
        "affected": affected
    }

def get_graph(request: Request):
    client = request.app.state.mongo_client
    db = client["Data_lineage"]
    assets_collection = db["assets"]
    edges_collection = db["edges"]

    asset_docs = list(assets_collection.find())
    nodes = [_to_node(doc) for doc in asset_docs]

    edges = []
    for edge in edges_collection.find():
        edges.append({
            "id": f"{edge['source']}-{edge['target']}",
            "source": edge["source"],
            "target": edge["target"],
            "label": edge.get("relationship_type", "")
        })

    return {
        "nodes": nodes,
        "edges": edges
    }


