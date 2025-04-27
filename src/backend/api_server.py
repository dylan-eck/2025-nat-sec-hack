import time
import pickle
import os
import sys
import networkx as nx
from shapely.geometry import Point, Polygon, box
from pyproj import Transformer
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Tuple
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware

# --- Configuration ---
PICKLE_FILENAME = '../../public/road_graph_data.pkl' # Use the cropped graph
SOURCE_CRS = "EPSG:4326"  # WGS84 (longitude, latitude)
TARGET_CRS = "EPSG:32610"  # Projected CRS used for graph building (UTM Zone 10N)
# --- End Configuration ---

# --- Global Variables for Loaded Data ---
G_base = None
node_points_base = None
original_edges_base = None
transformer_to_metric = None
transformer_to_wgs84 = None

# --- Helper Function: Load Graph Data ---
def load_graph_data():
    global G_base, node_points_base, original_edges_base, transformer_to_metric, transformer_to_wgs84

    print(f"Loading graph data from '{PICKLE_FILENAME}'...")
    load_start_time = time.perf_counter()

    if not os.path.exists(PICKLE_FILENAME):
        print(f"Error: Input pickle file '{PICKLE_FILENAME}' not found.")
        print("Please run build_graph.py (and potentially crop_graph.py) first.")
        sys.exit(1)

    try:
        with open(PICKLE_FILENAME, 'rb') as f:
            data = pickle.load(f)
            G_base = data['graph']
            node_points_base = data['node_points']
            original_edges_base = data['original_edges']
        print(f"Loaded graph with {G_base.number_of_nodes()} nodes and {G_base.number_of_edges()} edges.")

        # Initialize transformers
        transformer_to_metric = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)
        transformer_to_wgs84 = Transformer.from_crs(TARGET_CRS, SOURCE_CRS, always_xy=True)

        load_end_time = time.perf_counter()
        print(f"Graph data loaded and transformers initialized in {load_end_time - load_start_time:.2f} seconds.")

    except (KeyError, EOFError, pickle.UnpicklingError) as e:
        print(f"Error loading pickle file '{PICKLE_FILENAME}': {e}")
        sys.exit(1)
    except Exception as e:
        print(f"An unexpected error occurred loading data: {e}")
        sys.exit(1)

# --- Helper Function: Find Nearest Node ---
def get_nearest_node_api(graph, point_coords_metric, current_node_points):
    point_geom = Point(point_coords_metric)
    min_dist = float("inf")
    nearest_node = None
    # Use items() for potentially better performance on large dicts
    for node, node_point in current_node_points.items():
         if node in graph: # Check if node exists in the potentially modified graph
            dist = point_geom.distance(node_point)
            if dist < min_dist:
                min_dist = dist
                nearest_node = node
    return nearest_node

# --- FastAPI App Setup ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Code to run on startup
    print("Lifespan startup: Loading graph data...")
    load_graph_data()
    if G_base is None or node_points_base is None or transformer_to_metric is None:
        print("ERROR: Graph data or transformers failed to load during startup.")
        # In a real app, you might raise an exception here to prevent startup
    else:
        print("Lifespan startup: Graph data loaded successfully.")
    yield
    # Code to run on shutdown (if any)
    print("Lifespan shutdown.")

origins = [
    "http://localhost:3000",  # Allow your frontend origin
    # Add other origins if needed, e.g., "http://127.0.0.1:3000"
]

app = FastAPI(
    title="Pathfinding API",
    description="API to find the shortest path between two points, avoiding specified polygonal areas.",
    version="1.0.0",
    lifespan=lifespan  # Register the lifespan context manager
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"], # Allow POST requests for pathfinding
    allow_headers=["*"], # Allow all headers
)

# --- Pydantic Models for Request/Response ---
class PointInput(BaseModel):
    longitude: float
    latitude: float

class PolygonInput(BaseModel):
    coordinates: List[Tuple[float, float]] = Field(..., description="List of [longitude, latitude] tuples defining polygon vertices")

class PathRequest(BaseModel):
    start_point: PointInput
    safe_zones: List[PolygonInput] = Field(..., description="List of polygons defining target safe zones")
    polygons: List[PolygonInput] = Field([], description="List of polygons defining inaccessible areas")

class PathResponse(BaseModel):
    path_found: bool
    path_coordinates: List[Tuple[float, float]] = Field(None, description="List of [longitude, latitude] tuples for the path, if found")
    message: str

# --- API Endpoint ---
@app.post("/find_path", response_model=PathResponse)
async def find_path(request: PathRequest):
    """
    Finds the shortest path between a start point and the nearest point within any of the specified safe zone polygons,
    avoiding nodes within specified exclusion polygons.
    Coordinates are expected in WGS84 (longitude, latitude).
    """
    if G_base is None or node_points_base is None or transformer_to_metric is None or transformer_to_wgs84 is None:
        raise HTTPException(status_code=503, detail="Server error: Graph data not loaded.")

    request_start_time = time.perf_counter()
    print("Received path request (to safe zone)...")

    try:
        # 1. Transform start point to metric CRS
        start_lon, start_lat = request.start_point.longitude, request.start_point.latitude
        start_proj_x, start_proj_y = transformer_to_metric.transform(start_lon, start_lat)

        # 2. Create a temporary copy of the graph for modification
        G_temp = G_base.copy()
        nodes_to_remove = set()

        # 3. Process exclusion polygons
        if request.polygons:
            print(f"Processing {len(request.polygons)} exclusion polygons...")
            for poly_input in request.polygons:
                if len(poly_input.coordinates) < 3:
                    print(f"Skipping invalid exclusion polygon with < 3 vertices: {poly_input.coordinates}")
                    continue
                poly_coords_metric = [transformer_to_metric.transform(lon, lat) for lon, lat in poly_input.coordinates]
                exclusion_poly = Polygon(poly_coords_metric)
                for node, node_point in node_points_base.items():
                    if node in G_temp and exclusion_poly.contains(node_point):
                        nodes_to_remove.add(node)

            if nodes_to_remove:
                print(f"Removing {len(nodes_to_remove)} nodes based on exclusion polygons...")
                G_temp.remove_nodes_from(list(nodes_to_remove))
            else:
                print("No nodes found within specified exclusion polygons.")

        # 4. Find nearest node to the start point in the accessible graph
        start_node = get_nearest_node_api(G_temp, (start_proj_x, start_proj_y), node_points_base)

        if start_node is None:
            msg = "Could not find nearest start node in the accessible graph area."
            print(msg)
            return PathResponse(path_found=False, message=msg)

        # 5. Identify potential target nodes within safe zones
        target_nodes = set()
        safe_zone_polygons_metric = []
        print(f"Processing {len(request.safe_zones)} safe zone polygons...")
        if not request.safe_zones:
             raise HTTPException(status_code=400, detail="At least one safe zone must be provided.")

        for poly_input in request.safe_zones:
            if len(poly_input.coordinates) < 3:
                print(f"Skipping invalid safe zone polygon with < 3 vertices: {poly_input.coordinates}")
                continue
            poly_coords_metric = [transformer_to_metric.transform(lon, lat) for lon, lat in poly_input.coordinates]
            safe_poly = Polygon(poly_coords_metric)
            safe_zone_polygons_metric.append(safe_poly)

            # Find nodes within this safe zone polygon that are still in G_temp
            for node, node_point in node_points_base.items():
                if node in G_temp and safe_poly.contains(node_point):
                     # Check if the node is reachable from the start node
                     if nx.has_path(G_temp, source=start_node, target=node):
                        target_nodes.add(node)

        if not target_nodes:
            msg = "No accessible graph nodes found within any of the specified safe zones."
            print(msg)
            return PathResponse(path_found=False, message=msg)

        print(f"Found {len(target_nodes)} potential target nodes within safe zones.")

        # 6. Find the shortest path to *any* of the target nodes
        shortest_path = None
        shortest_path_len = float('inf')
        final_target_node = None

        print(f"Calculating shortest paths from {start_node} to {len(target_nodes)} potential targets...")
        # Use multi_source_dijkstra for efficiency if available and suitable,
        # or iterate if simpler/required by specific logic.
        # Let's iterate for clarity first.
        paths_found_count = 0
        for target_node in target_nodes:
             if start_node == target_node: # Handle case where start is already in a safe zone
                 if 0 < shortest_path_len:
                     shortest_path = [start_node]
                     shortest_path_len = 0
                     final_target_node = start_node
                 continue # Skip path calculation if start==target

             try:
                # Use path length (sum of weights) for comparison
                length = nx.shortest_path_length(G_temp, source=start_node, target=target_node, weight='weight')
                if length < shortest_path_len:
                     shortest_path_len = length
                     # We only retrieve the full path if it's currently the shortest to save computation
                     # shortest_path = nx.shortest_path(G_temp, source=start_node, target=target_node, weight='weight') # Defer getting the full path
                     final_target_node = target_node
                     paths_found_count += 1
             except nx.NetworkXNoPath:
                 # This shouldn't happen due to the has_path check earlier, but handle defensively
                 print(f"Warning: No path found to target {target_node} despite initial check.")
                 continue
             except nx.NodeNotFound:
                 print(f"Warning: Node {target_node} not found during path calculation.")
                 continue

        if final_target_node is None:
             # This could happen if the only target node was the start node itself and no path calculation was done
             if start_node in target_nodes:
                 shortest_path = [start_node]
                 final_target_node = start_node
                 print(f"Start node {start_node} is within a safe zone.")
             else:
                 # Or if all paths failed for some reason
                 msg = f"Could not find a valid path to any target node in safe zones from {start_node}."
                 print(msg)
                 return PathResponse(path_found=False, message=msg)

        # Now calculate the actual shortest path once the best target is known
        if start_node == final_target_node:
             shortest_path = [start_node]
             print(f"Optimal path is just the start node (already in safe zone): {start_node}")
        else:
             try:
                 shortest_path = nx.shortest_path(G_temp, source=start_node, target=final_target_node, weight='weight')
                 print(f"Shortest path found to target {final_target_node} with length {shortest_path_len:.2f} and {len(shortest_path)} nodes.")
             except (nx.NetworkXNoPath, nx.NodeNotFound):
                 # Should not happen if logic above is correct
                  msg = f"Failed to retrieve the final shortest path to {final_target_node}."
                  print(msg)
                  return PathResponse(path_found=False, message=msg)

        # 7. Transform path back to WGS84
        path_latlon = [transformer_to_wgs84.transform(node_point[0], node_point[1]) for node_point in shortest_path] # Fixed to use node coordinates

        request_end_time = time.perf_counter()
        print(f"Path to safe zone calculated in {request_end_time - request_start_time:.3f} seconds.")

        return PathResponse(
            path_found=True,
            path_coordinates=path_latlon,
            message="Shortest path to a safe zone calculated successfully."
        )

    except HTTPException as http_exc:
        # Re-raise HTTP exceptions directly
        raise http_exc
    except Exception as e:
        print(f"An unexpected error occurred during path finding to safe zone: {e}")
        # import traceback
        # print(traceback.format_exc()) # Uncomment for debugging
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

# --- Add entry point to run with Uvicorn (for simple execution) ---
if __name__ == "__main__":
    import uvicorn
    print("Starting Uvicorn server...")
    uvicorn.run("api_server:app", host="127.0.0.1", port=8000, reload=True)
    # Note: reload=True is good for development, disable for production
