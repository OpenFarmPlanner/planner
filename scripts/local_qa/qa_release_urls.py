"""Expose the running commit in the isolated QA backend."""

import os

from django.http import JsonResponse
from django.urls import include, path
from django.views.decorators.cache import never_cache
from qa_settings import ROOT_URLCONF as workspace_urls


@never_cache
def version(request):
    return JsonResponse({"commit": os.environ.get("OFP_QA_COMMIT", "unversioned")})


urlpatterns = [path("api/qa/version/", version), path("", include(workspace_urls))]
