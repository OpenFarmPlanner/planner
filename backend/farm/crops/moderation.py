"""Decides when a public-crop-library contribution must go through the
moderation queue (`PublicCropChangeProposal`) instead of applying live.

See docs/account-trust-levels.md and the "Legacy reviewed change proposals"
section of docs/crop-library-architecture.md.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.conf import settings

from accounts.models import AccountTrustProfile
from accounts.trust import resolve_trust_level
from farm.agent_api.permissions import client_declared_as_agent, get_request_api_token

if TYPE_CHECKING:
    from rest_framework.request import Request


def requires_moderation_queue(request: Request) -> bool:
    """Whether this request's crop-library contribution must be queued for review.

    True for any API-token-authenticated write (regardless of scope — a
    project's own established members still queue when writing through a
    token) and for any session user whose account is still at the "new"
    trust level. Established, session-authenticated users keep the existing
    direct-edit/publish behavior.
    """
    if get_request_api_token(request) is not None:
        return True
    user = getattr(request, 'user', None)
    if user is None or not user.is_authenticated:
        return False
    return resolve_trust_level(user) == AccountTrustProfile.TRUST_NEW


def describe_contribution_origin(request: Request) -> tuple[bool, bool]:
    """Return (origin_api, origin_declared_agent) for a proposal's provenance flags."""
    origin_api = get_request_api_token(request) is not None
    origin_declared_agent = client_declared_as_agent(request)
    return origin_api, origin_declared_agent


def pending_queue_limit_exceeded(request: Request) -> bool:
    """Whether this request's author already has too many proposals awaiting review.

    Bounds how far a single account (or, more likely in practice, a token
    routed into the queue by `requires_moderation_queue`) can flood the
    moderation queue while contributions are still pending a human decision.
    Rejecting new proposals here is independent of the write-rate throttles
    (`accounts.throttling.TrustAwareWriteRateThrottle`,
    `farm.agent_api.throttling`): those bound requests per hour, this bounds
    standing backlog regardless of how slowly it was built up.
    """
    from farm.models import PublicCropChangeProposal

    user = getattr(request, 'user', None)
    if user is None or not user.is_authenticated:
        return False
    limit = int(getattr(settings, 'PUBLIC_CROP_MAX_PENDING_PROPOSALS_PER_USER', 20))
    pending_count = PublicCropChangeProposal.objects.filter(
        proposed_by=user,
        status=PublicCropChangeProposal.STATUS_PENDING,
    ).count()
    return pending_count >= limit
