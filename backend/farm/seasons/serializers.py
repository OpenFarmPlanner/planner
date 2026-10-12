"""DRF serializers for the seasons domain (Season, SeasonPattern)."""

from rest_framework import serializers

from farm.models import PlantingPlan, Season, SeasonPattern
from farm.services.crop_rotation import COPY_CONFLICT_MODES, COPY_CONFLICTS_KEEP


class SeasonSerializer(serializers.ModelSerializer):
    label = serializers.CharField(read_only=True)
    computed_label = serializers.CharField(read_only=True)
    planting_plan_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Season
        fields = [
            'id',
            'project',
            'start_date',
            'end_date',
            'custom_label',
            'label',
            'computed_label',
            'planting_plan_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['project', 'created_at', 'updated_at']

    def validate(self, attrs):
        start_date = attrs.get('start_date') or (
            self.instance.start_date if self.instance else None
        )
        end_date = attrs.get('end_date') or (self.instance.end_date if self.instance else None)
        if start_date is not None and end_date is not None and end_date <= start_date:
            raise serializers.ValidationError({'end_date': 'End date must be after start date.'})
        request = self.context.get('request')
        project = getattr(request, 'active_project', None)
        if project is None or start_date is None or end_date is None:
            return attrs

        if self.instance is None:
            self._validate_new_season_period(project, start_date, end_date)
        elif 'start_date' in attrs or 'end_date' in attrs:
            self._validate_period_edit(project, start_date, end_date)
        return attrs

    def _validate_new_season_period(self, project, start_date, end_date) -> None:
        if self._overlapping_seasons(project, start_date, end_date).exists():
            raise serializers.ValidationError(
                'Season dates must not overlap an existing season.',
            )
        self._validate_unassigned_planting_plans_fit(project, start_date, end_date)

    def _overlapping_seasons(self, project, start_date, end_date):
        overlapping = Season.objects.filter(
            project=project,
            start_date__lte=end_date,
            end_date__gte=start_date,
        )
        if self.instance is not None:
            overlapping = overlapping.exclude(pk=self.instance.pk)
        return overlapping.order_by('start_date')

    def _validate_period_edit(self, project, start_date, end_date) -> None:
        """Reject a period change while assigned plans or neighbouring seasons conflict.

        Only `planting_date` is range-checked — harvest dates legitimately fall
        after a season's end. The user must move the listed plans (or resolve
        the overlap) before the period can change; nothing is shifted silently.
        """
        planting_plan_conflicts = [
            {
                'id': plan.pk,
                'label': str(plan),
                'crop': plan.crop.name if plan.crop_id else '',
                'planting_date': plan.planting_date.isoformat(),
            }
            for plan in (
                PlantingPlan.objects
                .filter(season=self.instance)
                .exclude(planting_date__isnull=True)
                .select_related('crop')
                .order_by('planting_date', 'pk')
            )
            if not start_date <= plan.planting_date <= end_date
        ]
        overlap_conflicts = [
            {
                'season_id': season.pk,
                'season_label': season.label,
                'overlap_start_date': max(start_date, season.start_date).isoformat(),
                'overlap_end_date': min(end_date, season.end_date).isoformat(),
            }
            for season in self._overlapping_seasons(project, start_date, end_date)
        ]
        if not planting_plan_conflicts and not overlap_conflicts:
            return
        raise serializers.ValidationError({
            'code': 'season_period_edit_conflict',
            'detail': (
                'The season period cannot be changed while planting plans or '
                'neighbouring seasons conflict with it.'
            ),
            'planting_plan_conflicts': planting_plan_conflicts,
            'overlap_conflicts': overlap_conflicts,
        })

    def _validate_unassigned_planting_plans_fit(self, project, start_date, end_date) -> None:
        """Reject a new season if legacy unassigned plans would fall outside it."""
        conflicts = []
        conflict_count = 0
        plans = (
            PlantingPlan.objects
            .filter(project=project, season__isnull=True)
            .select_related('crop', 'bed')
            .order_by('planting_date', 'pk')
        )
        for plan in plans:
            active_period = plan._get_active_period()
            if active_period is None:
                continue
            active_start, active_end = active_period
            if start_date <= active_start and active_end <= end_date:
                continue
            conflict_count += 1
            if len(conflicts) < 3:
                conflicts.append({
                    'id': plan.pk,
                    'label': str(plan),
                    'active_start_date': active_start.isoformat(),
                    'active_end_date': active_end.isoformat(),
                })

        if conflict_count == 0:
            return

        raise serializers.ValidationError({
            'code': 'season_unassigned_data_outside_period',
            'detail': (
                'Season cannot be created because existing unassigned planting '
                'plans fall outside the selected period.'
            ),
            'conflict_count': conflict_count,
            'conflicts': conflicts,
        })


class SeasonPatternSerializer(serializers.ModelSerializer):
    class Meta:
        model = SeasonPattern
        fields = ['id', 'project', 'start_day', 'start_month', 'created_at', 'updated_at']
        read_only_fields = ['project', 'created_at', 'updated_at']

    def validate_start_day(self, value):
        if not 1 <= value <= 31:
            raise serializers.ValidationError('Start day must be between 1 and 31.')
        return value

    def validate_start_month(self, value):
        if not 1 <= value <= 12:
            raise serializers.ValidationError('Start month must be between 1 and 12.')
        return value


class SeasonCopyFromSerializer(serializers.Serializer):
    source_season_id = serializers.IntegerField()
    rotation_conflicts = serializers.ChoiceField(
        choices=COPY_CONFLICT_MODES,
        default=COPY_CONFLICTS_KEEP,
        help_text=(
            'What to do with copies that would break the crop rotation on their bed: '
            '"keep" (same bed, conflict stays marked), "without_bed" (copied without a bed) '
            'or "skip" (not copied).'
        ),
    )
