import Foundation
import MCP

// MARK: - Command Line

/// The command line runs the same tools as the MCP server, for agents that can
/// run commands but not call MCP tools:
///
///     applemaps estimateTravelTime --originLatitude 47.6 --originLongitude -122.0 \
///         --destinationLatitude 47.44 --destinationLongitude -122.3 --arriveAt 2026-10-25T08:00:00-07:00
public enum CommandLineError: LocalizedError, Equatable {
    case unknownTool(String)
    case unknownOption(tool: String, option: String)
    case missingValue(String)
    case invalidValue(option: String, value: String, expected: String)
    case missingRequired(tool: String, options: [String])
    case unexpectedArgument(String)

    public var errorDescription: String? {
        switch self {
        case .unknownTool(let name):
            return "Unknown tool \"\(name)\". Run `applemaps help` for the list."
        case .unknownOption(let tool, let option):
            return "\(tool) has no option --\(option). Run `applemaps help \(tool)`."
        case .missingValue(let option):
            return "--\(option) needs a value"
        case .invalidValue(let option, let value, let expected):
            return "--\(option) \"\(value)\" is not a valid \(expected)"
        case .missingRequired(let tool, let options):
            return "\(tool) needs " + options.map { "--\($0)" }.joined(separator: ", ")
        case .unexpectedArgument(let argument):
            return "Unexpected argument \"\(argument)\"; options take the form --name value"
        }
    }
}

public func findTool(_ name: String) throws -> Tool {
    guard let tool = MapKitTools.all.first(where: { $0.name.lowercased() == name.lowercased() }) else {
        throw CommandLineError.unknownTool(name)
    }
    return tool
}

private func properties(of tool: Tool) -> [String: Value] {
    tool.inputSchema.objectValue?["properties"]?.objectValue ?? [:]
}

private func requiredOptions(of tool: Tool) -> [String] {
    tool.inputSchema.objectValue?["required"]?.arrayValue?.compactMap(\.stringValue) ?? []
}

/// Turns `--name value` pairs into tool arguments, typed by the tool's input schema.
public func parseToolArguments(_ args: [String], for tool: Tool) throws -> [String: Value] {
    let schema = properties(of: tool)
    var result: [String: Value] = [:]
    var index = 0
    while index < args.count {
        let token = args[index]
        guard token.hasPrefix("--"), token.count > 2 else { throw CommandLineError.unexpectedArgument(token) }
        var name = String(token.dropFirst(2))
        var inlineValue: String?
        if let equals = name.firstIndex(of: "=") {
            inlineValue = String(name[name.index(after: equals)...])
            name = String(name[..<equals])
        }
        guard let key = schema.keys.first(where: { $0.lowercased() == name.lowercased() }),
              let type = schema[key]?.objectValue?["type"]?.stringValue else {
            throw CommandLineError.unknownOption(tool: tool.name, option: name)
        }
        let raw: String
        if let inlineValue {
            raw = inlineValue
        } else if type == "boolean", index + 1 >= args.count || args[index + 1].hasPrefix("--") {
            raw = "true"  // a bare --saveToFile
        } else {
            guard index + 1 < args.count else { throw CommandLineError.missingValue(name) }
            index += 1
            raw = args[index]
        }
        result[key] = try typedValue(raw, type: type, option: key)
        index += 1
    }
    let missing = requiredOptions(of: tool).filter { result[$0] == nil }
    if !missing.isEmpty {
        throw CommandLineError.missingRequired(tool: tool.name, options: missing)
    }
    return result
}

private func typedValue(_ raw: String, type: String, option: String) throws -> Value {
    switch type {
    case "number":
        guard let number = Double(raw) else { throw CommandLineError.invalidValue(option: option, value: raw, expected: "number") }
        return .double(number)
    case "integer":
        guard let number = Int(raw) else { throw CommandLineError.invalidValue(option: option, value: raw, expected: "integer") }
        return .int(number)
    case "boolean":
        switch raw.lowercased() {
        case "true", "yes", "1": return .bool(true)
        case "false", "no", "0": return .bool(false)
        default: throw CommandLineError.invalidValue(option: option, value: raw, expected: "boolean")
        }
    case "array", "object":
        guard let data = raw.data(using: .utf8),
              let value = try? JSONDecoder().decode(Value.self, from: data) else {
            throw CommandLineError.invalidValue(option: option, value: raw, expected: "JSON \(type)")
        }
        return value
    default:
        return .string(raw)
    }
}

public func usage(for tool: Tool? = nil) -> String {
    guard let tool else {
        let lines = MapKitTools.all.map { "  \($0.name.padding(toLength: 24, withPad: " ", startingAt: 0)) \($0.description ?? "")" }
        return """
        Usage: applemaps <tool> [--option value ...]
               applemaps help <tool>
               applemaps mcp            Run as an MCP server on stdio

        Tools:
        \(lines.joined(separator: "\n"))

        Output is JSON. Map images are written to MAPKIT_OUTPUT_DIR and the result gives the path.
        """
    }
    let required = Set(requiredOptions(of: tool))
    let rows = properties(of: tool).sorted { $0.key < $1.key }.map { key, schema -> (flag: String, description: String) in
        let object = schema.objectValue
        let type = object?["type"]?.stringValue ?? "string"
        let flag = "--\(key) <\(type)>\(required.contains(key) ? " (required)" : "")"
        return (flag, object?["description"]?.stringValue ?? "")
    }
    let width = rows.map(\.flag.count).max() ?? 0
    let options = rows.map { "  \($0.flag.padding(toLength: width, withPad: " ", startingAt: 0))  \($0.description)" }
    return """
    Usage: applemaps \(tool.name) [--option value ...]

    \(tool.description ?? "")

    Options:
    \(options.joined(separator: "\n"))
    """
}

/// Runs a tool from command-line arguments. Returns the text to print and whether it failed.
public func runCommandLine(_ args: [String]) async -> (output: String, failed: Bool) {
    guard let first = args.first, !["help", "-h", "--help"].contains(first) else {
        if args.count > 1, let tool = try? findTool(args[1]) {
            return (usage(for: tool), false)
        }
        return (usage(), args.isEmpty)
    }
    do {
        let tool = try findTool(first)
        var arguments = try parseToolArguments(Array(args.dropFirst()), for: tool)
        if tool.name == "mapSnapshot" {
            // A terminal can't show the inline image, so always write the file.
            arguments["saveToFile"] = .bool(true)
        }
        let result = try await callTool(name: tool.name, arguments: arguments)
        let text = result.content.compactMap { content -> String? in
            if case .text(let text, _, _) = content { return text }
            return nil
        }.joined(separator: "\n")
        return (text, result.isError == true)
    } catch {
        return (error.localizedDescription, true)
    }
}
