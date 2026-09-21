import { useEffect, useMemo, useRef, useState, useCallback } from "react";

const WIDTH = 1400;
const HEIGHT = 800;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const BASE_NODE_R = 6;
const COLLISION_PADDING = 34;
const DRAG_THRESHOLD = 3;

// Matches Dashboard.jsx's dark theme (bg-[#0d1726] page, bg-[#172235] cards,
// white/opacity text) so the graph and dashboard read as one app.
const THEME = {
  border: "rgba(255,255,255,0.12)",
  wire: "rgba(255,255,255,0.85)",
  // Same hues Dashboard's lineage modal legend already uses:
  // blue = upstream ("what this depends on"), red = downstream ("what breaks").
  dependency: "rgba(96,165,250,0.85)",
  dependent: "rgba(248,113,113,0.85)",
  nodeStroke: "#0d1726",
  nodeStrokeSelected: "rgba(255,255,255,0.9)",
};

// Same red/yellow/green Dashboard.jsx uses for its criticality badges.
const CRIT_COLOR = {
  high: "#f87171",
  medium: "#fbbf24",
  low: "#4ade80",
};

// Asset type rows, top to bottom, as requested: File, then Pipeline, then
// Table, then Report. Any type not in this list falls into a trailing row
// so nothing silently disappears if a new type shows up later.
const TYPE_ROW_ORDER = ["file", "pipeline", "table", "report"];

function typeRowPositions(assets) {
  const pos = {};
  const vel = {};
  const groups = {};
  TYPE_ROW_ORDER.forEach((t) => (groups[t] = []));
  const others = [];
  assets.forEach((a) => {
    const id = a._id || a.id;
    const t = (a.type || "").toLowerCase();
    if (groups[t]) {
      groups[t].push(id);
    } else {
      others.push(id);
    }
  });

  const rows = TYPE_ROW_ORDER.map((t) => groups[t]).filter((row) => row.length > 0);
  if (others.length) rows.push(others);

  const rowCount = rows.length || 1;
  const topMargin = 120;
  const bottomMargin = 120;
  const rowGap = rowCount > 1 ? (HEIGHT - topMargin - bottomMargin) / (rowCount - 1) : 0;
  const sideMargin = 150;
  const rowWidth = WIDTH - sideMargin * 2;

  rows.forEach((rowIds, rowIndex) => {
    const y = rowCount > 1 ? topMargin + rowIndex * rowGap : CENTER_Y;
    const k = rowIds.length;
    const step = k > 1 ? rowWidth / (k - 1) : 0;
    const startX = k > 1 ? CENTER_X - ((k - 1) * step) / 2 : CENTER_X;
    rowIds.forEach((id, i) => {
      const x = k > 1 ? startX + i * step : startX;
      pos[id] = { x, y };
      vel[id] = { x: 0, y: 0 };
    });
  });

  return { pos, vel };
}

function safe(n, fallback) {
  return Number.isFinite(n) ? n : fallback;
}

// Everything reachable from `start` via `adjacency`, INCLUDING start itself,
// at any depth — used to classify which real edges lie on the indirect
// dependency/dependent chain from a focused node.
function bfsAll(start, adjacency) {
  const visited = new Set([start]);
  const queue = [...(adjacency[start] || [])];
  queue.forEach((n) => visited.add(n));
  while (queue.length) {
    const n = queue.shift();
    (adjacency[n] || []).forEach((n2) => {
      if (!visited.has(n2)) {
        visited.add(n2);
        queue.push(n2);
      }
    });
  }
  return visited;
}

// ---- tiny force simulation with collision separation, no external dependency ----
function useForceLayout(assets, edges, radiusFor) {
  const ids = useMemo(() => assets.map((a) => a._id || a.id), [assets]);
  const posRef = useRef({});
  const velRef = useRef({});
  const pinnedRef = useRef({});
  const anchorRef = useRef({});
  const [, tick] = useState(0);
  const [resetToken, setResetToken] = useState(0);

  useEffect(() => {
    const missing = ids.filter((id) => !posRef.current[id]);
    if (missing.length) {
      const { pos, vel } = typeRowPositions(assets);
      missing.forEach((id) => {
        if (!pos[id]) return;
        posRef.current[id] = pos[id];
        velRef.current[id] = vel[id];
        // Pinned by default so the row layout holds — center-pull and edge-spring
        // forces only ever apply to un-pinned nodes, so this keeps assets in their
        // type row until someone drags one, at which point it re-anchors there.
        pinnedRef.current[id] = true;
        anchorRef.current[id] = { x: pos[id].x, y: pos[id].y };
      });
    }
    Object.keys(posRef.current).forEach((id) => {
      if (!ids.includes(id)) {
        delete posRef.current[id];
        delete velRef.current[id];
        delete pinnedRef.current[id];
        delete anchorRef.current[id];
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const runningRef = useRef(false);
  const [wakeToken, setWakeToken] = useState(0);

  const wake = useCallback(() => {
    if (runningRef.current) return;
    setWakeToken((t) => t + 1);
  }, []);

  const activeDragRef = useRef(null);
  const setActiveDrag = useCallback((id) => {
    activeDragRef.current = id;
  }, []);

  useEffect(() => {
    let frame;
    let iterations = 0;
    const MAX_ITER = 320;
    runningRef.current = true;

    function step() {
      const pos = posRef.current;
      const vel = velRef.current;

      ids.forEach((a) => {
        if (!pos[a] || !vel[a]) return;
        let fx = 0;
        let fy = 0;

        ids.forEach((b) => {
          if (a === b || !pos[b]) return;
          const dx = pos[a].x - pos[b].x;
          const dy = pos[a].y - pos[b].y;
          const distSq = Math.max(dx * dx + dy * dy, 40);
          const force = 6300 / distSq;
          fx += (dx / Math.sqrt(distSq)) * force;
          fy += (dy / Math.sqrt(distSq)) * force;
        });

        // Dropped nodes (pinned, but not the one currently under the pointer)
        // get a light spring pulling them back to where they were dropped —
        // this is what lets them "hover"/sway when something else approaches,
        // instead of staying frozen until a hard collision snap. Free nodes
        // just drift gently toward the center as before.
        if (pinnedRef.current[a] && a !== activeDragRef.current) {
          const anchor = anchorRef.current[a];
          if (anchor) {
            fx += (anchor.x - pos[a].x) * 0.06;
            fy += (anchor.y - pos[a].y) * 0.06;
          }
        } else if (!pinnedRef.current[a]) {
          fx += (CENTER_X - pos[a].x) * 0.004;
          fy += (CENTER_Y - pos[a].y) * 0.004;
        }

        vel[a].x = safe((vel[a].x + fx) * 0.75, 0);
        vel[a].y = safe((vel[a].y + fy) * 0.75, 0);
      });

      edges.forEach((e) => {
        const s = pos[e.source];
        const t = pos[e.target];
        if (!s || !t) return;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetLen = 280;
        const pull = (dist - targetLen) * 0.02;
        const ux = dx / dist;
        const uy = dy / dist;
        if (!pinnedRef.current[e.source] && vel[e.source]) {
          vel[e.source].x += ux * pull;
          vel[e.source].y += uy * pull;
        }
        if (!pinnedRef.current[e.target] && vel[e.target]) {
          vel[e.target].x -= ux * pull;
          vel[e.target].y -= uy * pull;
        }
      });

      ids.forEach((id) => {
        if (id === activeDragRef.current || !pos[id] || !vel[id]) return;
        pos[id].x = safe(pos[id].x + vel[id].x, pos[id].x);
        pos[id].y = safe(pos[id].y + vel[id].y, pos[id].y);
      });

      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i];
            const b = ids[j];
            if (!pos[a] || !pos[b]) continue;
            const minDist = radiusFor(a) + radiusFor(b) + COLLISION_PADDING;
            const dx = pos[b].x - pos[a].x;
            const dy = pos[b].y - pos[a].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
            if (dist < minDist) {
              const overlap = (minDist - dist) / 2;
              const ux = dx / dist;
              const uy = dy / dist;
              if (a !== activeDragRef.current) {
                pos[a].x -= ux * overlap;
                pos[a].y -= uy * overlap;
              }
              if (b !== activeDragRef.current) {
                pos[b].x += ux * overlap;
                pos[b].y += uy * overlap;
              }
            }
          }
        }
      }

      ids.forEach((id) => {
        if (!pos[id]) return;
        pos[id].x = Math.min(WIDTH - 60, Math.max(60, safe(pos[id].x, CENTER_X)));
        pos[id].y = Math.min(HEIGHT - 60, Math.max(60, safe(pos[id].y, CENTER_Y)));
      });

      iterations += 1;
      tick((n) => n + 1);
      if (iterations < MAX_ITER) {
        frame = requestAnimationFrame(step);
      } else {
        runningRef.current = false;
      }
    }

    frame = requestAnimationFrame(step);
    return () => {
      runningRef.current = false;
      cancelAnimationFrame(frame);
    };
  }, [ids, edges, resetToken, radiusFor, wakeToken]);

  const setPinned = useCallback((id, pinned, coords) => {
    pinnedRef.current[id] = pinned;
    if (coords && Number.isFinite(coords.x) && Number.isFinite(coords.y)) {
      posRef.current[id] = coords;
      // clone — posRef's object gets mutated in place by collision
      // resolution each frame, and the anchor must NOT drift along with it
      anchorRef.current[id] = { x: coords.x, y: coords.y };
    }
    tick((n) => n + 1);
  }, []);

  const resetLayout = useCallback(() => {
    const { pos, vel } = typeRowPositions(assets);
    posRef.current = pos;
    velRef.current = vel;
    const pinned = {};
    const anchor = {};
    Object.keys(pos).forEach((id) => {
      pinned[id] = true;
      anchor[id] = { x: pos[id].x, y: pos[id].y };
    });
    pinnedRef.current = pinned;
    anchorRef.current = anchor;
    setResetToken((t) => t + 1);
  }, [ids, assets]);

  return { positions: posRef.current, setPinned, resetLayout, wake, setActiveDrag };
}

export function LineageGraph({ assets, edges, colorFor, selectedId, onSelect }) {
  const degree = useMemo(() => {
    const d = {};
    edges.forEach((e) => {
      d[e.source] = (d[e.source] || 0) + 1;
      d[e.target] = (d[e.target] || 0) + 1;
    });
    return d;
  }, [edges]);

  const radiusFor = useCallback((id) => BASE_NODE_R + Math.min(degree[id] || 0, 6) * 1.1, [degree]);

  const { positions, setPinned, resetLayout, wake, setActiveDrag } = useForceLayout(assets, edges, radiusFor);
  const [hoverId, setHoverId] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const svgRef = useRef(null);
  const dragRef = useRef(null); // { id, pointerId, startX, startY, moved }
  const panRef = useRef(null); // { pointerId, startX, startY, origX, origY }

  const focusId = hoverId || selectedId;

  // directed adjacency, used to find nodes beyond one hop in each direction
  const outgoing = useMemo(() => {
    const m = {};
    edges.forEach((e) => {
      (m[e.source] ??= []).push(e.target);
    });
    return m;
  }, [edges]);

  const incoming = useMemo(() => {
    const m = {};
    edges.forEach((e) => {
      (m[e.target] ??= []).push(e.source);
    });
    return m;
  }, [edges]);

  // full reachable sets in each direction (including focus + direct neighbors) —
  // used to classify which real edges sit on the dependent/dependency chain
  const downstreamReachable = useMemo(() => (focusId ? bfsAll(focusId, outgoing) : null), [focusId, outgoing]);
  const upstreamReachable = useMemo(() => (focusId ? bfsAll(focusId, incoming) : null), [focusId, incoming]);

  const neighborIds = useMemo(() => {
    if (!focusId) return null;
    const s = new Set([focusId]);
    downstreamReachable?.forEach((id) => s.add(id));
    upstreamReachable?.forEach((id) => s.add(id));
    return s;
  }, [focusId, downstreamReachable, upstreamReachable]);

  const toSvgPoint = useCallback(
    (clientX, clientY) => {
      if (!svgRef.current) return { x: CENTER_X, y: CENTER_Y };
      const rect = svgRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: CENTER_X, y: CENTER_Y };
      const x = ((clientX - rect.left) / rect.width) * WIDTH;
      const y = ((clientY - rect.top) / rect.height) * HEIGHT;
      return { x: safe((x - view.x) / view.scale, CENTER_X), y: safe((y - view.y) / view.scale, CENTER_Y) };
    },
    [view]
  );

  // safety net: if a pointerup ever fails to reach our handlers (capture lost,
  // devtools focus steal, etc.) this guarantees drag/pan state doesn't get stuck
  useEffect(() => {
    function releaseAll() {
      dragRef.current = null;
      panRef.current = null;
      setActiveDrag(null);
    }
    window.addEventListener("pointerup", releaseAll);
    window.addEventListener("pointercancel", releaseAll);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("pointerup", releaseAll);
      window.removeEventListener("pointercancel", releaseAll);
      window.removeEventListener("blur", releaseAll);
    };
  }, [setActiveDrag]);

  function handleNodePointerDown(id, e) {
    e.stopPropagation();
    e.preventDefault();
    wake();
    setActiveDrag(id);
    dragRef.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, el: e.currentTarget };
  }

  function handleNodePointerMove(e) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    wake();
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD) {
      drag.moved = true;
      // only take pointer capture once we know this is a real drag, not a click —
      // capturing on every pointerdown reroutes hover (pointerenter/leave) to the
      // captured element per the Pointer Events spec, which is what broke hover
      // highlighting after a click previously
      try {
        drag.el.setPointerCapture(e.pointerId);
        drag.captured = true;
      } catch {
        // ignore if unsupported
      }
      setPinned(drag.id, true, positions[drag.id]);
    }
    if (drag.moved) {
      setPinned(drag.id, true, toSvgPoint(e.clientX, e.clientY));
    }
  }

  function handleNodePointerUp(e) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.captured) {
      try {
        drag.el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    if (!drag.moved) {
      onSelect(selectedId === drag.id ? null : drag.id);
    }
    setActiveDrag(null);
    dragRef.current = null;
  }

  function handleBackgroundPointerDown(e) {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    panRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y };
  }

  function handleBackgroundPointerMove(e) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    setView((v) => ({ ...v, x: safe(pan.origX + dx, v.x), y: safe(pan.origY + dy, v.y) }));
  }

  function handleBackgroundPointerUp(e) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    panRef.current = null;
  }

  function handleWheel(e) {
    e.preventDefault();
    setView((v) => {
      const delta = e.deltaY > 0 ? 0.97 : 1.03;
      const nextScale = Math.min(2.2, Math.max(0.5, v.scale * delta));
      const nx = v.x + (v.scale - nextScale) * CENTER_X;
      const ny = v.y + (v.scale - nextScale) * CENTER_Y;
      return { x: safe(nx, v.x), y: safe(ny, v.y), scale: nextScale };
    });
  }

  function resetView() {
    setView({ x: 0, y: 0, scale: 1 });
    resetLayout();
    setHoverId(null);
    setActiveDrag(null);
    dragRef.current = null;
    panRef.current = null;
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={resetView}
        title="Reset zoom, pan, and layout"
        className="absolute right-3 top-3 z-10 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/70 backdrop-blur-md transition hover:border-white/20 hover:bg-white/10 hover:text-white"
      >
        Reset view
      </button>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        style={{ display: "block", cursor: "grab", touchAction: "none", userSelect: "none" }}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleBackgroundPointerMove}
        onPointerUp={handleBackgroundPointerUp}
        onPointerLeave={handleBackgroundPointerUp}
        onWheel={handleWheel}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={THEME.border} />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={THEME.wire} />
          </marker>
          <marker id="arrow-dependent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={THEME.dependent} />
          </marker>
          <marker id="arrow-dependency" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={THEME.dependency} />
          </marker>
        </defs>

        <g transform={`translate(${safe(view.x, 0)} ${safe(view.y, 0)}) scale(${safe(view.scale, 1)})`}>
          {edges.map((e) => {
            const s = positions[e.source];
            const t = positions[e.target];
            if (!s || !t) return null;

            const touchesFocus = e.source === focusId || e.target === focusId;
            // an edge counts as part of the dependent/dependency CHAIN when both
            // its ends sit within the reachable set, but it isn't the direct
            // edge off the focused node (that one keeps the plain blue highlight)
            const isDependentChain =
              !touchesFocus && downstreamReachable && downstreamReachable.has(e.source) && downstreamReachable.has(e.target);
            const isDependencyChain =
              !touchesFocus && !isDependentChain && upstreamReachable && upstreamReachable.has(e.source) && upstreamReachable.has(e.target);

            const active = neighborIds && touchesFocus;
            const chained = isDependentChain || isDependencyChain;
            const dim = neighborIds && !active && !chained;

            const mx = (s.x + t.x) / 2 + (t.y - s.y) * 0.08;
            const my = (s.y + t.y) / 2 - (t.x - s.x) * 0.08;

            const tr = radiusFor(e.target) + 6;
            const dx = t.x - mx;
            const dy = t.y - my;
            const dlen = Math.sqrt(dx * dx + dy * dy) || 1;
            const endX = t.x - (dx / dlen) * tr;
            const endY = t.y - (dy / dlen) * tr;

            let stroke = THEME.border;
            let marker = "url(#arrow)";
            let strokeWidth = 1.2;
            let dash = undefined;
            let opacity = dim ? 0.18 : 0.85;
            if (active) {
              stroke = THEME.wire;
              marker = "url(#arrow-active)";
              strokeWidth = 2;
            } else if (isDependentChain) {
              stroke = THEME.dependent;
              marker = "url(#arrow-dependent)";
              strokeWidth = 1.6;
              dash = "4 3";
              opacity = 0.75;
            } else if (isDependencyChain) {
              stroke = THEME.dependency;
              marker = "url(#arrow-dependency)";
              strokeWidth = 1.6;
              dash = "4 3";
              opacity = 0.75;
            }

            return (
              <path
                key={e._id || e.id}
                d={`M${s.x},${s.y} Q${mx},${my} ${endX},${endY}`}
                fill="none"
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={dash}
                opacity={opacity}
                markerEnd={marker}
              />
            );
          })}

          {assets.map((a) => {
            const id = a._id || a.id;
            const p = positions[id];
            if (!p) return null;
            const isSelected = id === selectedId;
            const isHovered = id === hoverId;
            const dim = neighborIds && !neighborIds.has(id);
            const r = radiusFor(id) + (isSelected ? 3 : 0);
            return (
              <g
                key={id}
                transform={`translate(${p.x}, ${p.y})`}
                onPointerDown={(e) => handleNodePointerDown(id, e)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={handleNodePointerUp}
                onPointerCancel={handleNodePointerUp}
                onPointerEnter={() => setHoverId(id)}
                onPointerLeave={() => setHoverId((h) => (h === id ? null : h))}
                style={{ cursor: "grab", opacity: dim ? 0.3 : 1, transition: "opacity 120ms ease" }}
              >
                {(isSelected || isHovered) && (
                  <circle r={r + 7} fill="none" stroke={THEME.wire} strokeWidth={1} opacity={0.4} />
                )}
                <circle
                  r={r}
                  fill={colorFor(a)}
                  stroke={isSelected ? THEME.nodeStrokeSelected : THEME.nodeStroke}
                  strokeWidth={isSelected ? 2 : 1.5}
                />
                <text
                  x="0"
                  y={-r - 8}
                  textAnchor="middle"
                  style={{ fill: "rgba(255,255,255,0.9)", fontSize: 10, fontWeight: 500 }}
                >
                  {a.name.length > 22 ? a.name.slice(0, 20) + "…" : a.name}
                </text>
                <text
                  x="0"
                  y={r + 16}
                  textAnchor="middle"
                  style={{ fill: "rgba(255,255,255,0.4)", fontSize: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}
                >
                  {a.type}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

import * as api from "../api.js";

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
    <div className="min-h-screen bg-[#0d1726] text-white">
      <main className="relative z-10 mx-auto max-w-[1125px] px-4 pb-9 pt-32">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white/90">Lineage graph</h1>
            <p className="mt-1 text-xs text-white/45">
              How data flows between assets — trace what feeds what before you change or retire something.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            disabled={assets.length < 1}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white/90 backdrop-blur-md transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Add relationship
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs text-red-100 backdrop-blur-md">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-[#172235]/60 p-3 backdrop-blur-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-white/55">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: CRIT_COLOR.high }} />
                High criticality
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: CRIT_COLOR.medium }} />
                Medium
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: CRIT_COLOR.low }} />
                Low
              </span>
            </div>
            <span className="text-xs text-white/35">
              {assets.length} assets · {edges.length} relationships
            </span>
          </div>

          <div className="flex gap-3">
            <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#0d1726]">
              {loading ? (
                <div className="flex h-[390px] items-center justify-center text-xs text-white/40">
                  Loading graph…
                </div>
              ) : assets.length === 0 ? (
                <div className="flex h-[390px] flex-col items-center justify-center gap-1 text-center text-xs text-white/40">
                  <strong className="text-white/70">No assets yet</strong>
                  Register assets first, then connect them here.
                </div>
              ) : (
                <LineageGraph
                  assets={assets}
                  edges={edges}
                  colorFor={(a) => CRIT_COLOR[a.criticality] || "rgba(255,255,255,0.35)"}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}
            </div>

            {selected && (
              <div className="w-[260px] shrink-0 rounded-xl border border-white/10 bg-[#172235]/90 p-3 backdrop-blur-xl">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <strong className="text-xs text-white/90">{selected.name}</strong>
                    <div className="mt-0.5 text-[12px] text-white/35">{selected._id || selected.id}</div>
                  </div>
                  <button
                    onClick={() => setSelectedId(null)}
                    title="Close"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                <dl className="grid grid-cols-2 gap-2 border-t border-white/10 pt-2 text-xs">
                  <div>
                    <dt className="text-white/35">Owner</dt>
                    <dd className="mt-0.5 text-white/75">{selected.owner}</dd>
                  </div>
                  <div>
                    <dt className="text-white/35">Environment</dt>
                    <dd className="mt-0.5 text-white/75">{selected.environment}</dd>
                  </div>
                  <div>
                    <dt className="text-white/35">Lifecycle</dt>
                    <dd className="mt-0.5 text-white/75">{selected.lifecycle}</dd>
                  </div>
                  <div>
                    <dt className="text-white/35">Criticality</dt>
                    <dd className="mt-0.5 text-white/75">{selected.criticality}</dd>
                  </div>
                </dl>

                <div className="mt-3 border-t border-white/10 pt-2">
                  <span className="text-[12px] uppercase tracking-wider text-white/35">Relationships</span>
                  {connectedEdges.length === 0 ? (
                    <p className="mt-1.5 text-xs text-white/40">None yet.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1.5">
                      {connectedEdges.map((e) => {
                        const isSource = e.source === selectedId;
                        const otherId = isSource ? e.target : e.source;
                        const other = assets.find((a) => (a._id || a.id) === otherId);
                        return (
                          <li
                            key={e._id || e.id}
                            className="flex items-start justify-between gap-1.5 rounded-md border border-white/5 bg-white/[0.03] px-2 py-1.5 text-xs"
                          >
                            <span className="min-w-0 flex-1 break-words text-white/70">
                              {isSource ? "→ " : "← "}
                              <strong className="text-white/85">{e.relationship_type}</strong>{" "}
                              {other ? other.name : otherId}
                              <span className="mt-1 block text-[12px] text-white/35">
                                {e.confidence} confidence
                              </span>
                            </span>
                            <button
                              onClick={() => handleDeleteEdge(e._id || e.id)}
                              className="shrink-0 self-start rounded-md border border-white/10 bg-white/5 px-1.5 py-1 text-[12px] text-white/60 transition hover:bg-white/10 hover:text-white"
                            >
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
      </main>

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
    </div>
  );
}

export function EdgeFormModal({ assets, onClose, onCreated }) {
  const [source, setSource] = useState(assets[0]?._id || assets[0]?.id || "");
  const [target, setTarget] = useState(assets[1]?._id || assets[1]?.id || "");
  const [relationshipType, setRelationshipType] = useState(api.RELATIONSHIP_TYPES[0]);
  const [confidence, setConfidence] = useState(api.CONFIDENCES[1]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!source || !target) {
      setError("Pick both a source and a target asset.");
      return;
    }
    if (source === target) {
      setError("Source and target must be different assets.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createEdge({
        source,
        target,
        relationship_type: relationshipType,
        confidence,
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const selectClass =
    "mt-1.5 w-full rounded-lg border border-white/10 bg-[#202b3a] px-2 py-2 text-xs text-white/80 outline-none focus:border-white/25";
  const labelClass = "text-xs text-white/50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-white/15 bg-[#172235]/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-2xl"
      >
        <h2 className="text-base font-semibold text-white/90">Add relationship</h2>

        {error && (
          <div className="mt-3 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs text-red-100">
            {error}
          </div>
        )}

        <div className="mt-3">
          <label htmlFor="source" className={labelClass}>Source asset</label>
          <select id="source" value={source} onChange={(e) => setSource(e.target.value)} className={selectClass}>
            {assets.map((a) => (
              <option key={a._id || a.id} value={a._id || a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div className="mt-3">
          <label htmlFor="relationship_type" className={labelClass}>Relationship</label>
          <select
            id="relationship_type"
            value={relationshipType}
            onChange={(e) => setRelationshipType(e.target.value)}
            className={selectClass}
          >
            {api.RELATIONSHIP_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="mt-3">
          <label htmlFor="target" className={labelClass}>Target asset</label>
          <select id="target" value={target} onChange={(e) => setTarget(e.target.value)} className={selectClass}>
            {assets.map((a) => (
              <option key={a._id || a.id} value={a._id || a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div className="mt-3">
          <label htmlFor="confidence" className={labelClass}>Confidence</label>
          <select id="confidence" value={confidence} onChange={(e) => setConfidence(e.target.value)} className={selectClass}>
            {api.CONFIDENCES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white/90 backdrop-blur-md transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Add relationship"}
          </button>
        </div>
      </form>
    </div>
  );
}