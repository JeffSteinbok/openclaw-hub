# FastMail SSE Tests

Unit tests for the FastMail SSE daemon using Python's `unittest` framework.

## Running Tests

### Run all tests:
```bash
cd /path/to/openclaw/services/fastmail-sse
python3 tests/test_fastmail_sse.py
```

### Run with pytest (if available):
```bash
cd /path/to/openclaw/services/fastmail-sse
python3 -m pytest tests/test_fastmail_sse.py -v
```

### Run specific test class:
```bash
python3 tests/test_fastmail_sse.py TestConfigLoading
```

## Test Coverage

The test suite covers:

### 1. Configuration Loading (TestConfigLoading)
- Valid configuration file loading
- Missing configuration file handling
- Invalid JSON handling
- Empty accounts validation
- Multiple accounts support

### 2. Rule-Based Notification Logic (TestShouldNotify)
- `notify_all` rule behavior
- `notify_meeting_updates` rule for calendar responses
- Rule combination handling
- Edge cases (missing subject, no rules, etc.)

### 3. Message Formatting (TestFormatMessage)
- Regular email formatting
- Calendar response formatting (accepted/declined/tentative)
- Spam filtering (unsubscribe, noreply, no-reply)
- Sender name extraction
- Case-insensitive filtering

### 4. Email Body Extraction (TestGetEmailBodyText)
- Text body part extraction
- Multiple parts handling
- Fallback to any available body value
- Missing body handling

### 5. Package Tracking Detection (TestScanAndAddPackages)
- UPS tracking number detection and addition
- Empty body handling
- No tracking numbers scenario
- Error handling when adding packages
- Exception handling

### 6. State Management (TestStateManagement)
- State file loading
- State file saving (atomic writes)
- Corrupt file handling
- Missing file handling

## Test Statistics

- **Total Tests**: 40
- **Test Classes**: 6
- **All tests passing**: ✓

## Notes

- Tests use `unittest.mock` to avoid external dependencies
- No network calls are made during testing
- State and configuration files are mocked
- Package tracking integration is mocked to avoid filesystem dependencies
