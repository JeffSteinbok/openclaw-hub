// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MapKitMCP",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "applemaps",
            targets: ["applemaps"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/modelcontextprotocol/swift-sdk.git", from: "0.12.1"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.5.0"),
    ],
    targets: [
        .target(
            name: "MapKitMCPLib",
            dependencies: [
                .product(name: "MCP", package: "swift-sdk")
            ]
        ),
        .executableTarget(
            name: "applemaps",
            dependencies: [
                "MapKitMCPLib",
                .product(name: "Logging", package: "swift-log"),
            ],
        ),
        .testTarget(
            name: "MapKitMCPTests",
            dependencies: ["MapKitMCPLib"]
        ),
    ]
)
