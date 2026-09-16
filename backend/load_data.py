import json
import os
import asyncio
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from models import Asset, Edge   # full models — your data already includes _id, created_at, etc.

load_dotenv()

client = AsyncIOMotorClient(os.getenv("MONGO_URI"))
db = client["lineage_db"]


async def load_assets(path="data/assets.json"):
    raw = json.load(open(path))
    valid_ids = set()

    for item in raw:
        try:
            asset = Asset(**item)
        except Exception as e:
            print(f"❌ Skipped '{item.get('name')}': {e}")
            continue

        doc = asset.model_dump(by_alias=True)  # by_alias=True keeps "_id" as "_id"
        await db.assets.replace_one({"_id": doc["_id"]}, doc, upsert=True)
        valid_ids.add(doc["_id"])
        print(f"✅ Loaded asset: {asset.name} ({doc['_id']})")

    return valid_ids


async def load_edges(valid_ids, path="data/edges.json"):
    raw = json.load(open(path))
    count = 0

    for item in raw:
        if item["source"] not in valid_ids or item["target"] not in valid_ids:
            print(f"❌ Skipped edge {item['_id']}: source/target id not found in assets")
            continue

        try:
            edge = Edge(**item)
        except Exception as e:
            print(f"❌ Skipped edge {item.get('_id')}: {e}")
            continue

        doc = edge.model_dump(by_alias=True)
        await db.edges.replace_one({"_id": doc["_id"]}, doc, upsert=True)
        count += 1
        print(f"✅ Loaded edge: {doc['_id']}")

    print(f"\nDone. {count} edges inserted.")


async def main():
    print("Loading assets...")
    valid_ids = await load_assets()
    print(f"\n{len(valid_ids)} assets loaded.\n")

    print("Loading edges...")
    await load_edges(valid_ids)


if __name__ == "__main__":
    asyncio.run(main())