# reset_db.py
import os, asyncio
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()
client = AsyncIOMotorClient(os.getenv("MONGO_URI"))
db = client["lineage_db"]

async def reset():
    a = await db.assets.delete_many({})
    e = await db.edges.delete_many({})
    print(f"Deleted {a.deleted_count} assets, {e.deleted_count} edges")

asyncio.run(reset())