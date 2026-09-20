from fastapi import Request, HTTPException
from google import genai
import os

client_ai = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

def get_asset_explanation(request: Request, asset_id: str):
    client = request.app.state.mongo_client
    db = client["Data_lineage"]
    assets_collection = db["assets"]
    edges_collection = db["edges"]

    asset = assets_collection.find_one({"_id": asset_id})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    downstream_count = edges_collection.count_documents({"source": asset_id})
    upstream_count = edges_collection.count_documents({"target": asset_id})

    prompt = f"""
    You are explaining a data asset from a company's data catalog to a non-technical business user.
    
    Asset details:
    - Name: {asset.get('name')}
    - Type: {asset.get('type')}
    - Environment: {asset.get('environment')}
    - Owner: {asset.get('owner')}
    - Criticality: {asset.get('criticality')}
    - Sensitivity: {asset.get('sensitivity')}
    - Lifecycle: {asset.get('lifecycle')}
    - Modernization status: {asset.get('modernization_status')}
    - Number of assets that directly depend on this one (downstream): {downstream_count}
    - Number of assets this one directly depends on (upstream): {upstream_count}
    
    Write a plain-English explanation using EXACTLY this structure, with these 4 headings. Keep each section to 1-2 short sentences. Use the exact numbers given above, don't say "several" or "a few" if a number is provided.
    
    ## What it is
    (what this asset is and its role, in one line)
    
    ## Risk of changing it
    (mention criticality and cite the exact upstream/downstream counts)
    
    ## Sensitivity
    (what kind of data it holds, in plain terms)
    
    ## What's next
    (what the modernization status means going forward)
    
    Avoid jargon. Do not repeat raw field names like "criticality: high" — describe them in words instead.
    """

    try:
        response = client_ai.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt
        )
        explanation = response.text
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI explanation failed: {str(e)}")

    return {
        "asset_id": asset_id,
        "asset_name": asset.get("name"),
        "explanation": explanation
    }