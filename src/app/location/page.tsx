'use client';

import React, { useState, useEffect, useRef } from 'react';
// No longer need type import or direct programmatic import attempts here

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 'YOUR_MAPBOX_ACCESS_TOKEN';

// Define interface for Mapbox Custom Event Detail
interface MapboxRetrieveEventDetail {
    features: any[];
    // Add other properties if needed based on the actual event structure
}

export default function LocationPage() {
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState<string>(''); // Keep for potential display or prefill
  const [geocodedCoords, setGeocodedCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showMapboxInput, setShowMapboxInput] = useState<boolean>(false);
  // Ref for the custom element
  const mapboxAutofillRef = useRef<HTMLElement | null>(null);

  // Effect for Geolocation
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
        // Only set error if in browser and geolocation is not supported
        if (typeof window !== 'undefined') {
            setError('Geolocation is not supported by your browser.');
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
        let errorMessage = 'Could not determine location automatically.'; // Default user-friendly message
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
    let scriptElement: HTMLScriptElement | null = null;
    let isMounted = true; // Flag to prevent state updates on unmounted component
    const handleRetrieveEvent = (event: Event) => {
        if (!isMounted) return;
        // Type assertion for custom event
        const customEvent = event as CustomEvent<MapboxRetrieveEventDetail>;
        handleRetrieve(customEvent.detail); // Pass the detail to your existing handler
    };

    const attachListener = () => {
        const element = mapboxAutofillRef.current;
        if (element) {
            (element as HTMLElement).addEventListener('retrieve', handleRetrieveEvent);
            console.log('Retrieve event listener attached to mapbox-address-autofill');
        }
    };

    const cleanup = () => {
        isMounted = false;
        const element = mapboxAutofillRef.current;
        if (element) {
            (element as HTMLElement).removeEventListener('retrieve', handleRetrieveEvent);
            console.log('Retrieve event listener removed.');
        }
        // Optional: Remove the script tag itself if desired, though not strictly necessary
        // if (scriptElement && scriptElement.parentNode) {
        //     scriptElement.parentNode.removeChild(scriptElement);
        //     console.log('Mapbox script tag removed.');
        // }
    };

    if (typeof window !== 'undefined' && showMapboxInput && MAPBOX_ACCESS_TOKEN !== 'YOUR_MAPBOX_ACCESS_TOKEN') {
      const scriptId = 'mapbox-search-js';
      const existingScript = document.getElementById(scriptId) as HTMLScriptElement;

      if (!existingScript) {
        scriptElement = document.createElement('script');
        scriptElement.id = scriptId;
        scriptElement.src = `https://api.mapbox.com/search-js/v1.0.0/web.js?access_token=${MAPBOX_ACCESS_TOKEN}`;
        scriptElement.async = false; // Set async to false
        scriptElement.onload = () => {
          console.log('Mapbox Search JS Web script loaded.');
          // Ensure component is still mounted before attaching listener
          if (isMounted) {
            attachListener();
          }
        };
        scriptElement.onerror = () => {
          console.error('Failed to load Mapbox Search JS Web script.');
          if (isMounted) {
            setError('Failed to load address search functionality.');
          }
        };
        document.body.appendChild(scriptElement);
      } else {
        // If script exists, assume it's loaded or will load, attach listener directly
        // We might need a more robust way to check if a pre-existing script has loaded
        console.log('Mapbox script tag already exists. Attaching listener.');
        attachListener(); 
      }
    }

    // Return the single cleanup function
    return cleanup;

  }, [showMapboxInput]); // Rerun when the input field should be shown

  // handleRetrieve function remains the same, receives detail from custom event
  const handleRetrieve = (detail: MapboxRetrieveEventDetail) => {
    const feature = detail?.features?.[0];
    if (feature && feature.geometry && feature.geometry.coordinates) {
      const [longitude, latitude] = feature.geometry.coordinates;
      setGeocodedCoords({ latitude, longitude });
      setManualAddress(feature.properties.full_address || '');
      console.log('Geocoded Coords:', { latitude, longitude });
      setError(null); // Clear previous errors if geocoding is successful
    } else {
      console.warn('Retrieve event did not contain expected feature data:', detail);
    }
  };

  // No longer needed for input value, but might keep if displaying selected address elsewhere
  // const handleAddressChange = (event: React.ChangeEvent<HTMLInputElement>) => { ... };

  const handleSubmit = () => {
    const coordsToUse = geocodedCoords || location;
    if (coordsToUse) {
        console.log('Submitting location:', coordsToUse);
        // TODO: Implement actual submission logic (e.g., API call, navigation)
        alert(`Location submitted: Lat: ${coordsToUse.latitude.toFixed(6)}, Lng: ${coordsToUse.longitude.toFixed(6)}`);
    } else {
        console.log('No location data to submit.');
        alert('Please select an address or allow location access.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center text-gray-800">Your Location</h1>

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
          <form onSubmit={(e) => {e.preventDefault(); handleSubmit();}} className="mt-4">
            <p className="text-gray-600 mb-4">
              We couldn't automatically detect your location. Please enter your address:
            </p>
            
            {MAPBOX_ACCESS_TOKEN !== 'YOUR_MAPBOX_ACCESS_TOKEN' ? (
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
                <div className="text-red-600 mt-2 text-sm">Mapbox Access Token not configured. Address search disabled.</div>
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
              className={`mt-6 w-full bg-blue-600 text-white py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${!(geocodedCoords || location) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'}`}
              disabled={!(geocodedCoords || location)}
            >
              Use this location
            </button>
          </form>
        )}

        {!location && !showMapboxInput && (
          <div className="text-center text-gray-600">
            <p>Attempting to detect your location...</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Add TypeScript declaration for the custom element to avoid JSX errors
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'mapbox-address-autofill': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
} 