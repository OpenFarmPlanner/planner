from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from .models import AccountTrustProfile

User = get_user_model()


def _plausible_usage_count(user: User) -> int:
    """Count the user's own crops/planting plans across projects they belong to.

    Used only as a coarse "this looks like a real gardener, not a bulk-write
    bot" signal for trust promotion — not an ownership or permission check.
    """
    from farm.models import Crop, PlantingPlan

    crop_count = Crop.objects.filter(project__memberships__user=user, deleted_at__isnull=True).count()
    plan_count = PlantingPlan.objects.filter(project__memberships__user=user).count()
    return crop_count + plan_count


def _is_eligible_for_established_trust(user: User, *, now) -> bool:
    min_age_days = int(getattr(settings, 'TRUST_ESTABLISHED_MIN_AGE_DAYS', 7))
    min_activity = int(getattr(settings, 'TRUST_ESTABLISHED_MIN_ACTIVITY', 3))
    account_age = now - user.date_joined
    if account_age.days < min_age_days:
        return False
    return _plausible_usage_count(user) >= min_activity


def resolve_trust_level(user: User, *, now=None) -> str:
    """Return the account's current trust level, promoting it if eligible.

    Promotion from `AccountTrustProfile.TRUST_NEW` to `TRUST_ESTABLISHED` is
    lazy: it is decided the next time this function runs for that user rather
    than on a schedule, so it needs no cron/management-command infrastructure.
    See docs/account-trust-levels.md.
    """
    profile, _created = AccountTrustProfile.objects.get_or_create(user=user)
    if profile.trust_level != AccountTrustProfile.TRUST_NEW:
        return profile.trust_level

    resolved_now = now or timezone.now()
    if _is_eligible_for_established_trust(user, now=resolved_now):
        profile.trust_level = AccountTrustProfile.TRUST_ESTABLISHED
        profile.established_at = resolved_now
        profile.save(update_fields=['trust_level', 'established_at', 'updated_at'])

    return profile.trust_level


def grant_established_trust(user: User, *, now=None) -> AccountTrustProfile:
    """Force an account straight to `TRUST_ESTABLISHED`, bypassing the eligibility check.

    For tests that need to exercise the pre-existing direct-edit/publish
    behavior without also setting up account age and activity fixtures, and
    for any future admin tooling that needs to grandfather an account in.
    """
    resolved_now = now or timezone.now()
    profile, _created = AccountTrustProfile.objects.get_or_create(user=user)
    profile.trust_level = AccountTrustProfile.TRUST_ESTABLISHED
    profile.established_at = resolved_now
    profile.save(update_fields=['trust_level', 'established_at', 'updated_at'])
    return profile
