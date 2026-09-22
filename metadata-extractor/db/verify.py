import os
import asyncio
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()
client = AsyncIOMotorClient(os.getenv("MONGO_URI"))
db = client["lineage_db"]


async def verify():
    asset_count = await db.assets.count_documents({})
    edge_count = await db.edges.count_documents({})
    print(f"Assets in DB: {asset_count}")
    print(f"Edges in DB: {edge_count}")

    print("\n--- Sample assets ---")
    async for doc in db.assets.find().limit(3):
        print(doc)

    print("\n--- Checking edges point to real assets ---")
    all_asset_ids = set()
    async for doc in db.assets.find():
        all_asset_ids.add(str(doc["_id"]))

    broken = 0
    async for edge in db.edges.find():
        if edge["source"] not in all_asset_ids or edge["target"] not in all_asset_ids:
            print(f"❌ Broken edge: {edge}")
            broken += 1

    if broken == 0:
        print("✅ All edges point to real assets. Graph is clean.")
    else:
        print(f"❌ {broken} broken edge(s) found.")


if __name__ == "__main__":
    asyncio.run(verify())