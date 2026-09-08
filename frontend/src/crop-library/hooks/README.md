# Crop Library hooks

Hooks that are purely about crop library data (browsing, searching a
`Crop`, a public crop's discussions and versions) with no
project/planting-plan context. `usePublicCropDiscussion` lives here. `frontend/src/pages/usePublicCropLibrary.ts` deliberately stays
in `pages/` rather than moving here: it also publishes a project's `Crop`
into the library and imports a `Crop` back into the active project, so it's
the Farm Planning-side integration hook, not a Crop Library one — see
docs/crop-library-architecture.md.
