import Foundation
import MapKit
import MCP

// MARK: - Validation Errors

public enum MapKitError: LocalizedError, Sendable {
    case emptyAddress
    case invalidLatitude(Double)
    case invalidLongitude(Double)
    case invalidRadius(Double)
    case emptyQuery
    case invalidSnapshotSize(Int, Int)
    case invalidCategory(String)
    case invalidTime(String, String)
    case conflictingTimes
    case invalidPins
    case missingCenter

    public var errorDescription: String? {
        switch self {
        case .emptyAddress:
            return "Address must not be empty"
        case .invalidLatitude(let lat):
            return "Latitude \(lat) is out of range [-90, 90]"
        case .invalidLongitude(let lng):
            return "Longitude \(lng) is out of range [-180, 180]"
        case .invalidRadius(let r):
            return "Radius \(r) is out of range [1, 50000]"
        case .emptyQuery:
            return "Search query must not be empty"
        case .invalidSnapshotSize(let w, let h):
            return "Snapshot size \(w)x\(h) is invalid. Width and height must be between 1 and 2048."
        case .invalidCategory(let cat):
            return "Unknown category \"\(cat)\". Valid categories: \(validCategoryNames.joined(separator: ", "))"
        case .invalidTime(let name, let value):
            return "\(name) \"\(value)\" is not an ISO 8601 date-time (e.g. \"2026-10-24T17:30:00-07:00\")"
        case .conflictingTimes:
            return "Pass departAt or arriveAt, not both"
        case .invalidPins:
            return "pins must be an array of objects with numeric latitude and longitude"
        case .missingCenter:
            return "Pass latitude and longitude, or at least one pin to center the map on"
        }
    }
}

// MARK: - Validation Helpers

public func validateCoordinate(latitude: Double, longitude: Double) throws {
    guard (-90...90).contains(latitude) else {
        throw MapKitError.invalidLatitude(latitude)
    }
    guard (-180...180).contains(longitude) else {
        throw MapKitError.invalidLongitude(longitude)
    }
}

public func validateAddress(_ address: String) throws {
    guard !address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw MapKitError.emptyAddress
    }
}

public func validateQuery(_ query: String) throws {
    guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw MapKitError.emptyQuery
    }
}

public func validateRadius(_ radius: Double) throws {
    guard (1...50_000).contains(radius) else {
        throw MapKitError.invalidRadius(radius)
    }
}

public func validateSnapshotSize(width: Int, height: Int) throws {
    guard (1...2048).contains(width) && (1...2048).contains(height) else {
        throw MapKitError.invalidSnapshotSize(width, height)
    }
}

// MARK: - Number Arguments

extension Value {
    /// A JSON number either way it decoded: `47` arrives as an int, `47.6` as a double.
    public var numberValue: Double? {
        switch self {
        case .double(let value): return value
        case .int(let value): return Double(value)
        default: return nil
        }
    }

    /// An integer argument, also accepting a whole double such as `640.0`.
    public var wholeNumberValue: Int? {
        switch self {
        case .int(let value): return value
        case .double(let value) where value.rounded() == value && abs(value) < Double(Int.max): return Int(value)
        default: return nil
        }
    }
}

// MARK: - Trip Time Parsing

/// When a trip leaves or must arrive. MapKit uses it for traffic-aware estimates.
public enum TripTime: Equatable, Sendable {
    case departAt(Date)
    case arriveAt(Date)
}

public func parseISODate(_ value: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return ISO8601DateFormatter().date(from: value) ?? withFraction.date(from: value)
}

public func formatISODate(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.timeZone = .current
    return formatter.string(from: date)
}

public func parseTripTime(_ arguments: [String: Value]?) throws -> TripTime? {
    let departAt = arguments?["departAt"]?.stringValue
    let arriveAt = arguments?["arriveAt"]?.stringValue
    if departAt != nil && arriveAt != nil {
        throw MapKitError.conflictingTimes
    }
    if let departAt {
        guard let date = parseISODate(departAt) else { throw MapKitError.invalidTime("departAt", departAt) }
        return .departAt(date)
    }
    if let arriveAt {
        guard let date = parseISODate(arriveAt) else { throw MapKitError.invalidTime("arriveAt", arriveAt) }
        return .arriveAt(date)
    }
    return nil
}

private func apply(_ tripTime: TripTime?, to request: MKDirections.Request) {
    switch tripTime {
    case .departAt(let date): request.departureDate = date
    case .arriveAt(let date): request.arrivalDate = date
    case nil: break
    }
}

/// Departure and arrival times for a trip, given its travel time.
public func tripSchedule(_ tripTime: TripTime?, travelTime: TimeInterval) -> (departure: String?, arrival: String?) {
    switch tripTime {
    case .departAt(let date):
        return (formatISODate(date), formatISODate(date.addingTimeInterval(travelTime)))
    case .arriveAt(let date):
        return (formatISODate(date.addingTimeInterval(-travelTime)), formatISODate(date))
    case nil:
        return (nil, nil)
    }
}

// MARK: - Map Pins

public struct MapPin: Equatable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let label: String?
}

public func parsePins(_ value: Value?) throws -> [MapPin] {
    guard let value else { return [] }
    guard let items = value.arrayValue else { throw MapKitError.invalidPins }
    return try items.map { item in
        guard let object = item.objectValue,
              let latitude = object["latitude"]?.numberValue,
              let longitude = object["longitude"]?.numberValue else {
            throw MapKitError.invalidPins
        }
        try validateCoordinate(latitude: latitude, longitude: longitude)
        let label = object["label"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        return MapPin(latitude: latitude, longitude: longitude, label: label?.isEmpty == false ? label : nil)
    }
}

/// The region a snapshot shows: around the given center, or around all pins when there is none.
public func snapshotRegion(
    latitude: Double?,
    longitude: Double?,
    spanDelta: Double?,
    pins: [MapPin]
) throws -> MKCoordinateRegion {
    if let latitude, let longitude {
        try validateCoordinate(latitude: latitude, longitude: longitude)
        let span = spanDelta ?? 0.01
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)
        )
    }
    guard !pins.isEmpty else { throw MapKitError.missingCenter }
    let lats = pins.map(\.latitude)
    let lngs = pins.map(\.longitude)
    let center = CLLocationCoordinate2D(
        latitude: (lats.min()! + lats.max()!) / 2,
        longitude: (lngs.min()! + lngs.max()!) / 2
    )
    // Pad the pins' bounding box so markers aren't drawn on the edge.
    let latSpan = max((lats.max()! - lats.min()!) * 1.4, spanDelta ?? 0.01)
    let lngSpan = max((lngs.max()! - lngs.min()!) * 1.4, spanDelta ?? 0.01)
    return MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: latSpan, longitudeDelta: lngSpan))
}

private func drawPins(_ pins: [MapPin], on snapshot: MKMapSnapshotter.Snapshot) -> NSImage {
    let image = snapshot.image
    guard !pins.isEmpty else { return image }
    image.lockFocus()
    defer { image.unlockFocus() }
    let labelAttributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.boldSystemFont(ofSize: 13),
        .foregroundColor: NSColor.black,
    ]
    for pin in pins {
        let point = snapshot.point(for: CLLocationCoordinate2D(latitude: pin.latitude, longitude: pin.longitude))
        let radius: CGFloat = 8
        let marker = NSBezierPath(ovalIn: NSRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
        NSColor.systemRed.setFill()
        marker.fill()
        NSColor.white.setStroke()
        marker.lineWidth = 2.5
        marker.stroke()
        guard let label = pin.label else { continue }
        let text = NSAttributedString(string: label, attributes: labelAttributes)
        let size = text.size()
        let box = NSRect(x: point.x + radius + 4, y: point.y - size.height / 2 - 2, width: size.width + 8, height: size.height + 4)
        NSColor.white.withAlphaComponent(0.85).setFill()
        NSBezierPath(roundedRect: box, xRadius: 4, yRadius: 4).fill()
        text.draw(at: NSPoint(x: box.minX + 4, y: box.minY + 2))
    }
    return image
}

/// Where saved snapshots go: MAPKIT_OUTPUT_DIR, else OpenClaw's outbound media
/// folder (so the agent can attach them), else the temp directory.
private func snapshotOutputDirectory() throws -> URL {
    let fileManager = FileManager.default
    let directory: URL
    if let path = ProcessInfo.processInfo.environment["MAPKIT_OUTPUT_DIR"], !path.isEmpty {
        directory = URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
    } else {
        let openclawMedia = fileManager.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/media", isDirectory: true)
        directory = fileManager.fileExists(atPath: openclawMedia.path)
            ? openclawMedia.appendingPathComponent("outbound/maps", isDirectory: true)
            : fileManager.temporaryDirectory.appendingPathComponent("mapkit-mcp", isDirectory: true)
    }
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}

// MARK: - Transport Type Parsing

private func parseTransportType(_ value: String?) -> MKDirectionsTransportType {
    switch value?.lowercased() {
    case "walking": return .walking
    case "transit": return .transit
    default: return .automobile
    }
}

// MARK: - POI Category Mapping

public let validCategoryNames: [String] = [
    "airport", "atm", "bakery", "bank", "beach", "brewery", "cafe", "campground",
    "carRental", "evCharging", "fireStation", "fitness", "foodMarket", "gasStation",
    "hospital", "hotel", "laundry", "library", "marina", "museum", "nationalPark",
    "nightlife", "park", "parking", "pharmacy", "police", "postOffice", "publicTransport",
    "restaurant", "school", "stadium", "store", "theater", "university", "winery", "zoo",
]

public func mapCategory(_ name: String) throws -> MKPointOfInterestCategory {
    switch name.lowercased() {
    case "airport": return .airport
    case "atm": return .atm
    case "bakery": return .bakery
    case "bank": return .bank
    case "beach": return .beach
    case "brewery": return .brewery
    case "cafe": return .cafe
    case "campground": return .campground
    case "carrental": return .carRental
    case "evcharging": return .evCharger
    case "firestation": return .fireStation
    case "fitness": return .fitnessCenter
    case "foodmarket": return .foodMarket
    case "gasstation": return .gasStation
    case "hospital": return .hospital
    case "hotel": return .hotel
    case "laundry": return .laundry
    case "library": return .library
    case "marina": return .marina
    case "museum": return .museum
    case "nationalpark": return .nationalPark
    case "nightlife": return .nightlife
    case "park": return .park
    case "parking": return .parking
    case "pharmacy": return .pharmacy
    case "police": return .police
    case "postoffice": return .postOffice
    case "publictransport": return .publicTransport
    case "restaurant": return .restaurant
    case "school": return .school
    case "stadium": return .stadium
    case "store": return .store
    case "theater": return .theater
    case "university": return .university
    case "winery": return .winery
    case "zoo": return .zoo
    default: throw MapKitError.invalidCategory(name)
    }
}

// MARK: - Place Lookup

/// Finds a place by address or name. MapKit's place search knows landmarks and
/// businesses that CLGeocoder misplaces (it put "Space Needle, Seattle" on
/// Bainbridge Island), so it goes first; the geocoder is the fallback.
private func lookUpPlace(_ query: String) async throws -> CLPlacemark? {
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query
    if let item = try? await MKLocalSearch(request: request).start().mapItems.first {
        return item.placemark
    }
    do {
        return try await CLGeocoder().geocodeAddressString(query).first
    } catch let error as CLError where error.code == .geocodeFoundNoResult {
        return nil
    }
}

// MARK: - Tool Implementations

private func geocode(arguments: [String: Value]?) async throws -> String {
    let address = arguments?["address"]?.stringValue ?? ""
    try validateAddress(address)

    guard let placemark = try await lookUpPlace(address),
          let location = placemark.location else {
        return "{\"error\": \"No results found for address\"}"
    }

    let response = GeocodeResponse(
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude,
        name: placemark.name ?? "",
        locality: placemark.locality ?? "",
        administrativeArea: placemark.administrativeArea ?? "",
        country: placemark.country ?? "",
        postalCode: placemark.postalCode ?? "",
        formattedAddress: [
            placemark.name,
            placemark.locality,
            placemark.administrativeArea,
            placemark.postalCode,
            placemark.country
        ].compactMap { $0 }.joined(separator: ", ")
    )

    return try encodeResponse(response)
}

private func reverseGeocode(arguments: [String: Value]?) async throws -> String {
    let latitude = arguments?["latitude"]?.numberValue ?? 0
    let longitude = arguments?["longitude"]?.numberValue ?? 0
    try validateCoordinate(latitude: latitude, longitude: longitude)

    let geocoder = CLGeocoder()
    let location = CLLocation(latitude: latitude, longitude: longitude)
    let placemarks = try await geocoder.reverseGeocodeLocation(location)

    guard let placemark = placemarks.first else {
        return "{\"error\": \"No address found for coordinates\"}"
    }

    let response = ReverseGeocodeResponse(
        name: placemark.name ?? "",
        streetNumber: placemark.subThoroughfare ?? "",
        street: placemark.thoroughfare ?? "",
        locality: placemark.locality ?? "",
        subLocality: placemark.subLocality ?? "",
        administrativeArea: placemark.administrativeArea ?? "",
        subAdministrativeArea: placemark.subAdministrativeArea ?? "",
        country: placemark.country ?? "",
        countryCode: placemark.isoCountryCode ?? "",
        postalCode: placemark.postalCode ?? "",
        formattedAddress: [
            placemark.subThoroughfare,
            placemark.thoroughfare,
            placemark.locality,
            placemark.administrativeArea,
            placemark.postalCode,
            placemark.country
        ].compactMap { $0 }.joined(separator: ", ")
    )

    return try encodeResponse(response)
}

private func searchPlaces(arguments: [String: Value]?) async throws -> String {
    let query = arguments?["query"]?.stringValue ?? ""
    let latitude = arguments?["latitude"]?.numberValue ?? 0
    let longitude = arguments?["longitude"]?.numberValue ?? 0
    let radiusMeters = arguments?["radiusMeters"]?.numberValue ?? 5000

    try validateQuery(query)
    try validateCoordinate(latitude: latitude, longitude: longitude)
    try validateRadius(radiusMeters)

    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query

    let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    let region = MKCoordinateRegion(
        center: center,
        latitudinalMeters: radiusMeters * 2,
        longitudinalMeters: radiusMeters * 2
    )
    request.region = region

    let search = MKLocalSearch(request: request)
    let searchResponse = try await search.start()

    let places = searchResponse.mapItems.map { item in
        PlaceResult(
            name: item.name ?? "",
            latitude: item.placemark.coordinate.latitude,
            longitude: item.placemark.coordinate.longitude,
            phoneNumber: item.phoneNumber,
            url: item.url?.absoluteString,
            address: item.placemark.title,
            category: item.pointOfInterestCategory?.rawValue
        )
    }

    return try encodeResponse(SearchPlacesResponse(results: places, count: places.count))
}

private func getDirections(arguments: [String: Value]?) async throws -> String {
    let originLat = arguments?["originLatitude"]?.numberValue ?? 0
    let originLng = arguments?["originLongitude"]?.numberValue ?? 0
    let destLat = arguments?["destinationLatitude"]?.numberValue ?? 0
    let destLng = arguments?["destinationLongitude"]?.numberValue ?? 0
    let transportType = arguments?["transportType"]?.stringValue
    let tripTime = try parseTripTime(arguments)

    try validateCoordinate(latitude: originLat, longitude: originLng)
    try validateCoordinate(latitude: destLat, longitude: destLng)

    let request = MKDirections.Request()
    request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: originLat, longitude: originLng)))
    request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: destLat, longitude: destLng)))
    request.transportType = parseTransportType(transportType)
    apply(tripTime, to: request)

    let directions = MKDirections(request: request)
    let response = try await directions.calculate()

    guard let route = response.routes.first else {
        return "{\"error\": \"No route found\"}"
    }

    let steps = route.steps.filter { !$0.instructions.isEmpty }.map { step in
        RouteStep(
            instructions: step.instructions,
            distanceMeters: step.distance,
            notice: step.notice ?? ""
        )
    }

    let result = DirectionsResponse(
        distanceMeters: route.distance,
        expectedTravelTimeSeconds: route.expectedTravelTime,
        expectedTravelTimeMinutes: route.expectedTravelTime / 60,
        name: route.name,
        transportType: transportType ?? "automobile",
        departureTime: tripSchedule(tripTime, travelTime: route.expectedTravelTime).departure,
        arrivalTime: tripSchedule(tripTime, travelTime: route.expectedTravelTime).arrival,
        steps: steps
    )

    return try encodeResponse(result)
}

private func calculateDistance(arguments: [String: Value]?) async throws -> String {
    let lat1 = arguments?["latitude1"]?.numberValue ?? 0
    let lng1 = arguments?["longitude1"]?.numberValue ?? 0
    let lat2 = arguments?["latitude2"]?.numberValue ?? 0
    let lng2 = arguments?["longitude2"]?.numberValue ?? 0

    try validateCoordinate(latitude: lat1, longitude: lng1)
    try validateCoordinate(latitude: lat2, longitude: lng2)

    let location1 = CLLocation(latitude: lat1, longitude: lng1)
    let location2 = CLLocation(latitude: lat2, longitude: lng2)
    let distanceMeters = location1.distance(from: location2)

    let result = DistanceResponse(
        distanceMeters: distanceMeters,
        distanceKilometers: distanceMeters / 1000,
        distanceMiles: distanceMeters / 1609.344
    )

    return try encodeResponse(result)
}

private func estimateTravelTime(arguments: [String: Value]?) async throws -> String {
    let originLat = arguments?["originLatitude"]?.numberValue ?? 0
    let originLng = arguments?["originLongitude"]?.numberValue ?? 0
    let destLat = arguments?["destinationLatitude"]?.numberValue ?? 0
    let destLng = arguments?["destinationLongitude"]?.numberValue ?? 0
    let transportType = arguments?["transportType"]?.stringValue
    let tripTime = try parseTripTime(arguments)

    try validateCoordinate(latitude: originLat, longitude: originLng)
    try validateCoordinate(latitude: destLat, longitude: destLng)

    let request = MKDirections.Request()
    request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: originLat, longitude: originLng)))
    request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: destLat, longitude: destLng)))
    request.transportType = parseTransportType(transportType)
    apply(tripTime, to: request)

    let directions = MKDirections(request: request)
    let response = try await directions.calculateETA()

    let result = TravelTimeResponse(
        expectedTravelTimeSeconds: response.expectedTravelTime,
        expectedTravelTimeMinutes: response.expectedTravelTime / 60,
        distanceMeters: response.distance,
        transportType: transportType ?? "automobile",
        departureTime: tripTime == nil ? nil : formatISODate(response.expectedDepartureDate),
        arrivalTime: tripTime == nil ? nil : formatISODate(response.expectedArrivalDate)
    )

    return try encodeResponse(result)
}

private func getDirectionsByAddress(arguments: [String: Value]?) async throws -> String {
    let originAddress = arguments?["originAddress"]?.stringValue ?? ""
    let destAddress = arguments?["destinationAddress"]?.stringValue ?? ""
    let transportType = arguments?["transportType"]?.stringValue
    let tripTime = try parseTripTime(arguments)

    try validateAddress(originAddress)
    try validateAddress(destAddress)

    guard let originLocation = try await lookUpPlace(originAddress)?.location else {
        return "{\"error\": \"Could not find origin address\"}"
    }

    guard let destLocation = try await lookUpPlace(destAddress)?.location else {
        return "{\"error\": \"Could not find destination address\"}"
    }

    let request = MKDirections.Request()
    request.source = MKMapItem(placemark: MKPlacemark(coordinate: originLocation.coordinate))
    request.destination = MKMapItem(placemark: MKPlacemark(coordinate: destLocation.coordinate))
    request.transportType = parseTransportType(transportType)
    apply(tripTime, to: request)

    let directions = MKDirections(request: request)
    let response = try await directions.calculate()

    guard let route = response.routes.first else {
        return "{\"error\": \"No route found\"}"
    }

    let steps = route.steps.filter { !$0.instructions.isEmpty }.map { step in
        RouteStep(
            instructions: step.instructions,
            distanceMeters: step.distance,
            notice: step.notice ?? ""
        )
    }

    let result = AddressDirectionsResponse(
        origin: AddressDetail(
            address: originAddress,
            latitude: originLocation.coordinate.latitude,
            longitude: originLocation.coordinate.longitude
        ),
        destination: AddressDetail(
            address: destAddress,
            latitude: destLocation.coordinate.latitude,
            longitude: destLocation.coordinate.longitude
        ),
        distanceMeters: route.distance,
        expectedTravelTimeSeconds: route.expectedTravelTime,
        expectedTravelTimeMinutes: route.expectedTravelTime / 60,
        name: route.name,
        transportType: transportType ?? "automobile",
        departureTime: tripSchedule(tripTime, travelTime: route.expectedTravelTime).departure,
        arrivalTime: tripSchedule(tripTime, travelTime: route.expectedTravelTime).arrival,
        steps: steps
    )

    return try encodeResponse(result)
}

private func mapSnapshot(arguments: [String: Value]?) async throws -> [Tool.Content] {
    let latitude = arguments?["latitude"]?.numberValue
    let longitude = arguments?["longitude"]?.numberValue
    let spanDelta = arguments?["spanDelta"]?.numberValue
    let width = arguments?["width"]?.wholeNumberValue ?? 512
    let height = arguments?["height"]?.wholeNumberValue ?? 512
    let mapTypeStr = arguments?["mapType"]?.stringValue ?? "standard"
    let saveToFile = arguments?["saveToFile"]?.boolValue ?? false
    let pins = try parsePins(arguments?["pins"])

    try validateSnapshotSize(width: width, height: height)
    let region = try snapshotRegion(latitude: latitude, longitude: longitude, spanDelta: spanDelta, pins: pins)

    let options = MKMapSnapshotter.Options()
    options.region = region
    options.size = CGSize(width: CGFloat(width), height: CGFloat(height))

    switch mapTypeStr.lowercased() {
    case "satellite":
        options.mapType = .satellite
    case "hybrid":
        options.mapType = .hybrid
    case "mutedstandard":
        options.mapType = .mutedStandard
    default:
        options.mapType = .standard
    }

    let snapshotter = MKMapSnapshotter(options: options)
    let snapshot = try await snapshotter.start()

    let image = drawPins(pins, on: snapshot)
    guard let tiffData = image.tiffRepresentation,
          let bitmapRep = NSBitmapImageRep(data: tiffData),
          let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
        throw MCPError.internalError("Failed to render map snapshot as PNG")
    }

    var savedPath: String?
    if saveToFile {
        let file = try snapshotOutputDirectory().appendingPathComponent("map-\(UUID().uuidString.prefix(8)).png")
        try pngData.write(to: file)
        savedPath = file.path
    }

    let metadata = MapSnapshotMetadata(
        latitude: region.center.latitude,
        longitude: region.center.longitude,
        spanDelta: max(region.span.latitudeDelta, region.span.longitudeDelta),
        width: width,
        height: height,
        mapType: mapTypeStr,
        pinCount: pins.count,
        path: savedPath
    )
    let metadataJSON = try encodeResponse(metadata)

    // A saved file is for attaching to a message; skip the inline copy.
    if savedPath != nil {
        return [.text(metadataJSON)]
    }
    return [
        .image(data: pngData.base64EncodedString(), mimeType: "image/png", metadata: nil),
        .text(metadataJSON),
    ]
}

private func searchByCategory(arguments: [String: Value]?) async throws -> String {
    let categoryStr = arguments?["category"]?.stringValue ?? ""
    let latitude = arguments?["latitude"]?.numberValue ?? 0
    let longitude = arguments?["longitude"]?.numberValue ?? 0
    let radiusMeters = arguments?["radiusMeters"]?.numberValue ?? 5000

    let category = try mapCategory(categoryStr)
    try validateCoordinate(latitude: latitude, longitude: longitude)
    try validateRadius(radiusMeters)

    let request = MKLocalSearch.Request()
    request.pointOfInterestFilter = MKPointOfInterestFilter(including: [category])

    let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    let region = MKCoordinateRegion(
        center: center,
        latitudinalMeters: radiusMeters * 2,
        longitudinalMeters: radiusMeters * 2
    )
    request.region = region

    let search = MKLocalSearch(request: request)
    let searchResponse = try await search.start()

    let places = searchResponse.mapItems.map { item in
        PlaceResult(
            name: item.name ?? "",
            latitude: item.placemark.coordinate.latitude,
            longitude: item.placemark.coordinate.longitude,
            phoneNumber: item.phoneNumber,
            url: item.url?.absoluteString,
            address: item.placemark.title,
            category: item.pointOfInterestCategory?.rawValue
        )
    }

    return try encodeResponse(SearchPlacesResponse(results: places, count: places.count))
}

// MARK: - Server Registration

/// Runs one tool. Shared by the MCP server and the command line.
public func callTool(name: String, arguments: [String: Value]?) async throws -> CallTool.Result {
    do {
        switch name {
        case "mapSnapshot":
            let content = try await mapSnapshot(arguments: arguments)
            return CallTool.Result(content: content)
        default:
            let result: String
            switch name {
            case "geocode":
                result = try await geocode(arguments: arguments)
            case "reverseGeocode":
                result = try await reverseGeocode(arguments: arguments)
            case "searchPlaces":
                result = try await searchPlaces(arguments: arguments)
            case "getDirections":
                result = try await getDirections(arguments: arguments)
            case "calculateDistance":
                result = try await calculateDistance(arguments: arguments)
            case "estimateTravelTime":
                result = try await estimateTravelTime(arguments: arguments)
            case "getDirectionsByAddress":
                result = try await getDirectionsByAddress(arguments: arguments)
            case "searchByCategory":
                result = try await searchByCategory(arguments: arguments)
            default:
                throw MCPError.invalidParams("Unknown tool: \(name)")
            }
            return CallTool.Result(content: [.text(result)])
        }
    } catch let error as MapKitError {
        return CallTool.Result(content: [.text(error.localizedDescription)], isError: true)
    } catch let error as MCPError {
        throw error
    } catch {
        // MapKit and geocoder failures (no network, nothing found, throttled).
        return CallTool.Result(content: [.text("MapKit request failed: \(error.localizedDescription)")], isError: true)
    }
}

public func registerTools(on server: Server) async {
    await server.withMethodHandler(ListTools.self) { _ in
        ListTools.Result(tools: MapKitTools.all)
    }

    await server.withMethodHandler(CallTool.self) { params in
        try await callTool(name: params.name, arguments: params.arguments)
    }
}
