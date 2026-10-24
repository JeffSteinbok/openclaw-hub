import MCP

public enum MapKitTools {
    /// Lookups against Apple Maps: no side effects.
    static let lookup = Tool.Annotations(readOnlyHint: true, openWorldHint: true)
    /// mapSnapshot can write a new PNG (saveToFile) but never changes anything else.
    static let rendersImage = Tool.Annotations(readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true)

    static let geocode = Tool(
        name: "geocode",
        description: "Geocode an address to get its coordinates (latitude and longitude)",
        inputSchema: .object([
            "type": "object",
            "properties": .object([
                "address": .object([
                    "type": "string",
                    "description": "The address to geocode (e.g., \"1 Apple Park Way, Cupertino, CA\")"
                ])
            ]),
            "required": .array(["address"])
        ]),
        annotations: lookup
    )

    static let reverseGeocode = Tool(
        name: "reverseGeocode",
        description: "Reverse geocode coordinates to get the address at that location",
        inputSchema: .object([
            "type": "object",
            "properties": .object([
                "latitude": .object([
                    "type": "number",
                    "description": "The latitude coordinate"
                ]),
                "longitude": .object([
                    "type": "number",
                    "description": "The longitude coordinate"
                ])
            ]),
            "required": .array(["latitude", "longitude"])
        ]),
        annotations: lookup
    )

    static let searchPlaces = Tool(
        name: "searchPlaces",
        description: "Search for places or points of interest near a location",
        inputSchema: .object([
            "type": "object",
            "properties": .object([
                "query": .object([
                    "type": "string",
                    "description": "The search query (e.g., \"coffee shops\", \"restaurants\", \"gas stations\")"
                ]),
                "latitude": .object([
                    "type": "number",
                    "description": "The latitude of the center point for the search"
                ]),
                "longitude": .object([
                    "type": "number",
                    "description": "The longitude of the center point for the search"
                ]),
                "radiusMeters": .object([
                    "type": "number",
                    "description": "The search radius in meters (default: 5000, range: 1-50000)"
                ])
            ]),
            "required": .array(["query", "latitude", "longitude"])
        ]),
        annotations: lookup
    )

    static let getDirections = Tool(
        name: "getDirections",
        description: "Get directions between two locations specified by coordinates",
        inputSchema: .object([
            "type": "object",
            "properties": .object([
                "originLatitude": .object([
                    "type": "number",
                    "description": "The latitude of the starting location"
                ]),
                "originLongitude": .object([
                    "type": "number",
                    "description": "The longitude of the starting location"
                ]),
                "destinationLatitude": .object([
                    "type": "number",
                    "description": "The latitude of the destination"
                ]),
                "destinationLongitude": .object([
                    "type": "number",
                    "description": "The longitude of the destination"
                ]),
                "transportType": .object([
                    "type": "string",
                    "description": "The transport type: \"automobile\", \"walking\", or \"transit\" (default: \"automobile\")"
                ]),
                "departAt": .object([
                    "type": "string",
                    "description": "Leave at this ISO 8601 date-time, for a traffic-aware estimate. Omit to leave now. Don't combine with arriveAt."
                ]),
                "arriveAt": .object([
                    "type": "string",
                    "description": "Arrive by this ISO 8601 date-time; the result's departureTime says when to leave. Don't combine with departAt."
                ])
            ]),
            "required": .array(["originLatitude", "originLongitude", "destinationLatitude", "destinationLongitude"])
        ]),
        annotations: lookup
    )

    static let calculateDistance = Tool(
        name: "calculateDistance",
        description: "Calculate the straight-line distance between two coordinates",
        inputSchema: .object([
            "type": "object",
            "properties": .object([
                "latitude1": .object([
                    "type": "number",
                    "description": "Latitude of the first location"
                ]),
                "longitude1": .object([
                    "type": "number",
                    "description": "Longitude of the first location"
                ]),
                "latitude2": .object([
                    "type": "number",
                    "description": "Latitude of the second location"
                ]),
                "longitude2": .object([
                    "type": "number",
                    "description": "Longitude of the second location"
                ])
            ]),
            "required": .array(["latitude1", "longitude1", "latitude2", "longitude2"])
        ]),
        annotations: Tool.Annotations(readOnlyHint: true, openWorldHint: false)
    )

    static let estimateTravelTime = Tool(
        name: "estimateTravelTime",
        description: "Estimate travel time between two locations without detailed step-by-step directions",
        inputSchema: .object([
            "type": "object",
            "properties": .object([
                "originLatitude": .object([
                    "type": "number",
                    "description": "The latitude of the starting location"
                ]),
                "originLongitude": .object([
                    "type": "number",
                    "description": "The longitude of the starting location"
                ]),
                "destinationLatitude": .object([
                    "type": "number",
                    "description": "The latitude of the destination"
                ]),
                "destinationLongitude": .object([
                    "type": "number",
                    "description": "The longitude of the destination"
                ]),
                "transportType": .object([
                    "type": "string",
                    "description": "The transport type: \"automobile\", \"walking\", or \"transit\" (default: \"automobile\")"
                ]),
                "departAt": .object([
                    "type": "string",
                    "description": "Leave at this ISO 8601 date-time, for a traffic-aware estimate. Omit to leave now. Don't combine with arriveAt."
                ]),
                "arriveAt": .object([
                    "type": "string",
                    "description": "Arrive by this ISO 8601 date-time; the result's departureTime says when to leave. Don't combine with departAt."
                ])
            ]),
            "required": .array(["originLatitude", "originLongitude", "destinationLatitude", "destinationLongitude"])
        ]),
        annotations: lookup
    )

    static let getDirectionsByAddress = Tool(
        name: "getDirectionsByAddress",
        description: "Get directions between two locations specified by address strings",
        inputSchema: .object([
            "type": "object",
            "properties": .object([
                "originAddress": .object([
                    "type": "string",
                    "description": "The starting address"
                ]),
                "destinationAddress": .object([
                    "type": "string",
                    "description": "The destination address"
                ]),
                "transportType": .object([
                    "type": "string",
                    "description": "The transport type: \"automobile\", \"walking\", or \"transit\" (default: \"automobile\")"
                ]),
                "departAt": .object([
                    "type": "string",
                    "description": "Leave at this ISO 8601 date-time, for a traffic-aware estimate. Omit to leave now. Don't combine with arriveAt."
                ]),
                "arriveAt": .object([
                    "type": "string",
                    "description": "Arrive by this ISO 8601 date-time; the result's departureTime says when to leave. Don't combine with departAt."
                ])
            ]),
            "required": .array(["originAddress", "destinationAddress"])
        ]),
        annotations: lookup
    )

    static let mapSnapshot = Tool(
        name: "mapSnapshot",
        description: "Render a static map image, optionally with labeled pins. Centers on latitude/longitude, or fits all pins when those are omitted. Set saveToFile to get a PNG path to attach to a message.",
        inputSchema: .object([
            "type": "object",
            "properties": .object([
                "latitude": .object([
                    "type": "number",
                    "description": "The latitude of the center point (omit to fit the pins)"
                ]),
                "longitude": .object([
                    "type": "number",
                    "description": "The longitude of the center point (omit to fit the pins)"
                ]),
                "spanDelta": .object([
                    "type": "number",
                    "description": "The span in degrees for the visible region (default: 0.01; the minimum span when fitting pins)"
                ]),
                "width": .object([
                    "type": "integer",
                    "description": "Image width in pixels (1-2048, default: 512)"
                ]),
                "height": .object([
                    "type": "integer",
                    "description": "Image height in pixels (1-2048, default: 512)"
                ]),
                "mapType": .object([
                    "type": "string",
                    "description": "Map type: \"standard\", \"satellite\", \"hybrid\", or \"mutedStandard\" (default: \"standard\")"
                ]),
                "pins": .object([
                    "type": "array",
                    "description": "Markers to draw on the map",
                    "items": .object([
                        "type": "object",
                        "properties": .object([
                            "latitude": .object(["type": "number"]),
                            "longitude": .object(["type": "number"]),
                            "label": .object(["type": "string", "description": "Text shown next to the pin"])
                        ]),
                        "required": .array(["latitude", "longitude"])
                    ])
                ]),
                "saveToFile": .object([
                    "type": "boolean",
                    "description": "Write the PNG to disk and return its path instead of the inline image (default: false)"
                ])
            ])
        ]),
        annotations: rendersImage
    )

    static let searchByCategory = Tool(
        name: "searchByCategory",
        description: "Search for points of interest by category near a location (no natural language query needed)",
        inputSchema: .object([
            "type": "object",
            "properties": .object([
                "category": .object([
                    "type": "string",
                    "description": "The POI category (e.g., \"cafe\", \"restaurant\", \"park\", \"hospital\")"
                ]),
                "latitude": .object([
                    "type": "number",
                    "description": "The latitude of the center point for the search"
                ]),
                "longitude": .object([
                    "type": "number",
                    "description": "The longitude of the center point for the search"
                ]),
                "radiusMeters": .object([
                    "type": "number",
                    "description": "The search radius in meters (default: 5000, range: 1-50000)"
                ])
            ]),
            "required": .array(["category", "latitude", "longitude"])
        ]),
        annotations: lookup
    )

    public static let all: [Tool] = [
        geocode,
        reverseGeocode,
        searchPlaces,
        getDirections,
        calculateDistance,
        estimateTravelTime,
        getDirectionsByAddress,
        mapSnapshot,
        searchByCategory,
    ]
}
