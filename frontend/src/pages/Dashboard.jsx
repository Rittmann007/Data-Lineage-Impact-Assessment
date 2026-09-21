import { useEffect, useMemo, useState } from "react";
import {
  getAssets,
  getEdges,
  getAssetById,
  getImpact,
  getAssetExplanation,
} from "../api";
import {
  ReactFlow,
  Background,
  Handle,
  MarkerType,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const ASSET_TYPES = ["Table", "Pipeline", "Report", "File"];
const ENVIRONMENTS = ["prod", "staging", "dev"];
const CRITICALITIES = ["high", "medium", "low"];
const SENSITIVITIES = ["pii", "internal", "public"];
const LIFECYCLES = ["active", "deprecated", "retiring"];
const MODERNIZATION_STATUSES = [
  "retain",
  "remediate",
  "migrate",
  "redesign",
  "retire",
];

const emptyAssetForm = {
  name: "",
  type: "Table",
  environment: "prod",
  owner: "",
  criticality: "medium",
  sensitivity: "internal",
  lifecycle: "active",
  modernization_status: "retain",
};

// Bold, legible badge treatment per criticality — solid enough to actually
// read as red/amber/green at a glance, not washed-out low-opacity tints.
const CRITICALITY_BADGE = {
  high: "border border-red-500/30 bg-red-500/15 text-red-300",
  medium: "border border-amber-500/30 bg-amber-500/15 text-amber-300",
  low: "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
};

const CRITICALITY_ACCENT = {
  high: "bg-red-500/70",
  medium: "bg-amber-500/70",
  low: "bg-emerald-500/70",
};

const ENVIRONMENT_BADGE = {
  prod: "border border-blue-500/30 bg-blue-500/15 text-blue-300",
  staging: "border border-violet-500/30 bg-violet-500/15 text-violet-300",
  dev: "border border-white/15 bg-white/[0.06] text-white/65",
};

const SENSITIVITY_BADGE = {
  pii: "border border-pink-500/30 bg-pink-500/15 text-pink-300",
  internal: "border border-white/15 bg-white/[0.06] text-white/65",
  public: "border border-sky-500/30 bg-sky-500/15 text-sky-300",
};

const LIFECYCLE_BADGE = {
  active: "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  deprecated: "border border-amber-500/30 bg-amber-500/15 text-amber-300",
  retiring: "border border-red-500/30 bg-red-500/15 text-red-300",
};

// Each asset type gets its own hue so a row is scannable at a glance —
// Pipeline reuses the app's violet accent since pipelines are the
// "active" processing concept; Table/Report get distinct, unused hues.
const TYPE_BADGE = {
  File: "border border-white/15 bg-white/[0.06] text-white/65",
  Pipeline: "border border-violet-400/25 bg-violet-400/10 text-violet-200",
  Table: "border border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
  Report: "border border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-200",
};

const TYPE_DOT = {
  File: "bg-white/50",
  Pipeline: "bg-violet-400",
  Table: "bg-cyan-400",
  Report: "bg-fuchsia-400",
};

function LineageNode({ data }) {
  const roleStyles = {
    upstream: {
      border: "1px solid rgba(96,165,250,0.28)",
      background: "rgba(59,130,246,0.10)",
      shadow: "0 10px 28px rgba(37,99,235,0.08)",
      dot: "bg-blue-300/80",
      label: "UPSTREAM",
    },
    selected: {
      border: "1px solid rgba(255,255,255,0.38)",
      background: "rgba(255,255,255,0.10)",
      shadow: "0 14px 40px rgba(0,0,0,0.22)",
      dot: "bg-white/80",
      label: "SELECTED",
    },
    downstream: {
      border: "1px solid rgba(248,113,113,0.30)",
      background: "rgba(239,68,68,0.10)",
      shadow: "0 10px 28px rgba(220,38,38,0.08)",
      dot: "bg-red-300/80",
      label: "DOWNSTREAM",
    },
  };

  const style = roleStyles[data.role] || roleStyles.selected;

  return (
    <div
      className="relative flex h-[56px] w-[158px] flex-col justify-center rounded-xl px-3 text-center backdrop-blur-md"
      style={{
        border: style.border,
        background: style.background,
        boxShadow: style.shadow,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-slate-300/80"
      />

      <div className="flex items-center justify-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        <span className="max-w-[124px] truncate text-xs font-medium text-white/90">
          {data.label}
        </span>
      </div>

      <span className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/35">
        {data.assetType} · {style.label}
      </span>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-slate-300/80"
      />
    </div>
  );
}

const lineageNodeTypes = {
  lineage: LineageNode,
};

function Dashboard() {
  const [assets, setAssets] = useState([]);
  const [allAssets, setAllAssets] = useState([]);
  const [edges, setEdges] = useState([]);

  const [viewMode, setViewMode] = useState("assets");

  // Asset filters
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [environment, setEnvironment] = useState("");
  const [owner, setOwner] = useState("");
  const [criticality, setCriticality] = useState("");

  // Relation filters
  const [relationSearch, setRelationSearch] = useState("");
  const [relationSource, setRelationSource] = useState("");
  const [relationTarget, setRelationTarget] = useState("");
  const [relationType, setRelationType] = useState("");
  const [relationConfidence, setRelationConfidence] = useState("");

  // Asset details modal
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [loadingAssetDetails, setLoadingAssetDetails] = useState(false);

  // Impact analysis modal
  const [impactAsset, setImpactAsset] = useState(null);
  const [impact, setImpact] = useState(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  // Lineage modal
  const [lineageAsset, setLineageAsset] = useState(null);
  const [loadingLineage, setLoadingLineage] = useState(false);

  // AI overview modal
  const [aiAsset, setAiAsset] = useState(null);
  const [aiExplanation, setAiExplanation] = useState(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiError, setAiError] = useState(null);

  // Create asset modal
  const [showCreateAsset, setShowCreateAsset] = useState(false);
  const [assetForm, setAssetForm] = useState(emptyAssetForm);
  const [creatingAsset, setCreatingAsset] = useState(false);

  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadingEdges, setLoadingEdges] = useState(true);
  const [error, setError] = useState("");

  // --------------------------------------------------
  // Load assets
  // --------------------------------------------------

  async function loadAssets() {
    try {
      setLoadingAssets(true);
      setError("");

      const data = await getAssets({
        search,
        type,
        environment,
        owner,
        criticality,
      });

      setAssets(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAssets(false);
    }
  }

  async function loadAllAssets() {
    try {
      const data = await getAssets({});
      setAllAssets(data);
    } catch (err) {
      setError(err.message);
    }
  }

  // --------------------------------------------------
  // Load relations
  // --------------------------------------------------

  async function loadEdges() {
    try {
      setLoadingEdges(true);

      const data = await getEdges();

      setEdges(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingEdges(false);
    }
  }

  // --------------------------------------------------
  // Initial loading
  // --------------------------------------------------

  useEffect(() => {
    loadAssets();
    loadAllAssets();
    loadEdges();
  }, []);

  // Reload only the filtered asset list.
  useEffect(() => {
    const timer = setTimeout(() => {
      loadAssets();
    }, 300);

    return () => clearTimeout(timer);
  }, [search, type, environment, owner, criticality]);

  // --------------------------------------------------
  // Modal / Escape handling
  // --------------------------------------------------

  useEffect(() => {
    const modalOpen =
      Boolean(selectedAsset) ||
      Boolean(impactAsset) ||
      Boolean(lineageAsset) ||
      Boolean(aiAsset) ||
      showCreateAsset;

    function handleEscape(event) {
      if (event.key !== "Escape") return;

      setSelectedAsset(null);
      setImpactAsset(null);
      setImpact(null);
      setLineageAsset(null);
      setAiAsset(null);
      setAiExplanation(null);
      setAiError(null);
      setShowCreateAsset(false);
    }

    if (modalOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [selectedAsset, impactAsset, lineageAsset, aiAsset, showCreateAsset]);

  // --------------------------------------------------
  // Asset details
  // --------------------------------------------------

  async function handleAssetSelect(asset) {
    try {
      setSelectedAsset(asset);
      setLoadingAssetDetails(true);

      const assetDetails = await getAssetById(asset._id);

      setSelectedAsset(assetDetails);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAssetDetails(false);
    }
  }

  function closeAssetDetailsModal() {
    setSelectedAsset(null);
  }

  // --------------------------------------------------
  // Asset impact
  // --------------------------------------------------

  async function handleImpactClick(event, asset) {
    event.stopPropagation();

    try {
      setImpactAsset(asset);
      setLoadingImpact(true);
      setImpact(null);

      const impactData = await getImpact(asset._id);

      setImpact(impactData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingImpact(false);
    }
  }

  function closeImpactModal() {
    setImpactAsset(null);
    setImpact(null);
  }

  // --------------------------------------------------
  // Create asset
  // --------------------------------------------------

  function updateAssetForm(field, value) {
    setAssetForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleCreateAsset(event) {
    event.preventDefault();

    try {
      setCreatingAsset(true);
      setError("");

      const response = await fetch(`${API_BASE_URL}/asset_create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(assetForm),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          body?.detail || "Unable to create asset."
        );
      }

      setShowCreateAsset(false);
      setAssetForm(emptyAssetForm);

      await Promise.all([
        loadAssets(),
        loadAllAssets(),
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingAsset(false);
    }
  }

  // --------------------------------------------------
  // Asset / relation maps
  // --------------------------------------------------

  const allAssetMap = useMemo(() => {
    const map = {};

    allAssets.forEach((asset) => {
      map[asset._id] = asset;
    });

    return map;
  }, [allAssets]);

  const displayedRelations = useMemo(() => {
    const query = relationSearch.trim().toLowerCase();

    return edges
      .map((edge) => ({
        ...edge,
        sourceName:
          allAssetMap[edge.source]?.name || edge.source,
        targetName:
          allAssetMap[edge.target]?.name || edge.target,
      }))
      .filter((edge) => {
        const matchesSearch =
          !query ||
          [
            edge.sourceName,
            edge.targetName,
            edge.relationship_type,
            edge.confidence,
            edge.source,
            edge.target,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query);

        const matchesSource =
          !relationSource || edge.source === relationSource;

        const matchesTarget =
          !relationTarget || edge.target === relationTarget;

        const matchesType =
          !relationType ||
          edge.relationship_type === relationType;

        const matchesConfidence =
          !relationConfidence ||
          edge.confidence === relationConfidence;

        return (
          matchesSearch &&
          matchesSource &&
          matchesTarget &&
          matchesType &&
          matchesConfidence
        );
      });
  }, [
    edges,
    allAssetMap,
    relationSearch,
    relationSource,
    relationTarget,
    relationType,
    relationConfidence,
  ]);

  const relationTypes = useMemo(
    () =>
      [...new Set(edges.map((edge) => edge.relationship_type))]
        .filter(Boolean)
        .sort(),
    [edges]
  );

  const relationConfidences = useMemo(
    () =>
      [...new Set(edges.map((edge) => edge.confidence))]
        .filter(Boolean)
        .sort(),
    [edges]
  );

  // --------------------------------------------------
  // Lineage
  //
  // The lineage relationships come from the loaded backend relation set.
  // The important part here is deterministic presentation: the selected
  // asset stays centered, upstream assets are above it, and downstream
  // assets are below it.
  // --------------------------------------------------

  function buildLineage(assetId) {
    // Build exact hop levels from the selected asset.
    // Upstream is placed above; downstream is placed below.
    const upstreamLevels = new Map([[assetId, 0]]);
    const downstreamLevels = new Map([[assetId, 0]]);

    let queue = [assetId];

    while (queue.length) {
      const current = queue.shift();

      edges.forEach((edge) => {
        if (edge.target !== current) return;

        const nextLevel = upstreamLevels.get(current) + 1;
        if (!upstreamLevels.has(edge.source)) {
          upstreamLevels.set(edge.source, nextLevel);
          queue.push(edge.source);
        }
      });
    }

    queue = [assetId];

    while (queue.length) {
      const current = queue.shift();

      edges.forEach((edge) => {
        if (edge.source !== current) return;

        const nextLevel = downstreamLevels.get(current) + 1;
        if (!downstreamLevels.has(edge.target)) {
          downstreamLevels.set(edge.target, nextLevel);
          queue.push(edge.target);
        }
      });
    }

    const upstream = new Set(
      [...upstreamLevels.keys()].filter((id) => id !== assetId)
    );
    const downstream = new Set(
      [...downstreamLevels.keys()].filter((id) => id !== assetId)
    );

    const involvedIds = new Set([
      ...upstream,
      assetId,
      ...downstream,
    ]);

    const nodeBase = [...involvedIds].map((id) => {
      const asset = allAssetMap[id];

      let role = "selected";
      if (upstream.has(id)) role = "upstream";
      if (downstream.has(id)) role = "downstream";

      return {
        id,
        type: "lineage",
        data: {
          label: asset?.name || id,
          assetType: asset?.type || "Asset",
          role,
        },
      };
    });

    // Keep every level centered around the selected asset.
    // This prevents the graph from drifting into separate columns.
    const NODE_WIDTH = 210;
    const HORIZONTAL_GAP = 70;
    const VERTICAL_GAP = 145;
    const CENTER_X = 500;
    const CENTER_Y = 300;

    const positionLevel = (ids, level, direction) => {
      const count = ids.length;
      const spacing = NODE_WIDTH + HORIZONTAL_GAP;

      return ids.map((id, index) => ({
        id,
        position: {
          x: CENTER_X - ((count - 1) * spacing) / 2 + index * spacing,
          y:
            CENTER_Y +
            direction * level * VERTICAL_GAP,
        },
      }));
    };

    const upstreamByLevel = {};
    upstreamLevels.forEach((level, id) => {
      if (id === assetId) return;
      if (!upstreamByLevel[level]) upstreamByLevel[level] = [];
      upstreamByLevel[level].push(id);
    });

    const downstreamByLevel = {};
    downstreamLevels.forEach((level, id) => {
      if (id === assetId) return;
      if (!downstreamByLevel[level]) downstreamByLevel[level] = [];
      downstreamByLevel[level].push(id);
    });

    const positions = new Map();

    Object.entries(upstreamByLevel).forEach(([level, ids]) => {
      positionLevel(ids, Number(level), -1).forEach((item) => {
        positions.set(item.id, item.position);
      });
    });

    Object.entries(downstreamByLevel).forEach(([level, ids]) => {
      positionLevel(ids, Number(level), 1).forEach((item) => {
        positions.set(item.id, item.position);
      });
    });

    positions.set(assetId, {
      x: CENTER_X,
      y: CENTER_Y,
    });

    const positionedNodes = nodeBase.map((node) => ({
      ...node,
      position: positions.get(node.id),
    }));

    const lineageEdges = edges
      .filter(
        (edge) =>
          involvedIds.has(edge.source) &&
          involvedIds.has(edge.target)
      )
      .map((edge) => ({
        id:
          edge._id ||
          `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        label: edge.relationship_type,
        labelStyle: {
          fill: "rgba(255,255,255,0.72)",
          fontSize: 10,
          fontWeight: 500,
        },
        labelBgStyle: {
          fill: "#172235",
          fillOpacity: 0.96,
        },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 5,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: "rgba(148,163,184,0.75)",
        },
        style: {
          stroke: "rgba(148,163,184,0.72)",
          strokeWidth: 1.8,
        },
      }));

    return {
      nodes: positionedNodes,
      edges: lineageEdges,
    };
  }

  const lineageGraph = useMemo(() => {
    if (!lineageAsset) {
      return {
        nodes: [],
        edges: [],
      };
    }

    return buildLineage(lineageAsset._id);
  }, [lineageAsset, edges, allAssetMap]);

  function handleLineageClick(event, asset) {
    event.stopPropagation();
    setLineageAsset(asset);
    setLoadingLineage(true);

    // Keep a short loading state so the popup feels deliberate
    // while the graph is prepared.
    window.setTimeout(() => {
      setLoadingLineage(false);
    }, 150);
  }

  function closeLineageModal() {
    setLineageAsset(null);
    setLoadingLineage(false);
  }

  // --------------------------------------------------
  // AI overview
  // --------------------------------------------------

  async function handleAIClick(event, asset) {
    event.stopPropagation();

    try {
      setAiAsset(asset);
      setLoadingAI(true);
      setAiExplanation(null);
      setAiError(null);

      const data = await getAssetExplanation(asset._id);

      setAiExplanation(data.explanation);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setLoadingAI(false);
    }
  }

  function closeAIModal() {
    setAiAsset(null);
    setAiExplanation(null);
    setAiError(null);
  }

  // --------------------------------------------------
  // Impact statistics
  // --------------------------------------------------

  const directImpact =
    impact?.affected?.filter(
      (item) => item.directly_affected
    ).length || 0;

  const indirectImpact =
    impact?.affected?.filter(
      (item) => !item.directly_affected
    ).length || 0;

  const maxHops =
    impact?.affected?.reduce(
      (max, item) => Math.max(max, item.hops),
      0
    ) || 0;

  // --------------------------------------------------
  // Analytics (derived entirely from already-loaded
  // allAssets / edges — no extra backend calls needed)
  // --------------------------------------------------

  const CRITICALITY_BAR_COLOR = {
    high: "bg-gradient-to-r from-red-400/50 to-red-400",
    medium: "bg-gradient-to-r from-amber-400/50 to-amber-400",
    low: "bg-gradient-to-r from-green-400/50 to-green-400",
  };

  const CONFIDENCE_BAR_COLOR = {
    high: "bg-gradient-to-r from-green-400/50 to-green-400",
    medium: "bg-gradient-to-r from-amber-400/50 to-amber-400",
    low: "bg-white/20",
  };

  const assetAnalytics = useMemo(() => {
    const total = assets.length;

    const byType = ASSET_TYPES.map((label) => ({
      label,
      count: assets.filter((a) => a.type === label).length,
    }));

    const byEnvironment = ENVIRONMENTS.map((label) => ({
      label,
      count: assets.filter((a) => a.environment === label).length,
    }));

    const byCriticality = CRITICALITIES.map((label) => ({
      label,
      count: assets.filter((a) => a.criticality === label).length,
      colorClassName: CRITICALITY_BAR_COLOR[label],
    }));

    const connectedIds = new Set();
    edges.forEach((e) => {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    });

    const highCriticality =
      byCriticality.find((r) => r.label === "high")?.count || 0;
    const notConnected = assets.filter(
      (a) => !connectedIds.has(a._id)
    ).length;
    const deprecatedOrRetiring = assets.filter(
      (a) => a.lifecycle === "deprecated" || a.lifecycle === "retiring"
    ).length;
    const distinctOwners = new Set(
      assets.map((a) => a.owner).filter(Boolean)
    ).size;

    return {
      total,
      byType,
      byEnvironment,
      byCriticality,
      highCriticality,
      highCriticalityPct: total
        ? Math.round((highCriticality / total) * 100)
        : 0,
      notConnected,
      deprecatedOrRetiring,
      distinctOwners,
    };
  }, [assets, edges]);

  const edgeAnalytics = useMemo(() => {
    const total = edges.length;

    const byRelationshipType = [
      "reads_from",
      "writes_to",
      "feeds",
      "depends_on",
    ].map((label) => ({
      label,
      count: edges.filter((e) => e.relationship_type === label).length,
    }));

    const byConfidence = ["high", "medium", "low"].map((label) => ({
      label,
      count: edges.filter((e) => e.confidence === label).length,
      colorClassName: CONFIDENCE_BAR_COLOR[label],
    }));

    const highConfidence =
      byConfidence.find((r) => r.label === "high")?.count || 0;

    const degree = {};
    const connectedIds = new Set();
    edges.forEach((e) => {
      degree[e.source] = (degree[e.source] || 0) + 1;
      degree[e.target] = (degree[e.target] || 0) + 1;
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    });

    let mostConnectedId = null;
    let mostConnectedDegree = 0;
    Object.entries(degree).forEach(([id, count]) => {
      if (count > mostConnectedDegree) {
        mostConnectedDegree = count;
        mostConnectedId = id;
      }
    });

    return {
      total,
      byRelationshipType,
      byConfidence,
      highConfidence,
      highConfidencePct: total
        ? Math.round((highConfidence / total) * 100)
        : 0,
      avgPerAsset: allAssets.length
        ? (total / allAssets.length).toFixed(1)
        : "0.0",
      connectedCount: connectedIds.size,
      mostConnectedName: mostConnectedId
        ? allAssetMap[mostConnectedId]?.name || mostConnectedId
        : "—",
      mostConnectedDegree,
    };
  }, [edges, allAssets, allAssetMap]);

  return (
    <div className="min-h-screen bg-[#0d1726] text-white">
      {/* Keep the existing dashboard background / atmosphere. */}
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute left-[-10%] top-[10%] h-[500px] w-[500px] rounded-full bg-blue-500/15 blur-[140px]" />
        <div className="absolute right-[-10%] top-[30%] h-[500px] w-[500px] rounded-full bg-violet-500/12 blur-[140px]" />
        <div className="absolute bottom-[-15%] left-[35%] h-[400px] w-[500px] rounded-full bg-blue-400/10 blur-[150px]" />
      </div>

      <main className="relative z-10 mx-auto max-w-[1280px] px-4 pb-9 pt-20">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.25em] text-white/50">
              Data Estate
            </p>

            <h1 className="text-[1.7rem] font-extrabold leading-[1.05] tracking-tight text-white">
              Dashboard
            </h1>
          </div>

          <p className="max-w-sm text-xs leading-relaxed text-white/45">
            Explore assets, inspect relationships, and understand
            downstream impact across your data estate.
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs text-red-100 backdrop-blur-md">
            <span>{error}</span>
            <button
              onClick={() => setError("")}
              className="text-white/50 hover:text-white"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {/* Assets / Relations toggle */}
        <div className="mb-3 inline-flex rounded-xl border border-white/10 bg-white/[0.06] p-1.5 shadow-xl shadow-black/10 backdrop-blur-xl">
          <button
            onClick={() => setViewMode("assets")}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
              viewMode === "assets"
                ? "bg-white/[0.12] text-white shadow-lg shadow-violet-500/10 ring-1 ring-violet-400/20"
                : "text-white/45 hover:text-white/75"
            }`}
          >
            Assets
          </button>

          <button
            onClick={() => setViewMode("relations")}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
              viewMode === "relations"
                ? "bg-white/[0.12] text-white shadow-lg shadow-violet-500/10 ring-1 ring-violet-400/20"
                : "text-white/45 hover:text-white/75"
            }`}
          >
            Relations
          </button>
        </div>

        {viewMode === "assets" ? (
          <section className="overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] shadow-2xl shadow-black/20 backdrop-blur-xl">
            {/* Assets header */}
            <div className="border-b border-white/10 px-4 py-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">
                    Assets
                  </h2>

                  <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/60 [font-family:var(--font-mono)]">
                    {assets.length} assets
                  </span>

                  <span className="text-xs text-white/35">
                    · Search and filter the data estate.
                  </span>
                </div>

                <button
                  onClick={() => {
                    setError("");
                    setShowCreateAsset(true);
                  }}
                  className="rounded-lg border border-violet-300/20 bg-violet-400/[0.12] px-3 py-2 text-xs font-medium text-violet-50 shadow-lg shadow-violet-500/10 transition hover:border-violet-300/30 hover:bg-violet-400/[0.18]"
                >
                  + Create Asset
                </button>
              </div>

              {/* Asset analytics */}
              <div className="mt-3 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.015] p-3 shadow-inner shadow-black/20">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                  Asset Analytics
                </p>

                <div className="grid grid-cols-2 divide-y divide-white/[0.06] sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-5">
                  <AnalyticsStat
                    value={assetAnalytics.total}
                    label="assets registered"
                  />
                  <AnalyticsStat
                    value={assetAnalytics.highCriticality}
                    label="high criticality"
                    caption={`${assetAnalytics.highCriticalityPct}% of registry`}
                    valueClassName="text-red-300"
                  />
                  <AnalyticsStat
                    value={assetAnalytics.notConnected}
                    label="not yet connected"
                    caption={
                      assetAnalytics.notConnected === 0
                        ? "everything is mapped"
                        : "needs a relationship"
                    }
                  />
                  <AnalyticsStat
                    value={assetAnalytics.deprecatedOrRetiring}
                    label="deprecated or retiring"
                  />
                  <AnalyticsStat
                    value={assetAnalytics.distinctOwners}
                    label="distinct owners"
                  />
                </div>

                <div className="mt-3 grid grid-cols-1 gap-4 border-t border-white/10 pt-3 md:grid-cols-3">
                  <BreakdownColumn
                    title="By type"
                    rows={assetAnalytics.byType}
                  />
                  <BreakdownColumn
                    title="By environment"
                    rows={assetAnalytics.byEnvironment}
                  />
                  <StatPieChart
                    title="By criticality"
                    rows={assetAnalytics.byCriticality}
                    colors={PIE_COLORS}
                    centerLabel="assets"
                  />
                </div>
              </div>

              {/* Search */}
              <div className="mt-3">
                <input
                  type="text"
                  placeholder="Search assets..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/25 focus:bg-white/5"
                />
              </div>

              {/* Filters */}
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 xl:grid-cols-4">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white/75 outline-none"
                >
                  <option value="">All types</option>
                  {ASSET_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>

                <select
                  value={environment}
                  onChange={(e) =>
                    setEnvironment(e.target.value)
                  }
                  className="rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white/75 outline-none"
                >
                  <option value="">All environments</option>
                  <option value="prod">Production</option>
                  <option value="staging">Staging</option>
                  <option value="dev">Development</option>
                </select>

                <select
                  value={criticality}
                  onChange={(e) =>
                    setCriticality(e.target.value)
                  }
                  className="rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white/75 outline-none"
                >
                  <option value="">All criticality</option>
                  {CRITICALITIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  placeholder="Owner"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  className="rounded-lg border border-white/10 bg-black/10 px-2 py-2 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/25"
                />
              </div>
            </div>

            {/* Asset list */}
            <div className="min-h-[465px] p-3">
              {loadingAssets ? (
                <div className="flex h-28 items-center justify-center text-xs text-white/40">
                  Loading assets...
                </div>
              ) : assets.length === 0 ? (
                <div className="flex h-28 items-center justify-center text-xs text-white/40">
                  No assets found.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {assets.map((asset) => {
                    const isSelected =
                      selectedAsset?._id === asset._id;

                    return (
                      <div
                        key={asset._id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleAssetSelect(asset)}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" ||
                            event.key === " "
                          ) {
                            event.preventDefault();
                            handleAssetSelect(asset);
                          }
                        }}
                        className={`group relative flex flex-wrap cursor-pointer items-start justify-between gap-x-3 gap-y-2 overflow-hidden rounded-xl border py-2.5 pl-4 pr-2.5 text-left transition-all duration-200 ${
                          isSelected
                            ? "border-violet-300/30 bg-violet-400/[0.10] shadow-lg shadow-violet-500/10"
                            : "border-white/10 bg-white/[0.045] hover:border-white/25 hover:bg-white/[0.08] hover:shadow-md hover:shadow-black/20"
                        }`}
                      >
                        <span
                          className={`absolute inset-y-0 left-0 w-1 ${
                            CRITICALITY_ACCENT[asset.criticality]
                          }`}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <h3 className="truncate text-[0.9rem] font-bold text-white/95">
                              {asset.name}
                            </h3>
                            <p className="truncate text-[11px] tracking-tight text-white/35 [font-family:var(--font-mono)]">
                              {asset._id}
                            </p>
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span
                              className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] [font-family:var(--font-mono)] ${
                                TYPE_BADGE[asset.type]
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  TYPE_DOT[asset.type]
                                }`}
                              />
                              {asset.type}
                            </span>

                            <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-white/55">
                              {asset.environment}
                            </span>

                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                                CRITICALITY_BADGE[asset.criticality]
                              }`}
                            >
                              {asset.criticality}
                            </span>

                            <span className="truncate rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-white/55">
                              {asset.owner}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5 self-center">
                          {/* Lineage button */}
                          <button
                            type="button"
                            onClick={(event) =>
                              handleLineageClick(event, asset)
                            }
                            className="rounded-md border border-violet-400/25 bg-violet-400/[0.10] px-2.5 py-1.5 text-[11px] font-semibold text-violet-200 transition hover:border-violet-300/50 hover:bg-violet-400/25 hover:text-white"
                          >
                            Lineage
                          </button>

                          {/* Impact button */}
                          <button
                            type="button"
                            onClick={(event) =>
                              handleImpactClick(event, asset)
                            }
                            className="rounded-md border border-amber-400/25 bg-amber-400/[0.10] px-2.5 py-1.5 text-[11px] font-semibold text-amber-200 transition hover:border-amber-300/50 hover:bg-amber-400/25 hover:text-white"
                          >
                            Impact
                          </button>

                          {/* AI overview button */}
                          <button
                            type="button"
                            onClick={(event) =>
                              handleAIClick(event, asset)
                            }
                            className="flex items-center gap-1 rounded-md border border-sky-400/25 bg-sky-400/[0.10] px-2.5 py-1.5 text-[11px] font-semibold text-sky-200 transition hover:border-sky-300/50 hover:bg-sky-400/25 hover:text-white"
                          >
                            <span className="text-[10px]">✦</span>
                            AI Overview
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="flex min-h-[465px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] shadow-2xl shadow-black/20 backdrop-blur-xl">
            {/* Relations header */}
            <div className="border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">
                  Relations
                </h2>

                <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/60 [font-family:var(--font-mono)]">
                  {displayedRelations.length} relations
                </span>

                <span className="text-xs text-white/35">
                  · View and filter existing connections between assets.
                </span>
              </div>

              {/* Edge analytics */}
              <div className="mt-3 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.015] p-3 shadow-inner shadow-black/20">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                  Edge Analytics
                </p>

                <div className="grid grid-cols-2 divide-y divide-white/[0.06] sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-5">
                  <AnalyticsStat
                    value={edgeAnalytics.total}
                    label="relationships mapped"
                  />
                  <AnalyticsStat
                    value={edgeAnalytics.highConfidence}
                    label="high confidence"
                    caption={`${edgeAnalytics.highConfidencePct}% of edges`}
                    valueClassName="text-green-300"
                  />
                  <AnalyticsStat
                    value={edgeAnalytics.avgPerAsset}
                    label="avg edges per asset"
                  />
                  <AnalyticsStat
                    value={edgeAnalytics.connectedCount}
                    label="assets connected"
                    caption={`of ${assetAnalytics.total} registered`}
                  />
                  <AnalyticsStat
                    value={edgeAnalytics.mostConnectedDegree}
                    label="most connected"
                    caption={edgeAnalytics.mostConnectedName}
                  />
                </div>

                <div className="mt-3 grid grid-cols-1 gap-4 border-t border-white/10 pt-3 md:grid-cols-2">
                  <BreakdownColumn
                    title="By relationship type"
                    rows={edgeAnalytics.byRelationshipType}
                  />
                  <StatPieChart
                    title="By confidence"
                    rows={edgeAnalytics.byConfidence}
                    colors={CONFIDENCE_PIE_COLORS}
                    centerLabel="edges"
                  />
                </div>
              </div>

              <div className="mt-3">
                <input
                  type="text"
                  placeholder="Search relations..."
                  value={relationSearch}
                  onChange={(e) =>
                    setRelationSearch(e.target.value)
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/25 focus:bg-white/5"
                />
              </div>

              <div className="mt-1.5 grid grid-cols-2 gap-1.5 xl:grid-cols-4">
                <select
                  value={relationSource}
                  onChange={(e) =>
                    setRelationSource(e.target.value)
                  }
                  className="rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white/75 outline-none"
                >
                  <option value="">All sources</option>
                  {allAssets
                    .slice()
                    .sort((a, b) =>
                      a.name.localeCompare(b.name)
                    )
                    .map((asset) => (
                      <option key={asset._id} value={asset._id}>
                        {asset.name}
                      </option>
                    ))}
                </select>

                <select
                  value={relationTarget}
                  onChange={(e) =>
                    setRelationTarget(e.target.value)
                  }
                  className="rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white/75 outline-none"
                >
                  <option value="">All targets</option>
                  {allAssets
                    .slice()
                    .sort((a, b) =>
                      a.name.localeCompare(b.name)
                    )
                    .map((asset) => (
                      <option key={asset._id} value={asset._id}>
                        {asset.name}
                      </option>
                    ))}
                </select>

                <select
                  value={relationType}
                  onChange={(e) =>
                    setRelationType(e.target.value)
                  }
                  className="rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white/75 outline-none"
                >
                  <option value="">All relationship types</option>
                  {relationTypes.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>

                <select
                  value={relationConfidence}
                  onChange={(e) =>
                    setRelationConfidence(e.target.value)
                  }
                  className="rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white/75 outline-none"
                >
                  <option value="">All confidence</option>
                  {relationConfidences.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Relation list */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="mx-auto w-full max-w-4xl">
                {loadingEdges ? (
                  <div className="flex h-28 items-center justify-center text-xs text-white/40">
                    Loading relations...
                  </div>
                ) : displayedRelations.length === 0 ? (
                  <div className="flex h-28 items-center justify-center text-xs text-white/40">
                    No relations found.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {displayedRelations.map((edge) => (
                      <div
                        key={edge._id}
                        className="rounded-xl border border-white/10 bg-white/[0.055] p-2 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.09]"
                      >
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/10 px-3 py-1.5">
                            <p className="truncate text-xs font-medium text-white/90">
                              {edge.sourceName}
                            </p>
                            <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/30">
                              Source
                            </p>
                          </div>

                          <div className="flex w-20 shrink-0 flex-col items-center justify-center gap-1">
                            <span className="max-w-full truncate rounded-md bg-blue-400/10 px-1.5 py-1 text-[12px] font-medium text-blue-100/80">
                              {edge.relationship_type}
                            </span>
                            <span className="text-base leading-none text-white/35">
                              →
                            </span>
                            <span className="text-[11px] text-white/35">
                              {edge.confidence} confidence
                            </span>
                          </div>

                          <div className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/10 px-3 py-1.5 text-right">
                            <p className="truncate text-xs font-medium text-white/90">
                              {edge.targetName}
                            </p>
                            <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/30">
                              Target
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ==================================================
          CREATE ASSET MODAL
      ================================================== */}

      {showCreateAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-6 backdrop-blur-sm"
          onClick={() => setShowCreateAsset(false)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-[#172235]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-white/10 bg-[#172235]/90 px-4 py-3.5 backdrop-blur-xl">
              <div>
                <h2 className="text-lg font-semibold">
                  Create Asset
                </h2>

                <p className="mt-1 text-xs text-white/45">
                  Add a new asset to the data estate.
                </p>
              </div>

              <button
                onClick={() => setShowCreateAsset(false)}
                className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-base text-white/60 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={handleCreateAsset}
              className="grid gap-3 p-4 md:grid-cols-2"
            >
              <div className="md:col-span-2">
                <label className="text-xs text-white/50">
                  Name
                </label>
                <input
                  required
                  value={assetForm.name}
                  onChange={(e) =>
                    updateAssetForm("name", e.target.value)
                  }
                  placeholder="e.g. customer_orders"
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-white outline-none placeholder:text-white/25 focus:border-white/25"
                />
              </div>

              <FormSelect
                label="Type"
                value={assetForm.type}
                onChange={(value) =>
                  updateAssetForm("type", value)
                }
                options={ASSET_TYPES}
              />

              <FormSelect
                label="Environment"
                value={assetForm.environment}
                onChange={(value) =>
                  updateAssetForm("environment", value)
                }
                options={ENVIRONMENTS}
              />

              <div>
                <label className="text-xs text-white/50">
                  Owner
                </label>
                <input
                  required
                  value={assetForm.owner}
                  onChange={(e) =>
                    updateAssetForm("owner", e.target.value)
                  }
                  placeholder="e.g. Data Platform"
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white outline-none placeholder:text-white/25 focus:border-white/25"
                />
              </div>

              <FormSelect
                label="Criticality"
                value={assetForm.criticality}
                onChange={(value) =>
                  updateAssetForm("criticality", value)
                }
                options={CRITICALITIES}
              />

              <FormSelect
                label="Sensitivity"
                value={assetForm.sensitivity}
                onChange={(value) =>
                  updateAssetForm("sensitivity", value)
                }
                options={SENSITIVITIES}
              />

              <FormSelect
                label="Lifecycle"
                value={assetForm.lifecycle}
                onChange={(value) =>
                  updateAssetForm("lifecycle", value)
                }
                options={LIFECYCLES}
              />

              <FormSelect
                label="Modernization status"
                value={assetForm.modernization_status}
                onChange={(value) =>
                  updateAssetForm(
                    "modernization_status",
                    value
                  )
                }
                options={MODERNIZATION_STATUSES}
              />

              <div className="mt-1.5 flex justify-end gap-1.5 md:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowCreateAsset(false)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={creatingAsset}
                  className="rounded-lg border border-violet-300/20 bg-violet-400/[0.14] px-3.5 py-2 text-xs font-medium text-violet-50 shadow-lg shadow-violet-500/10 transition hover:border-violet-300/30 hover:bg-violet-400/[0.20] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creatingAsset
                    ? "Creating..."
                    : "Create Asset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================
          ASSET DETAILS MODAL
      ================================================== */}

      {selectedAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-6 backdrop-blur-sm"
          onClick={closeAssetDetailsModal}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/15 bg-[#172235]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <span
              className={`absolute inset-x-0 top-0 h-1 ${
                CRITICALITY_ACCENT[selectedAsset.criticality] || "bg-white/20"
              }`}
            />

            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-violet-400/10 to-transparent" />

            <div className="relative flex items-start justify-between border-b border-white/10 px-4 pb-3.5 pt-4 backdrop-blur-xl">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-violet-400/25 bg-violet-400/[0.12] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-200">
                    Asset Details
                  </span>

                  {selectedAsset.type && (
                    <span
                      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] [font-family:var(--font-mono)] ${
                        TYPE_BADGE[selectedAsset.type] || "text-white/55"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          TYPE_DOT[selectedAsset.type] || "bg-white/50"
                        }`}
                      />
                      {selectedAsset.type}
                    </span>
                  )}
                </div>

                <h2 className="mt-1.5 truncate text-lg font-semibold">
                  {selectedAsset.name}
                </h2>

                <p className="mt-0.5 truncate text-xs text-white/35 [font-family:var(--font-mono)]">
                  {selectedAsset._id}
                </p>
              </div>

              <button
                onClick={closeAssetDetailsModal}
                className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-base text-white/60 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="max-h-[calc(90vh-92px)] overflow-y-auto p-4">
              {loadingAssetDetails ? (
                <div className="py-7 text-center text-xs text-white/35">
                  Loading asset details...
                </div>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  <Metadata label="Owner" value={selectedAsset.owner} />
                  <Metadata
                    label="Criticality"
                    value={selectedAsset.criticality}
                    badgeClassName={CRITICALITY_BADGE[selectedAsset.criticality]}
                  />
                  <Metadata
                    label="Environment"
                    value={selectedAsset.environment}
                    badgeClassName={ENVIRONMENT_BADGE[selectedAsset.environment]}
                  />
                  <Metadata
                    label="Sensitivity"
                    value={selectedAsset.sensitivity}
                    badgeClassName={SENSITIVITY_BADGE[selectedAsset.sensitivity]}
                  />
                  <Metadata
                    label="Lifecycle"
                    value={selectedAsset.lifecycle}
                    badgeClassName={LIFECYCLE_BADGE[selectedAsset.lifecycle]}
                  />
                  <Metadata
                    label="Modernization"
                    value={selectedAsset.modernization_status}
                  />
                </div>
              )}

              <div className="mt-4 flex justify-end border-t border-white/10 pt-3.5">
                <button
                  onClick={(event) => {
                    closeAssetDetailsModal();
                    handleImpactClick(event, selectedAsset);
                  }}
                  className="rounded-lg border border-amber-400/25 bg-amber-400/[0.10] px-3 py-2 text-xs font-semibold text-amber-200 transition hover:border-amber-300/50 hover:bg-amber-400/25 hover:text-white"
                >
                  View downstream impact →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================
          IMPACT ANALYSIS MODAL
      ================================================== */}

      {impactAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-6 backdrop-blur-sm"
          onClick={closeImpactModal}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-amber-400/15 bg-[#172235]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-amber-400/10 to-transparent" />

            <div className="relative flex items-start justify-between border-b border-white/10 px-4 py-3.5 backdrop-blur-xl">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-amber-400/25 bg-amber-400/[0.12] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                    Impact Analysis
                  </span>

                  {impactAsset.criticality && (
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        CRITICALITY_BADGE[impactAsset.criticality]
                      }`}
                    >
                      {impactAsset.criticality}
                    </span>
                  )}
                </div>

                <h2 className="mt-1.5 text-lg font-semibold">
                  {impactAsset.name}
                </h2>

                <p className="mt-0.5 text-xs text-white/45">
                  Downstream assets affected if this one changes or breaks.
                </p>
              </div>

              <button
                onClick={closeImpactModal}
                className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-base text-white/60 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="max-h-[calc(90vh-88px)] overflow-y-auto p-4">
              {loadingImpact ? (
                <div className="py-10 text-center text-xs text-white/35">
                  Calculating impact...
                </div>
              ) : impact ? (
                <>
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    <ImpactStat
                      label="Total affected"
                      value={impact.affected_count}
                      accentClassName="from-amber-400/60 to-amber-400/0"
                    />
                    <ImpactStat
                      label="Directly affected"
                      value={directImpact}
                      valueClassName="text-blue-200"
                      accentClassName="from-blue-400/60 to-blue-400/0"
                    />
                    <ImpactStat
                      label="Indirectly affected"
                      value={indirectImpact}
                      accentClassName="from-white/40 to-white/0"
                    />
                    <ImpactStat
                      label="Maximum hops"
                      value={maxHops}
                      accentClassName="from-violet-400/60 to-violet-400/0"
                    />
                  </div>

                  {impact.affected?.length > 0 ? (
                    <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
                      <div className="grid grid-cols-[1.6fr_0.8fr_1fr_0.7fr] border-b border-white/10 bg-white/[0.05] px-3 py-2 text-[11px] uppercase tracking-wider text-white/35">
                        <span>Asset</span>
                        <span>Type</span>
                        <span>Owner</span>
                        <span>Hops</span>
                      </div>

                      {impact.affected.map((item, index) => (
                        <div
                          key={item._id}
                          className={`grid grid-cols-[1.6fr_0.8fr_1fr_0.7fr] items-center border-b border-white/5 px-3 py-2.5 text-xs transition last:border-b-0 hover:bg-white/[0.04] ${
                            index % 2 === 1 ? "bg-white/[0.015]" : ""
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white/85">
                              {item.name}
                            </p>

                            <span
                              className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                CRITICALITY_BADGE[item.criticality]
                              }`}
                            >
                              {item.criticality}
                            </span>
                          </div>

                          <span className="flex items-center gap-1.5 text-[11px] text-white/55 [font-family:var(--font-mono)]">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                TYPE_DOT[item.type]
                              }`}
                            />
                            {item.type}
                          </span>

                          <span className="truncate text-white/55">
                            {item.owner}
                          </span>

                          <span
                            className={
                              item.directly_affected
                                ? "font-semibold text-blue-200"
                                : "text-white/45"
                            }
                          >
                            {item.hops}
                            {item.directly_affected && (
                              <span className="ml-1 rounded bg-blue-400/15 px-1 py-0.5 text-[10px] font-medium text-blue-200/90">
                                direct
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] py-8 text-center text-xs text-white/40">
                      No downstream assets are affected by this one.
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================
          LINEAGE MODAL
      ================================================== */}

      {lineageAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-6 backdrop-blur-sm"
          onClick={closeLineageModal}
        >
          <div
            className="relative h-[82vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/15 bg-[#172235]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute left-0 right-0 top-0 z-20 flex items-start justify-between border-b border-white/10 bg-[#172235]/90 px-4 py-3.5 backdrop-blur-xl">
              <div>
                <h2 className="text-lg font-semibold">
                  Lineage
                </h2>

                <p className="mt-1 text-xs text-white/45">
                  Upstream and downstream relationships for{" "}
                  <span className="text-white/70">
                    {lineageAsset.name}
                  </span>
                  .
                </p>
              </div>

              <button
                onClick={closeLineageModal}
                className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-base text-white/60 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="absolute bottom-4 left-6 z-20 flex items-center gap-3 rounded-lg border border-white/10 bg-[#172235]/90 px-3 py-2 text-[12px] text-white/50 backdrop-blur-xl">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-300/80" />
                Upstream
              </span>

              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-white/70" />
                Selected
              </span>

              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-300/80" />
                Downstream
              </span>
            </div>

            <div className="h-full pt-[82px]">
              {loadingLineage ? (
                <div className="flex h-full items-center justify-center text-xs text-white/40">
                  Building lineage...
                </div>
              ) : lineageGraph.nodes.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-white/40">
                  No lineage relationships found for this asset.
                </div>
              ) : (
                <ReactFlow
                  nodes={lineageGraph.nodes}
                  edges={lineageGraph.edges}
                  nodeTypes={lineageNodeTypes}
                  fitView
                  fitViewOptions={{
                    padding: 0.18,
                    minZoom: 0.55,
                    maxZoom: 1.25,
                  }}
                  nodesDraggable
                  nodesConnectable={false}
                  elementsSelectable
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={24} size={1} />
                </ReactFlow>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================
          AI OVERVIEW MODAL
      ================================================== */}

      {aiAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-6 backdrop-blur-sm"
          onClick={closeAIModal}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-sky-400/15 bg-[#172235]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-sky-400/10 to-transparent" />

            <div className="relative flex items-start justify-between border-b border-white/10 px-4 py-3.5 backdrop-blur-xl">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 rounded-md border border-sky-400/25 bg-sky-400/[0.12] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-200">
                    <span className="text-[10px]">✦</span>
                    AI Overview
                  </span>

                  {aiAsset.criticality && (
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        CRITICALITY_BADGE[aiAsset.criticality]
                      }`}
                    >
                      {aiAsset.criticality}
                    </span>
                  )}
                </div>

                <h2 className="mt-1.5 truncate text-lg font-semibold">
                  {aiAsset.name}
                </h2>

                <p className="mt-0.5 text-xs text-white/45">
                  Plain-English explanation, generated for a business audience.
                </p>
              </div>

              <button
                onClick={closeAIModal}
                className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-base text-white/60 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="max-h-[calc(90vh-92px)] overflow-y-auto p-4">
              {loadingAI ? (
                <div className="flex flex-col items-center justify-center gap-2.5 py-14">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-400/25 border-t-sky-300" />
                  <p className="text-xs text-white/35">
                    Asking the AI to explain this asset...
                  </p>
                </div>
              ) : aiError ? (
                <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-6 text-center">
                  <p className="text-xs font-medium text-red-200">
                    Couldn't generate an explanation
                  </p>
                  <p className="mt-1 text-[11px] text-white/40">
                    {aiError}
                  </p>
                  <button
                    onClick={(event) => handleAIClick(event, aiAsset)}
                    className="mt-3 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/70 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
                  >
                    Try again
                  </button>
                </div>
              ) : aiExplanation ? (
                <div className="space-y-2.5">
                  {parseAIExplanation(aiExplanation).map((section, index) => {
                    const accent = getAIAccent(section.heading);

                    return (
                      <div
                        key={index}
                        className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.035] py-2.5 pl-4 pr-3.5"
                      >
                        <span
                          className={`absolute inset-y-0 left-0 w-1 ${accent.bar}`}
                        />

                        {section.heading && (
                          <p
                            className={`text-[11px] font-semibold uppercase tracking-wider ${accent.text}`}
                          >
                            {section.heading}
                          </p>
                        )}

                        <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-white/75">
                          {section.body}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormSelect({
  label,
  value,
  onChange,
  options,
}) {
  return (
    <div>
      <label className="text-xs text-white/50">
        {label}
      </label>

      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white/80 outline-none focus:border-white/25"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function Metadata({ label, value, badgeClassName }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 transition hover:border-white/15 hover:bg-white/[0.06]">
      <p className="text-[11px] uppercase tracking-wider text-white/35">
        {label}
      </p>

      {badgeClassName ? (
        <span
          className={`mt-1.5 inline-block rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${badgeClassName}`}
        >
          {value || "—"}
        </span>
      ) : (
        <p className="mt-1.5 text-sm font-medium text-white/85">
          {value || "—"}
        </p>
      )}
    </div>
  );
}

// Parses the "## Heading\nbody" structure the AI controller is prompted
// to always return. Falls back gracefully to a single unlabeled section
// if the model ever returns plain text without headings.
function parseAIExplanation(text) {
  if (!text) return [];

  const chunks = text
    .trim()
    .split(/\n(?=##\s)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk) => {
    const match = chunk.match(/^##\s+(.+?)\s*\n([\s\S]*)$/);

    if (match) {
      return { heading: match[1].trim(), body: match[2].trim() };
    }

    return { heading: null, body: chunk.replace(/^##\s*/, "") };
  });
}

const AI_SECTION_ACCENTS = [
  { test: /what it is/i, bar: "bg-violet-400/70", text: "text-violet-300" },
  { test: /risk/i, bar: "bg-red-400/70", text: "text-red-300" },
  { test: /sensitiv/i, bar: "bg-pink-400/70", text: "text-pink-300" },
  { test: /next/i, bar: "bg-emerald-400/70", text: "text-emerald-300" },
];

function getAIAccent(heading) {
  if (heading) {
    const match = AI_SECTION_ACCENTS.find((entry) => entry.test.test(heading));
    if (match) return match;
  }

  return { bar: "bg-sky-400/70", text: "text-sky-300" };
}

function ImpactStat({
  label,
  value,
  valueClassName = "text-white",
  accentClassName = "from-white/40 to-white/0",
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <span
        className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accentClassName}`}
      />

      <p className="text-xs text-white/40">
        {label}
      </p>

      <p className={`mt-1.5 text-xl font-semibold tabular-nums [font-family:var(--font-mono)] ${valueClassName}`}>
        {value}
      </p>
    </div>
  );
}

function AnalyticsStat({ value, label, caption, valueClassName = "text-white" }) {
  return (
    <div className="px-3 py-2 first:pl-0">
      <p
        className={`text-[1.35rem] font-semibold tabular-nums leading-none [font-family:var(--font-mono)] ${valueClassName}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-white/55">{label}</p>
      {caption && (
        <p className="mt-0.5 text-[11px] text-white/30">{caption}</p>
      )}
    </div>
  );
}

function BreakdownColumn({ title, rows, barClassName = "bg-gradient-to-r from-violet-400/50 to-violet-400" }) {
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <div>
      <p className="mb-2.5 text-[12px] uppercase tracking-wider text-white/35">
        {title}
      </p>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 truncate text-white/55 [font-family:var(--font-mono)]">
              {row.label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full rounded-full ${row.colorClassName || barClassName}`}
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </div>
            <span className="w-4 shrink-0 text-right text-white/45 [font-family:var(--font-mono)]">
              {row.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PIE_COLORS = {
  high: "#f87171",
  medium: "#fbbf24",
  low: "#4ade80",
};

const CONFIDENCE_PIE_COLORS = {
  high: "#4ade80",
  medium: "#fbbf24",
  low: "#94a3b8",
};

function StatPieChart({ title, rows, colors, centerLabel = "total" }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const size = 128;
  const radius = 48;
  const strokeWidth = 22;
  const circumference = 2 * Math.PI * radius;
  const visibleRows = rows.filter((row) => row.count > 0);

  let cumulativeLength = 0;

  return (
    <div>
      <p className="mb-2.5 text-[11px] uppercase tracking-wider text-white/35">
        {title}
      </p>

      <div className="flex items-center gap-5">
        <div
          className="relative shrink-0 drop-shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
          style={{ width: size, height: size }}
        >
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="-rotate-90"
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={strokeWidth}
            />

            {total === 0
              ? null
              : visibleRows.map((row) => {
                  const fraction = row.count / total;
                  const dash = fraction * circumference;
                  const offset = -cumulativeLength;
                  cumulativeLength += dash;

                  return (
                    <circle
                      key={row.label}
                      cx={size / 2}
                      cy={size / 2}
                      r={radius}
                      fill="none"
                      stroke={colors[row.label]}
                      strokeWidth={strokeWidth}
                      strokeDasharray={`${dash} ${circumference - dash}`}
                      strokeDashoffset={offset}
                      strokeLinecap={
                        visibleRows.length > 1 ? "butt" : "round"
                      }
                      style={{
                        filter: `drop-shadow(0 0 6px ${colors[row.label]}55)`,
                      }}
                      className="transition-all duration-500 ease-out"
                    />
                  );
                })}
          </svg>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold tabular-nums leading-none [font-family:var(--font-mono)]">
              {total}
            </span>
            <span className="mt-1 text-[10px] uppercase tracking-wider text-white/35">
              {centerLabel}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: colors[row.label],
                  boxShadow: `0 0 8px ${colors[row.label]}70`,
                }}
              />
              <span className="w-14 shrink-0 text-xs text-white/55 [font-family:var(--font-mono)]">
                {row.label}
              </span>
              <span className="text-xs font-semibold tabular-nums text-white/85">
                {row.count}
              </span>
              <span className="text-[11px] text-white/30">
                ({total ? Math.round((row.count / total) * 100) : 0}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;