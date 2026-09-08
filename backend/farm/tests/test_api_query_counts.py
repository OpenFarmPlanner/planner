"""Query-count regression tests for the farm list endpoints.

Every assertion here pins the number of SQL statements a list response costs.
The point is not the exact number but that it is *constant*: the fixtures below
create three rows per collection, each with its own related records, so any
relation a serializer resolves per row (a missing `select_related`,
`prefetch_related`, or an accidental extra lookup inside a
`SerializerMethodField`) shows up as a failing count instead of as a slow
production endpoint.

When a count changes, first work out whether the change is per-row. Adding one
constant query (a new prefetch) is normally fine; a count that grows with
`ROW_COUNT` is an N+1 and needs a queryset fix, not a bigger number here.
"""

from datetime import date

from django.contrib.auth import get_user_model

from crops.models import (
    CropSpecies,
    CropSpeciesTranslation,
    PublicLibraryModeratorRequest,
)
from farm.models import (
    Bed,
    Crop,
    CropSupplierData,
    EntityRevision,
    Field,
    Location,
    PlantingPlan,
    ProjectApiToken,
    Project,
    ProjectMembership,
    PublicCrop,
    Season,
    SeedPackage,
    Supplier,
    Task,
)
from farm.tests.api_base import ProjectApiTestCase

User = get_user_model()

# Three is enough for an N+1 to change the total, and small enough that a
# failure message stays readable.
ROW_COUNT = 3

# DRF's configured page size. The crop species catalogue is seeded by a data
# migration, so that one list serves a full page instead of the fixture rows.
PAGE_SIZE = 100


class ListEndpointQueryCountTest(ProjectApiTestCase):
    """Each list endpoint must cost the same number of queries for every row."""

    def setUp(self):
        super().setUp()
        # ProjectApiTestCase already provides one location/field/bed/crop/
        # supplier; top the project up to ROW_COUNT of each and give every row
        # the related records its serializer touches.
        self.locations = [self.location]
        self.fields = [self.field]
        self.beds = [self.bed]
        self.crops = [self.crop]
        self.suppliers = [self.supplier]
        self.public_crops = []
        self.seasons = []

        for index in range(ROW_COUNT):
            if index > 0:
                self.locations.append(Location.objects.create(
                    name=f'Location {index}', project=self.project,
                ))
                self.fields.append(Field.objects.create(
                    name=f'Field {index}', location=self.locations[index], project=self.project,
                ))
                self.beds.append(Bed.objects.create(
                    name=f'Bed {index}', field=self.fields[index],
                    area_sqm=20, project=self.project,
                ))
                self.suppliers.append(Supplier.objects.create(
                    name=f'Supplier {index}', homepage_url='https://supplier.example',
                    project=self.project,
                ))

            # One species stays unreviewed so both list serializers resolve
            # `crop_species_status` / `public_crop_species_pending` against a
            # `proposed` row too, not only against published ones.
            species = CropSpecies.objects.create(
                name=f'Query count species {index}',
                status=CropSpecies.STATUS_PROPOSED if index == 0 else CropSpecies.STATUS_PUBLISHED,
            )
            CropSpeciesTranslation.objects.create(
                species=species, language_code='de', common_name=f'Art {index}',
            )
            CropSpeciesTranslation.objects.create(
                species=species, language_code='en', common_name=f'Species {index}',
            )

            crop = self.crops[index] if index == 0 else Crop.objects.create(
                name=f'Crop {index}', variety='Sorte', project=self.project,
                growth_duration_days=30, harvest_duration_days=5,
            )
            if index > 0:
                self.crops.append(crop)
            crop.crop_species = species
            crop.supplier = self.suppliers[index]
            crop.save(update_fields=['crop_species', 'supplier'])

            CropSupplierData.objects.create(
                crop=crop, supplier=self.suppliers[index], project=self.project,
            )
            SeedPackage.objects.create(
                crop=crop, size_value=10, size_unit='g', project=self.project,
            )
            season = Season.objects.create(
                project=self.project, start_date=date(2020 + index, 1, 1), end_date=date(2020 + index, 12, 31),
            )
            self.seasons.append(season)
            plan = PlantingPlan.objects.create(
                crop=crop, bed=self.beds[index], planting_date=date(2026, 4, 1),
                area_usage_sqm=5, project=self.project, season=season,
                created_by=self.user, updated_by=self.user,
            )
            Task.objects.create(title=f'Task {index}', planting_plan=plan, project=self.project)

            public_crop = PublicCrop.objects.create(
                name=f'Public crop {index}', variety='Sorte',
                status=PublicCrop.STATUS_PUBLISHED, crop_species=species, created_by=self.user,
                original_language_code='en',
            )
            self.public_crops.append(public_crop)
            # An imported copy so the serializer's `project_import_status` has
            # something to resolve for every public row. `notes` is set and the
            # copy is left pristine so `description_language_code` reaches into
            # `source_public_crop.original_language_code` -- the relation read
            # this list's query count must keep guarding against an N+1.
            Crop.objects.create(
                name=f'Imported crop {index}', variety='Sorte', project=self.project,
                source_public_crop=public_crop, notes=f'Imported description {index}',
            )

    def assert_list_query_count(
        self, url: str, expected_queries: int, expected_rows: int = ROW_COUNT,
    ) -> None:
        """GET `url` and pin both its query count and how many rows it served.

        The row assertion matters: a count assertion on an accidentally empty
        list would pass while measuring nothing.
        """
        with self.assertNumQueries(expected_queries):
            response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), expected_rows)

    def test_locations_list_query_count(self):
        self.assert_list_query_count('/openfarmplanner/api/locations/', 8)

    def test_fields_list_query_count(self):
        """`location_name` comes from the serializer's dotted source."""
        self.assert_list_query_count('/openfarmplanner/api/fields/', 5)

    def test_beds_list_query_count(self):
        """`field_name` needs `field`, and the layout code needs `field__location`."""
        self.assert_list_query_count('/openfarmplanner/api/beds/', 5)

    def test_suppliers_list_query_count(self):
        self.assert_list_query_count('/openfarmplanner/api/suppliers/', 5)

    def test_crops_list_query_count(self):
        """The heaviest project list: supplier rows, seed packages, species
        translations, the owned-public-crop lookup, that entry's species
        status, the same user's species-level public entry, the general
        Kultur a Sorte inherits from, and the imported copy's
        `description_language_code` (which reads the linked public entry's
        `original_language_code`) are all per-row data that the viewset
        resolves for the whole page."""
        # Each crop created above also has an imported sibling row, so the
        # project holds twice ROW_COUNT crops.
        self.assert_list_query_count(
            '/openfarmplanner/api/crops/', 12, expected_rows=ROW_COUNT * 2,
        )

    def test_crop_supplier_data_list_query_count(self):
        """Rows embed a full nested `SupplierSerializer`."""
        self.assert_list_query_count('/openfarmplanner/api/crop-supplier-data/', 5)

    def test_seed_packages_list_query_count(self):
        self.assert_list_query_count('/openfarmplanner/api/seed-packages/', 5)

    def test_planting_plans_list_query_count(self):
        """Crop, species translations, bed and both audit users per row, plus
        one page-wide lookup of the general Kulturen the plans' Sorten inherit
        their timing from."""
        self.assert_list_query_count('/openfarmplanner/api/planting-plans/', 7)

    def test_tasks_list_query_count(self):
        """`planting_plan_name` renders `PlantingPlan.__str__`, which reads the
        plan's crop and bed."""
        self.assert_list_query_count('/openfarmplanner/api/tasks/', 5)

    def test_public_crops_list_query_count(self):
        """Species translations, description translations, the species status
        behind `crop_species_status` and the active project's imported copies
        are all resolved for the whole page rather than per row."""
        self.assert_list_query_count('/openfarmplanner/api/public-crops/', 8)

    def test_projects_list_query_count(self):
        self.assert_list_query_count('/openfarmplanner/api/projects/', 4, expected_rows=1)

    def test_seasons_list_query_count(self):
        """`planting_plan_count` is a page-wide annotation, not a per-row lookup."""
        self.assert_list_query_count('/openfarmplanner/api/seasons/', 5)

    def test_crop_species_list_query_count(self):
        """The strongest N+1 guard here: the official species catalogue is
        seeded by a data migration, so this list serves a *full* page rather
        than the handful of fixture rows above. Every row renders its whole
        `translations` list and resolves `display_name` through
        `localized_name`; without the viewset's `prefetch_related` that is
        three queries per species, so a regression would show up as roughly
        `3 * PAGE_SIZE` here instead of a constant."""
        self.assert_list_query_count(
            '/openfarmplanner/api/crop-species/', 9, expected_rows=PAGE_SIZE,
        )

    def test_crop_species_list_query_count_includes_proposals(self):
        """A moderator sees proposed rows too, which additionally resolve
        `proposed_by` / `reviewed_by` and their public profiles. Those are
        `select_related`, so a full page still costs a constant number.

        It is *lower* than the anonymous count above rather than higher: the
        non-moderator path filters through `public_species_mapping_targets`,
        whose extra lookups the moderator path skips."""
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])

        self.assert_list_query_count(
            '/openfarmplanner/api/crop-species/?include_proposed=1', 7,
            expected_rows=PAGE_SIZE,
        )

    def test_crop_library_list_query_count(self):
        """The public crop library list serves published entries with their
        species translations resolved for the whole page."""
        self.assert_list_query_count('/openfarmplanner/api/crop-library/', 8)

    def test_moderator_requests_list_query_count(self):
        """Each request resolves the requesting and reviewing user plus both
        public profiles; all four are `select_related`."""
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        for index in range(ROW_COUNT):
            requester = User.objects.create_user(
                username=f'moderator-candidate-{index}',
                email=f'moderator-candidate-{index}@example.com',
                password='pw',
            )
            PublicLibraryModeratorRequest.objects.create(
                user=requester, reviewed_by=self.user, motivation=f'Request {index}',
            )

        self.assert_list_query_count(
            '/openfarmplanner/api/public-library/moderator-requests/', 4,
        )

    def test_projects_bootstrap_query_count(self):
        """`/projects-bootstrap/` serialises one entry per membership and reads
        each membership's project, which `select_related` resolves for the
        whole list."""
        for index in range(ROW_COUNT):
            other_project = Project.objects.create(
                name=f'Extra project {index}', slug=f'extra-project-{index}',
            )
            ProjectMembership.objects.create(
                user=self.user, project=other_project,
                role=ProjectMembership.ROLE_ADMIN,
            )

        with self.assertNumQueries(7):
            response = self.client.get('/openfarmplanner/api/projects-bootstrap/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), ROW_COUNT + 1)

    def test_project_members_query_count(self):
        """Every member row renders `user_email` and `get_full_name()`, both
        read off the `user` relation this view selects."""
        for index in range(ROW_COUNT):
            member = User.objects.create_user(
                username=f'member-{index}', email=f'member-{index}@example.com',
                password='pw', first_name='Mit', last_name=f'Glied {index}',
            )
            ProjectMembership.objects.create(
                user=member, project=self.project,
                role=ProjectMembership.ROLE_MEMBER,
            )

        with self.assertNumQueries(5):
            response = self.client.get(
                f'/openfarmplanner/api/projects/{self.project.pk}/members/',
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), ROW_COUNT + 1)

    def test_yield_calendar_query_count(self):
        """The calendar walks every plan in the year and renders each crop's
        localized name, so it needs the crop, its species and that species'
        translations resolved for the whole set rather than per plan.

        The crops need an `expected_yield` and a harvest date to appear at
        all -- without them the endpoint returns an empty list, and a count
        assertion over nothing would pass while measuring nothing."""
        for crop in self.crops:
            crop.expected_yield = 2
            crop.save(update_fields=['expected_yield'])
        for plan in PlantingPlan.objects.filter(project=self.project):
            plan.harvest_date = date(2026, 6, 1)
            plan.harvest_end_date = date(2026, 6, 21)
            plan.save(update_fields=['harvest_date', 'harvest_end_date'])

        with self.assertNumQueries(5):
            response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.data), 0)

    def test_global_history_list_query_count(self):
        """`/history/global/` is unpaginated and covers 30 days of crop
        revisions, so it can serve far more rows than a page.

        It deliberately has no `select_related`, unlike its project-wide
        sibling: the crop payload reads only plain columns off each revision
        (`user_name`, `display_name`), never `batch_operation` or a user
        relation. This pins that. Adding a field here that reaches through a
        relation would turn the count per-row, and the fix would be a
        `select_related` on the view rather than a bigger number here."""
        crop_revisions = EntityRevision.objects.filter(
            project=self.project, entity_type='crop',
        )
        # The fixture's own crop writes already left revisions behind; add
        # more so the list is comfortably longer than one batch of rows.
        already_recorded = crop_revisions.count()
        for index in range(ROW_COUNT):
            EntityRevision.objects.create(
                project=self.project,
                entity_type='crop',
                object_id=self.crops[index].id,
                action=EntityRevision.ACTION_UPDATED,
                display_name=f'Crop {index}',
                snapshot={'name': f'Crop {index}'},
                user_name='testuser',
            )

        with self.assertNumQueries(4):
            response = self.client.get('/openfarmplanner/api/history/global/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), already_recorded + ROW_COUNT)

    def test_api_tokens_list_query_count(self):
        """`/api-tokens/` is unpaginated, so an N+1 here has no page size to
        cap it. Every row's `project_name` reads through the `project`
        relation, which `select_related` resolves for the whole list."""
        for index in range(ROW_COUNT):
            ProjectApiToken.create_token(
                user=self.user, project=self.project,
                name=f'Token {index}', scope=ProjectApiToken.SCOPE_READ,
                expires_at=None,
            )

        with self.assertNumQueries(3):
            response = self.client.get('/openfarmplanner/api/api-tokens/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), ROW_COUNT)

    def test_project_history_list_query_count(self):
        """`/history/project/` groups revisions by `batch_operation`; the FK is
        `select_related`, so the cost stays constant no matter how many batches
        (here: three deleted seasons, each cascading to three plans)."""
        for index in range(ROW_COUNT):
            season = Season.objects.create(
                project=self.project,
                start_date=date(2030 + index, 1, 1),
                end_date=date(2030 + index, 12, 31),
            )
            for day in (1, 8, 15):
                PlantingPlan.objects.create(
                    crop=self.crop, bed=self.bed, project=self.project,
                    season=season, planting_date=date(2030 + index, 4, day),
                )
            self.client.delete(f'/openfarmplanner/api/seasons/{season.pk}/')

        with self.assertNumQueries(4):
            response = self.client.get('/openfarmplanner/api/history/project/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sum(1 for entry in response.data if entry.get('is_batch')), ROW_COUNT)
