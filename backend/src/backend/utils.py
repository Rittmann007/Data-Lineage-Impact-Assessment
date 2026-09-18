import networkx as nx

def build_graph(edges_collection):
    graph = nx.DiGraph()
    for edge in edges_collection.find():
        graph.add_edge(edge["source"], edge["target"], type=edge.get("relationship_type"))
    return graph

def _to_node(doc: dict) -> dict:
    return {
        "id": doc["_id"],
        "type": doc.get("type"),
        "data": {
            "label": doc.get("name"),
            "environment": doc.get("environment"),
            "criticality": doc.get("criticality")
        }
    }