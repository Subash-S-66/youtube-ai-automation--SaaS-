import pytest
from youtube_ai_automation.gemini_utils import execute_with_gemini_fallback, get_gemini_api_keys

def test_get_gemini_api_keys(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "key1, key2 ,key3")
    keys = get_gemini_api_keys()
    assert keys == ["key1", "key2", "key3"]

    monkeypatch.delenv("GEMINI_API_KEYS", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "single_key")
    keys = get_gemini_api_keys()
    assert keys == ["single_key"]

def test_execute_with_gemini_fallback_success(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "key1,key2")

    def operation(key):
        if key == "key1":
            raise Exception("429 Too Many Requests")
        return f"Success with {key}"

    result = execute_with_gemini_fallback(operation)
    assert result == "Success with key2"

def test_execute_with_gemini_fallback_all_fail(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "key1,key2")

    def operation(key):
        raise Exception("429 quota")

    with pytest.raises(RuntimeError) as excinfo:
        execute_with_gemini_fallback(operation)
    assert "All 2 Gemini API keys failed" in str(excinfo.value)
