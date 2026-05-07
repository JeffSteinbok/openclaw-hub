# Writing Custom USPS Mail Rules

USPS classification rules let you override the default importance assigned to individual mailpieces based on what the vision analysis extracted. This document explains the rule engine and how to write effective rules for non-obvious cases.

## How rules work

After the vision agent analyzes a scan image it returns a normalized mailpiece dict:

```json
{
  "sender": "County Assessor",
  "addressee": "Jane Doe",
  "description": "Property tax assessment notice in a standard envelope",
  "type": "scan",
  "importance": "medium",
  "mail_class": "First-Class Mail",
  "address_method": "window"
}
```

The rule engine then walks your `rules.json` in order and applies the **first matching rule**. If a rule matches, its `importance` replaces the default. If nothing matches, the vision-assigned importance stands.

Rules are stored at:

```
~/.openclaw/agents/<workspace_agent>/workspace/usps-mail/rules.json
```

## Rule schema

```json
{
  "version": "1.2",
  "rules": [
    {
      "_comment": "Human-readable note about this rule",
      "<field>_<operator>": "<value>",
      "importance": "<level>"
    }
  ]
}
```

### Fields

| Field | What it comes from |
|-------|--------------------|
| `sender` | Name or return address the vision agent extracted |
| `addressee` | Name on the address label |
| `description` | Full free-text description the vision agent wrote |
| `mail_class` | USPS mail class (e.g. `First-Class Mail`, `Presorted Standard`) |
| `address_method` | How the address is applied: `window`, `label`, `handwritten`, `direct` |

### Operators

All comparisons are **case-insensitive**.

| Operator | Meaning |
|----------|---------|
| `<field>_contains` | The field must include this substring |
| `<field>_not_contains` | The field must NOT include this substring |
| `<field>_equals` | Exact normalized match |
| `<field>_not_equals` | Exact normalized mismatch |

### Importance levels

| Level | Badge | When to use |
|-------|-------|-------------|
| `urgent` | 🚨 Urgent | Time-sensitive: credit cards, legal, government notices |
| `high` | ⚠️ Important | Things you should act on soon: bills, insurance, utilities |
| `medium` | 📬 Medium | Informational, non-urgent |
| `low` | 📭 Low | Former residents, proxy votes, things you'll check eventually |
| `junk` | 🗑️ Junk | Marketing, solicitations, nonprofit fundraising |
| `ad` | 📢 Ad | Advertising circulars |

## Multiple conditions

Rules can combine multiple conditions — all conditions in a rule must match (logical AND) before it fires:

```json
{
  "_comment": "Unknown sender + PO Box + not Standard class = probably a credit card",
  "sender_contains": "unknown",
  "description_contains": "po box",
  "description_not_contains": "standard",
  "importance": "urgent"
}
```

This rule only matches if:
- the vision agent couldn't identify the sender **AND**
- the return address is a PO Box **AND**
- the mail class isn't Standard (which rules out most marketing)

## Rule ordering matters

Rules are **first match wins**. Put more specific rules before more general ones.

**Example — correct ordering:**

```json
[
  {
    "_comment": "Cardmember Service with named bank = statement → high",
    "sender_contains": "cardmember",
    "importance": "high"
  },
  {
    "_comment": "No sender name at all = could be credit card → urgent",
    "description_contains": "no sender name",
    "importance": "urgent"
  }
]
```

If you reversed these, a "Cardmember Service" envelope would hit the "no sender name" rule first and incorrectly become `urgent`.

## Patterns that work well

### Former/previous residents

Mail to people who no longer live at your address is common and almost never matters:

```json
{
  "_comment": "Former resident: Smith family",
  "addressee_contains": "smith",
  "importance": "low"
}
```

### Known high-priority senders

Name-match against senders you always want to notice:

```json
{
  "_comment": "Health insurance EOBs and notices",
  "sender_contains": "premera",
  "importance": "high"
}
```

```json
{
  "_comment": "Utility district bills",
  "sender_contains": "sewer",
  "importance": "high"
}
```

### Credit card / bank envelope detection

Credit card mailers are often the most important thing in a daily delivery. When the sender is obscured or uses a PO Box, the vision description is your main signal:

```json
{
  "_comment": "Window envelope, no visible sender = bank or credit card",
  "description_contains": "no sender name",
  "description_not_contains": "label",
  "address_method_not_equals": "label",
  "importance": "urgent"
}
```

```json
{
  "_comment": "Plain white envelope + unknown sender = credit card pattern",
  "sender_contains": "unknown",
  "description_contains": "plain white",
  "description_not_contains": "standard",
  "importance": "urgent"
}
```

### Specific return address or company

If you know a particular company's return address or ZIP city:

```json
{
  "_comment": "CPC Services in Westerville OH = Chase credit card processor",
  "description_contains": "westerville",
  "importance": "urgent"
}
```

```json
{
  "_comment": "CPC Services sender name variant",
  "sender_contains": "cpc",
  "importance": "urgent"
}
```

### Demote by mail class

Presorted Standard / nonprofit mail is almost always marketing:

```json
{
  "_comment": "Nonprofit mail class = fundraising mailer",
  "mail_class_contains": "nonprofit",
  "importance": "junk"
}
```

### Promote by description keyword

Certain description words reliably indicate personal or important mail:

```json
{
  "_comment": "Handwritten = personal letter",
  "description_contains": "handwritten",
  "importance": "high"
}
```

```json
{
  "_comment": "Personal letter pattern in description",
  "description_contains": "personal letter",
  "importance": "high"
}
```

### Subject-matter keywords in description

The vision agent writes a fairly detailed free-text description. You can match on what it says:

```json
{
  "_comment": "Any mention of property tax → high",
  "description_contains": "property tax",
  "importance": "high"
}
```

```json
{
  "_comment": "Real estate solicitations → junk",
  "description_contains": "real estate",
  "importance": "junk"
}
```

## Managing rules with the OpenClaw tools

You don't have to edit `rules.json` by hand. The `usps-mail` plugin exposes tool-level helpers:

```
usps_update_rule  action=add    workspace_agent=mail
usps_update_rule  action=remove workspace_agent=mail  index=3
usps_rules        workspace_agent=mail                # list all
usps_rules        workspace_agent=mail  test_mailpiece={...}  # test a match
```

When you add or remove via the tool the version string in `rules.json` is bumped automatically.

## Testing before committing

Use `usps_rules` with a `test_mailpiece` to verify a rule fires the way you expect before real mail goes through it:

```json
{
  "sender": "unknown",
  "addressee": "Jeff Steinbok",
  "description": "plain white window envelope, no visible sender name, PO Box 44921",
  "mail_class": "First-Class Mail",
  "address_method": "window",
  "importance": "medium"
}
```

The tool returns `original_importance`, `final_importance`, `rule_matched`, and the rules version so you can confirm your new rule is actually firing.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Putting a broad rule before a narrow one | Reorder — first match wins |
| Matching on `sender_contains: "unknown"` for everything | Pair it with a second condition to narrow scope |
| Using `_equals` when the vision description includes extra words | Use `_contains` instead; the description field is free text |
| Forgetting that all conditions must match (AND, not OR) | Write separate rules for separate cases |
| Over-specifying a rule so it never fires | Drop conditions one by one and test until it matches |
