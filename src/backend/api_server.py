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
    end_point: PointInput
    polygons: List[PolygonInput] = Field([], description="List of polygons defining inaccessible areas")

class PathResponse(BaseModel):
    path_found: bool
    path_coordinates: List[Tuple[float, float]] = Field(None, description="List of [longitude, latitude] tuples for the path, if found")
    message: str

# --- API Endpoint ---
@app.post("/find_path", response_model=PathResponse)
async def find_path(request: PathRequest):
    """
    Finds the shortest path between a start and end point, avoiding nodes within specified polygons.
    Coordinates are expected in WGS84 (longitude, latitude).
    """
    if G_base is None or node_points_base is None or transformer_to_metric is None or transformer_to_wgs84 is None:
        raise HTTPException(status_code=503, detail="Server error: Graph data not loaded.")

    request_start_time = time.perf_counter()
    print("Received path request...")

    try:
        # 1. Transform start/end points to metric CRS
        start_lon, start_lat = request.start_point.longitude, request.start_point.latitude
        end_lon, end_lat = request.end_point.longitude, request.end_point.latitude
        start_proj_x, start_proj_y = transformer_to_metric.transform(start_lon, start_lat)
        end_proj_x, end_proj_y = transformer_to_metric.transform(end_lon, end_lat)

        # 2. Create a temporary copy of the graph for modification
        G_temp = G_base.copy()
        nodes_to_remove = set()

        # 3. Process exclusion polygons
        if request.polygons:
            print(f"Processing {len(request.polygons)} exclusion polygons...")
            for poly_input in request.polygons:
                if len(poly_input.coordinates) < 3:
                    print(f"Skipping invalid polygon with < 3 vertices: {poly_input.coordinates}")
                    continue

                # Transform polygon vertices to metric CRS
                poly_coords_metric = [transformer_to_metric.transform(lon, lat) for lon, lat in poly_input.coordinates]
                exclusion_poly = Polygon(poly_coords_metric)

                # Find nodes within this polygon
                for node, node_point in node_points_base.items(): # Check against base node points
                    if node in G_temp and exclusion_poly.contains(node_point):
                        nodes_to_remove.add(node)

            if nodes_to_remove:
                print(f"Removing {len(nodes_to_remove)} nodes based on polygons...")
                G_temp.remove_nodes_from(list(nodes_to_remove))
            else:
                print("No nodes found within specified polygons.")

        # 4. Find nearest nodes in the (potentially modified) temporary graph
        start_node = get_nearest_node_api(G_temp, (start_proj_x, start_proj_y), node_points_base)
        end_node = get_nearest_node_api(G_temp, (end_proj_x, end_proj_y), node_points_base)

        if start_node is None or end_node is None:
            msg = "Could not find nearest start or end node in the accessible graph area."
            print(msg)
            return PathResponse(path_found=False, message=msg)

        if start_node == end_node:
             msg = "Start and end nodes are the same."
             print(msg)
             # Return a path with just the single point
             start_node_lon, start_node_lat = transformer_to_wgs84.transform(start_node[0], start_node[1])
             return PathResponse(path_found=True, path_coordinates=[(start_node_lon, start_node_lat)], message=msg)

        # 5. Calculate shortest path
        print(f"Finding path between {start_node} and {end_node}...")
        path = None
        try:
            path = nx.shortest_path(G_temp, source=start_node, target=end_node, weight='weight')
            print(f"Path found with {len(path)} nodes.")
        except nx.NetworkXNoPath:
            msg = f"No path found between the selected start and end points in the accessible graph."
            print(msg)
            return PathResponse(path_found=False, message=msg)
        except nx.NodeNotFound:
             # This might happen if start/end node was removed *after* nearest node check - race condition unlikely here but possible
             msg = "Start or end node not found in the graph (possibly removed by a polygon)."
             print(msg)
             return PathResponse(path_found=False, message=msg)

        # 6. Transform path back to WGS84
        path_latlon = [transformer_to_wgs84.transform(x, y) for x, y in path]

        request_end_time = time.perf_counter()
        print(f"Path calculated in {request_end_time - request_start_time:.3f} seconds.")

        return PathResponse(
            path_found=True,
            path_coordinates=path_latlon,
            message="Shortest path calculated successfully."
        )

    except Exception as e:
        print(f"An unexpected error occurred during path finding: {e}")
        # Log the full traceback in a real application
        # import traceback
        # print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

# --- Add entry point to run with Uvicorn (for simple execution) ---
if __name__ == "__main__":
    import uvicorn
    print("Starting Uvicorn server...")
    uvicorn.run("api_server:app", host="127.0.0.1", port=8000, reload=True)
    # Note: reload=True is good for development, disable for production
