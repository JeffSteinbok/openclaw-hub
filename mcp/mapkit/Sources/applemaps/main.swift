import Foundation
import Logging
import MCP
import MapKitMCPLib

let args = Array(CommandLine.arguments.dropFirst())

if args.first == "mcp" {
    LoggingSystem.bootstrap(StreamLogHandler.standardError)
    let logger = Logger(label: "com.jsflax.MapKitMCP")

    let server = Server(
        name: "MapKit MCP",
        version: "1.0.0",
        capabilities: .init(tools: .init(listChanged: false))
    )

    await registerTools(on: server)

    let transport = StdioTransport(logger: logger)
    try await server.start(transport: transport)
    await server.waitUntilCompleted()
} else {
    let (output, failed) = await runCommandLine(args)
    if failed {
        FileHandle.standardError.write(Data((output + "\n").utf8))
        exit(1)
    }
    print(output)
}
