# waitlistme

Add yourself to a [Waitlist.me](https://www.waitlist.me) queue from the command line.

## Usage

```bash
# Add yourself to the Sammamish Cafe waitlist
waitlistme add --name "Jeff" --party 2 --location sammamishcafe

# With phone notification
waitlistme add --name "Jeff" --party 2 --phone "+14255551234" --location sammamishcafe

# Check status
waitlistme status --location sammamishcafe
```

## How it works

Uses the Waitlist.me public widget API (`/api/add_party_remotely_widget`) which is the same endpoint their web widgets use. No API key required — it's the customer-facing self-add flow.

## Adding new locations

Locations are auto-discovered from their Waitlist.me slug (the part after `/w/` in URLs like `waitlist.me/w/sammamishcafe`). Known locations with hardcoded IDs are in the `LOCATIONS` dict for faster lookups.

## Dependencies

Python 3.10+ with stdlib only (uses `urllib`). No pip packages needed.
