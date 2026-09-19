from dotenv import load_dotenv
load_dotenv()
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pymongo.server_api import ServerApi
import os
from backend.controllers.assets_controller import get_assets,get_asset_by_id,create_asset,delete_asset
from backend.controllers.edges_controller import get_edges, get_edge_by_id, create_edge
from backend.controllers.lineage_controller import get_lineage,get_impact, get_graph


uri = os.environ.get("MONGO_URI")
client = MongoClient(uri, server_api=ServerApi("1"))

@asynccontextmanager # this section will run before the app actually starts
async def lifespan(app: FastAPI):
    app.state.mongo_client = client # store the Mongo client on the app during lifespan, then read it inside the controller.
    try:
        client.admin.command("ping")
        print("Pinged your deployment. You successfully connected to MongoDB!", flush=True)
    except Exception as e:
        print(e, flush=True)
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(# adding cors middleware
    CORSMiddleware,
    allow_origins=["http://localhost:5173","http://localhost:3000"],  # your React dev server URL (Vite default; use 3000 for CRA)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


#routes

# root
@app.get("/")
async def root():
    return {"message": "Hello World"}

# assets
app.get("/assets")(get_assets)

app.get("/assets/{asset_id}")(get_asset_by_id)

app.post("/asset_create")(create_asset)

app.delete("/assets/{asset_id}")(delete_asset)

# edges
app.get("/edges")(get_edges)

app.get("/edges/{edge_id}")(get_edge_by_id)

app.post("/edge_create")(create_edge)

# lineage
app.get("/lineage/{asset_id}")(get_lineage)

app.get("/impact/{asset_id}")(get_impact)

app.get("/graph")(get_graph)
