from typing import Any


def get_public_user_label(user: Any) -> str:
    """Only an explicitly chosen public name may identify a public contributor."""
    if user is None:
        return ''
    public_profile = getattr(user, 'public_profile', None)
    if public_profile and public_profile.public_display_name:
        return public_profile.public_display_name
    return ''
