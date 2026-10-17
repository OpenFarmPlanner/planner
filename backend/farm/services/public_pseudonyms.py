"""Per-thread pseudonyms for public crop library authors without a public name.

Authors who never set ``PublicProfile.public_display_name`` are shown as
"Anonymous N". The number is scoped to one discussion topic (or one library
entry's revision history) and assigned in order of the author's first
contribution there, so it cannot link the same person across topics or
entries. See docs/crop-library-architecture.md.
"""

from collections.abc import Iterable
from typing import Any

from farm.models import PublicCropDiscussionComment, PublicCropDiscussionTopic


def has_public_name(user: Any) -> bool:
    public_profile = getattr(user, 'public_profile', None) if user is not None else None
    return bool(public_profile and public_profile.public_display_name)


def number_anonymous_authors(authors_in_order: Iterable[Any]) -> dict[int, int]:
    """Map user id → pseudonym number for authors without a public name.

    ``authors_in_order`` yields users (or None for deleted accounts) in
    contribution order; repeated users keep their first number.
    """
    numbers: dict[int, int] = {}
    seen: set[int] = set()
    for user in authors_in_order:
        if user is None or user.pk in seen:
            continue
        seen.add(user.pk)
        if not has_public_name(user):
            numbers[user.pk] = len(numbers) + 1
    return numbers


def number_topic_authors(
    topic: PublicCropDiscussionTopic,
    comments: Iterable[PublicCropDiscussionComment] | None = None,
) -> dict[int, int]:
    """Pseudonym numbers for a topic; the topic starter always comes first.

    Pass the topic's already loaded comments (deleted ones included) to avoid
    a query; otherwise they are fetched once.
    """
    if comments is None:
        comments = topic.comments.select_related('created_by__public_profile').order_by('created_at', 'id')
    ordered = sorted(comments, key=lambda comment: (comment.created_at, comment.id))
    return number_anonymous_authors([topic.created_by, *(comment.created_by for comment in ordered)])
