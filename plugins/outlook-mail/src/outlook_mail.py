#!/usr/bin/env python3
"""
Search and read personal Outlook inbox via Microsoft Graph API.

Auth: OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN from env.
"""

import os, sys, json, argparse, urllib.request, urllib.parse, urllib.error

TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"


def get_access_token():
    for var in ["OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_REFRESH_TOKEN"]:
        if not os.environ.get(var):
            print(f"ERROR: {var} not set.", file=sys.stderr); sys.exit(1)
    data = urllib.parse.urlencode({
        "client_id": os.environ["OUTLOOK_CLIENT_ID"],
        "client_secret": os.environ["OUTLOOK_CLIENT_SECRET"],
        "refresh_token": os.environ["OUTLOOK_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
        "scope": "Mail.Read",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data)
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())["access_token"]
    except urllib.error.HTTPError as e:
        print(f"ERROR: Token refresh failed: {e.code} {e.read().decode()[:200]}", file=sys.stderr); sys.exit(1)


def graph_get(token, path):
    req = urllib.request.Request(f"{GRAPH_BASE}{path}")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def quote_graph_path_segment(value: str) -> str:
    """Safely encode a Graph path segment such as a message ID."""
    return urllib.parse.quote(str(value), safe="")


def escape_odata_string(value: str) -> str:
    """Escape a string for use inside a single-quoted OData literal."""
    return str(value).replace("'", "''")


def safe_attachment_name(name: str) -> str:
    """Return a filename that stays within the chosen output directory."""
    flattened = str(name).replace("\\", "/")
    basename = os.path.basename(flattened).strip()
    if basename in {"", ".", ".."}:
        return "attachment"
    return basename.replace("/", "_").replace("\\", "_")


def format_message(m, body=False):
    unread = "🔵 " if not m.get("isRead") else "   "
    date = m.get("receivedDateTime", "")[:10]
    sender = m.get("from", {}).get("emailAddress", {})
    from_str = f"{sender.get('name', '')} <{sender.get('address', '')}>"
    subject = m.get("subject", "(no subject)")
    lines = [f"{unread}{date} | {from_str}\n        {subject}"]
    if body and m.get("body"):
        preview = m["body"].get("content", "")[:500].replace("\r\n", " ").replace("\n", " ")
        lines.append(f"\n  {preview}")
    return "\n".join(lines)


def cmd_inbox(args, token):
    limit = args.limit or 10
    unread_filter = "&%24filter=isRead+eq+false" if args.unread else ""
    data = graph_get(token, f"/me/mailFolders/inbox/messages?%24top={limit}&%24select=subject%2Cfrom%2CreceivedDateTime%2CisRead&%24orderby=receivedDateTime+desc{unread_filter}")
    msgs = data.get("value", [])
    print(f"## Inbox — {len(msgs)} message(s)\n")
    for m in msgs:
        print(format_message(m))


def cmd_search(args, token):
    filters = []
    if args.query:
        query = escape_odata_string(args.query)
        filters.append(f"contains(subject,'{query}') or contains(body/content,'{query}')")
    if args.sender:
        sender = escape_odata_string(args.sender)
        filters.append(f"from/emailAddress/address eq '{sender}'")
    if args.subject:
        subject = escape_odata_string(args.subject)
        filters.append(f"contains(subject,'{subject}')")
    if args.since:
        filters.append(f"receivedDateTime ge {args.since}T00:00:00Z")
    if args.before:
        filters.append(f"receivedDateTime le {args.before}T00:00:00Z")

    limit = args.limit or 10
    if filters:
        fstr = urllib.parse.quote(" and ".join(filters))
        path = f"/me/messages?%24top={limit}&%24select=subject%2Cfrom%2CreceivedDateTime%2CisRead&%24filter={fstr}&%24orderby=receivedDateTime+desc"
    else:
        path = f"/me/messages?%24top={limit}&%24select=subject%2Cfrom%2CreceivedDateTime%2CisRead&%24orderby=receivedDateTime+desc"

    try:
        data = graph_get(token, path)
        msgs = data.get("value", [])
        print(f"## Search Results — {len(msgs)} message(s)\n")
        for m in msgs:
            print(format_message(m))
    except urllib.error.HTTPError as e:
        print(f"Search error {e.code}: {e.read().decode()[:300]}", file=sys.stderr)


def cmd_read(args, token):
    message_id = quote_graph_path_segment(args.id)
    data = graph_get(token, f"/me/messages/{message_id}?%24select=subject%2Cfrom%2CreceivedDateTime%2CisRead%2Cbody%2CtoRecipients")
    print(format_message(data, body=True))


def save_attachments(token, message_id, output_dir, content_types=None):
    """Download attachments from a message to output_dir.

    Also saves the message body HTML as body.html.
    Returns list of saved file paths (relative to output_dir).
    """
    import base64
    os.makedirs(output_dir, exist_ok=True)
    saved = []

    # Fetch attachments
    quoted_message_id = quote_graph_path_segment(message_id)
    path = f"/me/messages/{quoted_message_id}/attachments"
    data = graph_get(token, path)
    for att in data.get("value", []):
        name = att.get("name", "attachment")
        ct = att.get("contentType", "")
        content_b64 = att.get("contentBytes")
        if not content_b64:
            continue

        # Filter by content type if specified
        if content_types:
            match = False
            for pattern in content_types:
                if pattern.endswith("/*"):
                    match = ct.startswith(pattern[:-1])
                else:
                    match = ct == pattern
                if match:
                    break
            if not match:
                continue

        safe_name = safe_attachment_name(name)
        dest = os.path.join(output_dir, safe_name)
        with open(dest, "wb") as f:
            f.write(base64.b64decode(content_b64))
        saved.append(safe_name)

    # Also save the body as HTML
    msg_path = (
        f"/me/messages/{quoted_message_id}"
        f"?%24select=body%2Csubject%2CreceivedDateTime"
    )
    msg = graph_get(token, msg_path)
    body_html = msg.get("body", {}).get("content", "")
    if body_html:
        body_dest = os.path.join(output_dir, "body.html")
        with open(body_dest, "w") as f:
            f.write(body_html)
        saved.append("body.html")

    return saved


def main():
    p = argparse.ArgumentParser(description="Read personal Outlook inbox via Graph API")
    sub = p.add_subparsers(dest="command", required=True)

    p_inbox = sub.add_parser("inbox", help="List recent inbox messages")
    p_inbox.add_argument("--limit", type=int, default=10)
    p_inbox.add_argument("--unread", action="store_true")

    p_search = sub.add_parser("search", help="Search messages")
    p_search.add_argument("--query", help="Full-text search")
    p_search.add_argument("--from", dest="sender", help="Filter by sender address")
    p_search.add_argument("--subject", help="Filter by subject")
    p_search.add_argument("--since", metavar="YYYY-MM-DD")
    p_search.add_argument("--before", metavar="YYYY-MM-DD")
    p_search.add_argument("--limit", type=int, default=10)

    p_read = sub.add_parser("read", help="Read a specific message by ID")
    p_read.add_argument("--id", required=True, help="Message ID")

    args = p.parse_args()
    token = get_access_token()

    if args.command == "inbox":
        cmd_inbox(args, token)
    elif args.command == "search":
        cmd_search(args, token)
    elif args.command == "read":
        cmd_read(args, token)


if __name__ == "__main__":
    main()
