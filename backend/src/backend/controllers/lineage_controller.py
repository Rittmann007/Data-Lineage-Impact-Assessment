from fastapi import Request, HTTPException
import networkx as nx
from backend.utils import build_graph,_to_node

def get_lineage(request: Request, asset_id: str, depth: int | None = None):
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

