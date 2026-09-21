import { useEffect, useMemo, useRef, useState, useCallback } from "react";

const WIDTH = 900;
const HEIGHT = 520;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const BASE_NODE_R = 6;
const COLLISION_PADDING = 22;
const DRAG_THRESHOLD = 3;

function seedPositions(ids) {
  const pos = {};
  const vel = {};
  const n = ids.length || 1;
  ids.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const r = Math.min(WIDTH, HEIGHT) / 2 - 100;
    pos[id] = { x: CENTER_X + r * Math.cos(angle), y: CENTER_Y + r * Math.sin(angle) };
    vel[id] = { x: 0, y: 0 };
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
    const n = ids.length || 1;
    ids.forEach((id, i) => {
      if (!posRef.current[id]) {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const r = Math.min(WIDTH, HEIGHT) / 2 - 100;
        posRef.current[id] = { x: CENTER_X + r * Math.cos(angle), y: CENTER_Y + r * Math.sin(angle) };
        velRef.current[id] = { x: 0, y: 0 };
      }
    });
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
          const force = 2600 / distSq;
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
        const targetLen = 180;
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
        pos[id].x = Math.min(WIDTH - 40, Math.max(40, safe(pos[id].x, CENTER_X)));
        pos[id].y = Math.min(HEIGHT - 40, Math.max(40, safe(pos[id].y, CENTER_Y)));
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
    const { pos, vel } = seedPositions(ids);
    posRef.current = pos;
    velRef.current = vel;
    pinnedRef.current = {};
    anchorRef.current = {};
    setResetToken((t) => t + 1);
  }, [ids]);

  return { positions: posRef.current, setPinned, resetLayout, wake, setActiveDrag };
}

export default function LineageGraph({ assets, edges, colorFor, selectedId, onSelect }) {
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
      <button type="button" className="btn btn-ghost graph-reset" onClick={resetView} title="Reset zoom, pan, and layout">
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
            <path d="M0,0 L10,5 L0,10 z" fill="var(--border)" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--wire)" />
          </marker>
          <marker id="arrow-dependent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--pointer-dependent)" />
          </marker>
          <marker id="arrow-dependency" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--pointer-dependency)" />
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

            let stroke = "var(--border)";
            let marker = "url(#arrow)";
            let strokeWidth = 1.2;
            let dash = undefined;
            let opacity = dim ? 0.18 : 0.85;
            if (active) {
              stroke = "var(--wire)";
              marker = "url(#arrow-active)";
              strokeWidth = 2;
            } else if (isDependentChain) {
              stroke = "var(--pointer-dependent)";
              marker = "url(#arrow-dependent)";
              strokeWidth = 1.6;
              dash = "4 3";
              opacity = 0.75;
            } else if (isDependencyChain) {
              stroke = "var(--pointer-dependency)";
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
                className={active ? "edge-flow" : ""}
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
                  <circle r={r + 7} fill="none" stroke="var(--wire)" strokeWidth={1} opacity={0.4} />
                )}
                <circle
                  r={r}
                  fill={colorFor(a)}
                  stroke={isSelected ? "var(--text)" : "var(--bg)"}
                  strokeWidth={isSelected ? 2 : 1.5}
                />
                <text className="graph-node-title" x="0" y={-r - 8} textAnchor="middle">
                  {a.name.length > 22 ? a.name.slice(0, 20) + "…" : a.name}
                </text>
                <text className="graph-node-label" x="0" y={r + 16} textAnchor="middle">
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
