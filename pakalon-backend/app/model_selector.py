"""Model selection algorithm for Pakalon backend.

Intelligent provider selection based on health, latency, and capabilities.
"""

import logging
from dataclasses import dataclass, field

from app.health import ProviderHealth, health_checker
from app.providers import ModelProvider, get_registry

logger = logging.getLogger(__name__)


@dataclass
class ModelRequirements:
    """Requirements for model selection."""

    min_context_window: int = 4096
    max_latency: float = 5000.0
    preferred_providers: list[str] = field(default_factory=list)
    exclude_providers: list[str] = field(default_factory=list)
    require_capabilities: list[str] = field(default_factory=list)
    prefer_local: bool = False


@dataclass
class ModelScore:
    """Scored provider candidate."""

    provider: ModelProvider
    score: float
    health: ProviderHealth | None = None
    reasons: list[str] = field(default_factory=list)


class ModelSelector:
    """Selects the best provider based on requirements and health."""

    def __init__(self):
        self._registry = get_registry()

    async def select_model(
        self,
        requirements: ModelRequirements | None = None,
    ) -> ModelProvider | None:
        """Select the best provider based on requirements."""
        reqs = requirements or ModelRequirements()

        # Get enabled providers
        providers = self._registry.get_enabled_providers()
        if not providers:
            logger.warning("No enabled providers available")
            return None

        # Score each provider
        candidates: list[ModelScore] = []
        for provider in providers:
            score = await self._score_provider(provider, reqs)
            if score:
                candidates.append(score)

        if not candidates:
            logger.warning("No providers matched requirements")
            return None

        # Sort by score (highest first)
        candidates.sort(key=lambda c: c.score, reverse=True)

        best = candidates[0]
        logger.info(
            f"Selected provider: {best.provider.id} "
            f"(score={best.score:.1f}, reasons={best.reasons})"
        )
        return best.provider

    async def _score_provider(
        self,
        provider: ModelProvider,
        requirements: ModelRequirements,
    ) -> ModelScore | None:
        """Score a provider against requirements."""
        # Check excluded providers
        if provider.id in requirements.exclude_providers:
            return None

        # Check capabilities
        if requirements.require_capabilities:
            has_all = all(
                cap in provider.capabilities
                for cap in requirements.require_capabilities
            )
            if not has_all:
                return None

        # Get health status
        health = health_checker.get_health(provider.id)
        score = 0.0
        reasons: list[str] = []

        # Health score (0-100)
        if health:
            if health.status == "healthy":
                score += 100
                reasons.append("healthy")
            elif health.status == "degraded":
                score += 50
                reasons.append("degraded")
            else:
                # Provider is down, skip unless it's the only option
                score += 0
                reasons.append("down")

            # Latency penalty
            if health.latency_ms > requirements.max_latency:
                score -= 50
                reasons.append(f"high latency ({health.latency_ms:.0f}ms)")
        else:
            # No health data, give neutral score
            score += 25
            reasons.append("no health data")

        # Provider preference score
        if provider.id in requirements.preferred_providers:
            score += 30
            reasons.append("preferred")

        # Local preference score
        if requirements.prefer_local and provider.provider_type == "local":
            score += 20
            reasons.append("local preferred")

        # Provider type bonus (local providers are generally faster)
        if provider.provider_type == "local":
            score += 10
            reasons.append("local provider")

        return ModelScore(
            provider=provider,
            score=score,
            health=health,
            reasons=reasons,
        )

    async def get_available_models(self) -> list[dict]:
        """Get list of available models from all providers."""
        providers = self._registry.get_enabled_providers()
        models = []

        for provider in providers:
            health = health_checker.get_health(provider.id)
            models.append({
                "provider_id": provider.id,
                "provider_name": provider.name,
                "provider_type": provider.provider_type,
                "enabled": provider.enabled,
                "capabilities": provider.capabilities,
                "health_status": health.status if health else "unknown",
                "latency_ms": health.latency_ms if health else None,
            })

        return models


# Global instance
model_selector = ModelSelector()
