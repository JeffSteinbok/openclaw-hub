import MapKit
import Testing
import MCP
@testable import MapKitMCPLib

@Suite("Coordinate Validation")
struct CoordinateValidationTests {
    @Test func validCoordinates() throws {
        try validateCoordinate(latitude: 0, longitude: 0)
        try validateCoordinate(latitude: 90, longitude: 180)
        try validateCoordinate(latitude: -90, longitude: -180)
        try validateCoordinate(latitude: 37.3349, longitude: -122.0090)
    }

    @Test func latitudeTooHigh() {
        #expect(throws: MapKitError.self) {
            try validateCoordinate(latitude: 91, longitude: 0)
        }
    }

    @Test func latitudeTooLow() {
        #expect(throws: MapKitError.self) {
            try validateCoordinate(latitude: -91, longitude: 0)
        }
    }

    @Test func longitudeTooHigh() {
        #expect(throws: MapKitError.self) {
            try validateCoordinate(latitude: 0, longitude: 181)
        }
    }

    @Test func longitudeTooLow() {
        #expect(throws: MapKitError.self) {
            try validateCoordinate(latitude: 0, longitude: -181)
        }
    }
}

@Suite("Address Validation")
struct AddressValidationTests {
    @Test func validAddress() throws {
        try validateAddress("1 Apple Park Way, Cupertino, CA")
    }

    @Test func emptyAddress() {
        #expect(throws: MapKitError.self) {
            try validateAddress("")
        }
    }

    @Test func whitespaceOnlyAddress() {
        #expect(throws: MapKitError.self) {
            try validateAddress("   ")
        }
    }

    @Test func newlineOnlyAddress() {
        #expect(throws: MapKitError.self) {
            try validateAddress("\n\t")
        }
    }
}

@Suite("Query Validation")
struct QueryValidationTests {
    @Test func validQuery() throws {
        try validateQuery("coffee shops")
    }

    @Test func emptyQuery() {
        #expect(throws: MapKitError.self) {
            try validateQuery("")
        }
    }

    @Test func whitespaceOnlyQuery() {
        #expect(throws: MapKitError.self) {
            try validateQuery("   ")
        }
    }
}

@Suite("Radius Validation")
struct RadiusValidationTests {
    @Test func validRadius() throws {
        try validateRadius(1)
        try validateRadius(5000)
        try validateRadius(50_000)
    }

    @Test func radiusTooSmall() {
        #expect(throws: MapKitError.self) {
            try validateRadius(0)
        }
    }

    @Test func negativeRadius() {
        #expect(throws: MapKitError.self) {
            try validateRadius(-100)
        }
    }

    @Test func radiusTooLarge() {
        #expect(throws: MapKitError.self) {
            try validateRadius(50_001)
        }
    }
}

@Suite("Error Messages")
struct ErrorMessageTests {
    @Test func emptyAddressMessage() {
        let error = MapKitError.emptyAddress
        #expect(error.localizedDescription == "Address must not be empty")
    }

    @Test func invalidLatitudeMessage() {
        let error = MapKitError.invalidLatitude(91.0)
        #expect(error.localizedDescription == "Latitude 91.0 is out of range [-90, 90]")
    }

    @Test func invalidLongitudeMessage() {
        let error = MapKitError.invalidLongitude(-181.0)
        #expect(error.localizedDescription == "Longitude -181.0 is out of range [-180, 180]")
    }

    @Test func invalidRadiusMessage() {
        let error = MapKitError.invalidRadius(-5.0)
        #expect(error.localizedDescription == "Radius -5.0 is out of range [1, 50000]")
    }

    @Test func emptyQueryMessage() {
        let error = MapKitError.emptyQuery
        #expect(error.localizedDescription == "Search query must not be empty")
    }

}

@Suite("POI Category Mapping")
struct CategoryMappingTests {
    @Test func validCategories() throws {
        #expect(try mapCategory("cafe") == .cafe)
        #expect(try mapCategory("restaurant") == .restaurant)
        #expect(try mapCategory("park") == .park)
        #expect(try mapCategory("hospital") == .hospital)
        #expect(try mapCategory("airport") == .airport)
        #expect(try mapCategory("zoo") == .zoo)
    }

    @Test func caseInsensitive() throws {
        #expect(try mapCategory("Cafe") == .cafe)
        #expect(try mapCategory("RESTAURANT") == .restaurant)
        #expect(try mapCategory("Park") == .park)
    }

    @Test func invalidCategory() {
        #expect(throws: MapKitError.self) {
            try mapCategory("invalidCategory")
        }
    }

    @Test func invalidCategoryMessage() {
        let error = MapKitError.invalidCategory("foo")
        #expect(error.localizedDescription.contains("Unknown category"))
        #expect(error.localizedDescription.contains("foo"))
        #expect(error.localizedDescription.contains("cafe"))
    }
}

@Suite("Snapshot Size Validation")
struct SnapshotSizeValidationTests {
    @Test func validSizes() throws {
        try validateSnapshotSize(width: 1, height: 1)
        try validateSnapshotSize(width: 512, height: 512)
        try validateSnapshotSize(width: 2048, height: 2048)
    }

    @Test func zeroWidth() {
        #expect(throws: MapKitError.self) {
            try validateSnapshotSize(width: 0, height: 512)
        }
    }

    @Test func zeroHeight() {
        #expect(throws: MapKitError.self) {
            try validateSnapshotSize(width: 512, height: 0)
        }
    }

    @Test func negativeSize() {
        #expect(throws: MapKitError.self) {
            try validateSnapshotSize(width: -1, height: 512)
        }
    }

    @Test func tooLargeWidth() {
        #expect(throws: MapKitError.self) {
            try validateSnapshotSize(width: 2049, height: 512)
        }
    }

    @Test func tooLargeHeight() {
        #expect(throws: MapKitError.self) {
            try validateSnapshotSize(width: 512, height: 2049)
        }
    }
}

@Suite("Codable Response Encoding")
struct CodableResponseTests {
    @Test func geocodeResponseRoundTrip() throws {
        let original = GeocodeResponse(
            latitude: 37.3349,
            longitude: -122.0090,
            name: "Apple Park",
            locality: "Cupertino",
            administrativeArea: "CA",
            country: "United States",
            postalCode: "95014",
            formattedAddress: "Apple Park, Cupertino, CA, 95014, United States"
        )

        let json = try encodeResponse(original)
        let data = json.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(GeocodeResponse.self, from: data)

        #expect(decoded.latitude == original.latitude)
        #expect(decoded.longitude == original.longitude)
        #expect(decoded.name == original.name)
        #expect(decoded.formattedAddress == original.formattedAddress)
    }

    @Test func distanceResponseRoundTrip() throws {
        let original = DistanceResponse(
            distanceMeters: 1000.0,
            distanceKilometers: 1.0,
            distanceMiles: 0.621371
        )

        let json = try encodeResponse(original)
        let data = json.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(DistanceResponse.self, from: data)

        #expect(decoded.distanceMeters == original.distanceMeters)
        #expect(decoded.distanceKilometers == original.distanceKilometers)
        #expect(decoded.distanceMiles == original.distanceMiles)
    }

    @Test func placeResultEncodesOptionals() throws {
        let place = PlaceResult(
            name: "Test",
            latitude: 0,
            longitude: 0,
            phoneNumber: nil,
            url: nil,
            address: "123 Main St",
            category: nil
        )
        let response = SearchPlacesResponse(results: [place], count: 1)

        let json = try encodeResponse(response)
        #expect(json.contains("\"count\" : 1"))
        #expect(json.contains("\"name\" : \"Test\""))
    }
}

@Suite("Trip Time")
struct TripTimeTests {
    @Test func noTimeMeansLeaveNow() throws {
        #expect(try parseTripTime(nil) == nil)
        #expect(try parseTripTime([:]) == nil)
    }

    @Test func parsesDepartAt() throws {
        let tripTime = try parseTripTime(["departAt": .string("2026-10-24T17:30:00-07:00")])
        #expect(tripTime == .departAt(parseISODate("2026-10-25T00:30:00Z")!))
    }

    @Test func parsesArriveAtWithFractionalSeconds() throws {
        let tripTime = try parseTripTime(["arriveAt": .string("2026-10-25T00:30:00.000Z")])
        #expect(tripTime == .arriveAt(parseISODate("2026-10-25T00:30:00Z")!))
    }

    @Test func rejectsBothTimes() {
        #expect(throws: MapKitError.self) {
            try parseTripTime([
                "departAt": .string("2026-10-25T00:30:00Z"),
                "arriveAt": .string("2026-10-25T01:30:00Z"),
            ])
        }
    }

    @Test func rejectsNonISOTime() {
        #expect(throws: MapKitError.self) {
            try parseTripTime(["arriveAt": .string("5:30pm tomorrow")])
        }
    }

    @Test func arriveAtWorksBackToDeparture() {
        let arrival = parseISODate("2026-10-25T00:30:00Z")!
        let schedule = tripSchedule(.arriveAt(arrival), travelTime: 1800)
        #expect(schedule.departure.flatMap(parseISODate) == parseISODate("2026-10-25T00:00:00Z"))
        #expect(schedule.arrival.flatMap(parseISODate) == arrival)
    }

    @Test func departAtWorksForwardToArrival() {
        let departure = parseISODate("2026-10-25T00:30:00Z")!
        let schedule = tripSchedule(.departAt(departure), travelTime: 600)
        #expect(schedule.arrival.flatMap(parseISODate) == parseISODate("2026-10-25T00:40:00Z"))
    }

    @Test func noScheduleWithoutTripTime() {
        let schedule = tripSchedule(nil, travelTime: 600)
        #expect(schedule.departure == nil && schedule.arrival == nil)
    }
}

@Suite("Map Pins")
struct MapPinTests {
    @Test func parsesPinsWithAndWithoutLabels() throws {
        let pins = try parsePins(.array([
            .object(["latitude": .double(47.6), "longitude": .double(-122.0), "label": .string("Home")]),
            .object(["latitude": .double(47.4), "longitude": .double(-122.3), "label": .string("  ")]),
        ]))
        #expect(pins == [
            MapPin(latitude: 47.6, longitude: -122.0, label: "Home"),
            MapPin(latitude: 47.4, longitude: -122.3, label: nil),
        ])
    }

    @Test func missingPinsIsEmpty() throws {
        #expect(try parsePins(nil).isEmpty)
    }

    @Test func rejectsMalformedPins() {
        #expect(throws: MapKitError.self) { try parsePins(.string("47.6,-122.0")) }
        #expect(throws: MapKitError.self) { try parsePins(.array([.object(["latitude": .double(47.6)])])) }
        #expect(throws: MapKitError.self) {
            try parsePins(.array([.object(["latitude": .double(95), "longitude": .double(0)])]))
        }
    }

    @Test func centersOnExplicitCoordinates() throws {
        let region = try snapshotRegion(latitude: 47.6, longitude: -122.0, spanDelta: nil, pins: [])
        #expect(region.center.latitude == 47.6)
        #expect(region.span.latitudeDelta == 0.01)
    }

    @Test func fitsAllPinsWhenNoCenter() throws {
        let pins = [
            MapPin(latitude: 47.6, longitude: -122.0, label: nil),
            MapPin(latitude: 47.4, longitude: -122.3, label: nil),
        ]
        let region = try snapshotRegion(latitude: nil, longitude: nil, spanDelta: nil, pins: pins)
        #expect(abs(region.center.latitude - 47.5) < 1e-9)
        #expect(abs(region.center.longitude - -122.15) < 1e-9)
        #expect(region.span.latitudeDelta > 0.2)
        #expect(region.span.longitudeDelta > 0.3)
    }

    @Test func singlePinUsesMinimumSpan() throws {
        let region = try snapshotRegion(
            latitude: nil, longitude: nil, spanDelta: 0.05,
            pins: [MapPin(latitude: 25.76, longitude: -80.19, label: "Bo")]
        )
        #expect(region.span.latitudeDelta == 0.05)
    }

    @Test func needsCenterOrPins() {
        #expect(throws: MapKitError.self) {
            try snapshotRegion(latitude: nil, longitude: nil, spanDelta: nil, pins: [])
        }
    }
}

@Suite("Tool Annotations")
struct ToolAnnotationTests {
    @Test func everyToolIsAnnotated() {
        for tool in MapKitTools.all {
            #expect(!tool.annotations.isEmpty, "\(tool.name) has no annotations")
        }
    }

    @Test func onlySnapshotWrites() {
        let writers = MapKitTools.all.filter { $0.annotations.readOnlyHint != true }.map(\.name)
        #expect(writers == ["mapSnapshot"])
    }
}

@Suite("Command Line")
struct CommandLineTests {
    @Test func findsToolsCaseInsensitively() throws {
        #expect(try findTool("estimatetraveltime").name == "estimateTravelTime")
        #expect(throws: CommandLineError.self) { try findTool("teleport") }
    }

    @Test func typesArgumentsFromTheSchema() throws {
        let args = try parseToolArguments([
            "--originLatitude", "47.6", "--originLongitude=-122.04",
            "--destinationLatitude", "47.44", "--destinationLongitude", "-122.3",
            "--arriveAt", "2026-10-25T08:00:00-07:00",
        ], for: findTool("estimateTravelTime"))
        #expect(args["originLatitude"] == .double(47.6))
        #expect(args["originLongitude"] == .double(-122.04))
        #expect(args["destinationLongitude"] == .double(-122.3))
        #expect(args["arriveAt"] == .string("2026-10-25T08:00:00-07:00"))
    }

    @Test func parsesJSONPinsAndBareBooleans() throws {
        let args = try parseToolArguments([
            "--pins", #"[{"latitude": 47.6, "longitude": -122.0, "label": "Home"}]"#,
            "--saveToFile", "--width", "640",
        ], for: findTool("mapSnapshot"))
        #expect(try parsePins(args["pins"]) == [MapPin(latitude: 47.6, longitude: -122.0, label: "Home")])
        #expect(args["saveToFile"] == .bool(true))
        #expect(args["width"] == .int(640))
    }

    @Test func rejectsBadInput() throws {
        let tool = try findTool("geocode")
        #expect(throws: CommandLineError.unknownOption(tool: "geocode", option: "street")) {
            try parseToolArguments(["--street", "x"], for: tool)
        }
        #expect(throws: CommandLineError.missingRequired(tool: "geocode", options: ["address"])) {
            try parseToolArguments([], for: tool)
        }
        #expect(throws: CommandLineError.unexpectedArgument("Seattle")) {
            try parseToolArguments(["Seattle"], for: tool)
        }
        #expect(throws: CommandLineError.missingValue("address")) {
            try parseToolArguments(["--address"], for: tool)
        }
        #expect(throws: CommandLineError.self) {
            try parseToolArguments(["--latitude", "north", "--longitude", "1"], for: findTool("reverseGeocode"))
        }
    }

    @Test func helpListsEveryTool() async {
        let (output, failed) = await runCommandLine(["help"])
        #expect(!failed)
        for tool in MapKitTools.all {
            #expect(output.contains(tool.name))
        }
    }

    @Test func toolHelpListsOptions() async {
        let (output, _) = await runCommandLine(["help", "estimateTravelTime"])
        #expect(output.contains("--arriveAt <string>"))
        #expect(output.contains("--originLatitude <number> (required)"))
    }

    @Test func reportsErrorsAsFailures() async {
        let (output, failed) = await runCommandLine(["geocode"])
        #expect(failed)
        #expect(output.contains("--address"))
    }
}

@Suite("Number Arguments")
struct NumberArgumentTests {
    @Test func wholeNumbersCountAsNumbers() {
        #expect(Value.int(2000).numberValue == 2000)
        #expect(Value.double(47.6).numberValue == 47.6)
        #expect(Value.string("47").numberValue == nil)
    }

    @Test func wholeDoublesCountAsIntegers() {
        #expect(Value.double(640).wholeNumberValue == 640)
        #expect(Value.double(640.5).wholeNumberValue == nil)
        #expect(Value.int(512).wholeNumberValue == 512)
    }

    @Test func pinsAcceptWholeDegrees() throws {
        let pins = try parsePins(.array([.object(["latitude": .int(47), "longitude": .int(-122)])]))
        #expect(pins == [MapPin(latitude: 47, longitude: -122, label: nil)])
    }
}
