from waste_equity_ingestion.samples import build_envelope, sanitize


def test_sanitize_redacts_credential_like_fields() -> None:
    payload = {
        "serviceKey": "real-key",
        "SERVICEKEY": "upper-real-key",
        "nested": {"accessToken": "token", "safe": "value"},
        "items": [{"key": "vworld-key"}],
        "USRID": "rcis-user-id",
    }

    sanitized = sanitize(payload)

    assert sanitized["serviceKey"] == "[REDACTED]"
    assert sanitized["SERVICEKEY"] == "[REDACTED]"
    assert sanitized["nested"]["accessToken"] == "[REDACTED]"
    assert sanitized["nested"]["safe"] == "value"
    assert sanitized["items"][0]["key"] == "[REDACTED]"
    assert sanitized["USRID"] == "[REDACTED]"


def test_sample_envelope_requires_explicit_status() -> None:
    envelope = build_envelope(
        source="fixture",
        endpoint="fixture_endpoint",
        payload={"response": {"header": {"resultCode": "00"}}},
        verification_status="FIXTURE_ONLY",
        schema_validation_status="FIXTURE_ONLY",
        request_metadata={"RCIS_USER_ID": "rcis-user-id"},
    )

    assert envelope.verification_status == "FIXTURE_ONLY"
    assert envelope.schema_validation_status == "FIXTURE_ONLY"
    assert envelope.request_metadata["RCIS_USER_ID"] == "[REDACTED]"
