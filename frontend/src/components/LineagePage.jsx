import { useEffect, useState, useMemo } from "react";
import * as api from "../api.js";
import LineageGraph from "./LineageGraph.jsx";
import EdgeFormModal from "./EdgeFormModal.jsx";

const CRIT_COLOR = { high: "var(--risk-high)", medium: "var(--risk-medium)", low: "var(--risk-low)" };

export default function LineagePage() {
  const [assets, setAssets] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([api.getAssets(), api.getEdges()])
      .then(([a, e]) => {
        setAssets(a);
        setEdges(e);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const selected = useMemo(
    () => assets.find((a) => (a._id || a.id) === selectedId) || null,
    [assets, selectedId]
  );

  const connectedEdges = useMemo(
    () => edges.filter((e) => e.source === selectedId || e.target === selectedId),
    [edges, selectedId]
  );

  async function handleDeleteEdge(edgeId) {
    if (!confirm("Delete this relationship?")) return;
    try {
      await api.deleteEdge(edgeId);
      load();
    } catch (e) {
      alert(`Could not delete: ${e.message}`);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lineage graph</h1>
          <p>How data flows between assets — trace what feeds what before you change or retire something.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)} disabled={assets.length < 1}>
          + Add relationship
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="graph-shell">
        <div className="graph-toolbar">
          <div className="legend">
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: "var(--risk-high)" }} />
              High criticality
            </span>
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: "var(--risk-medium)" }} />
              Medium
            </span>
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: "var(--risk-low)" }} />
              Low
            </span>
          </div>
          <span style={{ color: "var(--text-faint)", fontSize: 12 }}>
            {assets.length} assets · {edges.length} relationships
          </span>
        </div>

        <div className="graph-body">
          <div className="graph-canvas">
            {loading ? (
              <div className="loading">Loading graph…</div>
            ) : assets.length === 0 ? (
              <div className="empty-state">
                <strong>No assets yet</strong>
                Register assets first, then connect them here.
              </div>
            ) : (
              <LineageGraph
                assets={assets}
                edges={edges}
                colorFor={(a) => CRIT_COLOR[a.criticality] || "var(--text-faint)"}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </div>

          {selected && (
            <div className="node-panel">
              <div className="node-panel-head">
                <div>
                  <strong>{selected.name}</strong>
                  <div className="cell-id">{selected._id || selected.id}</div>
                </div>
                <button className="icon-btn" onClick={() => setSelectedId(null)} title="Close">✕</button>
              </div>

              <dl className="node-panel-meta">
                <dt>Owner</dt>
                <dd>{selected.owner}</dd>
                <dt>Environment</dt>
                <dd>{selected.environment}</dd>
                <dt>Lifecycle</dt>
                <dd>{selected.lifecycle}</dd>
                <dt>Criticality</dt>
                <dd>{selected.criticality}</dd>
              </dl>

              <div className="node-panel-section">
                <span className="node-panel-label">Relationships</span>
                {connectedEdges.length === 0 ? (
                  <p style={{ color: "var(--text-dim)", marginTop: 6, fontSize: 13 }}>None yet.</p>
                ) : (
                  <ul className="edge-list">
                    {connectedEdges.map((e) => {
                      const isSource = e.source === selectedId;
                      const otherId = isSource ? e.target : e.source;
                      const other = assets.find((a) => (a._id || a.id) === otherId);
                      return (
                        <li key={e._id || e.id} className="edge-list-item">
                          <span>
                            {isSource ? "→ " : "← "}
                            <strong>{e.relationship_type}</strong>{" "}
                            {other ? other.name : otherId}
                            <span className="cell-id" style={{ display: "block", marginTop: 2 }}>
                              {e.confidence} confidence
                            </span>
                          </span>
                          <button className="icon-btn" onClick={() => handleDeleteEdge(e._id || e.id)}>
                            Delete
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <EdgeFormModal
          assets={assets}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </>
  );
}
