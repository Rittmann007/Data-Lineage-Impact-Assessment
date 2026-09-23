const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

async function apiRequest(endpoint, options = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;

    try {
      const errorData = await response.json();
      if (errorData.detail) {
        message = errorData.detail;
      }
    } catch {
      // Keep default error message
    }

    throw new Error(message);
  }

  return response.json();
}

export async function getAssets(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.append(key, value);
    }
  });

  const query = params.toString();

  return apiRequest(`/assets${query ? `?${query}` : ""}`);
}

export async function getAssetById(assetId) {
  return apiRequest(`/assets/${assetId}`);
}

export async function getEdges() {
  return apiRequest("/edges");
}

export async function createEdge(edge) {
  return apiRequest("/edge_create", {
    method: "POST",
    body: JSON.stringify(edge),
  });
}

export async function getImpact(assetId) {
  return apiRequest(`/impact/${assetId}`);
}

export async function getAssetExplanation(assetId) {
  return apiRequest(`/assets/${assetId}/explain`);
}

export async function getLineage(assetId, depth) {
  const query = depth ? `?depth=${depth}` : "";
  return apiRequest(`/lineage/${assetId}${query}`);
}

export async function getGraph() {
  return apiRequest("/graph");
}

export async function deleteAsset(assetId) {
  return apiRequest(`/assets/${assetId}`, {
    method: "DELETE",
  });
}