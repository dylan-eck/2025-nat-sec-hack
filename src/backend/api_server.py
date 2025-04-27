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
import json
import os

# --- Configuration ---
PICKLE_FILENAME = '../../public/road_graph_data.pkl' # Use the cropped graph
SAVED_ZONES_FILENAME = 'saved_zones.json' # File to store zones
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
    path: List[Tuple[float, float]] = Field(None, description="List of [longitude, latitude] tuples for the path, if found")
    message: str

class ZonesData(BaseModel):
    exclusion: List[PolygonInput]
    safe: List[PolygonInput]

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
            msg = f"Could not find a starting node near {request.start_point.longitude}, {request.start_point.latitude} in the accessible graph."
            print(msg)
            return PathResponse(path_found=False, message=msg)

        # --- MODIFIED: Find shortest path to the NEAREST safe zone (based on centroid) ---
        print("Finding path to the nearest safe zone (via centroid node)...")
        if not request.safe_zones:
             raise HTTPException(status_code=400, detail="At least one safe zone must be provided.")

        shortest_path_len = float('inf')
        final_target_node = None
        processed_safe_zones = 0

        for i, safe_zone_input in enumerate(request.safe_zones):
            print(f"  Processing safe zone {i+1}/{len(request.safe_zones)}...")
            if len(safe_zone_input.coordinates) < 3:
                print(f"    Skipping invalid safe zone polygon {i+1} (< 3 vertices).")
                continue

            # Transform coordinates and create polygon
            safe_poly_coords_metric = [transformer_to_metric.transform(lon, lat) for lon, lat in safe_zone_input.coordinates]
            safe_poly = Polygon(safe_poly_coords_metric)

            # Calculate centroid
            centroid = safe_poly.centroid
            centroid_coords_metric = (centroid.x, centroid.y)

            # Find nearest node in G_temp to the centroid
            current_target_node = get_nearest_node_api(G_temp, centroid_coords_metric, node_points_base)

            if current_target_node is None:
                print(f"    Could not find node near centroid for safe zone {i+1}.")
                continue

            print(f"    Nearest node to centroid: {current_target_node}")

            # Calculate path length from start_node to this potential target
            current_path_length = float('inf')
            try:
                if start_node == current_target_node:
                    current_path_length = 0
                elif nx.has_path(G_temp, source=start_node, target=current_target_node):
                    current_path_length = nx.shortest_path_length(G_temp, source=start_node, target=current_target_node, weight='weight')
                else:
                    print(f"    No path found from start node to {current_target_node}.")
                    continue # Skip if no path exists

                print(f"    Path length to this target: {current_path_length:.2f}")

                # Check if this path is the shortest found so far
                if current_path_length < shortest_path_len:
                    shortest_path_len = current_path_length
                    final_target_node = current_target_node
                    print(f"    New shortest path found to target {final_target_node} (via safe zone {i+1}). Length: {shortest_path_len:.2f}")
                processed_safe_zones += 1

            except nx.NodeNotFound as e:
                 # Should not happen if get_nearest_node_api worked, but handle defensively
                 print(f"    Node not found error during path length calculation: {e}")
                 continue
            except Exception as e:
                 print(f"    Unexpected error calculating path length for target {current_target_node}: {e}")
                 continue

        # 5. Calculate final path and return response
        if final_target_node is not None:
            print(f"Shortest path identified to target node {final_target_node} (length: {shortest_path_len:.2f}). Calculating node path...")
            try:
                # Calculate the actual path (list of nodes)
                path_nodes = nx.shortest_path(G_temp, source=start_node, target=final_target_node, weight='weight')

                # Transform path nodes back to WGS84 coordinates
                path_coords_wgs84 = []
                for node in path_nodes:
                    if node in node_points_base:
                        metric_x, metric_y = node_points_base[node].x, node_points_base[node].y
                        lon, lat = transformer_to_wgs84.transform(metric_x, metric_y)
                        path_coords_wgs84.append([lon, lat])
                    else:
                        print(f"Warning: Node {node} from shortest path not found in node_points_base.")

                calculation_time = time.perf_counter() - request_start_time
                msg = f"Path found to nearest safe zone in {calculation_time:.4f} seconds. Nodes: {len(path_coords_wgs84)}"
                print(msg)
                print(f"DEBUG: Returning path type: {type(path_coords_wgs84)}, content: {path_coords_wgs84}")
                return PathResponse(path_found=True, path=path_coords_wgs84, message=msg)

            except nx.NetworkXNoPath:
                msg = f"Internal Error: No path exists from start node {start_node} to final target node {final_target_node}, even though length was calculated."
                print(msg)
                return PathResponse(path_found=False, message=msg)
            except Exception as final_path_err:
                msg = f"Error calculating final shortest path or transforming coordinates: {final_path_err}"
                print(msg)
                raise HTTPException(status_code=500, detail=msg)
        else:
            # This case means no path was found from the start node to *any* safe zone centroid node
            calculation_time = time.perf_counter() - request_start_time
            msg = f"Could not find a path from the start location to any of the provided safe zones' accessible nodes. Searched {len(request.safe_zones)} zones. Time: {calculation_time:.4f}s"
            print(msg)
            return PathResponse(path_found=False, message=msg)

    except Exception as e:
        print(f"An unexpected error occurred during path finding to safe zone: {e}")
        # import traceback
        # print(traceback.format_exc()) # Uncomment for debugging
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

# --- API Endpoint to Save Zones ---
@app.post("/save_zones")
async def save_zones(zones_data: ZonesData):
    try:
        print(f"Saving {len(zones_data.exclusion)} exclusion zones and {len(zones_data.safe)} safe zones...")
        # Convert Pydantic models to dict for JSON serialization
        data_to_save = zones_data.dict()
        with open(SAVED_ZONES_FILENAME, 'w') as f:
            json.dump(data_to_save, f, indent=4)
        print(f"Zones saved successfully to {SAVED_ZONES_FILENAME}")
        return {"message": "Zones saved successfully."}
    except Exception as e:
        print(f"Error saving zones: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error while saving zones: {e}")

# --- API Endpoint to Load Zones ---
@app.get("/load_zones", response_model=ZonesData)
async def load_zones():
    try:
        if not os.path.exists(SAVED_ZONES_FILENAME):
            print("Saved zones file not found, returning empty lists.")
            return ZonesData(exclusion=[], safe=[]) # Return empty structure if file doesn't exist

        print(f"Loading zones from {SAVED_ZONES_FILENAME}...")
        with open(SAVED_ZONES_FILENAME, 'r') as f:
            loaded_data = json.load(f)
            # Validate loaded data against the Pydantic model
            zones = ZonesData(**loaded_data)
            print(f"Loaded {len(zones.exclusion)} exclusion zones and {len(zones.safe)} safe zones.")
            return zones
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from {SAVED_ZONES_FILENAME}: {e}")
        raise HTTPException(status_code=500, detail=f"Error reading saved zones file: Invalid JSON format.")
    except Exception as e:
        print(f"Error loading zones: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error while loading zones: {e}")

# --- Add entry point to run with Uvicorn (for simple execution) ---
if __name__ == "__main__":
    import uvicorn
    print("Starting Uvicorn server...")
    uvicorn.run("api_server:app", host="127.0.0.1", port=8000, reload=True)
    # Note: reload=True is good for development, disable for production
