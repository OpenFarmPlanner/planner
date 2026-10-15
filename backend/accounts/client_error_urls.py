from django.urls import path

from .client_error_views import TurnstileClientErrorView

urlpatterns = [
    path('turnstile/', TurnstileClientErrorView.as_view(), name='client-errors-turnstile'),
]
