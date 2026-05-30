"""Tests for feature gating system."""

import pytest
from app.features import (
    FeatureFlags,
    OSS_FEATURES,
    CLOUD_FEATURES,
    SELFHOSTED_FEATURES,
    get_feature_flags,
    is_feature_enabled,
    get_available_providers,
)


class TestFeatureFlags:
    """Test feature flags system."""

    def test_oss_features_openrouter_disabled(self):
        """OSS features should have OpenRouter disabled."""
        assert OSS_FEATURES.openrouter is False

    def test_oss_features_local_models_enabled(self):
        """OSS features should have local models enabled."""
        assert OSS_FEATURES.local_models is True

    def test_cloud_features_openrouter_enabled(self):
        """Cloud features should have OpenRouter enabled."""
        assert CLOUD_FEATURES.openrouter is True

    def test_cloud_features_auth_enabled(self):
        """Cloud features should have auth enabled."""
        assert CLOUD_FEATURES.auth is True

    def test_selfhosted_features_openrouter_disabled(self):
        """Self-hosted features should have OpenRouter disabled."""
        assert SELFHOSTED_FEATURES.openrouter is False

    def test_selfhosted_features_local_models_enabled(self):
        """Self-hosted features should have local models enabled."""
        assert SELFHOSTED_FEATURES.local_models is True

    def test_feature_flags_model_dump(self):
        """Feature flags should be serializable."""
        flags = FeatureFlags()
        dump = flags.model_dump()
        assert isinstance(dump, dict)
        assert "openrouter" in dump
        assert "local_models" in dump


class TestFeatureFlagFunctions:
    """Test feature flag functions."""

    def test_is_feature_enabled_local_models(self):
        """Local models should be enabled."""
        assert is_feature_enabled("local_models") is True

    def test_get_available_providers_includes_local(self):
        """Available providers should include local providers."""
        providers = get_available_providers()
        assert "ollama" in providers
        assert "lmstudio" in providers


class TestProviderRegistry:
    """Test provider registry system."""

    def test_provider_registration(self):
        """Providers should be registered correctly."""
        from app.providers import ProviderRegistry, ModelProvider, ProviderConfig

        registry = ProviderRegistry()
        provider = ModelProvider(
            id="test",
            name="Test Provider",
            provider_type="local",
            enabled=True,
            config=ProviderConfig(base_url="http://localhost:8080"),
        )
        registry.register_provider(provider)
        assert registry.is_provider_available("test")

    def test_cloud_provider_disabled_in_selfhosted(self):
        """Cloud providers should be disabled in self-hosted mode."""
        from app.providers import ProviderRegistry, ModelProvider, ProviderConfig
        from app.features import SELFHOSTED_FEATURES

        registry = ProviderRegistry()
        registry._features = SELFHOSTED_FEATURES
        provider = ModelProvider(
            id="test-cloud",
            name="Test Cloud Provider",
            provider_type="cloud",
            enabled=True,
            config=ProviderConfig(base_url="https://api.example.com"),
        )
        registry.register_provider(provider)
        assert not registry.is_provider_available("test-cloud")


class TestSecurityValidator:
    """Test security validation."""

    def test_redact_api_key(self):
        """API keys should be redacted correctly."""
        from app.security import SecurityValidator

        assert SecurityValidator.redact_api_key("sk-1234567890abcdef") == "sk-1...cdef"
        assert SecurityValidator.redact_api_key("short") == "***"
        assert SecurityValidator.redact_api_key("") == "***"

    def test_sanitize_env(self):
        """Sensitive environment variables should be sanitized."""
        from app.security import SecurityValidator

        env = {
            "OPENROUTER_API_KEY": "sk-test-key",
            "DATABASE_URL": "postgresql://localhost/db",
            "JWT_SECRET": "super-secret",
        }
        sanitized = SecurityValidator.sanitize_env(env)
        assert sanitized["OPENROUTER_API_KEY"] == "***REDACTED***"
        assert sanitized["DATABASE_URL"] == "postgresql://localhost/db"
        assert sanitized["JWT_SECRET"] == "***REDACTED***"
