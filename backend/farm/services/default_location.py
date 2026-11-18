"""Name of the location every new project gets automatically.

The first location takes the project's name (#1190). Both are user content:
the name is stored as written, never translated, and a later rename of the
project does not touch the location. Projects created before #1190 got a
generated, translated name ("Hauptstandort", "Main location", ...); migration
``0146_name_single_default_locations_after_project`` renamed those.
"""

from farm.models import Location, Project

_LOCATION_NAME_MAX_LENGTH = Location._meta.get_field('name').max_length


def initial_location_name(project: Project) -> str:
    """Return the name of a project's first, automatically created location."""
    return project.name[:_LOCATION_NAME_MAX_LENGTH]
