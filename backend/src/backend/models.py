from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
from datetime import datetime,timezone

# ---------- Enums (keep values controlled) ----------

class AssetType(str, Enum):
    table = "Table"
    pipeline = "Pipeline"
    report = "Report"
    file = "File"

class Environment(str, Enum):
    prod = "prod"
    staging = "staging"
    dev = "dev"

class Criticality(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"

class Sensitivity(str, Enum):
    pii = "pii"
    internal = "internal"
    public = "public"

class Lifecycle(str, Enum):
    active = "active"
    deprecated = "deprecated"
    retiring = "retiring"

class ModernizationStatus(str, Enum):
    retain = "retain"
    remediate = "remediate"
    migrate = "migrate"
    redesign = "redesign"
    retire = "retire"

class RelationshipType(str, Enum):
    reads_from = "reads_from"
    writes_to = "writes_to"
    feeds = "feeds"
    depends_on = "depends_on"

class Confidence(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"

# ---------- Asset ----------

class AssetBase(BaseModel):
    name: str
    type: AssetType
    environment: Environment
    owner: str
    criticality: Criticality
    sensitivity: Sensitivity
    lifecycle: Lifecycle
    modernization_status: ModernizationStatus

class AssetCreate(AssetBase):
    """Used when registering a new asset (no id yet, Mongo/you assign it)."""
    pass

class Asset(AssetBase):
    """Full asset as stored/returned from MongoDB."""
    id: str = Field(alias="_id") # these 3 returned from mongo, needs validation
    created_at: datetime = Field(default_factory=datetime.now(timezone.utc))
    last_scanned: datetime = Field(default_factory=datetime.now(timezone.utc))

    class Config:
        populate_by_name = True

# ---------- Edge ----------

class EdgeBase(BaseModel):
    source: str          # asset _id
    target: str          # asset _id
    relationship_type: RelationshipType
    confidence: Confidence = Confidence.medium

class EdgeCreate(EdgeBase):
    pass

class Edge(EdgeBase):
    id: str = Field(alias="_id")

    class Config:
        populate_by_name = True