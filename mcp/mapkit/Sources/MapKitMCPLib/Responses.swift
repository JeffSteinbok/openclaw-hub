import Foundation

// MARK: - Geocode

public struct GeocodeResponse: Codable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let name: String
    public let locality: String
    public let administrativeArea: String
    public let country: String
    public let postalCode: String
    public let formattedAddress: String
}

// MARK: - Reverse Geocode

public struct ReverseGeocodeResponse: Codable, Sendable {
    public let name: String
    public let streetNumber: String
    public let street: String
    public let locality: String
    public let subLocality: String
    public let administrativeArea: String
    public let subAdministrativeArea: String
    public let country: String
    public let countryCode: String
    public let postalCode: String
    public let formattedAddress: String
}

// MARK: - Search Places

public struct PlaceResult: Codable, Sendable {
    public let name: String
    public let latitude: Double
    public let longitude: Double
    public let phoneNumber: String?
    public let url: String?
    public let address: String?
    public let category: String?
}

public struct SearchPlacesResponse: Codable, Sendable {
    public let results: [PlaceResult]
    public let count: Int
}

// MARK: - Directions

public struct RouteStep: Codable, Sendable {
    public let instructions: String
    public let distanceMeters: Double
    public let notice: String
}

public struct DirectionsResponse: Codable, Sendable {
    public let distanceMeters: Double
    public let expectedTravelTimeSeconds: Double
    public let expectedTravelTimeMinutes: Double
    public let name: String
    public let transportType: String
    /// Set when departAt or arriveAt was given.
    public let departureTime: String?
    public let arrivalTime: String?
    public let steps: [RouteStep]
}

// MARK: - Distance

public struct DistanceResponse: Codable, Sendable {
    public let distanceMeters: Double
    public let distanceKilometers: Double
    public let distanceMiles: Double
}

// MARK: - Travel Time

public struct TravelTimeResponse: Codable, Sendable {
    public let expectedTravelTimeSeconds: Double
    public let expectedTravelTimeMinutes: Double
    public let distanceMeters: Double
    public let transportType: String
    /// Set when departAt or arriveAt was given.
    public let departureTime: String?
    public let arrivalTime: String?
}

// MARK: - Address Directions

public struct AddressDetail: Codable, Sendable {
    public let address: String
    public let latitude: Double
    public let longitude: Double
}

public struct AddressDirectionsResponse: Codable, Sendable {
    public let origin: AddressDetail
    public let destination: AddressDetail
    public let distanceMeters: Double
    public let expectedTravelTimeSeconds: Double
    public let expectedTravelTimeMinutes: Double
    public let name: String
    public let transportType: String
    /// Set when departAt or arriveAt was given.
    public let departureTime: String?
    public let arrivalTime: String?
    public let steps: [RouteStep]
}

// MARK: - Map Snapshot Metadata

public struct MapSnapshotMetadata: Codable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let spanDelta: Double
    public let width: Int
    public let height: Int
    public let mapType: String
    public let pinCount: Int
    /// Set when saveToFile was true.
    public let path: String?
}

// MARK: - JSON Encoding Helper

public let responseEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return encoder
}()

public func encodeResponse<T: Encodable>(_ value: T) throws -> String {
    let data = try responseEncoder.encode(value)
    return String(data: data, encoding: .utf8) ?? "{}"
}
