"""DRF serializers for the projects domain (projects, memberships, invitations)."""

from rest_framework import serializers

from farm.models import Project, ProjectInvitation, ProjectMembership
from farm.services.bed_capacity import MAX_SUCCESSION_MIN_DAYS


class ProjectSerializer(serializers.ModelSerializer):
    succession_min_days_after_harvest_start = serializers.IntegerField(
        min_value=0,
        max_value=MAX_SUCCESSION_MIN_DAYS,
        required=False,
        help_text=(
            'Days after the harvest start of a crop before a follow-up crop may take over '
            'its bed (harvest, clearing and bed preparation).'
        ),
    )

    class Meta:
        model = Project
        fields = [
            'id', 'name', 'slug', 'description', 'region', 'is_active', 'deleted_at',
            'created_at', 'updated_at',
            'allow_succession_during_harvest', 'succession_min_days_after_harvest_start',
        ]
        read_only_fields = ['id', 'slug', 'is_active', 'deleted_at', 'created_at', 'updated_at']


class ProjectMembershipSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source='user.email', read_only=True)
    user_display_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectMembership
        fields = ['id', 'user', 'user_email', 'user_display_name', 'project', 'role', 'created_at']
        read_only_fields = ['id', 'created_at', 'project']

    def get_user_display_name(self, obj: ProjectMembership) -> str:
        """Return the member's account display name."""
        return obj.user.get_full_name()


class ProjectInvitationSerializer(serializers.ModelSerializer):
    resolved_status = serializers.CharField(read_only=True)

    class Meta:
        model = ProjectInvitation
        fields = [
            'id',
            'project',
            'email',
            'email_normalized',
            'role',
            'token',
            'status',
            'resolved_status',
            'invited_by',
            'accepted_by',
            'accepted_at',
            'expires_at',
            'revoked_at',
            'revoked_by',
            'message',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'token',
            'status',
            'email_normalized',
            'accepted_by',
            'accepted_at',
            'expires_at',
            'revoked_at',
            'revoked_by',
            'created_at',
            'updated_at',
            'project',
            'invited_by',
        ]


class InvitationTokenSerializer(serializers.Serializer):
    token = serializers.CharField()
