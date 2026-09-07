from datetime import date
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest import skipUnless
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.guest_demo import create_guest_demo_session
from farm.image_processing import (
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_SIDE,
    ImageProcessingError,
    process_note_image,
    validate_image_upload,
)
from farm.models import (
    Bed,
    Crop,
    Field,
    Location,
    NoteAttachment,
    PlantingPlan,
    Project,
    ProjectMembership,
)

User = get_user_model()

try:
    from PIL import Image
    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False


@skipUnless(PIL_AVAILABLE, 'Pillow is required for image processing tests')
class NoteAttachmentProcessingApiTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='attachprocuser',
            email='attachproc@example.com',
            password='testpass',
            is_active=True,
        )
        self.project = Project.objects.create(name='Attachment Project', slug='attachment-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        self.location = Location.objects.create(name='Attachment Location', project=self.project)
        self.field = Field.objects.create(
            name='Attachment Field', location=self.location, project=self.project
        )
        self.bed = Bed.objects.create(name='Attachment Bed', field=self.field, project=self.project)
        self.crop = Crop.objects.create(
            name='Attachment Crop',
            growth_duration_days=7,
            harvest_duration_days=2,
            project=self.project,
        )
        self.plan = PlantingPlan.objects.create(
            crop=self.crop,
            bed=self.bed,
            planting_date=date(2024, 3, 1),
            project=self.project,
        )

    def _image_file(
        self, width: int, height: int, file_name: str = 'test.jpg'
    ) -> SimpleUploadedFile:
        image = Image.new('RGB', (width, height), color=(120, 50, 90))
        buffer = BytesIO()
        image.save(buffer, format='JPEG')
        return SimpleUploadedFile(file_name, buffer.getvalue(), content_type='image/jpeg')

    def test_upload_valid_image_resized_and_stored(self):
        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, MEDIA_URL='/media/'):
                upload = self._image_file(4000, 2000)
                response = self.client.post(
                    f'/openfarmplanner/api/notes/{self.plan.id}/attachments/',
                    {'image': upload},
                    format='multipart',
                )

                self.assertEqual(response.status_code, status.HTTP_201_CREATED)
                attachment = NoteAttachment.objects.get(pk=response.data['id'])
                self.assertLessEqual(
                    max(attachment.width or 0, attachment.height or 0), MAX_IMAGE_SIDE
                )
                self.assertTrue(attachment.image.name.startswith(f'notes/{self.plan.id}/'))

    def test_upload_invalid_file_returns_400(self):
        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, MEDIA_URL='/media/'):
                not_image = SimpleUploadedFile(
                    'bad.txt', b'not-an-image', content_type='text/plain'
                )
                response = self.client.post(
                    f'/openfarmplanner/api/notes/{self.plan.id}/attachments/',
                    {'image': not_image},
                    format='multipart',
                )
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_attachment_works(self):
        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, MEDIA_URL='/media/'):
                upload = self._image_file(1200, 900)
                create_response = self.client.post(
                    f'/openfarmplanner/api/notes/{self.plan.id}/attachments/',
                    {'image': upload},
                    format='multipart',
                )
                attachment_id = create_response.data['id']

                delete_response = self.client.delete(
                    f'/openfarmplanner/api/attachments/{attachment_id}/'
                )
                self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
                self.assertFalse(NoteAttachment.objects.filter(pk=attachment_id).exists())

    def test_guest_demo_user_cannot_upload_note_attachment(self):
        demo_session = create_guest_demo_session()
        plan = PlantingPlan.objects.filter(project=demo_session.project).first()
        self.client.force_authenticate(user=demo_session.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(demo_session.project_id)

        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, MEDIA_URL='/media/'):
                response = self.client.post(
                    f'/openfarmplanner/api/notes/{plan.id}/attachments/',
                    {'image': self._image_file(1200, 900)},
                    format='multipart',
                )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'guest_demo_restricted')
        self.assertFalse(NoteAttachment.objects.filter(project=demo_session.project).exists())


@skipUnless(PIL_AVAILABLE, 'Pillow is required for image processing tests')
class ImagePixelLimitTest(TestCase):
    def setUp(self):
        self.upload = SimpleUploadedFile('large.png', b'image-header', content_type='image/png')
        self.oversized_image = MagicMock()
        self.oversized_image.size = (MAX_IMAGE_PIXELS + 1, 1)
        self.oversized_image.format = 'PNG'

    @patch('PIL.Image.open')
    def test_direct_media_validation_rejects_excessive_pixel_count(self, mock_open):
        mock_open.return_value = self.oversized_image

        with self.assertRaisesRegex(ImageProcessingError, 'pixel limit'):
            validate_image_upload(self.upload)

        self.oversized_image.verify.assert_not_called()

    @patch('PIL.Image.open')
    def test_note_processing_rejects_excessive_pixel_count_before_decode(self, mock_open):
        mock_open.return_value = self.oversized_image

        with self.assertRaisesRegex(ImageProcessingError, 'pixel limit'):
            process_note_image(self.upload)

        self.oversized_image.verify.assert_not_called()
