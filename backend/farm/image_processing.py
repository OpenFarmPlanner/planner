"""Utilities for validating and processing uploaded note images."""

from __future__ import annotations

from io import BytesIO
from typing import Protocol

from django.core.files.base import ContentFile

MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_SIDE = 2560
# Compressed image size is not a useful bound on decode cost. Reject images
# above this pixel count before Pillow loads their raster data into memory.
MAX_IMAGE_PIXELS = 25_000_000


class ImageProcessingError(ValueError):
    """Raised when uploaded image processing fails."""


class ImageProcessingBackendUnavailableError(ImageProcessingError):
    """Raised when the image processing backend is not installed."""


class _ImageWithDimensions(Protocol):
    size: tuple[int, int]


# Map the raster formats we accept for direct (non re-encoded) media storage to
# a safe, canonical file extension and MIME type. The extension is derived from
# the *decoded* image format rather than the client-supplied filename, so a
# request cannot control the stored file's extension (e.g. store HTML/SVG under
# an ``image/*`` content-type header).
_ALLOWED_MEDIA_IMAGE_FORMATS: dict[str, tuple[str, str]] = {
    'JPEG': ('jpg', 'image/jpeg'),
    'PNG': ('png', 'image/png'),
    'WEBP': ('webp', 'image/webp'),
    'GIF': ('gif', 'image/gif'),
}


def _validate_image_dimensions(image: _ImageWithDimensions) -> None:
    """Reject invalid or excessively large rasters before decoding pixel data."""
    width, height = image.size
    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        raise ImageProcessingError(
            f'Uploaded image exceeds the {MAX_IMAGE_PIXELS:,}-pixel limit.'
        )


def validate_image_upload(uploaded_file) -> tuple[str, str]:
    """Verify that an upload is a genuine raster image and return (extension, mime).

    The returned extension is derived from the actual decoded image format, never
    from the client-supplied filename or ``Content-Type`` header (both of which are
    attacker-controlled). This prevents storing non-image payloads (HTML, SVG,
    scripts) under an image content-type and a dangerous file extension.
    """
    try:
        from PIL import Image
    except ModuleNotFoundError as exc:
        raise ImageProcessingBackendUnavailableError(
            'Image processing backend is not available. Install Pillow in the backend environment.'
        ) from exc

    if uploaded_file.size > MAX_UPLOAD_SIZE_BYTES:
        raise ImageProcessingError('Uploaded file exceeds the 10MB size limit.')

    uploaded_file.seek(0)
    try:
        image = Image.open(uploaded_file)
        _validate_image_dimensions(image)
        image.verify()
    except ImageProcessingError:
        raise
    except Exception as exc:
        raise ImageProcessingError('Uploaded file is not a valid image.') from exc

    # ``verify()`` leaves the image unusable; reopen to read the detected format.
    uploaded_file.seek(0)
    try:
        detected_format = (Image.open(uploaded_file).format or '').upper()
    except Exception as exc:
        raise ImageProcessingError('Uploaded file is not a valid image.') from exc
    finally:
        uploaded_file.seek(0)

    mapping = _ALLOWED_MEDIA_IMAGE_FORMATS.get(detected_format)
    if mapping is None:
        raise ImageProcessingError('Unsupported file type. Only image uploads are allowed.')
    return mapping


def process_note_image(uploaded_file) -> tuple[ContentFile, dict[str, int | str]]:
    """Validate, orient, downscale and re-encode uploaded image."""
    try:
        from PIL import Image, ImageOps
    except ModuleNotFoundError as exc:
        raise ImageProcessingBackendUnavailableError(
            'Image processing backend is not available. Install Pillow in the backend environment.'
        ) from exc

    if uploaded_file.size > MAX_UPLOAD_SIZE_BYTES:
        raise ImageProcessingError('Uploaded file exceeds the 10MB size limit.')

    uploaded_file.seek(0)
    try:
        image = Image.open(uploaded_file)
        _validate_image_dimensions(image)
        image.verify()
    except ImageProcessingError:
        raise
    except Exception as exc:
        raise ImageProcessingError('Uploaded file is not a valid image.') from exc

    try:
        uploaded_file.seek(0)
        image = Image.open(uploaded_file)
        _validate_image_dimensions(image)
        image = ImageOps.exif_transpose(image)

        if image.mode not in ('RGB', 'RGBA'):
            image = image.convert('RGB')
        elif image.mode == 'RGBA':
            background = Image.new('RGB', image.size, (255, 255, 255))
            background.paste(image, mask=image.getchannel('A'))
            image = background

        image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)

        buffer = BytesIO()
        mime_type = 'image/webp'
        filename = 'processed.webp'
        try:
            image.save(buffer, format='WEBP', quality=90, method=6)
        except Exception:
            buffer = BytesIO()
            image.save(buffer, format='JPEG', quality=90, optimize=True)
            mime_type = 'image/jpeg'
            filename = 'processed.jpg'

        payload = buffer.getvalue()
        content = ContentFile(payload)

        metadata = {
            'width': image.width,
            'height': image.height,
            'size_bytes': len(payload),
            'mime_type': mime_type,
            'filename': filename,
        }
        return content, metadata
    except ImageProcessingError:
        raise
    except Exception as exc:
        raise ImageProcessingError('Failed to process image.') from exc
