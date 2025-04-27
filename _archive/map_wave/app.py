from flask import Flask, request, jsonify, render_template
import requests
import json
import os
import time
from shapely.geometry import shape, Polygon, LineString, Point, box
from shapely.ops import nearest_points, unary_union
import numpy as np
from dotenv import load_dotenv
import uuid
import math
from itertools import combinations

load_dotenv()  # Load environment variables from .env file

app = Flask(__name__)

# Load the Mapbox API key from environment variable
MAPBOX_ACCESS_TOKEN = os.getenv("MAPBOX_API_KEY")

if not MAPBOX_ACCESS_TOKEN:
    raise ValueError(
        "MAPBOX_API_KEY environment variable not set! Create a .env file with MAPBOX_API_KEY=your_key"
    )


def get_coordinates_from_address(address):
    """Geocode an address to (longitude, latitude) using Mapbox Directions API."""
    geocode_url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{address}.json"
    params = {"access_token": MAPBOX_ACCESS_TOKEN, "limit": 1}
    try:
        response = requests.get(geocode_url, params=params)
        response.raise_for_status()  # Raise an exception for bad status codes
        data = response.json()
        if data["features"]:
            # Return (longitude, latitude)
            return data["features"][0]["center"]
        else:
            return None
    except requests.exceptions.RequestException as e:
        print(f"Geocoding error for '{address}': {e}")
        return None


def find_routes(start_coords, end_coords, waypoints=None):
    """Find routes between two points using Mapbox Directions API.

    Args:
        start_coords: Starting coordinates as [longitude, latitude]
        end_coords: Ending coordinates as [longitude, latitude]
        waypoints: Optional list of waypoint coordinates [[lon1, lat1], [lon2, lat2], ...]
    """
    base_url = "https://api.mapbox.com/directions/v5/mapbox/driving"

    # Build coordinates string
    coordinates = f"{start_coords[0]},{start_coords[1]}"

    # Add waypoints if provided
    if waypoints and len(waypoints) > 0:
        for wp in waypoints:
            coordinates += f";{wp[0]},{wp[1]}"

    # Add destination
    coordinates += f";{end_coords[0]},{end_coords[1]}"

    request_url = f"{base_url}/{coordinates}"
    params = {
        "access_token": MAPBOX_ACCESS_TOKEN,
        "geometries": "geojson",
        "overview": "full",
        "alternatives": "true",
    }
    try:
        response = requests.get(request_url, params=params)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Directions API error: {e}")
        return None


def is_waypoint_on_road(waypoint, max_distance=0.0005):
    """Check if a waypoint is on or near a road.

    Args:
        waypoint: Coordinates [lon, lat]
        max_distance: Maximum allowed distance from road (about 50m)

    Returns:
        Boolean indicating if waypoint is on/near a road
    """
    # Use Mapbox Directions API to check if point is routable
    base_url = "https://api.mapbox.com/directions/v5/mapbox/driving"

    # Create a small circle around the point
    lon, lat = waypoint
    radius = max_distance  # ~50 meters

    # Create points in cardinal directions
    test_points = [
        [lon, lat],  # The point itself
        [lon + radius, lat],  # East
        [lon - radius, lat],  # West
        [lon, lat + radius],  # North
        [lon, lat - radius],  # South
    ]

    # Try to route between the point and nearby points
    for test_point in test_points[1:]:  # Skip the first point (same as waypoint)
        coordinates = f"{waypoint[0]},{waypoint[1]};{test_point[0]},{test_point[1]}"
        request_url = f"{base_url}/{coordinates}"
        params = {
            "access_token": MAPBOX_ACCESS_TOKEN,
            "geometries": "geojson",
        }

        try:
            response = requests.get(request_url, params=params)

            # If the request was successful and we got a valid route
            if response.status_code == 200:
                data = response.json()
                if "routes" in data and len(data["routes"]) > 0:
                    return True
        except Exception as e:
            print(f"Error checking if waypoint is on road: {e}")
            pass  # Continue with other test points

    # If all routing attempts failed, the point is not on a road
    return False


def filter_road_waypoints(waypoints, batch_size=5):
    """Filter waypoints to only include those on or near roads.

    Args:
        waypoints: List of waypoint coordinates
        batch_size: Number of waypoints to check in parallel

    Returns:
        List of filtered waypoint coordinates
    """
    if not waypoints:
        return []

    road_waypoints = []

    # Process waypoints in batches to avoid too many API requests at once
    for i in range(0, len(waypoints), batch_size):
        batch = waypoints[i : i + batch_size]

        # Check each waypoint in the batch
        for wp in batch:
            if is_waypoint_on_road(wp):
                road_waypoints.append(wp)

        # Add a small delay between batches to avoid rate limiting
        if i + batch_size < len(waypoints):
            time.sleep(0.2)

    return road_waypoints


def generate_grid_waypoints(
    bounds,
    grid_size=5,
    exclude_zones=None,
    direct_line=None,
    max_distance_from_direct=0.05,
):
    """Generate a grid of waypoints within the given bounds.

    Args:
        bounds: [min_lon, min_lat, max_lon, max_lat]
        grid_size: Number of points in each direction
        exclude_zones: List of Shapely Polygon objects to exclude
        direct_line: Optional LineString of the direct route
        max_distance_from_direct: Maximum distance from direct line to place waypoints

    Returns:
        List of waypoint coordinates [[lon1, lat1], [lon2, lat2], ...]
    """
    min_lon, min_lat, max_lon, max_lat = bounds

    # Create a grid of points
    lon_step = (max_lon - min_lon) / (grid_size - 1) if grid_size > 1 else 0
    lat_step = (max_lat - min_lat) / (grid_size - 1) if grid_size > 1 else 0

    waypoints = []
    for i in range(grid_size):
        for j in range(grid_size):
            lon = min_lon + i * lon_step
            lat = min_lat + j * lat_step

            # Skip if the point is within any exclusion zone
            point = Point(lon, lat)
            if exclude_zones and any(point.within(zone) for zone in exclude_zones):
                continue

            # If direct line is provided, only include points within max_distance
            if direct_line and point.distance(direct_line) > max_distance_from_direct:
                continue

            waypoints.append([lon, lat])

    # Filter waypoints to only include those on roads
    return filter_road_waypoints(waypoints)


def generate_border_waypoints(
    danger_polygons,
    start_coords,
    end_coords,
    buffer_distance=0.002,
    num_points=20,
    max_distance=0.03,
):
    """Generate waypoints around the borders of danger zones.

    Args:
        danger_polygons: List of Shapely Polygon objects representing danger zones
        start_coords: Starting point coordinates [lon, lat]
        end_coords: Ending point coordinates [lon, lat]
        buffer_distance: Distance to offset from danger zone boundaries
        num_points: Target number of waypoints to generate
        max_distance: Maximum distance from the direct path to place waypoints

    Returns:
        List of waypoint coordinates [[lon1, lat1], [lon2, lat2], ...]
    """
    if not danger_polygons:
        return []

    # Create a direct line from start to end
    direct_line = LineString([start_coords, end_coords])

    # Create a buffer around the direct line to limit waypoint distance
    direct_buffer = direct_line.buffer(max_distance)

    # Create a unified polygon of all danger zones
    unified_danger = unary_union(danger_polygons)

    # Create a buffer around the danger zone
    buffered_zone = unified_danger.buffer(buffer_distance)

    # Get the boundary of the buffered zone
    boundary = buffered_zone.boundary

    # Only consider the part of the boundary within our direct path buffer
    if not boundary.is_empty and not direct_buffer.is_empty:
        boundary = boundary.intersection(direct_buffer)

    # Generate evenly spaced points along the boundary
    candidate_waypoints = []

    if hasattr(boundary, "geoms"):  # MultiLineString case
        for line in boundary.geoms:
            coords = list(line.coords)
            step = max(1, len(coords) // (num_points // len(boundary.geoms)))

            for i in range(0, len(coords), step):
                waypoint = coords[i]
                # Skip if the point is in any danger zone
                point = Point(waypoint)
                if any(point.within(zone) for zone in danger_polygons):
                    continue

                candidate_waypoints.append(list(waypoint))
    else:  # LineString case
        coords = list(boundary.coords)
        step = max(1, len(coords) // num_points)

        for i in range(0, len(coords), step):
            if i < len(coords):  # Safety check
                waypoint = coords[i]
                # Skip if the point is in any danger zone
                point = Point(waypoint)
                if any(point.within(zone) for zone in danger_polygons):
                    continue

                candidate_waypoints.append(list(waypoint))

    # If we have too few points, try a different approach with cardinal directions
    if len(candidate_waypoints) < 4:
        # Get the bounding box of the danger zones that intersect with the direct path
        intersecting_zones = [
            zone for zone in danger_polygons if zone.intersects(direct_line)
        ]
        if intersecting_zones:
            unified_intersect = unary_union(intersecting_zones)
            minx, miny, maxx, maxy = unified_intersect.bounds

            # Create points at the cardinal directions around the bounding box
            # but limit them to be within max_distance of the direct path
            buffer_dist = min(
                max(maxx - minx, maxy - miny) * 0.15, max_distance
            )  # 15% of box size or max allowed

            cardinal_points = [
                [minx - buffer_dist, (miny + maxy) / 2],  # West
                [maxx + buffer_dist, (miny + maxy) / 2],  # East
                [(minx + maxx) / 2, miny - buffer_dist],  # South
                [(minx + maxx) / 2, maxy + buffer_dist],  # North
            ]

            for point_coords in cardinal_points:
                point = Point(point_coords)
                if (
                    not any(point.within(zone) for zone in danger_polygons)
                    and point.distance(direct_line) <= max_distance
                ):
                    candidate_waypoints.append(point_coords)

    # Filter waypoints to only include those on roads
    return filter_road_waypoints(candidate_waypoints)


def generate_waypoints_around_danger_zones(
    start_coords, end_coords, danger_polygons, num_points=15
):
    """Generate potential waypoints to navigate around danger zones using multiple strategies.

    Args:
        start_coords: Starting point coordinates [lon, lat]
        end_coords: Ending point coordinates [lon, lat]
        danger_polygons: List of Shapely Polygon objects representing danger zones
        num_points: Number of potential waypoints to generate

    Returns:
        List of waypoint coordinates [[lon1, lat1], [lon2, lat2], ...]
    """
    # If no danger zones, no need for waypoints
    if not danger_polygons:
        return []

    # Create a direct line from start to end
    direct_line = LineString([start_coords, end_coords])

    # Calculate the direct distance
    direct_distance = math.sqrt(
        (start_coords[0] - end_coords[0]) ** 2 + (start_coords[1] - end_coords[1]) ** 2
    )

    # Find all intersections with danger zones
    intersecting_zones = []
    for zone in danger_polygons:
        if direct_line.intersects(zone):
            intersecting_zones.append(zone)

    if not intersecting_zones:
        return []

    # Calculate the bounds for our search area - much tighter than before
    # This will be a corridor along the direct route
    max_deviation = min(
        direct_distance * 0.2, 0.03
    )  # 20% of direct distance or max 3km, whichever is smaller

    # Create bounds that follow the direct line more closely
    direct_buffer = direct_line.buffer(max_deviation)
    min_lon, min_lat, max_lon, max_lat = direct_buffer.bounds

    # Add tiny padding
    padding = 0.001  # About 100m
    min_lon -= padding
    min_lat -= padding
    max_lon += padding
    max_lat += padding

    # Strategy 1: Generate waypoints around the borders of danger zones
    border_waypoints = generate_border_waypoints(
        danger_polygons,
        start_coords,
        end_coords,
        buffer_distance=0.002,
        num_points=num_points,
        max_distance=max_deviation,
    )

    # Strategy 2: Generate a grid of waypoints across the search area
    grid_waypoints = generate_grid_waypoints(
        [min_lon, min_lat, max_lon, max_lat],
        grid_size=5,
        exclude_zones=danger_polygons,
        direct_line=direct_line,
        max_distance_from_direct=max_deviation,
    )

    # Strategy 3: Generate midpoints between the direct route and each danger zone
    midpoint_waypoints = []
    for zone in intersecting_zones:
        # Find the center of the danger zone
        zone_center = list(zone.centroid.coords)[0]

        # Find the nearest point on the direct line
        nearest_point = nearest_points(direct_line, Point(zone_center))[0]
        nearest_coords = list(nearest_point.coords)[0]

        # Create a point halfway between the direct line and the zone's edge
        for i in range(1, 4):
            # Try different fractions of the distance
            fraction = i / 4
            midpoint = [
                nearest_coords[0] + (zone_center[0] - nearest_coords[0]) * fraction,
                nearest_coords[1] + (zone_center[1] - nearest_coords[1]) * fraction,
            ]

            # Check if it's not in a danger zone
            if not any(Point(midpoint).within(p) for p in danger_polygons):
                midpoint_waypoints.append(midpoint)
                break

    # Filter midpoint waypoints to only include those on roads
    midpoint_waypoints = filter_road_waypoints(midpoint_waypoints)

    # Combine all waypoint strategies
    all_waypoints = border_waypoints + grid_waypoints + midpoint_waypoints

    # Make sure we don't have duplicates by checking proximity
    unique_waypoints = []
    min_distance = 0.005  # About 500m

    for wp in all_waypoints:
        is_duplicate = False
        wp_point = Point(wp)

        # Check if this point is too close to an existing point
        for existing_wp in unique_waypoints:
            existing_point = Point(existing_wp)
            if wp_point.distance(existing_point) < min_distance:
                is_duplicate = True
                break

        if not is_duplicate:
            unique_waypoints.append(wp)

    # Sort waypoints by distance to direct line (closest first)
    unique_waypoints.sort(key=lambda wp: Point(wp).distance(direct_line))

    # Make sure we have some waypoints - if road filtering removed too many
    if not unique_waypoints and all_waypoints:
        print("Warning: Road filtering removed all waypoints. Using unfiltered points.")
        return all_waypoints[:num_points]

    return unique_waypoints[:num_points]


def ensure_valid_route(route_coords, start_coords, end_coords, max_distance=0.001):
    """Ensure route starts and ends at the exact points provided.

    Args:
        route_coords: List of coordinate pairs from the route
        start_coords: Starting point coordinates [lon, lat]
        end_coords: Ending point coordinates [lon, lat]
        max_distance: Maximum allowed distance to consider points equal

    Returns:
        Modified list of coordinates ensuring start and end match
    """
    if not route_coords:
        return route_coords

    # Check if the start point is already close enough
    start_point = Point(start_coords)
    actual_start = Point(route_coords[0])

    # Check if the end point is already close enough
    end_point = Point(end_coords)
    actual_end = Point(route_coords[-1])

    # Create a new route with exact start and end points
    new_route = [start_coords]

    # Add all the middle points
    if len(route_coords) > 2:
        new_route.extend(route_coords[1:-1])

    # Add the exact end point
    new_route.append(end_coords)

    return new_route


@app.route("/")
def index():
    """Serve the main HTML page."""
    # Pass the Mapbox token to the template
    return render_template("index.html", mapbox_token=MAPBOX_ACCESS_TOKEN)


@app.route("/api/find_safe_routes", methods=["POST"])
def api_find_safe_routes():
    """API endpoint to find safe routes."""
    data = request.json
    start_address = data.get("start_address")
    end_address = data.get("end_address")
    danger_zone_features = data.get("danger_zones", [])  # GeoJSON features

    if not start_address or not end_address:
        return jsonify({"error": "Start and end addresses are required."}), 400

    # Geocode addresses
    start_coords = get_coordinates_from_address(start_address)
    end_coords = get_coordinates_from_address(end_address)

    if not start_coords:
        return (
            jsonify({"error": f"Could not geocode start address: {start_address}"}),
            400,
        )
    if not end_coords:
        return jsonify({"error": f"Could not geocode end address: {end_address}"}), 400

    # Convert danger zone features to Shapely Polygons
    danger_polygons = []
    for feature in danger_zone_features:
        try:
            # Assuming the input is a GeoJSON Feature with a Polygon geometry
            if feature.get("geometry", {}).get("type") == "Polygon":
                danger_polygons.append(shape(feature["geometry"]))
            else:
                print(
                    f"Skipping invalid danger zone geometry: {feature.get('geometry', {}).get('type')}"
                )
        except Exception as e:
            print(f"Error processing danger zone feature: {e}")
            # Optionally return an error if strict validation is needed
            # return jsonify({"error": "Invalid danger zone format."}), 400

    # Find direct routes first
    route_data = find_routes(start_coords, end_coords)
    if not route_data or "routes" not in route_data:
        return jsonify({"error": "Could not retrieve routes from Mapbox."}), 500

    # Check direct routes for safety
    all_routes_geojson = []
    safe_routes_geojson = []
    unsafe_routes = []

    for i, route in enumerate(route_data["routes"]):
        path_coords = route["geometry"]["coordinates"]

        # Ensure route starts and ends at the exact locations
        path_coords = ensure_valid_route(path_coords, start_coords, end_coords)
        path_line = LineString(path_coords)

        is_safe = True
        for danger_zone in danger_polygons:
            if path_line.intersects(danger_zone):
                is_safe = False
                print(f"Direct route {i+1} intersects a danger zone.")
                unsafe_routes.append(route)
                break

        # Generate a unique ID for this route
        route_id = str(uuid.uuid4())

        # Create a GeoJSON Feature for the route
        route_feature = {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": path_coords},
            "properties": {
                "id": route_id,
                "distance_km": route.get("distance", 0) / 1000,
                "duration_min": route.get("duration", 0) / 60,
                "route_index": i + 1,
                "route_type": "direct",
                "is_safe": is_safe,
                "visible": True,  # Default to visible
            },
        }

        all_routes_geojson.append(route_feature)

        if is_safe:
            print(f"Direct route {i+1} is safe.")
            safe_routes_geojson.append(route_feature)

    # If we found safe direct routes, include them in the all_routes list
    if safe_routes_geojson:
        return jsonify(
            {
                "message": f"Found {len(safe_routes_geojson)} safe direct route(s).",
                "safe_routes": safe_routes_geojson,
                "all_routes": all_routes_geojson,
            }
        )

    # No safe direct routes found, try to find routes with waypoints
    print("No safe direct routes found. Attempting to find routes with waypoints...")

    # Calculate the direct distance to help determine reasonable deviations
    direct_distance = math.sqrt(
        (start_coords[0] - end_coords[0]) ** 2 + (start_coords[1] - end_coords[1]) ** 2
    )

    # Adjust the number of waypoints based on distance
    if direct_distance > 0.2:  # For routes > ~20km
        num_waypoints = 20
    elif direct_distance > 0.1:  # For routes > ~10km
        num_waypoints = 15
    else:
        num_waypoints = 10

    waypoints = generate_waypoints_around_danger_zones(
        start_coords, end_coords, danger_polygons, num_points=num_waypoints
    )

    if not waypoints:
        return jsonify(
            {
                "message": "No safe routes found and couldn't generate waypoints.",
                "safe_routes": [],
                "all_routes": all_routes_geojson,
            }
        )

    print(f"Generated {len(waypoints)} potential waypoints.")

    # Try different combinations of waypoints
    waypoint_combinations = []

    # Start with single waypoints (use all of them)
    for wp in waypoints:
        waypoint_combinations.append([wp])

    # Try pairs of waypoints (limit the combinations to avoid too many API calls)
    # Use a tighter distance constraint to avoid pairs that are too far apart
    max_pair_distance = min(
        direct_distance * 0.3, 0.05
    )  # 30% of direct distance or 5km max
    pairs = []

    for i, wp1 in enumerate(waypoints):
        for j, wp2 in enumerate(waypoints[i + 1 :], i + 1):
            # Calculate distance between waypoints
            dist = math.sqrt((wp1[0] - wp2[0]) ** 2 + (wp1[1] - wp2[1]) ** 2)
            if dist < max_pair_distance:
                pairs.append((i, j, dist))

    # Sort pairs by distance (closest first) and take the top 10
    pairs.sort(key=lambda x: x[2])
    for i, j, _ in pairs[:10]:
        waypoint_combinations.append([waypoints[i], waypoints[j]])

    # Also try strategic triplets for very complex routes (max 3)
    # Only use the closest waypoints to the direct path
    if len(waypoints) >= 3:
        close_waypoints = waypoints[: min(8, len(waypoints))]
        triplets = list(combinations(range(len(close_waypoints)), 3))
        for i, j, k in triplets[:3]:
            waypoint_combinations.append(
                [close_waypoints[i], close_waypoints[j], close_waypoints[k]]
            )

    # Try each waypoint combination
    max_combinations_to_try = 15  # Limit to avoid too many API calls
    for wp_idx, wp_combo in enumerate(waypoint_combinations[:max_combinations_to_try]):
        print(
            f"Trying waypoint combination {wp_idx+1}/{min(max_combinations_to_try, len(waypoint_combinations))}: {wp_combo}"
        )
        waypoint_route_data = find_routes(start_coords, end_coords, wp_combo)

        if not waypoint_route_data or "routes" not in waypoint_route_data:
            continue

        for i, route in enumerate(waypoint_route_data["routes"]):
            path_coords = route["geometry"]["coordinates"]

            # Ensure route starts and ends at the exact locations
            path_coords = ensure_valid_route(path_coords, start_coords, end_coords)
            path_line = LineString(path_coords)

            # Generate a unique ID for this route
            route_id = str(uuid.uuid4())

            is_safe = True
            for danger_zone in danger_polygons:
                if path_line.intersects(danger_zone):
                    is_safe = False
                    print(f"Waypoint route {wp_idx+1}-{i+1} intersects a danger zone.")
                    break

            # Create a GeoJSON Feature for the route
            route_feature = {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": path_coords},
                "properties": {
                    "id": route_id,
                    "distance_km": route.get("distance", 0) / 1000,
                    "duration_min": route.get("duration", 0) / 60,
                    "route_index": len(all_routes_geojson) + 1,
                    "route_type": "waypoint",
                    "waypoints": [[float(wp[0]), float(wp[1])] for wp in wp_combo],
                    "is_safe": is_safe,
                    "visible": True,  # Default to visible
                },
            }

            all_routes_geojson.append(route_feature)

            if is_safe:
                print(f"Waypoint route {wp_idx+1}-{i+1} is safe.")
                safe_routes_geojson.append(route_feature)

            # If we found enough safe routes, we can return them
            if len(safe_routes_geojson) >= 3:
                break

        if len(safe_routes_geojson) >= 3:
            break

    # If we still didn't find safe routes, try a last-resort approach
    if not safe_routes_geojson and danger_polygons:
        print("Trying last-resort approach with more focused waypoints...")

        # Calculate a corridor along the direct path that's a bit wider
        corridor_width = min(
            direct_distance * 0.25, 0.05
        )  # 25% of direct distance or 5km, whichever is smaller
        direct_line = LineString([start_coords, end_coords])
        path_corridor = direct_line.buffer(corridor_width)

        # Find the intersection of danger zones with our corridor
        corridor_intersections = []
        for zone in danger_polygons:
            if zone.intersects(path_corridor):
                corridor_intersections.append(zone.intersection(path_corridor))

        if corridor_intersections:
            # Create a unified obstacle within our corridor
            unified_obstacle = unary_union(corridor_intersections)

            # Generate a denser grid of waypoints around the obstacle boundaries
            extra_waypoints = []

            if not unified_obstacle.is_empty:
                # Buffer the obstacle slightly
                buffered_obstacle = unified_obstacle.buffer(0.001)  # ~100m buffer

                # Get the boundary of the buffered obstacle
                boundary = buffered_obstacle.boundary

                # Generate points along the boundary
                if hasattr(boundary, "geoms"):  # MultiLineString case
                    for line in boundary.geoms:
                        coords = list(line.coords)
                        step = max(
                            1, len(coords) // 8
                        )  # Get ~8 points per boundary segment

                        for i in range(0, len(coords), step):
                            if i < len(coords):
                                waypoint = coords[i]
                                # Ensure it's not in a danger zone
                                if not any(
                                    Point(waypoint).within(zone)
                                    for zone in danger_polygons
                                ):
                                    extra_waypoints.append(list(waypoint))
                else:  # LineString case
                    coords = list(boundary.coords)
                    step = max(1, len(coords) // 8)

                    for i in range(0, len(coords), step):
                        if i < len(coords):
                            waypoint = coords[i]
                            # Ensure it's not in a danger zone
                            if not any(
                                Point(waypoint).within(zone) for zone in danger_polygons
                            ):
                                extra_waypoints.append(list(waypoint))

            # Filter waypoints to only include those on roads
            extra_waypoints = filter_road_waypoints(extra_waypoints)

            # If we got some waypoints, try them in pairs
            if len(extra_waypoints) >= 2:
                # Try a few combinations of these focused waypoints
                last_resort_combos = []

                # Try pairs
                for i in range(min(4, len(extra_waypoints))):
                    for j in range(i + 1, min(i + 3, len(extra_waypoints))):
                        last_resort_combos.append(
                            [extra_waypoints[i], extra_waypoints[j]]
                        )

                # Try up to 5 combinations
                for wp_idx, wp_combo in enumerate(last_resort_combos[:5]):
                    print(
                        f"Trying last-resort waypoint combination {wp_idx+1}: {wp_combo}"
                    )
                    waypoint_route_data = find_routes(
                        start_coords, end_coords, wp_combo
                    )

                    if not waypoint_route_data or "routes" not in waypoint_route_data:
                        continue

                    for i, route in enumerate(waypoint_route_data["routes"]):
                        path_coords = route["geometry"]["coordinates"]
                        path_coords = ensure_valid_route(
                            path_coords, start_coords, end_coords
                        )
                        path_line = LineString(path_coords)

                        route_id = str(uuid.uuid4())
                        is_safe = True

                        for danger_zone in danger_polygons:
                            if path_line.intersects(danger_zone):
                                is_safe = False
                                break

                        route_feature = {
                            "type": "Feature",
                            "geometry": {
                                "type": "LineString",
                                "coordinates": path_coords,
                            },
                            "properties": {
                                "id": route_id,
                                "distance_km": route.get("distance", 0) / 1000,
                                "duration_min": route.get("duration", 0) / 60,
                                "route_index": len(all_routes_geojson) + 1,
                                "route_type": "focused",
                                "waypoints": [
                                    [float(wp[0]), float(wp[1])] for wp in wp_combo
                                ],
                                "is_safe": is_safe,
                                "visible": True,
                            },
                        }

                        all_routes_geojson.append(route_feature)

                        if is_safe:
                            print(f"Focused route {wp_idx+1}-{i+1} is safe.")
                            safe_routes_geojson.append(route_feature)

                            if len(safe_routes_geojson) >= 3:
                                break

                    if len(safe_routes_geojson) >= 3:
                        break

    if not safe_routes_geojson:
        return jsonify(
            {
                "message": "No safe routes found even with waypoints.",
                "safe_routes": [],
                "all_routes": all_routes_geojson,
            }
        )
    else:
        return jsonify(
            {
                "message": f"Found {len(safe_routes_geojson)} safe route(s) using waypoints.",
                "safe_routes": safe_routes_geojson,
                "all_routes": all_routes_geojson,
            }
        )


@app.route("/api/toggle_route_visibility", methods=["POST"])
def toggle_route_visibility():
    """API endpoint to toggle route visibility."""
    data = request.json
    route_id = data.get("route_id")
    visible = data.get("visible")

    if route_id is None or visible is None:
        return jsonify({"error": "Route ID and visibility flag are required."}), 400

    # In a real application, you would store and retrieve route data from a database
    # Since we're not using a database here, the client will need to manage state
    return jsonify({"success": True, "route_id": route_id, "visible": visible})


if __name__ == "__main__":
    app.run(debug=True)  # Runs on http://127.0.0.1:5000 by default
