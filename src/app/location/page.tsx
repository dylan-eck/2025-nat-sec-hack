"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

// Types matching backend API for Zones and Pathfinding
interface Coordinate {
  longitude: number;
  latitude: number;
}

interface PolygonInput {
  coordinates: [number, number][];
}

interface ZonesData {
  exclusion: PolygonInput[];
  safe: PolygonInput[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080";
const MAPBOX_ACCESS_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "YOUR_MAPBOX_ACCESS_TOKEN";

export default function LocationPage() {
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState<string>(""); // Keep for potential display or prefill
  const [geocodedCoords, setGeocodedCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [showMapboxInput, setShowMapboxInput] = useState<boolean>(false);
  // Ref for the custom element
  const mapboxAutofillRef = useRef<HTMLElement | null>(null);

  const [savedZones, setSavedZones] = useState<ZonesData | null>(null);
  const [isLoadingZones, setIsLoadingZones] = useState<boolean>(true);
  const [isFindingPath, setIsFindingPath] = useState<boolean>(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [googleMapsUrl, setGoogleMapsUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      // Only set error if in browser and geolocation is not supported
      if (typeof window !== "undefined") {
        setError("Geolocation is not supported by your browser.");
        setShowMapboxInput(true);
      }
      return; // Exit if not in browser or no geolocation
    }

    const handleSuccess = (position: GeolocationPosition) => {
      setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setError(null);
      setShowMapboxInput(false);
    };

    const handleError = (error: GeolocationPositionError) => {
      // Updated error handling for timeout
      let errorMessage = "Could not determine location automatically."; // Default user-friendly message
      if (error.code !== error.TIMEOUT) {
        // Use specific message for other errors if desired, or keep generic
        // errorMessage = `Unable to retrieve location: ${error.message}`;
      }
      setError(errorMessage);
      setShowMapboxInput(true);
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  }, []);

  // Effect to load Mapbox script and attach event listener to custom element
  useEffect(() => {
    const loadZones = async () => {
      setIsLoadingZones(true);
      setPathError(null);
      try {
        const response = await fetch(`${API_URL}/load_zones`);
        const data: any = await response.json(); // Get response body regardless of status

        if (!response.ok) {
          // Attempt to get detail from error response body, else use generic message
          const errorDetail =
            data?.detail ||
            `Failed to load saved zones (Status: ${response.status})`;
          throw new Error(errorDetail);
        }

        // If response IS ok, assume data matches ZonesData
        setSavedZones(data as ZonesData);
        console.log("Saved zones loaded on location page:", data);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "An unknown error occurred";
        setError(`Failed to load zones: ${message}`);
        setSavedZones(null);
      } finally {
        setIsLoadingZones(false);
      }
    };
    loadZones();
  }, []);

  const handleFindPath = useCallback(async () => {
    const startPoint = location || geocodedCoords;

    if (!startPoint) {
      setPathError("Cannot find path: Your location is not determined yet.");
      return;
    }

    if (isLoadingZones) {
      setPathError("Cannot find path: Still loading saved zones. Please wait.");
      return;
    }

    if (!savedZones || savedZones.safe.length === 0) {
      setPathError(
        "Cannot find path: No saved safe zones found. Please define safe zones on the main map page and save them."
      );
      return;
    }

    setIsFindingPath(true);
    setPathError(null);
    setGoogleMapsUrl(null);

    const requestBody = {
      start_point: startPoint,
      exclusion_zones: savedZones.exclusion,
      safe_zones: savedZones.safe,
    };

    try {
      console.log("Sending path request from location page:", requestBody);
      const response = await fetch(`${API_URL}/find_path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (!response.ok || !result.path_found) {
        throw new Error(result.message || "Failed to find path");
      }

      console.log("Path found (length):", result.path?.length);

      try {
        // Check if path is valid before generating link
        if (!result.path || result.path.length < 2) {
          throw new Error("Received invalid path data from API");
        }
        const mapsUrl = generateGoogleMapsRouteLink(result.path);
        setGoogleMapsUrl(mapsUrl);
        console.log("Google Maps URL:", mapsUrl);
      } catch (urlError: unknown) {
        console.error("Error generating Google Maps URL:", urlError);
        // Optionally set a specific error state for URL generation failure
        // setPathError("Path found, but couldn't generate map link.");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "An unknown error occurred during pathfinding.";
      console.error("Pathfinding error:", err);
      setPathError(message);
      setGoogleMapsUrl(null); // Ensure URL is cleared on error
    } finally {
      setIsFindingPath(false);
    }
  }, [location, geocodedCoords, savedZones, isLoadingZones]);

  useEffect(() => {
    const startPoint = location || geocodedCoords;
    // Trigger find path only when:
    // 1. We have a start point (location or geocoded)
    // 2. Zones are loaded (not loading and not null)
    // 3. We aren't already finding a path
    // 4. We haven't already found a path (check googleMapsUrl to prevent re-triggering)
    if (
      startPoint &&
      !isLoadingZones &&
      savedZones &&
      !isFindingPath &&
      !googleMapsUrl
    ) {
      console.log("Auto-triggering find path...");
      handleFindPath();
    }
  }, [
    location,
    geocodedCoords,
    savedZones,
    isLoadingZones,
    isFindingPath,
    googleMapsUrl,
    handleFindPath,
  ]);

  const handleGeocode = async () => {
    if (!manualAddress) {
      setError("Please enter an address to geocode.");
      return;
    }
    setError(null);
    setGeocodedCoords(null);

    try {
      const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
      if (!accessToken) {
        throw new Error("Mapbox Access Token is not configured.");
      }
      const query = encodeURIComponent(manualAddress);
      const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${accessToken}&limit=1`;

      const response = await fetch(geocodeUrl);
      const data = await response.json();

      if (data && data.features && data.features.length > 0) {
        const [longitude, latitude] = data.features[0].center;
        setGeocodedCoords({ latitude, longitude });
        setLocation(null);
        setShowMapboxInput(false);
      } else {
        throw new Error("Address not found.");
      }
    } catch (err) {
      setError(
        `Geocoding Error: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
      setGeocodedCoords(null);
    }
  };

  const generateGoogleMapsRouteLink = (points: [number, number][]): string => {
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error("Need at least 2 points to create a route");
    }

    // API returns [longitude, latitude], Google Maps needs [latitude, longitude]
    const formatCoord = (point: [number, number]): string =>
      `${point[1]},${point[0]}`;

    const origin = formatCoord(points[0]);
    const destination = formatCoord(points[points.length - 1]);

    const waypoints = points.slice(1, -1).map(formatCoord).join("|");

    let url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(destination)}`;

    if (waypoints) {
      url += `&waypoints=${encodeURIComponent(waypoints)}`;
    }

    return url;
  };

  const currentLocationString = location
    ? `Lat: ${location.latitude.toFixed(5)}, Lon: ${location.longitude.toFixed(
        5
      )} (Geolocation)`
    : geocodedCoords
    ? `Lat: ${geocodedCoords.latitude.toFixed(
        5
      )}, Lon: ${geocodedCoords.longitude.toFixed(5)} (Geocoded)`
    : "Determining location...";

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center text-gray-800">
          Your Location
        </h1>

        {location && (
          <div className="mb-4 p-4 bg-green-100 border border-green-300 rounded text-green-800">
            <p className="font-semibold">Location Found:</p>
            <p>Latitude: {location.latitude.toFixed(6)}</p>
            <p>Longitude: {location.longitude.toFixed(6)}</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-100 border border-red-300 rounded text-red-700">
            <p className="font-semibold">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {showMapboxInput && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="mt-4"
          >
            <p className="text-gray-600 mb-4">
              We couldn't automatically detect your location. Please enter your
              address:
            </p>

            {MAPBOX_ACCESS_TOKEN !== "YOUR_MAPBOX_ACCESS_TOKEN" ? (
              // Use the custom element
              // Note: We need to declare this custom element type for TypeScript
              <mapbox-address-autofill
                ref={mapboxAutofillRef as React.RefObject<HTMLInputElement>}
                access-token={MAPBOX_ACCESS_TOKEN}
              >
                <input
                  name="address"
                  placeholder="Enter your address"
                  autoComplete="address-line1" // Standard autocomplete helps, Mapbox enhances
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  // value={manualAddress} // Input value is controlled by the custom element
                  // onChange={handleAddressChange} // Change is handled by the custom element
                />
              </mapbox-address-autofill>
            ) : (
              <div className="text-red-600 mt-2 text-sm">
                Mapbox Access Token not configured. Address search disabled.
              </div>
            )}

            {/* Geocoded Result Display */}
            {geocodedCoords && (
              <div className="mt-4 p-3 bg-blue-100 border border-blue-300 rounded text-blue-800">
                <p className="font-semibold">Geocoded Location:</p>
                <p>Latitude: {geocodedCoords.latitude.toFixed(6)}</p>
                <p>Longitude: {geocodedCoords.longitude.toFixed(6)}</p>
              </div>
            )}

            {/* Submit Button - enabled only if we have coords */}
            <button
              type="submit"
              className={`mt-6 w-full bg-blue-600 text-white py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                !(geocodedCoords || location)
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-blue-700"
              }`}
              disabled={!(geocodedCoords || location)}
            >
              Use this location
            </button>
          </form>
        )}

        {/* --- Pathfinding Section --- */}
        <div
          style={{
            marginTop: "30px",
            borderTop: "1px solid #eee",
            paddingTop: "20px",
          }}
        >
          <h2>Route to Safety</h2>
          {isLoadingZones && <p>Loading saved zone data...</p>}
          {isFindingPath && <p>Calculating route...</p>}
          {pathError && <p style={{ color: "red" }}>Error: {pathError}</p>}

          {!(location || geocodedCoords) && !error && !isLoadingZones && (
            <p>Waiting for location to be determined...</p>
          )}
          {savedZones &&
            !isLoadingZones &&
            !isFindingPath &&
            !googleMapsUrl &&
            !pathError && (
              <p style={{ fontSize: "12px", color: "#555", marginTop: "10px" }}>
                Ready to find path using {savedZones.exclusion.length} exclusion
                zone(s) and {savedZones.safe.length} safe zone(s).
              </p>
            )}

          {googleMapsUrl && (
            <div style={{ marginTop: "15px" }}>
              <p style={{ marginBottom: "10px", color: "green" }}>
                Route found!
              </p>
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  padding: "10px 15px",
                  backgroundColor: "#1a73e8", // Google Blue
                  color: "white",
                  textDecoration: "none",
                  borderRadius: "4px",
                  fontWeight: "bold",
                }}
              >
                Open Route in Google Maps
              </a>
            </div>
          )}
        </div>
        {/* --- END Pathfinding SECTION --- */}
      </div>
    </div>
  );
}

// Add TypeScript declaration for the custom element to avoid JSX errors
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "mapbox-address-autofill": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
