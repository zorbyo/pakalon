"""Build configuration for Pakalon backend.

Provides build-time configuration and validation.
"""

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


class BuildConfig:
    """Build-time configuration."""

    def __init__(self):
        self.build_target = os.environ.get("BUILD_TARGET", "oss")
        self.is_cloud_build = self.build_target == "cloud"
        self.is_oss_build = self.build_target == "oss"

        # Feature flags based on build target
        self.features = {
            "openrouter": self.is_cloud_build,
            "auth": self.is_cloud_build,
            "session_limits": self.is_cloud_build,
            "pro_models": self.is_cloud_build,
            "analytics": self.is_cloud_build,
            "local_models": True,
            "cloud_providers": self.is_cloud_build,
            "billing": self.is_cloud_build,
            "subscriptions": self.is_cloud_build,
            "audit_logging": self.is_cloud_build,
            "rate_limiting": self.is_cloud_build,
        }

    def log_build_info(self) -> None:
        """Log build information."""
        if self.is_oss_build:
            logger.info("Building Open-Source version")
            logger.info("- Local models only (Ollama, LM Studio)")
            logger.info("- No OpenRouter integration")
            logger.info("- No authentication required")
        else:
            logger.info("Building Cloud version")
            logger.info("- All model providers available")
            logger.info("- OpenRouter integration enabled")
            logger.info("- Authentication required")

    def get_feature_flags(self) -> dict[str, bool]:
        """Get feature flags for this build."""
        return self.features.copy()

    def is_feature_enabled(self, feature: str) -> bool:
        """Check if a feature is enabled."""
        return self.features.get(feature, False)


# Global instance
_build_config: BuildConfig | None = None


def get_build_config() -> BuildConfig:
    """Get the global build configuration."""
    global _build_config
    if _build_config is None:
        _build_config = BuildConfig()
    return _build_config


def initialize_build_config() -> BuildConfig:
    """Initialize and return build configuration."""
    config = get_build_config()
    config.log_build_info()
    return config
