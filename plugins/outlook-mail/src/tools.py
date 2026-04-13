"""
Outlook Mail plugin – JSON stdin/stdout dispatch layer.

Wraps outlook_mail.py functions as structured tool handlers for the
OpenClaw Python plugin framework.
"""

import json
import sys
import urllib.error

from outlook_mail import (
    escape_odata_string,
    format_message,
    get_access_token,
    graph_get,
    quote_graph_path_segment,
    save_attachments,
)

# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def handle_inbox(args: dict) -> dict:
    """List recent messages from an Outlook mail folder."""
    token = get_access_token()
    limit = args.get("limit", 10)
    unread_only = args.get("unread", False)
    folder = args.get("folder", "inbox")

    unread_filter = "&%24filter=isRead+eq+false" if unread_only else ""
    path = (
        f"/me/mailFolders/{folder}/messages"
        f"?%24top={limit}"
        f"&%24select=subject%2Cfrom%2CreceivedDateTime%2CisRead"
        f"&%24orderby=receivedDateTime+desc"
        f"{unread_filter}"
    )
    data = graph_get(token, path)
    messages = data.get("value", [])
    return {
        "count": len(messages),
        "messages": [
            {
                "id": m.get("id"),
                "subject": m.get("subject"),
                "from": m.get("from", {}).get("emailAddress", {}),
                "receivedDateTime": m.get("receivedDateTime"),
                "isRead": m.get("isRead"),
            }
            for m in messages
        ],
    }


def handle_search(args: dict) -> dict:
    """Search messages by query, sender, subject, or date range."""
    token = get_access_token()
    import urllib.parse

    filters = []
    query = args.get("query")
    sender = args.get("from")
    subject = args.get("subject")
    since = args.get("since")
    before = args.get("before")
    limit = args.get("limit", 10)

    if query:
        escaped_query = escape_odata_string(query)
        filters.append(f"contains(subject,'{escaped_query}') or contains(body/content,'{escaped_query}')")
    if sender:
        escaped_sender = escape_odata_string(sender)
        filters.append(f"from/emailAddress/address eq '{escaped_sender}'")
    if subject:
        escaped_subject = escape_odata_string(subject)
        filters.append(f"contains(subject,'{escaped_subject}')")
    if since:
        filters.append(f"receivedDateTime ge {since}T00:00:00Z")
    if before:
        filters.append(f"receivedDateTime le {before}T00:00:00Z")

    if filters:
        fstr = urllib.parse.quote(" and ".join(filters))
        path = (
            f"/me/messages?%24top={limit}"
            f"&%24select=subject%2Cfrom%2CreceivedDateTime%2CisRead"
            f"&%24filter={fstr}"
            f"&%24orderby=receivedDateTime+desc"
        )
    else:
        path = (
            f"/me/messages?%24top={limit}"
            f"&%24select=subject%2Cfrom%2CreceivedDateTime%2CisRead"
            f"&%24orderby=receivedDateTime+desc"
        )

    try:
        data = graph_get(token, path)
        messages = data.get("value", [])
        return {
            "count": len(messages),
            "messages": [
                {
                    "id": m.get("id"),
                    "subject": m.get("subject"),
                    "from": m.get("from", {}).get("emailAddress", {}),
                    "receivedDateTime": m.get("receivedDateTime"),
                    "isRead": m.get("isRead"),
                }
                for m in messages
            ],
        }
    except urllib.error.HTTPError as e:
        return {"error": f"Search error {e.code}: {e.read().decode()[:300]}"}


def handle_read(args: dict) -> dict:
    """Read a specific message by its ID."""
    token = get_access_token()
    message_id = args["message_id"]
    quoted_message_id = quote_graph_path_segment(message_id)
    path = (
        f"/me/messages/{quoted_message_id}"
        f"?%24select=subject%2Cfrom%2CreceivedDateTime%2CisRead%2Cbody%2CtoRecipients"
    )
    data = graph_get(token, path)
    to_list = [
        r.get("emailAddress", {})
        for r in data.get("toRecipients", [])
    ]
    body_content = data.get("body", {}).get("content", "")
    return {
        "id": data.get("id"),
        "subject": data.get("subject"),
        "from": data.get("from", {}).get("emailAddress", {}),
        "to": to_list,
        "receivedDateTime": data.get("receivedDateTime"),
        "isRead": data.get("isRead"),
        "body": body_content,
    }


def handle_save_attachments(args: dict) -> dict:
    """Save attachments from a message to a local directory."""
    token = get_access_token()
    message_id = args["message_id"]
    output_dir = args.get("output_dir", "/tmp/outlook-attachments")
    content_types = args.get("content_types", ["image/*"])
    saved = save_attachments(token, message_id, output_dir, content_types)
    return {
        "output_dir": output_dir,
        "files": saved,
        "count": len(saved),
    }


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

TOOLS = {
    "outlook_inbox": {
        "description": "List recent messages from the Outlook inbox, or any other mail folder.",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of messages to return (default 10).",
                },
                "unread": {
                    "type": "boolean",
                    "description": "Only show unread messages.",
                },
                "folder": {
                    "type": "string",
                    "description": (
                        "Mail folder to read (default: inbox). "
                        "Well-known folder names: inbox, junkemail, deleteditems, sentitems, "
                        "drafts, outbox, archive, clutter, conflicts, conversationhistory, "
                        "localfailures, recoverableitemsdeletions, scheduled, searchfolders, "
                        "serverfailures, syncissues."
                    ),
                },
            },
        },
        "handler": handle_inbox,
    },
    "outlook_search": {
        "description": "Search Outlook messages by query text, sender, subject, or date range.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Full-text search across subject and body.",
                },
                "from": {
                    "type": "string",
                    "description": "Filter by sender email address.",
                },
                "subject": {
                    "type": "string",
                    "description": "Filter by subject (substring match).",
                },
                "since": {
                    "type": "string",
                    "description": "Only messages received on or after this date (YYYY-MM-DD).",
                },
                "before": {
                    "type": "string",
                    "description": "Only messages received on or before this date (YYYY-MM-DD).",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results (default 10).",
                },
            },
        },
        "handler": handle_search,
    },
    "outlook_read": {
        "description": "Read a specific Outlook message by its ID, including full body content.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The Microsoft Graph message ID to retrieve.",
                },
            },
            "required": ["message_id"],
        },
        "handler": handle_read,
    },
    "outlook_save_attachments": {
        "description": (
            "Download attachments from an Outlook message to a local directory. "
            "Also saves the message body as body.html. Useful for processing "
            "emails that contain inline images (e.g., USPS Informed Delivery)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The Microsoft Graph message ID.",
                },
                "output_dir": {
                    "type": "string",
                    "description": "Local directory path to save attachments to (created if needed).",
                },
                "content_types": {
                    "type": "array",
                    "description": "Content type filters (e.g. ['image/*']). Defaults to ['image/*'].",
                    "items": {"type": "string"},
                },
            },
            "required": ["message_id", "output_dir"],
        },
        "handler": handle_save_attachments,
    },
}

# ---------------------------------------------------------------------------
# JSON stdin/stdout dispatch
# ---------------------------------------------------------------------------

def manifest():
    return {
        "tools": [
            {
                "name": name,
                "description": tool["description"],
                "input_schema": tool["input_schema"],
            }
            for name, tool in TOOLS.items()
        ]
    }


def call(tool_name: str, args: dict):
    return TOOLS[tool_name]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    method = payload["method"]

    if method == "manifest":
        print(json.dumps(manifest()))
    elif method == "call":
        print(json.dumps(call(payload["tool"], payload["args"])))
    else:
        print(json.dumps({"error": f"Unknown method: {method}"}))


if __name__ == "__main__":
    main()
